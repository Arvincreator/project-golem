// ============================================================
// Skills Configuration - Single Source of Truth
// ============================================================
const MANDATORY_SKILLS = [
    'adaptive-learning',
    'definition',
    'list-schedules',
    'log-archive',
    'log-reader',
    'model-router',
    'monica-quota',
    'persona',
    'reincarnate',
    'moltbot',
    'schedule',
];

const OPTIONAL_SKILLS = [

];

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
