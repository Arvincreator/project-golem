// tests/ClaudeGateway.test.js
const ClaudeGateway = require('../src/bridges/ClaudeGateway');

describe('ClaudeGateway', () => {
    let gateway;

    const mockBrain = {
        sendMessage: jest.fn().mockResolvedValue('brain response'),
        recall: jest.fn().mockResolvedValue([{ id: '1', content: 'recall result' }]),
        memorize: jest.fn().mockResolvedValue(undefined),
        _ragProvider: null,
    };

    const mockRAG = {
        augmentedRecall: jest.fn().mockResolvedValue({
            merged: [{ id: 'r1', content: 'rag result' }],
            contextString: '[1] rag result',
        }),
        ingest: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        gateway = new ClaudeGateway(mockBrain, {
            brains: { default: mockBrain },
            ragProvider: mockRAG,
        });
        gateway._token = 'test-token';
    });

    test('constructor initializes correctly', () => {
        expect(gateway._brain).toBe(mockBrain);
        expect(gateway._ragProvider).toBe(mockRAG);
    });

    test('_authenticate passes with correct token', () => {
        const req = { headers: { authorization: 'Bearer test-token' } };
        expect(gateway._authenticate(req)).toBe(true);
    });

    test('_authenticate fails with wrong token', () => {
        const req = { headers: { authorization: 'Bearer wrong-token' } };
        expect(gateway._authenticate(req)).toBe(false);
    });

    test('_authenticate fails with no auth header', () => {
        const req = { headers: {} };
        expect(gateway._authenticate(req)).toBe(false);
    });

    test('_authenticate passes when no token configured', () => {
        gateway._token = null;
        const req = { headers: {} };
        expect(gateway._authenticate(req)).toBe(true);
    });

    test('_checkRateLimit allows within limit', () => {
        for (let i = 0; i < 60; i++) {
            expect(gateway._checkRateLimit('client1')).toBe(true);
        }
    });

    test('_checkRateLimit rejects over limit', () => {
        gateway._rateLimitRpm = 3;
        expect(gateway._checkRateLimit('client1')).toBe(true);
        expect(gateway._checkRateLimit('client1')).toBe(true);
        expect(gateway._checkRateLimit('client1')).toBe(true);
        expect(gateway._checkRateLimit('client1')).toBe(false);
    });

    test('_checkRateLimit resets after window expires', () => {
        gateway._rateLimitRpm = 1;
        expect(gateway._checkRateLimit('client2')).toBe(true);
        expect(gateway._checkRateLimit('client2')).toBe(false);

        // Manually expire timestamps
        gateway._requestCounts.set('client2', [Date.now() - 61000]);
        expect(gateway._checkRateLimit('client2')).toBe(true);
    });

    test('_authenticate uses timing-safe comparison', () => {
        // Same-length tokens with different values
        gateway._token = 'abcdefghijklmnop';
        const req1 = { headers: { authorization: 'Bearer abcdefghijklmnop' } };
        expect(gateway._authenticate(req1)).toBe(true);
        const req2 = { headers: { authorization: 'Bearer xbcdefghijklmnop' } };
        expect(gateway._authenticate(req2)).toBe(false);
    });

    test('_authenticate handles length mismatch gracefully', () => {
        gateway._token = 'short';
        const req = { headers: { authorization: 'Bearer muchlongertoken' } };
        expect(gateway._authenticate(req)).toBe(false);
    });

    test('setContext updates brain and brains', () => {
        const newBrain = { sendMessage: jest.fn() };
        const newBrains = { test: newBrain };
        gateway.setContext(newBrain, newBrains, mockRAG);
        expect(gateway._brain).toBe(newBrain);
        expect(gateway._brains).toBe(newBrains);
        expect(gateway._ragProvider).toBe(mockRAG);
    });

    test('mountRoutes registers expected routes', () => {
        const routes = [];
        const mockApp = {
            use: jest.fn(),
            get: jest.fn((path) => routes.push(`GET ${path}`)),
            post: jest.fn((path) => routes.push(`POST ${path}`)),
        };

        gateway.mountRoutes(mockApp);

        expect(mockApp.use).toHaveBeenCalled();
        expect(routes).toContain('POST /api/claude/chat');
        expect(routes).toContain('POST /api/claude/recall');
        expect(routes).toContain('POST /api/claude/memorize');
        expect(routes).toContain('GET /api/claude/brains');
        expect(routes).toContain('POST /api/claude/brain/:name');
        expect(routes).toContain('GET /api/claude/health');
    });
});
