// src/core/SandboxGuard.js
// Sandbox isolation: restrict outbound HTTP to known domains only
const { EXTRA_SANDBOX_DOMAINS } = require('../config/endpoints');

const ALLOWED_DOMAINS = [
    'api.telegram.org',
    'generativelanguage.googleapis.com',
    'aistudio.google.com',
    '.yagami8095.workers.dev',
    'moltbook.io',
    'api.moltbook.io',
    'gemini.google.com',
    'raw.githubusercontent.com',
    'api.github.com',
    'openapi.monica.im',
    'monica.im',
    'localhost',
    ...EXTRA_SANDBOX_DOMAINS,
];

let _suspicious = [];

function isAllowed(url) {
    try {
        const hostname = new URL(url).hostname;
        return ALLOWED_DOMAINS.some(d =>
            d.startsWith('.') ? hostname.endsWith(d) : hostname === d
        );
    } catch { return false; }
}

function install() {
    const originalFetch = globalThis.fetch;
    if (!originalFetch) return;

    globalThis.fetch = async function sandboxedFetch(url, opts) {
        const urlStr = typeof url === 'string' ? url : url?.url || String(url);
        if (!isAllowed(urlStr)) {
            const entry = { url: urlStr, time: new Date().toISOString(), blocked: true };
            _suspicious.push(entry);
            if (_suspicious.length > 100) _suspicious.shift();
            console.warn(`🛡️ [SandboxGuard] Blocked outbound request to: ${urlStr}`);
            throw new Error(`[SandboxGuard] Domain not in whitelist: ${urlStr}`);
        }
        return originalFetch.call(this, url, opts);
    };
    console.log('🛡️ [SandboxGuard] Installed — outbound requests restricted to whitelist');
}

function getSuspicious() { return [..._suspicious]; }
function addDomain(domain) { ALLOWED_DOMAINS.push(domain); }

module.exports = { install, isAllowed, getSuspicious, addDomain, ALLOWED_DOMAINS };
