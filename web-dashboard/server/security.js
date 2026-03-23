const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RateLimiter } = require('../../src/utils/RateLimiter');

const PUBLIC_API_PATHS = new Set(['/api/system/login', '/api/health']);
const auditLogPath = path.resolve(process.cwd(), 'logs', 'security-audit.log');

const uploadLimiter = new RateLimiter({
    maxTokens: 8,
    refillRate: 8 / 60,
    cleanupInterval: 300000,
});

const loginLimiter = new RateLimiter({
    maxTokens: 10,
    refillRate: 10 / (5 * 60),
    cleanupInterval: 300000,
});

const apiLimiter = new RateLimiter({
    maxTokens: 60,
    refillRate: 1,
    cleanupInterval: 300000,
});

function parseCookies(cookieHeader) {
    if (!cookieHeader) return {};
    try {
        return Object.fromEntries(
            cookieHeader
                .split(';')
                .map((cookie) => cookie.trim().split('='))
                .filter((parts) => parts.length === 2)
        );
    } catch (e) {
        return {};
    }
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || '';
}

function isLocalIp(ip) {
    if (!ip) return false;
    return ip.includes('127.0.0.1') || ip === '::1' || ip.includes('::ffff:127.0.0.1');
}

function getAuthTokenFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies.golem_auth_token;
    const headerToken = req.headers['x-golem-auth-token'];
    return String(cookieToken || headerToken || '').trim();
}

function appendAuditRecord(record) {
    try {
        const logDir = path.dirname(auditLogPath);
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.appendFile(auditLogPath, `${JSON.stringify(record)}\n`, () => { });
    } catch (e) {
        // avoid recursive logging failures
    }
}

function auditSecurityEvent(server, event, req, detail = {}) {
    const record = {
        ts: new Date().toISOString(),
        event,
        method: req.method,
        path: req.path,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || '',
        ...detail,
    };

    if (!server.securityEvents) server.securityEvents = [];
    server.securityEvents.push(record);
    if (server.securityEvents.length > 500) server.securityEvents.shift();

    appendAuditRecord(record);
}

function installSecurityContext(server) {
    if (!server.authSessions) server.authSessions = new Map();
    if (!server.securityEvents) server.securityEvents = [];

    const sessionHoursRaw = Number(process.env.REMOTE_AUTH_SESSION_HOURS || 24);
    const sessionHours = Number.isFinite(sessionHoursRaw) && sessionHoursRaw > 0 ? sessionHoursRaw : 24;
    server.authSessionTtlMs = Math.floor(sessionHours * 60 * 60 * 1000);
    const maxAuthSessionsRaw = Number(process.env.MAX_AUTH_SESSIONS || 2000);
    server.maxAuthSessions = Number.isFinite(maxAuthSessionsRaw) && maxAuthSessionsRaw > 0
        ? Math.floor(maxAuthSessionsRaw)
        : 2000;

    server.pruneAuthSessions = function pruneAuthSessions() {
        const now = Date.now();
        for (const [token, session] of server.authSessions.entries()) {
            if (!session || session.expiresAt <= now) {
                server.authSessions.delete(token);
            }
        }
    };

    server.createAuthSession = function createAuthSession(req, overrides = {}) {
        server.pruneAuthSessions();
        while (server.authSessions.size >= server.maxAuthSessions) {
            const oldest = server.authSessions.keys().next();
            if (!oldest || oldest.done) break;
            server.authSessions.delete(oldest.value);
        }

        const ttlMs = overrides.ttlMs || server.authSessionTtlMs;
        const now = Date.now();
        const token = crypto.randomBytes(32).toString('hex');

        server.authSessions.set(token, {
            issuedAt: now,
            expiresAt: now + ttlMs,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || '',
        });

        return token;
    };

    server.resolveAuthToken = function resolveAuthToken(req) {
        return getAuthTokenFromRequest(req);
    };

    server.invalidateAuthSession = function invalidateAuthSession(token) {
        if (token) server.authSessions.delete(token);
    };

    server.isAuthenticatedRequest = function isAuthenticatedRequest(req) {
        server.pruneAuthSessions();
        const token = server.resolveAuthToken(req);
        return !!token && server.authSessions.has(token);
    };

    server.isAuthSessionFresh = function isAuthSessionFresh(req, maxAgeMs) {
        server.pruneAuthSessions();
        const token = server.resolveAuthToken(req);
        if (!token) return false;

        const session = server.authSessions.get(token);
        if (!session) return false;

        return (Date.now() - session.issuedAt) <= maxAgeMs;
    };

    server.isLocalRequest = function isLocalRequest(req) {
        return isLocalIp(getClientIp(req));
    };

    server.requiresRemoteAuth = function requiresRemoteAuth(req) {
        if (!server.allowRemote) return false;

        const remotePassword = String(process.env.REMOTE_ACCESS_PASSWORD || '').trim();
        if (!remotePassword) return false;

        return !server.isLocalRequest(req);
    };
}

