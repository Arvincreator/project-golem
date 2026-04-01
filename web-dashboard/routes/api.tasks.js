const express = require('express');
const { buildOperationGuard } = require('../server/security');

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return String(value)
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function parseExpectedVersionHeader(value) {
    const text = String(value || '').trim();
    if (!text) return undefined;
    const sanitized = text.replace(/^W\//i, '').replace(/"/g, '').trim();
    const parsed = Number(sanitized);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

module.exports = function registerTaskRoutes(server) {
    const router = express.Router();
    const requireTaskMutation = buildOperationGuard(server, 'task_mutation');

    function resolveGolemId(req) {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const query = (req.query && typeof req.query === 'object') ? req.query : {};
        return String(query.golemId || body.golemId || 'golem_A').trim() || 'golem_A';
    }

    function withMutationOptions(req, options = {}, allowExpectedVersion = false) {
        const safeOptions = (options && typeof options === 'object') ? { ...options } : {};
        const headers = (req.headers && typeof req.headers === 'object') ? req.headers : {};
        const decisionHeader = String(headers['x-task-decision'] || '').trim().toLowerCase();
        const decisionMode = (decisionHeader === 'ask' || decisionHeader === 'deny' || decisionHeader === 'allow')
            ? decisionHeader
            : '';
        const actorHeader = String(headers['x-task-actor'] || '').trim();
        const sourceHeader = String(headers['x-task-source'] || '').trim();
        const idempotencyHeader = String(
            headers['x-idempotency-key']
                || headers['idempotency-key']
                || ''
        ).trim();
        if (!safeOptions.idempotencyKey && idempotencyHeader) {
            safeOptions.idempotencyKey = idempotencyHeader;
        }

        if (allowExpectedVersion && safeOptions.expectedVersion === undefined) {
            const expectedFromHeader = parseExpectedVersionHeader(
                headers['x-expected-version'] || headers['if-match']
            );
            if (expectedFromHeader !== undefined) {
                safeOptions.expectedVersion = expectedFromHeader;
            }
        }

        if (!safeOptions.actor && actorHeader) {
            safeOptions.actor = actorHeader;
        }
        if (!safeOptions.source && sourceHeader) {
            safeOptions.source = sourceHeader;
        }
        if ((!safeOptions.decision || typeof safeOptions.decision !== 'object') && decisionMode) {
            safeOptions.decision = {
                mode: decisionMode,
                reason: 'header_override',
            };
        }

        return safeOptions;
    }

    function respondTaskError(res, error) {
        const code = String(error && error.code || '').trim();
        const status = Number(
            error && (error.statusCode || error.status)
            || (code === 'TASK_NOT_FOUND' ? 404 : 500)
        );
        return res.status(Number.isFinite(status) && status > 0 ? status : 500).json({
            error: error && error.message ? error.message : 'Task API failure',
            code: code || undefined,
            details: error && error.details ? error.details : undefined,
        });
    }

    function requireRuntime(res) {
        if (!server.runtimeController) {
            res.status(503).json({ error: 'Runtime controller not ready' });
            return null;
        }
        return server.runtimeController;
    }

    router.get('/api/tasks', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const filters = {
                includeCompleted: parseBoolean(req.query.includeCompleted, true),
                statuses: toArray(req.query.statuses || req.query.status),
                owner: req.query.owner ? String(req.query.owner) : '',
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };

            const result = await runtime.listTasks(golemId, filters);
            return res.json({
                success: true,
                golemId,
                tasks: result && Array.isArray(result.tasks) ? result.tasks : [],
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.get('/api/tasks/recovery', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const result = await runtime.getTaskRecoverySummary(golemId);
            return res.json({
                success: true,
                golemId,
                recovery: result && result.recovery ? result.recovery : null,
                pendingSummary: result && result.pendingSummary ? result.pendingSummary : '',
                resumeBrief: result && result.resumeBrief ? result.resumeBrief : null,
                metrics: result && result.metrics ? result.metrics : null,
                integrity: result && result.integrity ? result.integrity : null,
            });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.get('/api/tasks/resume-brief', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const options = {
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.getTaskResumeBrief(golemId, options);
            return res.json({
                success: true,
                golemId,
                brief: result && result.brief ? result.brief : null,
            });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.get('/api/tasks/audit', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const filters = {
                taskId: req.query.taskId ? String(req.query.taskId) : '',
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.getTaskAudit(golemId, filters);
            return res.json({
                success: true,
                golemId,
                events: result && Array.isArray(result.events) ? result.events : [],
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.get('/api/tasks/metrics', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const result = await runtime.getTaskMetrics(golemId);
            return res.json({
                success: true,
                golemId,
                metrics: result && result.metrics ? result.metrics : null,
            });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.get('/api/tasks/integrity', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const options = {
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.getTaskIntegrity(golemId, options);
            return res.json({
                success: true,
                golemId,
                integrity: result && result.integrity ? result.integrity : null,
            });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.get('/api/tasks/budgets', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const result = await runtime.getTaskBudgets(golemId);
            return res.json({
                success: true,
                golemId,
                budgets: result && result.budgets ? result.budgets : null,
            });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.post('/api/tasks', requireTaskMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const input = (req.body && req.body.input && typeof req.body.input === 'object')
                ? req.body.input
                : req.body;
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.createTask(golemId, input || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.get('/api/tasks/:taskId', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const taskId = String(req.params.taskId || '').trim();
            if (!taskId) return res.status(400).json({ error: 'taskId required' });

            const result = await runtime.getTask(golemId, taskId);
            if (!result || !result.task) {
                return res.status(404).json({ error: 'Task not found' });
            }
            return res.json({ success: true, golemId, task: result.task });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.post('/api/tasks/resume', requireTaskMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : req.body;
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.resumeTask(golemId, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.patch('/api/tasks/:taskId', requireTaskMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const taskId = String(req.params.taskId || '').trim();
            if (!taskId) return res.status(400).json({ error: 'taskId required' });

            const patch = (req.body && req.body.patch && typeof req.body.patch === 'object')
                ? req.body.patch
                : req.body;
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};
            const finalOptions = withMutationOptions(req, options || {}, true);
            const result = await runtime.updateTask(golemId, taskId, patch || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.post('/api/tasks/:taskId/stop', requireTaskMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const taskId = String(req.params.taskId || '').trim();
            if (!taskId) return res.status(400).json({ error: 'taskId required' });

            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : req.body;
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.stopTask(golemId, taskId, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.post('/api/tasks/todo-write', requireTaskMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};

            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.todoWrite(golemId, items, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    router.post('/api/tasks/budgets', requireTaskMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const policy = (req.body && req.body.policy && typeof req.body.policy === 'object')
                ? req.body.policy
                : req.body;
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.setTaskBudgets(golemId, policy || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondTaskError(res, error);
        }
    });

    return router;
};
