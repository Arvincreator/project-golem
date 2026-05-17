// ============================================================
// 🎯 Skills Configuration - Single Source of Truth
// ============================================================
// MANDATORY: Always injected on init, cannot be toggled off.
// OPTIONAL:  Off by default. Enable via OPTIONAL_SKILLS env var
//            (comma-separated basenames) or persona.skills array.
// ============================================================

const MANDATORY_SKILLS = [
    'actor',
    'chronos',
    'cloud',
    'code-wizard',
    'evolution',
    'log-archive',
    'log-reader',
    'memory',
    'multi-agent',
    'optic-nerve',
    'reincarnate',
    'sys-admin',
    'tool-explorer',
    'adaptive-learning',
    'reflection',
    'session-search',  // 🔍 Hermes-inspired: 歷史對話語意搜尋
    'reference-files',
    'stock-dashboard',
    'collab-calendar',
    'chrome-devtools',
    'duckduckgo-search',
    'duckduckgo-devtools-bridge',
];

const OPTIONAL_SKILLS = [
    'git',
    'image-prompt',
    'moltbot',
    'notebooklm-studio',
    'spotify',
    'youtube',
    // ── 其他選用技能 ──────────────────────────────────────────
    'apple-calendar',   // 🍎 macOS Apple Calendar 整合（僅 macOS）
    'delegate-task',    // 🤝 任務委派
];

/**
 * Given the current OPTIONAL_SKILLS env and persona skills,
 * returns the full set of skill basenames to inject.
 * @param {string} optionalEnv - process.env.OPTIONAL_SKILLS
 * @param {string[]} personaSkills - skills from persona config
 * @returns {Set<string>}
 */
function resolveEnabledSkills(optionalEnv = '', personaSkills = []) {
    const enabledOptional = new Set([
        ...optionalEnv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
        ...personaSkills.map(s => s.toLowerCase()),
    ]);

    return new Set([
        ...MANDATORY_SKILLS,
        ...[...enabledOptional].filter(s => !MANDATORY_SKILLS.includes(s)),
    ]);
}

/**
 * 從 SkillPackageRegistry 動態取得所有已安裝的 package 技能 id，
 * 合併到 MANDATORY_SKILLS 中（不在清單的也不遺漏）。
 * 供 /skills 指令和 SkillIndexManager.sync() 使用。
 */
function resolveAllInstalledSkills(userDataDir) {
    try {
        const SkillPackageRegistry = require('./SkillPackageRegistry');
        const pkgs = SkillPackageRegistry.listSkillPackages({ userDataDir });
        const pkgIds = pkgs.filter(p => p.enabled !== false).map(p => p.id);
        return new Set([...MANDATORY_SKILLS, ...OPTIONAL_SKILLS, ...pkgIds]);
    } catch (_) {
        return new Set([...MANDATORY_SKILLS, ...OPTIONAL_SKILLS]);
    }
}

module.exports = { MANDATORY_SKILLS, OPTIONAL_SKILLS, resolveEnabledSkills, resolveAllInstalledSkills };