function buildApiSecurityMiddleware(server) {
    return (req, res, next) => {
        if (!req.path.startsWith('/api/')) return next();

        const clientIp = getClientIp(req);
        req.clientIp = clientIp;
        if (req.method === 'OPTIONS') return next();

        const normalizedPath = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
        const isUpload = normalizedPath === '/api/upload';
        const isLogin = normalizedPath === '/api/system/login';

        let limiter = apiLimiter;
        let scope = 'api';
        let cost = 1;
        if (isUpload) {
            limiter = uploadLimiter;
            scope = 'upload';
            cost = 4;
        } else if (isLogin) {
            limiter = loginLimiter;
            scope = 'login';
        }

        const limiterKey = `${clientIp}:${scope}`;

        if (!limiter.acquire(limiterKey, cost)) {
            const info = limiter.getInfo(limiterKey);
            res.setHeader('Retry-After', String(Math.ceil(info.retryAfterMs / 1000)));
            auditSecurityEvent(server, 'api_rate_limited', req, {
                retryAfterMs: info.retryAfterMs,
                scope,
            });
            return res.status(429).json({
                error: 'Too many requests',
                retryAfterMs: info.retryAfterMs,
            });
        }

        if (server.requiresRemoteAuth(req) && !PUBLIC_API_PATHS.has(normalizedPath)) {
            if (!server.isAuthenticatedRequest(req)) {
                auditSecurityEvent(server, 'api_auth_denied', req, { reason: 'missing_or_invalid_session' });
                return res.status(401).json({ error: 'Authentication required' });
            }
        }

        return next();
    };
}

function buildOperationGuard(server, actionName) {
    const opName = actionName || 'sensitive_operation';

    return (req, res, next) => {
        const opToken = String(process.env.SYSTEM_OP_TOKEN || '').trim();

        if (opToken) {
            const provided = String(req.headers['x-system-op-token'] || '').trim();
            if (provided === opToken) {
                auditSecurityEvent(server, 'operation_guard_pass', req, { opName, mode: 'token' });
                return next();
            }

            auditSecurityEvent(server, 'operation_guard_denied', req, { opName, reason: 'invalid_op_token' });
            return res.status(403).json({
                error: 'Operation token required',
                message: 'Please provide x-system-op-token for this operation.',
            });
        }

        if (!server.requiresRemoteAuth(req)) return next();

        const confirmWindowMinRaw = Number(process.env.REMOTE_OP_CONFIRM_WINDOW_MIN || 10);
        const confirmWindowMin = Number.isFinite(confirmWindowMinRaw) && confirmWindowMinRaw > 0 ? confirmWindowMinRaw : 10;
        const confirmWindowMs = Math.floor(confirmWindowMin * 60 * 1000);

        if (server.isAuthSessionFresh(req, confirmWindowMs)) {
            auditSecurityEvent(server, 'operation_guard_pass', req, { opName, mode: 'fresh_session' });
            return next();
        }

        auditSecurityEvent(server, 'operation_guard_denied', req, { opName, reason: 'stale_session' });
        return res.status(403).json({
            error: 'Recent authentication required',
            message: `Please login again within ${confirmWindowMin} minutes before running this operation.`,
        });
    };
}

module.exports = {
    parseCookies,
    getClientIp,
    isLocalIp,
    installSecurityContext,
    buildApiSecurityMiddleware,
    buildOperationGuard,
    auditSecurityEvent,
};
