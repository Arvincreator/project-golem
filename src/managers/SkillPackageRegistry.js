const fs = require('fs');
const path = require('path');

const DEFAULT_PACKAGE_DIRS = [
    path.join(process.cwd(), 'src', 'skills'),          // ✅ 直接放在 src/skills/ 下的技能
    path.join(process.cwd(), 'src', 'skills', 'modules'), // 向後相容：舊的 modules/ 子目錄
    path.join(process.cwd(), 'src', 'skills', 'generated'),
];

function safeSkillId(value, fallback = 'generated-skill') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function getUserSkillPackageDir(userDataDir) {
    const baseDir = userDataDir || path.join(process.cwd(), 'golem_memory');
    return path.join(baseDir, 'skills');
}

function getPackageRoots(userDataDir) {
    // Canonical source first: user-owned skill packages.
    // Fallback: built-in src skills for backward compatibility.
    return [
        getUserSkillPackageDir(userDataDir),
        ...DEFAULT_PACKAGE_DIRS,
    ];
}

function getRootPriority(rootPath, userDataDir) {
    const userRoot = path.resolve(getUserSkillPackageDir(userDataDir));
    const current = path.resolve(rootPath);
    if (current === userRoot) return 0;
    return 10;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPromptFile(promptPath) {
    if (!promptPath || !fs.existsSync(promptPath)) return '';
    return fs.readFileSync(promptPath, 'utf8');
}

function stripPromptScaffolding(content) {
    return String(content || '')
        .replace(/<SkillModule.*?>/gi, '')
        .replace(/<\/SkillModule>/gi, '')
        .trim();
}

function cleanDescriptionLine(line) {
    return String(line || '')
        .replace(/^#+\s*/, '')
        .replace(/^[-*]\s*/, '')
        .replace(/^>\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .trim();
}

function derivePromptMetadata(content, fallbackId) {
    const cleaned = stripPromptScaffolding(content);
    if (!cleaned) return { title: fallbackId, description: '' };

    const lines = cleaned
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const titleLine = lines.find(line => /^#\s+/.test(line))
        || lines.find(line => /已載入技能/.test(line))
        || '';
    const title = cleanDescriptionLine(titleLine)
        .replace(/[【】]/g, '')
        .replace(/^已載入技能[:：]\s*/i, '')
        || fallbackId;

    const descriptionLine = lines.find(line => {
        if (line === titleLine) return false;
        if (/^#{1,6}\s+/.test(line)) return false;
        if (/^<\/?SkillModule/i.test(line)) return false;
        if (/^(使用時機|何時使用|When to use|Action 格式|指令格式|不要使用)/i.test(line)) return false;
        return cleanDescriptionLine(line).length >= 8;
    });

    return {
        title,
        description: cleanDescriptionLine(descriptionLine || ''),
    };
}

function normalizePackage(dir, manifest) {
    const id = safeSkillId(manifest.id || path.basename(dir));
    const entry = String(manifest.entry || 'index.js').trim();
    const prompt = String(manifest.prompt || 'skill.md').trim();
    const action = safeSkillId(manifest.action || id, id);
    const indexPath = path.join(dir, entry);
    const promptPath = path.join(dir, prompt);
    const promptMetadata = derivePromptMetadata(readPromptFile(promptPath), id);

    return {
        id,
        name: String(manifest.name || promptMetadata.title || id).trim(),
        description: String(manifest.description || promptMetadata.description || '').trim(),
        type: String(manifest.type || manifest.category || 'user_generated').trim(),
        enabled: manifest.enabled !== false,
        action,
        entry,
        prompt,
        indexPath,
        promptPath,
        dir,
        manifestPath: path.join(dir, 'manifest.json'),
        manifest: {
            ...manifest,
            id,
            action,
        },
    };
}

function loadPackage(dir) {
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJson(manifestPath);
    const pkg = normalizePackage(dir, manifest);
    if (!fs.existsSync(pkg.indexPath) && !fs.existsSync(pkg.promptPath)) return null;
    return pkg;
}

function listSkillPackages(options = {}) {
    const roots = options.roots || getPackageRoots(options.userDataDir);
    const packages = [];
    const indexById = new Map();

    for (const root of roots) {
        if (!root || typeof fs.existsSync !== 'function' || !fs.existsSync(root)) continue;
        const entries = fs.readdirSync(root, { withFileTypes: true });
        const rootPriority = getRootPriority(root, options.userDataDir);
        for (const entry of entries) {
            const entryName = typeof entry === 'string' ? entry : entry.name;
            let isDirectory = false;
            if (typeof entry === 'string') {
                const candidate = path.join(root, entryName);
                const stats = fs.existsSync(candidate) && typeof fs.statSync === 'function' ? fs.statSync(candidate) : null;
                isDirectory = Boolean(stats && typeof stats.isDirectory === 'function' && stats.isDirectory());
            } else {
                isDirectory = entry.isDirectory();
            }
            if (!isDirectory) continue;
            const dir = path.join(root, entryName);
            try {
                const pkg = loadPackage(dir);
                if (!pkg) continue;
                const candidate = {
                    ...pkg,
                    _sourceRoot: root,
                    _sourcePriority: rootPriority
                };
                const prevIdx = indexById.get(pkg.id);
                if (prevIdx === undefined) {
                    indexById.set(pkg.id, packages.length);
                    packages.push(candidate);
                    continue;
                }
                const prev = packages[prevIdx];
                if (candidate._sourcePriority < (prev._sourcePriority ?? 999)) {
                    packages[prevIdx] = candidate;
                }
            } catch (e) {
                console.warn(`[SkillPackageRegistry] Failed to load ${dir}: ${e.message}`);
            }
        }
    }

    return packages
        .map(pkg => {
            const clean = { ...pkg };
            delete clean._sourceRoot;
            delete clean._sourcePriority;
            return clean;
        })
        .sort((a, b) => a.id.localeCompare(b.id));
}

function readPackagePrompt(pkg) {
    if (!pkg || !fs.existsSync(pkg.promptPath)) return '';
    return stripPromptScaffolding(readPromptFile(pkg.promptPath));
}

function getPackageLastModified(pkg) {
    const paths = [pkg.manifestPath, pkg.promptPath, pkg.indexPath].filter(Boolean);
    let lastModified = 0;
    for (const filePath of paths) {
        if (!fs.existsSync(filePath)) continue;
        lastModified = Math.max(lastModified, fs.statSync(filePath).mtimeMs);
    }
    return lastModified || Date.now();
}

function buildPromptContent(pkg) {
    const promptContent = readPackagePrompt(pkg);
    const lines = [
        `# ${pkg.name || pkg.id}`,
        pkg.description || '',
        '',
        '## Runtime Action',
        `- action: \`${pkg.action || pkg.id}\``,
        `- package: \`${pkg.id}\``,
    ];

    if (promptContent) {
        lines.push('', '## Skill Protocol', promptContent);
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
    safeSkillId,
    getUserSkillPackageDir,
    getPackageRoots,
    loadPackage,
    listSkillPackages,
    readPackagePrompt,
    getPackageLastModified,
    buildPromptContent,
    derivePromptMetadata,
};
