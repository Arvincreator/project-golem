const os = require('os');
const { cleanEnv } = require('../config');

function getSystemFingerprint() {
    return `OS: ${os.platform()} | Arch: ${os.arch()} | Mode: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser')}`;
}

module.exports = { getSystemFingerprint };
