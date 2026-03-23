const {
    parseCookies,
    installSecurityContext,
    buildApiSecurityMiddleware,
    buildOperationGuard,
} = require('../web-dashboard/server/security');

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        payload: null,
        setHeader: jest.fn(function setHeader(key, value) {
            this.headers[key] = value;
        }),
        status: jest.fn(function status(code) {
            this.statusCode = code;
            return this;
        }),
        json: jest.fn(function json(payload) {
            this.payload = payload;
            return this;
        }),
    };
    return res;
}

describe('web-dashboard security middleware', () => {
    beforeEach(() => {
        delete process.env.REMOTE_ACCESS_PASSWORD;
        delete process.env.SYSTEM_OP_TOKEN;
        delete process.env.REMOTE_OP_CONFIRM_WINDOW_MIN;
        delete process.env.REMOTE_AUTH_SESSION_HOURS;
        delete process.env.MAX_AUTH_SESSIONS;
    });

    test('parseCookies handles basic cookie header', () => {
        const parsed = parseCookies('a=1; golem_auth_token=abc123; x=y');
        expect(parsed.a).toBe('1');
        expect(parsed.golem_auth_token).toBe('abc123');
        expect(parsed.x).toBe('y');
    });

    test('api guard blocks remote API requests without auth session', () => {
        process.env.REMOTE_ACCESS_PASSWORD = 'secret';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const middleware = buildApiSecurityMiddleware(server);
        const req = {
            method: 'GET',
            path: '/api/system/status',
            headers: {},
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.payload.error).toContain('Authentication required');
    });

    test('api guard allows /api/system/login without session', () => {
        process.env.REMOTE_ACCESS_PASSWORD = 'secret';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const middleware = buildApiSecurityMiddleware(server);
        const req = {
            method: 'POST',
            path: '/api/system/login',
            headers: {},
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('api guard allows OPTIONS preflight without auth', () => {
        process.env.REMOTE_ACCESS_PASSWORD = 'secret';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const middleware = buildApiSecurityMiddleware(server);
        const req = {
            method: 'OPTIONS',
            path: '/api/system/status',
            headers: {},
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('operation guard allows fresh session for remote sensitive op', () => {
        process.env.REMOTE_ACCESS_PASSWORD = 'secret';
        process.env.REMOTE_OP_CONFIRM_WINDOW_MIN = '10';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const loginReq = {
            headers: { 'user-agent': 'jest' },
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const token = server.createAuthSession(loginReq);

        const guard = buildOperationGuard(server, 'system_restart');
        const req = {
            method: 'POST',
            path: '/api/system/restart',
            headers: { cookie: `golem_auth_token=${token}` },
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const res = createMockRes();
        const next = jest.fn();

        guard(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('operation guard blocks stale remote session when no SYSTEM_OP_TOKEN', () => {
        process.env.REMOTE_ACCESS_PASSWORD = 'secret';
        process.env.REMOTE_OP_CONFIRM_WINDOW_MIN = '1';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const loginReq = {
            headers: { 'user-agent': 'jest' },
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const token = server.createAuthSession(loginReq);
        const session = server.authSessions.get(token);
        session.issuedAt = Date.now() - 2 * 60 * 1000;

        const guard = buildOperationGuard(server, 'system_shutdown');
        const req = {
            method: 'POST',
            path: '/api/system/shutdown',
            headers: { cookie: `golem_auth_token=${token}` },
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const res = createMockRes();
        const next = jest.fn();

        guard(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.payload.error).toContain('Recent authentication required');
    });

    test('operation guard requires SYSTEM_OP_TOKEN when configured', () => {
        process.env.REMOTE_ACCESS_PASSWORD = 'secret';
        process.env.SYSTEM_OP_TOKEN = 'op-secret';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const guard = buildOperationGuard(server, 'mcp_write');

        const deniedReq = {
            method: 'POST',
            path: '/api/mcp/servers',
            headers: {},
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const deniedRes = createMockRes();
        const deniedNext = jest.fn();
        guard(deniedReq, deniedRes, deniedNext);

        expect(deniedNext).not.toHaveBeenCalled();
        expect(deniedRes.status).toHaveBeenCalledWith(403);

        const allowedReq = {
            method: 'POST',
            path: '/api/mcp/servers',
            headers: { 'x-system-op-token': 'op-secret' },
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };
        const allowedRes = createMockRes();
        const allowedNext = jest.fn();
        guard(allowedReq, allowedRes, allowedNext);

        expect(allowedNext).toHaveBeenCalled();
        expect(allowedRes.status).not.toHaveBeenCalled();
    });

    test('operation guard enforces SYSTEM_OP_TOKEN on local request', () => {
        process.env.SYSTEM_OP_TOKEN = 'local-op-secret';

        const server = { allowRemote: true };
        installSecurityContext(server);

        const guard = buildOperationGuard(server, 'system_reload');
        const localDeniedReq = {
            method: 'POST',
            path: '/api/system/reload',
            headers: {},
            ip: '127.0.0.1',
            connection: { remoteAddress: '127.0.0.1' },
        };
        const deniedRes = createMockRes();
        const deniedNext = jest.fn();
        guard(localDeniedReq, deniedRes, deniedNext);

        expect(deniedNext).not.toHaveBeenCalled();
        expect(deniedRes.status).toHaveBeenCalledWith(403);

        const localAllowedReq = {
            ...localDeniedReq,
            headers: { 'x-system-op-token': 'local-op-secret' },
        };
        const allowedRes = createMockRes();
        const allowedNext = jest.fn();
        guard(localAllowedReq, allowedRes, allowedNext);

        expect(allowedNext).toHaveBeenCalled();
        expect(allowedRes.status).not.toHaveBeenCalled();
    });

    test('createAuthSession enforces MAX_AUTH_SESSIONS cap', () => {
        process.env.MAX_AUTH_SESSIONS = '2';
        const server = { allowRemote: true };
        installSecurityContext(server);

        const req = {
            headers: { 'user-agent': 'jest' },
            ip: '8.8.8.8',
            connection: { remoteAddress: '8.8.8.8' },
        };

        const t1 = server.createAuthSession(req);
        const t2 = server.createAuthSession(req);
        const t3 = server.createAuthSession(req);

        expect(server.authSessions.size).toBe(2);
        expect(server.authSessions.has(t1)).toBe(false);
        expect(server.authSessions.has(t2)).toBe(true);
        expect(server.authSessions.has(t3)).toBe(true);
    });
});
