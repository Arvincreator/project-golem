let mockRouterInstance = null;

jest.mock('express', () => ({
    Router: jest.fn(() => mockRouterInstance),
}), { virtual: true });

jest.mock('../web-dashboard/server/security', () => ({
    buildOperationGuard: jest.fn(() => (req, res, next) => next()),
}));

function createRouterMock() {
    const routes = {
        GET: new Map(),
        POST: new Map(),
    };

    return {
        routes,
        get(path, ...handlers) {
            routes.GET.set(path, handlers);
            return this;
        },
        post(path, ...handlers) {
            routes.POST.set(path, handlers);
            return this;
        },
    };
}

function createResponseMock() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

async function invokeHandlers(handlers, req = {}) {
    const res = createResponseMock();
    let index = 0;
    const next = async () => {
        const handler = handlers[index++];
        if (!handler) return;
        if (handler.length >= 3) {
            return handler(req, res, () => next());
        }
        return handler(req, res);
    };
    await next();
    return res;
}

describe('Chat planning mode routes', () => {
    let registerChatRoutes;
    let serverContext;

    beforeEach(() => {
        mockRouterInstance = createRouterMock();
        jest.resetModules();
        registerChatRoutes = require('../web-dashboard/routes/api.chat');

        serverContext = {
            runtimeController: {
                getChatPlanningMode: jest.fn(async () => ({
                    planningMode: { enabled: true, updatedAt: 123 },
                })),
                setChatPlanningMode: jest.fn(async () => ({
                    planningMode: { enabled: false, updatedAt: 456 },
                })),
                sendDashboardChat: jest.fn(async () => ({ success: true })),
                sendDashboardCallback: jest.fn(async () => ({ success: true })),
                getPendingTaskSummary: jest.fn(async () => null),
                getMetacognitionStats: jest.fn(async () => ({})),
                getMetacognitionHistory: jest.fn(async () => ([])),
            },
            broadcastLog: jest.fn(),
            chatHistory: new Map(),
        };

        registerChatRoutes(serverContext);
    });

    afterEach(() => {
        mockRouterInstance = null;
    });

    test('GET /api/chat/planning-mode returns runtime planning status', async () => {
        const handlers = mockRouterInstance.routes.GET.get('/api/chat/planning-mode');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.planningMode.enabled).toBe(true);
        expect(serverContext.runtimeController.getChatPlanningMode).toHaveBeenCalledWith('golem_A');
    });

    test('POST /api/chat/planning-mode updates runtime planning status', async () => {
        const handlers = mockRouterInstance.routes.POST.get('/api/chat/planning-mode');
        const res = await invokeHandlers(handlers, {
            body: { golemId: 'golem_A', enabled: false, persist: true },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.setChatPlanningMode).toHaveBeenCalledWith(
            'golem_A',
            false,
            { persist: true, source: 'dashboard_api' }
        );
    });

    test('POST /api/chat/planning-mode validates enabled type', async () => {
        const handlers = mockRouterInstance.routes.POST.get('/api/chat/planning-mode');
        const res = await invokeHandlers(handlers, {
            body: { golemId: 'golem_A', enabled: 'on' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('enabled');
        expect(serverContext.runtimeController.setChatPlanningMode).not.toHaveBeenCalled();
    });
});
