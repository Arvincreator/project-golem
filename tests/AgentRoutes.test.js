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
        PATCH: new Map(),
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
        patch(path, ...handlers) {
            routes.PATCH.set(path, handlers);
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

describe('Agent routes', () => {
    let registerAgentRoutes;
    let serverContext;

    beforeEach(() => {
        mockRouterInstance = createRouterMock();
        jest.resetModules();
        registerAgentRoutes = require('../web-dashboard/routes/api.agents');

        serverContext = {
            runtimeController: {
                listAgentSessions: jest.fn(async () => ({
                    sessions: [{ id: 'agent_session_000001', status: 'running', objective: 'A' }],
                    workers: [],
                })),
                createAgentSession: jest.fn(async () => ({
                    session: { id: 'agent_session_000002', status: 'pending', objective: 'B' },
                })),
                getAgentOrchestration: jest.fn(async () => ({
                    orchestration: {
                        sessionId: 'agent_session_000001',
                        currentPhase: 'research',
                        nextAction: { action: 'agent_worker_spawn', input: { role: 'research' } },
                    },
                })),
                updateAgentWorker: jest.fn(async () => ({
                    worker: { id: 'agent_worker_000001', status: 'running', sessionId: 'agent_session_000001' },
                    session: { id: 'agent_session_000001', status: 'running', objective: 'A' },
                })),
                resumeAgentSession: jest.fn(async () => ({
                    resumed: true,
                    resumedCount: 1,
                    brief: { nextSession: { id: 'agent_session_000001' } },
                })),
            },
        };

        registerAgentRoutes(serverContext);
    });

    afterEach(() => {
        mockRouterInstance = null;
    });

    test('GET /api/agents/sessions returns session list', async () => {
        const handlers = mockRouterInstance.routes.GET.get('/api/agents/sessions');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
            body: {},
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.listAgentSessions).toHaveBeenCalledWith('golem_A', expect.any(Object));
    });

    test('POST /api/agents/sessions creates a session', async () => {
        const handlers = mockRouterInstance.routes.POST.get('/api/agents/sessions');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
            body: {
                input: { objective: 'B' },
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.createAgentSession).toHaveBeenCalledWith(
            'golem_A',
            { objective: 'B' },
            {}
        );
    });

    test('PATCH /api/agents/workers/:workerId reads idempotency and expected version headers', async () => {
        const handlers = mockRouterInstance.routes.PATCH.get('/api/agents/workers/:workerId');
        const res = await invokeHandlers(handlers, {
            params: { workerId: 'agent_worker_000001' },
            query: { golemId: 'golem_A' },
            headers: {
                'x-idempotency-key': 'idem-agent-1',
                'if-match': '"5"',
            },
            body: {
                patch: { status: 'running' },
            },
        });

        expect(res.statusCode).toBe(200);
        expect(serverContext.runtimeController.updateAgentWorker).toHaveBeenCalledWith(
            'golem_A',
            'agent_worker_000001',
            { status: 'running' },
            { idempotencyKey: 'idem-agent-1', expectedVersion: 5 }
        );
    });

    test('GET /api/agents/sessions/:sessionId/orchestration returns orchestration state', async () => {
        const handlers = mockRouterInstance.routes.GET.get('/api/agents/sessions/:sessionId/orchestration');
        const res = await invokeHandlers(handlers, {
            params: { sessionId: 'agent_session_000001' },
            query: { golemId: 'golem_A' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.orchestration.currentPhase).toBe('research');
        expect(serverContext.runtimeController.getAgentOrchestration).toHaveBeenCalledWith(
            'golem_A',
            'agent_session_000001'
        );
    });

    test('POST /api/agents/sessions/resume resumes sessions', async () => {
        const handlers = mockRouterInstance.routes.POST.get('/api/agents/sessions/resume');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
            body: {
                options: { actor: 'dashboard' },
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.resumeAgentSession).toHaveBeenCalledWith(
            'golem_A',
            { actor: 'dashboard' }
        );
    });
});
