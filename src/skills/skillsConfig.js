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
];

const OPTIONAL_SKILLS = [
    'git',
    'image-prompt',
    'mempalace',
    'moltbot',
    'spotify',
    'youtube',
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

module.exports = { MANDATORY_SKILLS, OPTIONAL_SKILLS, resolveEnabledSkills };
