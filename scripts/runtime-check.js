#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const LOG_DIR = path.join(ROOT, 'logs');
const FALLBACK_DIR = path.join(ROOT, 'data', 'dashboard');
let REPORT_JSON = path.join(LOG_DIR, 'runtime-report.json');
let REPORT_MD = path.join(LOG_DIR, 'runtime-report.md');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function resolveReportPaths() {
  try {
    ensureDir(LOG_DIR);
    fs.accessSync(LOG_DIR, fs.constants.W_OK);
    REPORT_JSON = path.join(LOG_DIR, 'runtime-report.json');
    REPORT_MD = path.join(LOG_DIR, 'runtime-report.md');
    return;
  } catch (_) {
    ensureDir(FALLBACK_DIR);
    REPORT_JSON = path.join(FALLBACK_DIR, 'runtime-report.json');
    REPORT_MD = path.join(FALLBACK_DIR, 'runtime-report.md');
  }
}

function detectHeadless() {
  if (process.env.GOLEM_HEADLESS) return String(process.env.GOLEM_HEADLESS).toLowerCase() === 'true';
  if (process.platform === 'linux') return !process.env.DISPLAY;
  return false;
}

function collectBaseContext() {
  const pkgPath = path.join(ROOT, 'package.json');
  const envPath = path.join(ROOT, '.env');
  const contextPath = path.join(ROOT, 'web-dashboard', 'routes', 'utils', 'context.js');
  const learningsPath = path.join(ROOT, 'golem_memory', 'learnings.json');

  const pkg = fs.existsSync(pkgPath) ? readJson(pkgPath) : {};
  const scripts = pkg.scripts || {};
  return {
    time: nowIso(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    headless: detectHeadless(),
    paths: { pkgPath, envPath, contextPath, learningsPath },
    scripts,
    envExists: fs.existsSync(envPath),
  };
}

function runDoctor() {
  const ctx = collectBaseContext();
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, status: ok ? 'passed' : 'failed', detail, fix: ok ? '' : fix });

  add('env file', ctx.envExists, ctx.envExists ? '.env present' : '.env missing', 'Create .env from .env.example or run setup');

  const hasDashboardStart = String(ctx.scripts.dashboard || '').includes('apps/runtime/index.js dashboard');
  add('dashboard startup script', hasDashboardStart, hasDashboardStart ? 'dashboard script present' : 'dashboard script missing', 'Set package.json script `dashboard` to `node --expose-gc apps/runtime/index.js dashboard`');

  const startIncludesRuntime = String(ctx.scripts.start || '').includes('apps/runtime/index.js');
  add('start runtime entry', startIncludesRuntime, startIncludesRuntime ? 'start points to runtime' : 'start missing runtime entry', 'Set package.json script `start` to runtime entry');

  const contextPath = ctx.paths.contextPath;
  if (fs.existsSync(contextPath)) {
    const content = fs.readFileSync(contextPath, 'utf8');
    const hasSingleFallback =
      content.includes('server.contexts.size === 1') ||
      content.includes('contexts.size === 1') ||
      (content.includes('server.contexts.size === 0') && content.includes('Array.from(server.contexts.keys())[0]'));
    add('context single-id fallback', hasSingleFallback, hasSingleFallback ? 'single-context fallback detected' : 'single-context fallback not detected', 'Add fallback when only one context exists to avoid golemId mismatch');
  } else {
    add('context utils file', false, 'context.js missing', 'Restore web-dashboard/routes/utils/context.js');
  }

  const learningsPath = ctx.paths.learningsPath;
  if (fs.existsSync(learningsPath)) {
    try {
      JSON.parse(fs.readFileSync(learningsPath, 'utf8'));
      add('learnings.json parse', true, 'valid JSON');
    } catch (e) {
      add('learnings.json parse', false, `invalid JSON: ${e.message}`, 'Run repair mode to attempt cleanup');
    }
  } else {
    checks.push({ name: 'learnings.json', status: 'warn', detail: 'file not found (skipped)', fix: '' });
  }

  return { context: ctx, checks };
}

function repairContextFallback(contextPath) {
  if (!fs.existsSync(contextPath)) return { changed: false, detail: 'context.js not found' };
  const raw = fs.readFileSync(contextPath, 'utf8');
  const alreadySafe =
    raw.includes('Array.from(server.contexts.keys())[0]') ||
    raw.includes('server.contexts.size === 1') ||
    raw.includes('contexts.size === 1');
  if (alreadySafe) return { changed: false, detail: 'fallback already present' };

  const anchor = 'if (!server || !server.contexts || server.contexts.size === 0) return null;';
  if (!raw.includes(anchor)) return { changed: false, detail: 'anchor not found; manual review required' };
  const next = raw.replace(
    anchor,
    `${anchor}\n    if (server.contexts.size === 1) return Array.from(server.contexts.keys())[0] || null;`
  );
  if (next === raw) return { changed: false, detail: 'no changes applied' };
  const backup = `${contextPath}.bak.${Date.now()}`;
  fs.copyFileSync(contextPath, backup);
  fs.writeFileSync(contextPath, next, 'utf8');
  return { changed: true, detail: `fallback injected; backup created: ${path.basename(backup)}` };
}

