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

describe('Task routes', () => {
    let registerTaskRoutes;
    let serverContext;

    beforeEach(() => {
        mockRouterInstance = createRouterMock();
        jest.resetModules();
        registerTaskRoutes = require('../web-dashboard/routes/api.tasks');

        serverContext = {
            runtimeController: {
                listTasks: jest.fn(async () => ({ tasks: [{ id: 'task_1', subject: 'A', status: 'pending' }] })),
                getTask: jest.fn(async () => ({ task: { id: 'task_1', subject: 'A', status: 'pending' } })),
                createTask: jest.fn(async () => ({ task: { id: 'task_2', subject: 'B', status: 'pending' } })),
                updateTask: jest.fn(async () => ({ task: { id: 'task_1', subject: 'A', status: 'in_progress' } })),
                stopTask: jest.fn(async () => ({ task: { id: 'task_1', subject: 'A', status: 'killed' } })),
                todoWrite: jest.fn(async () => ({ changed: [{ id: 'task_1', status: 'in_progress' }] })),
                getTaskRecoverySummary: jest.fn(async () => ({ recovery: { pendingCount: 1, inProgressCount: 0, blockedCount: 0, nextTaskId: 'task_1' }, pendingSummary: '' })),
                getTaskAudit: jest.fn(async () => ({ events: [{ id: 'evt_1', type: 'task.created' }] })),
                getTaskMetrics: jest.fn(async () => ({ metrics: { totals: { totalTasks: 1, byStatus: { pending: 1 } } } })),
                getTaskIntegrity: jest.fn(async () => ({ integrity: { ok: true, violationCount: 0, stats: { taskCount: 1 } } })),
            },
        };

        registerTaskRoutes(serverContext);
    });

    afterEach(() => {
        mockRouterInstance = null;
    });

    test('GET /api/tasks returns task list', async () => {
        const handlers = mockRouterInstance.routes.GET.get('/api/tasks');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
            body: {},
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.listTasks).toHaveBeenCalled();
    });

    test('POST /api/tasks creates a task', async () => {
        const handlers = mockRouterInstance.routes.POST.get('/api/tasks');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
            body: { input: { subject: 'B' } },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.createTask).toHaveBeenCalledWith('golem_A', { subject: 'B' }, {});
    });

    test('PATCH /api/tasks/:taskId updates task', async () => {
        const handlers = mockRouterInstance.routes.PATCH.get('/api/tasks/:taskId');
        const res = await invokeHandlers(handlers, {
            params: { taskId: 'task_1' },
            query: { golemId: 'golem_A' },
            body: { patch: { status: 'in_progress' } },
        });

        expect(res.statusCode).toBe(200);
        expect(serverContext.runtimeController.updateTask).toHaveBeenCalledWith('golem_A', 'task_1', { status: 'in_progress' }, {});
    });

    test('GET /api/tasks/metrics returns telemetry metrics', async () => {
        const handlers = mockRouterInstance.routes.GET.get('/api/tasks/metrics');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A' },
            body: {},
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.getTaskMetrics).toHaveBeenCalledWith('golem_A');
    });

    test('GET /api/tasks/integrity returns integrity report', async () => {
        const handlers = mockRouterInstance.routes.GET.get('/api/tasks/integrity');
        const res = await invokeHandlers(handlers, {
            query: { golemId: 'golem_A', limit: '20' },
            body: {},
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serverContext.runtimeController.getTaskIntegrity).toHaveBeenCalledWith('golem_A', { limit: 20 });
    });

    test('PATCH /api/tasks/:taskId reads idempotency and version headers', async () => {
        const handlers = mockRouterInstance.routes.PATCH.get('/api/tasks/:taskId');
        const res = await invokeHandlers(handlers, {
            params: { taskId: 'task_1' },
            query: { golemId: 'golem_A' },
            headers: {
                'x-idempotency-key': 'idem-123',
                'if-match': '"7"',
            },
            body: { patch: { status: 'in_progress' } },
        });

        expect(res.statusCode).toBe(200);
        expect(serverContext.runtimeController.updateTask).toHaveBeenCalledWith(
            'golem_A',
            'task_1',
            { status: 'in_progress' },
            { idempotencyKey: 'idem-123', expectedVersion: 7 }
        );
    });
});
