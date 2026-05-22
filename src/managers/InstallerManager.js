'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { URL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');
const MCPManager = require('../mcp/MCPManager');
const SkillPackageRegistry = require('./SkillPackageRegistry');
const CapabilityRegistry = require('./CapabilityRegistry');
const ExampleSyncManager = require('./ExampleSyncManager');
const execFileAsync = promisify(execFile);
const REMOTE_INSTALL_MAX_BYTES = 5 * 1024 * 1024;
const INSTALL_REGISTRY_FILE = 'install-registry.json';

function ensureExists(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Path not found: ${filePath}`);
}

function parseJsonFile(filePath) {
  ensureExists(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function normalizeSkillSourceDir(inputPath) {
  const resolved = path.resolve(String(inputPath || '').trim());
  ensureExists(resolved);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('Skill source must be a directory.');
  return resolved;
}

function loadSkillManifest(sourceDir) {
  const manifestPath = path.join(sourceDir, 'manifest.json');
  ensureExists(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest.json');
  if (!manifest.id) throw new Error('manifest.id is required');
  return manifest;
}

function copyDir(sourceDir, targetDir) {
  if (fs.existsSync(targetDir)) {
    const backupDir = `${targetDir}.bak-${Date.now()}`;
    fs.renameSync(targetDir, backupDir);
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function parseGithubUrl(urlInput) {
  const parsed = new URL(String(urlInput || '').trim());
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) throw new Error('GitHub URL 格式錯誤，至少需包含 owner/repo');

  const owner = segments[0];
  const repo = String(segments[1] || '').replace(/\.git$/i, '');
  let branch = 'main';
  let subdir = '';
  if (segments[2] === 'tree' && segments[3]) {
    branch = segments[3];
    if (segments.length > 4) subdir = segments.slice(4).join('/');
  }

  return { host, owner, repo, branch, subdir };
}

function checkGithubSource(parsed) {
  const host = String(parsed.host || '').toLowerCase();
  if (host !== 'github.com') throw new Error(`目前僅支援 github.com 來源：${host}`);
}

function checkMcpUrl(urlInput) {
  const parsed = new URL(String(urlInput || '').trim());
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'https:') throw new Error(`MCP URL 僅允許 https：${urlInput}`);
  return parsed;
}

function downloadFile(urlInput, destPath, maxBytes) {
  return new Promise((resolve, reject) => {
    const seen = new Set();
    function run(urlValue, redirectCount = 0) {
      const urlObj = new URL(urlValue);
      const key = urlObj.toString();
      if (seen.has(key)) return reject(new Error('遠端下載失敗：偵測到循環轉址'));
      seen.add(key);

      const req = https.get(urlObj, (res) => {
        const status = Number(res.statusCode || 0);
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          if (redirectCount >= 5) return reject(new Error('遠端下載失敗：轉址過多'));
          const nextUrl = new URL(location, urlObj).toString();
          res.resume();
          return run(nextUrl, redirectCount + 1);
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`遠端下載失敗：HTTP ${status}`));
        }

        let total = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error(`遠端檔案過大，超過限制 ${maxBytes} bytes`));
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(destPath)));
        out.on('error', reject);
      });

      req.on('error', reject);
    }
    run(urlInput, 0);
  });
}

async function extractZip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  await execFileAsync('unzip', ['-q', zipPath, '-d', outDir]);
}

function findFirstDirectory(baseDir) {
  const names = fs.readdirSync(baseDir);
  for (const name of names) {
    const p = path.join(baseDir, name);
    if (fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

function resolveSkillDirFromExtracted(rootDir, subdir) {
  const repoRoot = findFirstDirectory(rootDir);
  if (!repoRoot) throw new Error('下載內容不含可用資料夾');
  const target = subdir ? path.join(repoRoot, subdir) : repoRoot;
  ensureExists(target);
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) throw new Error('技能目標路徑不是資料夾');
  return target;
}

async function postInstallSync(brain) {
  const userDataDir = brain && brain.userDataDir ? brain.userDataDir : path.resolve(process.cwd(), 'golem_memory');
  CapabilityRegistry.sync(userDataDir);
  const syncResult = ExampleSyncManager.sync(userDataDir);
  if (brain && typeof brain._syncToolVectorIndex === 'function') {
    await brain._syncToolVectorIndex();
  }
  return syncResult;
}

function getUserDataDir(brain) {
  return brain && brain.userDataDir ? brain.userDataDir : path.resolve(process.cwd(), 'golem_memory');
}

class InstallerManager {
  _registryPath(brain) {
    return path.join(getUserDataDir(brain), INSTALL_REGISTRY_FILE);
  }

  _readRegistry(brain) {
    const target = this._registryPath(brain);
    if (!fs.existsSync(target)) return { items: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return { items: [] };
      return parsed;
    } catch (_e) {
      return { items: [] };
    }
  }

  _writeRegistry(brain, payload) {
    const target = this._registryPath(brain);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  }

  _upsertRegistryItem(brain, item) {
    const registry = this._readRegistry(brain);
    const key = `${item.type}:${item.id}`;
    const now = new Date().toISOString();
    const idx = registry.items.findIndex(v => `${v.type}:${v.id}` === key);
    const next = { ...item, updatedAt: now };
    if (idx >= 0) {
      registry.items[idx] = { ...registry.items[idx], ...next };
    } else {
      registry.items.push({ ...next, createdAt: now });
    }
    this._writeRegistry(brain, registry);
    return next;
  }

  _removeRegistryItem(brain, type, id) {
    const registry = this._readRegistry(brain);
    registry.items = registry.items.filter(v => !(v.type === type && v.id === id));
    this._writeRegistry(brain, registry);
  }

  _flattenInstalled(brain) {
    const userDataDir = getUserDataDir(brain);
    const skills = SkillPackageRegistry.listSkillPackages({ userDataDir }).map(pkg => ({
      type: 'skill',
      id: pkg.id,
      name: pkg.name || pkg.id,
      path: pkg.dir,
      sourceType: 'unknown',
      source: '',
      installed: true
    }));
    const mcp = MCPManager.getInstance().getServers().map(cfg => ({
      type: 'mcp',
      id: cfg.name,
      name: cfg.name,
      command: cfg.command,
      enabled: cfg.enabled !== false,
      sourceType: 'unknown',
      source: '',
      installed: true
    }));
    const installedMap = new Map();
    for (const item of [...skills, ...mcp]) installedMap.set(`${item.type}:${item.id}`, item);
    const registry = this._readRegistry(brain);
    for (const item of registry.items) {
      const key = `${item.type}:${item.id}`;
      const merged = { ...(installedMap.get(key) || {}), ...item };
      if (installedMap.has(key)) merged.installed = true;
      installedMap.set(key, merged);
    }
    return [...installedMap.values()].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  }

  async listInstalled(brain) {
    await MCPManager.getInstance().load();
    return this._flattenInstalled(brain);
  }

  async searchInstalled(keyword, brain) {
    const q = String(keyword || '').trim().toLowerCase();
    const items = await this.listInstalled(brain);
    if (!q) return items;
    return items.filter(item => {
      const bucket = [
        item.type,
        item.id,
        item.name,
        item.path,
        item.command,
        item.sourceType,
        item.source
      ].map(v => String(v || '').toLowerCase()).join(' ');
      return bucket.includes(q);
    });
  }

  async installSkillFromPath(sourcePath, brain) {
    const sourceDir = normalizeSkillSourceDir(sourcePath);
    const manifest = loadSkillManifest(sourceDir);
    const safeId = SkillPackageRegistry.safeSkillId(manifest.id, `skill-${Date.now()}`);
    const destRoot = SkillPackageRegistry.getUserSkillPackageDir(brain && brain.userDataDir);
    const destDir = path.join(destRoot, safeId);

    copyDir(sourceDir, destDir);

    // quick health check: load package
    const loaded = SkillPackageRegistry.loadPackage(destDir);
    if (!loaded) throw new Error(`Installed package invalid: ${destDir}`);

    // refresh runtime skill manager
    const skillManager = require('./SkillManager');
    if (skillManager && typeof skillManager.refresh === 'function') {
      skillManager.refresh();
    }

    const syncResult = await postInstallSync(brain);
    const normalizedSource = path.resolve(String(sourcePath || '').trim());
    this._upsertRegistryItem(brain, {
      type: 'skill',
      id: loaded.id,
      name: loaded.name || loaded.id,
      path: destDir,
      sourceType: 'path',
      source: normalizedSource
    });
    return {
      ok: true,
      type: 'skill',
      id: loaded.id,
      name: loaded.name || loaded.id,
      path: destDir,
      syncResult
    };
  }

  async installSkillFromGithub(repoUrl, brain) {
    const gh = parseGithubUrl(repoUrl);
    checkGithubSource(gh);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-skill-gh-'));
    const zipPath = path.join(tmpRoot, 'repo.zip');
    const extractDir = path.join(tmpRoot, 'extract');
    const zipUrl = `https://codeload.github.com/${gh.owner}/${gh.repo}/zip/refs/heads/${gh.branch}`;
    await downloadFile(zipUrl, zipPath, REMOTE_INSTALL_MAX_BYTES);
    await extractZip(zipPath, extractDir);

    const sourceDir = resolveSkillDirFromExtracted(extractDir, gh.subdir);
    const result = await this.installSkillFromPath(sourceDir, brain);
    result.remote = {
      kind: 'github',
      source: repoUrl,
      owner: gh.owner,
      repo: gh.repo,
      branch: gh.branch,
      subdir: gh.subdir || ''
    };
    this._upsertRegistryItem(brain, {
      type: 'skill',
      id: result.id,
      name: result.name || result.id,
      path: result.path,
      sourceType: 'github',
      source: repoUrl
    });
    return result;
  }

  _normalizeMcpConfig(raw = {}) {
    const cfg = { ...raw };
    if (!cfg.name || !cfg.command) {
      throw new Error('MCP config requires fields: name, command');
    }
    cfg.name = String(cfg.name).trim();
    cfg.command = String(cfg.command).trim();
    cfg.args = Array.isArray(cfg.args) ? cfg.args.map(v => String(v)) : [];
    cfg.env = cfg.env && typeof cfg.env === 'object' ? cfg.env : {};
    cfg.timeout = Number(cfg.timeout || 30000);
    cfg.enabled = cfg.enabled !== false;
    cfg.description = String(cfg.description || '').trim();
    return cfg;
  }

  async installMcpFromConfig(configInput, brain) {
    const cfg = this._normalizeMcpConfig(configInput);
    const manager = MCPManager.getInstance();
    await manager.load();

    const existing = manager.getServer(cfg.name);
    if (existing) {
      await manager.updateServer(cfg.name, cfg);
    } else {
      await manager.addServer(cfg);
    }

    const syncResult = await postInstallSync(brain);
    this._upsertRegistryItem(brain, {
      type: 'mcp',
      id: cfg.name,
      name: cfg.name,
      command: cfg.command,
      sourceType: 'json',
      source: JSON.stringify(configInput || {})
    });
    return {
      ok: true,
      type: 'mcp',
      name: cfg.name,
      command: cfg.command,
      syncResult
    };
  }

  async installMcpFromFile(filePath, brain) {
    const resolved = path.resolve(String(filePath || '').trim());
    const parsed = parseJsonFile(resolved);
    const result = await this.installMcpFromConfig(parsed, brain);
    result.source = resolved;
    this._upsertRegistryItem(brain, {
      type: 'mcp',
      id: result.name,
      name: result.name,
      command: result.command,
      sourceType: 'file',
      source: resolved
    });
    return result;
  }

  async installMcpFromJson(jsonText, brain) {
    const parsed = JSON.parse(String(jsonText || '').trim());
    const result = await this.installMcpFromConfig(parsed, brain);
    this._upsertRegistryItem(brain, {
      type: 'mcp',
      id: result.name,
      name: result.name,
      command: result.command,
      sourceType: 'json',
      source: String(jsonText || '').trim()
    });
    return result;
  }

  async installMcpFromUrl(urlInput, brain) {
    const parsed = checkMcpUrl(urlInput);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-mcp-url-'));
    const destPath = path.join(tmpRoot, 'mcp-config.json');
    await downloadFile(parsed.toString(), destPath, REMOTE_INSTALL_MAX_BYTES);
    const result = await this.installMcpFromFile(destPath, brain);
    this._upsertRegistryItem(brain, {
      type: 'mcp',
      id: result.name,
      name: result.name,
      command: result.command,
      sourceType: 'url',
      source: parsed.toString()
    });
    return result;
  }

  async removeInstalled(typeInput, idInput, brain) {
    const type = String(typeInput || '').trim().toLowerCase();
    const id = String(idInput || '').trim();
    if (!type || !id) throw new Error('remove requires: <skill|mcp> <id>');

    await MCPManager.getInstance().load();
    if (type === 'skill') {
      const userSkillRoot = SkillPackageRegistry.getUserSkillPackageDir(getUserDataDir(brain));
      const pkg = SkillPackageRegistry.listSkillPackages({ userDataDir: getUserDataDir(brain) })
        .find(v => v.id === id);
      if (!pkg) throw new Error(`Skill not found: ${id}`);
      const normalizedDir = path.resolve(pkg.dir);
      const normalizedRoot = path.resolve(userSkillRoot);
      if (!normalizedDir.startsWith(normalizedRoot + path.sep) && normalizedDir !== normalizedRoot) {
        throw new Error(`Refuse to remove non-user skill: ${id}`);
      }
      fs.rmSync(normalizedDir, { recursive: true, force: true });
      const skillManager = require('./SkillManager');
      if (skillManager && typeof skillManager.refresh === 'function') skillManager.refresh();
      this._removeRegistryItem(brain, 'skill', id);
      const syncResult = await postInstallSync(brain);
      return { ok: true, type: 'skill', id, syncResult };
    }

    if (type === 'mcp') {
      const manager = MCPManager.getInstance();
      const existed = manager.getServer(id);
      if (!existed) throw new Error(`MCP not found: ${id}`);
      await manager.removeServer(id);
      this._removeRegistryItem(brain, 'mcp', id);
      const syncResult = await postInstallSync(brain);
      return { ok: true, type: 'mcp', id, syncResult };
    }
    throw new Error(`Unsupported type for remove: ${type}`);
  }

  async updateInstalled(typeInput, idInput, brain) {
    const type = String(typeInput || '').trim().toLowerCase();
    const id = String(idInput || '').trim();
    if (!type || !id) throw new Error('update requires: <skill|mcp> <id>');
    await MCPManager.getInstance().load();

    const registry = this._readRegistry(brain);
    const record = registry.items.find(v => v.type === type && v.id === id);
    if (!record) throw new Error(`No install record for ${type}:${id}`);
    if (!record.sourceType || !record.source) {
      throw new Error(`Install record missing source metadata for ${type}:${id}`);
    }

    if (type === 'skill') {
      if (record.sourceType === 'github') return this.installSkillFromGithub(record.source, brain);
      if (record.sourceType === 'path') return this.installSkillFromPath(record.source, brain);
      throw new Error(`Unsupported skill source type: ${record.sourceType}`);
    }
    if (type === 'mcp') {
      if (record.sourceType === 'url') return this.installMcpFromUrl(record.source, brain);
      if (record.sourceType === 'file') return this.installMcpFromFile(record.source, brain);
      if (record.sourceType === 'json') return this.installMcpFromJson(record.source, brain);
      throw new Error(`Unsupported MCP source type: ${record.sourceType}`);
    }
    throw new Error(`Unsupported type for update: ${type}`);
  }
}

module.exports = new InstallerManager();
