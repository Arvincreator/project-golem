const os = require('os');
const { cleanEnv, CONFIG } = require('../config');

function getSystemFingerprint() {
    const now = new Date();
    const localizedTime = now.toLocaleString('zh-TW', { timeZone: CONFIG.TZ, hour12: false });
    return `OS: ${os.platform()} | Arch: ${os.arch()} | Mode: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser')} | 【當前系統時間】: ${localizedTime} (${CONFIG.TZ})`;
}

module.exports = { getSystemFingerprint };