function repairLearnings(learningsPath) {
  if (!fs.existsSync(learningsPath)) return { changed: false, detail: 'file not found' };
  const raw = fs.readFileSync(learningsPath, 'utf8');
  try {
    JSON.parse(raw);
    return { changed: false, detail: 'already valid' };
  } catch (_) {
    const first = raw.indexOf('[');
    const last = raw.lastIndexOf(']');
    if (first === -1 || last === -1 || last <= first) {
      return { changed: false, detail: 'cannot auto-fix malformed json' };
    }
    const candidate = raw.slice(first, last + 1);
    try {
      JSON.parse(candidate);
      const backup = `${learningsPath}.bak.${Date.now()}`;
      fs.copyFileSync(learningsPath, backup);
      fs.writeFileSync(learningsPath, candidate, 'utf8');
      return { changed: true, detail: `repaired and backup created: ${path.basename(backup)}` };
    } catch (e) {
      return { changed: false, detail: `auto-fix failed: ${e.message}` };
    }
  }
}

async function smokeCheck() {
  const portCandidates = [];
  const envPort = Number(process.env.DASHBOARD_PORT || '');
  if (Number.isFinite(envPort) && envPort > 0) portCandidates.push(envPort);
  portCandidates.push(3000, 3001, 4000);

  const uniq = [...new Set(portCandidates)];
  const endpoints = ['/api/system/config', '/api/memory-firewall/status'];
  const results = [];

  for (const port of uniq) {
    let any = false;
    for (const ep of endpoints) {
      const url = `http://127.0.0.1:${port}${ep}`;
      try {
        const res = await fetch(url, { method: 'GET' });
        results.push({ url, ok: res.ok, status: res.status });
        if (res.ok) any = true;
      } catch (e) {
        results.push({ url, ok: false, status: 0, error: e.message });
      }
    }
    if (any) break;
  }
  return results;
}

function hasHealthySmoke(smoke = []) {
  return Array.isArray(smoke) && smoke.some((x) => x && x.ok);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function smokeCheckWithAutoStart() {
  let smoke = await smokeCheck();
  if (hasHealthySmoke(smoke)) return { smoke, autoStarted: false };

  const child = spawn(process.execPath, ['--expose-gc', 'apps/runtime/index.js', 'dashboard'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  });

  try {
    for (let i = 0; i < 8; i += 1) {
      await sleep(2000);
      smoke = await smokeCheck();
      if (hasHealthySmoke(smoke)) return { smoke, autoStarted: true };
    }
    return { smoke, autoStarted: true };
  } finally {
    try { child.kill('SIGTERM'); } catch (_) { }
    await sleep(600);
    if (!child.killed) {
      try { child.kill('SIGKILL'); } catch (_) { }
    }
  }
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Runtime Check Report');
  lines.push(`- time: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- platform: ${report.context.platform} ${report.context.arch}`);
  lines.push(`- node: ${report.context.node}`);
  lines.push(`- headless: ${report.context.headless}`);
  lines.push('');
  lines.push('## Checks');
  for (const c of report.checks) {
    lines.push(`- [${c.status.toUpperCase()}] ${c.name}: ${c.detail}${c.fix ? ` | fix: ${c.fix}` : ''}`);
  }
  if (Array.isArray(report.repairs) && report.repairs.length > 0) {
    lines.push('');
    lines.push('## Repairs');
    for (const r of report.repairs) lines.push(`- ${r.name}: ${r.detail}`);
  }
  if (Array.isArray(report.smoke) && report.smoke.length > 0) {
    lines.push('');
    lines.push('## Smoke');
    for (const s of report.smoke) lines.push(`- ${s.url} => ${s.ok ? 'OK' : 'FAIL'} (${s.status || s.error || 'unknown'})`);
  }
  return lines.join('\n');
}

async function main() {
  const mode = String(process.argv[2] || 'doctor').toLowerCase();
  const withStart = process.argv.includes('--with-start');
  const valid = new Set(['doctor', 'repair', 'smoke', 'all']);
  if (!valid.has(mode)) {
    console.error('Usage: node scripts/runtime-check.js [doctor|repair|smoke|all]');
    process.exit(1);
  }

  ensureDir(LOG_DIR);
  resolveReportPaths();
  const doctor = runDoctor();
  const report = {
    generatedAt: nowIso(),
    mode,
    context: doctor.context,
    checks: doctor.checks,
    repairs: [],
    smoke: []
  };

  if (mode === 'repair' || mode === 'all') {
    const result = repairLearnings(doctor.context.paths.learningsPath);
    report.repairs.push({ name: 'learnings.json', ...result });
    const contextResult = repairContextFallback(doctor.context.paths.contextPath);
    report.repairs.push({ name: 'context-fallback', ...contextResult });
  }

  if (mode === 'smoke' || mode === 'all') {
    if (withStart) {
      const wrapped = await smokeCheckWithAutoStart();
      report.smoke = wrapped.smoke;
      report.repairs.push({
        name: 'smoke-auto-start',
        changed: wrapped.autoStarted,
        detail: wrapped.autoStarted ? 'temporarily started dashboard runtime for smoke check' : 'existing runtime already healthy'
      });
    } else {
      report.smoke = await smokeCheck();
    }
  }

  writeJson(REPORT_JSON, report);
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');

  const failed = report.checks.filter((c) => c.status === 'failed').length;
  console.log(`Runtime check done. failed=${failed}, report=${REPORT_JSON}`);
  if (mode === 'smoke' || mode === 'all') {
    const smokeOk = report.smoke.some((x) => x.ok);
    console.log(`Smoke result: ${smokeOk ? 'OK' : 'NO HEALTHY ENDPOINT'}`);
  }
  process.exit(failed > 0 && mode === 'doctor' ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
