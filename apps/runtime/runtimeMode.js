'use strict';

function parseBoolean(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return null;
}

function shouldStartDashboard(options = {}) {
    const argv = Array.isArray(options.argv) ? options.argv : process.argv;
    const env = options.env || process.env;

    const explicit = parseBoolean(env.GOLEM_DASHBOARD_ENABLED);
    if (explicit !== null) return explicit;
    const legacy = parseBoolean(env.ENABLE_WEB_DASHBOARD);
    if (legacy !== null) return legacy;
    if (argv.includes('--no-dashboard')) return false;
    if (argv.includes('dashboard')) return true;
    return true;
}

module.exports = {
    shouldStartDashboard,
    parseBoolean
};
