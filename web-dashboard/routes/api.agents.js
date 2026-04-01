const express = require('express');
const { buildOperationGuard } = require('../server/security');

function parseExpectedVersionHeader(value) {
    const text = String(value || '').trim();
    if (!text) return undefined;
    const sanitized = text.replace(/^W\//i, '').replace(/"/g, '').trim();
    const parsed = Number(sanitized);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return String(value)
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

module.exports = function registerAgentRoutes(server) {
    const router = express.Router();
    const requireAgentMutation = buildOperationGuard(server, 'agent_mutation');

    function requireRuntime(res) {
        if (!server.runtimeController) {
            res.status(503).json({ error: 'Runtime controller not ready' });
            return null;
        }
        return server.runtimeController;
    }

    function resolveGolemId(req) {
        const query = (req.query && typeof req.query === 'object') ? req.query : {};
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        return compactText(query.golemId || body.golemId, 'golem_A');
    }

    function withMutationOptions(req, options = {}, allowExpectedVersion = false) {
        const safeOptions = (options && typeof options === 'object') ? { ...options } : {};
        const headers = (req.headers && typeof req.headers === 'object') ? req.headers : {};
        const actorHeader = compactText(headers['x-agent-actor'], '');
        const sourceHeader = compactText(headers['x-agent-source'], '');
        const decisionHeader = compactText(headers['x-agent-decision'], '').toLowerCase();
        const idempotencyHeader = compactText(
            headers['x-idempotency-key'] || headers['idempotency-key'],
            ''
        );
        if (!safeOptions.idempotencyKey && idempotencyHeader) {
            safeOptions.idempotencyKey = idempotencyHeader;
        }
        if (!safeOptions.actor && actorHeader) {
            safeOptions.actor = actorHeader;
        }
        if (!safeOptions.source && sourceHeader) {
            safeOptions.source = sourceHeader;
        }
        if ((!safeOptions.decision || typeof safeOptions.decision !== 'object') && ['ask', 'allow', 'deny'].includes(decisionHeader)) {
            safeOptions.decision = {
                mode: decisionHeader,
                reason: 'header_override',
            };
        }
        if (allowExpectedVersion && safeOptions.expectedVersion === undefined) {
            const expectedVersion = parseExpectedVersionHeader(headers['x-expected-version'] || headers['if-match']);
            if (expectedVersion !== undefined) {
                safeOptions.expectedVersion = expectedVersion;
            }
        }
        return safeOptions;
    }

    function respondAgentError(res, error) {
        const code = compactText(error && error.code, '');
        const status = Number(error && (error.statusCode || error.status) || 500);
        return res.status(Number.isFinite(status) && status > 0 ? status : 500).json({
            error: error && error.message ? error.message : 'Agent API failure',
            code: code || undefined,
            details: error && error.details ? error.details : undefined,
        });
    }

    router.get('/api/agents/sessions', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const filters = {
                sessionId: compactText(req.query.sessionId, ''),
                status: compactText(req.query.status, ''),
                statuses: toArray(req.query.statuses || req.query.status),
                includeTerminal: String(req.query.includeTerminal || '').trim().toLowerCase() === 'true',
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.listAgentSessions(golemId, filters);
            return res.json({
                success: true,
                golemId,
                sessions: result && Array.isArray(result.sessions) ? result.sessions : [],
                workers: result && Array.isArray(result.workers) ? result.workers : [],
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/sessions', requireAgentMutation, async (req, res) => {
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
            const result = await runtime.createAgentSession(golemId, input || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/sessions/resume', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : req.body;
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.resumeAgentSession(golemId, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/sessions/:sessionId', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const sessionId = compactText(req.params.sessionId, '');
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const golemId = resolveGolemId(req);
            const result = await runtime.getAgentSession(golemId, sessionId);
            if (!result || !result.session) {
                return res.status(404).json({ error: 'Session not found' });
            }
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/sessions/:sessionId/orchestration', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const sessionId = compactText(req.params.sessionId, '');
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const golemId = resolveGolemId(req);
            const result = await runtime.getAgentOrchestration(golemId, sessionId);
            if (!result || !result.orchestration) {
                return res.status(404).json({ error: 'Session not found' });
            }
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.patch('/api/agents/sessions/:sessionId', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const sessionId = compactText(req.params.sessionId, '');
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const golemId = resolveGolemId(req);
            const patch = (req.body && req.body.patch && typeof req.body.patch === 'object')
                ? req.body.patch
                : req.body;
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};
            const finalOptions = withMutationOptions(req, options || {}, true);
            const result = await runtime.updateAgentSession(golemId, sessionId, patch || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/sessions/:sessionId/resume', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const sessionId = compactText(req.params.sessionId, '');
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const golemId = resolveGolemId(req);
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : req.body;
            const finalOptions = withMutationOptions(req, { ...(options || {}), sessionId }, false);
            const result = await runtime.resumeAgentSession(golemId, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/sessions/:sessionId/wait', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const sessionId = compactText(req.params.sessionId, '');
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const golemId = resolveGolemId(req);
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : req.body;
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.waitAgentSession(golemId, sessionId, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/sessions/:sessionId/stop', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const sessionId = compactText(req.params.sessionId, '');
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const golemId = resolveGolemId(req);
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : req.body;
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.stopAgentSession(golemId, sessionId, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/workers', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const filters = {
                sessionId: compactText(req.query.sessionId, ''),
                status: compactText(req.query.status, ''),
                statuses: toArray(req.query.statuses || req.query.status),
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.listAgentWorkers(golemId, filters);
            return res.json({
                success: true,
                golemId,
                workers: result && Array.isArray(result.workers) ? result.workers : [],
                sessions: result && Array.isArray(result.sessions) ? result.sessions : [],
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/workers', requireAgentMutation, async (req, res) => {
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
            const result = await runtime.createAgentWorker(golemId, input || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/workers/:workerId', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const workerId = compactText(req.params.workerId, '');
            if (!workerId) return res.status(400).json({ error: 'workerId required' });
            const golemId = resolveGolemId(req);
            const result = await runtime.getAgentWorker(golemId, workerId);
            if (!result || !result.worker) {
                return res.status(404).json({ error: 'Worker not found' });
            }
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.patch('/api/agents/workers/:workerId', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const workerId = compactText(req.params.workerId, '');
            if (!workerId) return res.status(400).json({ error: 'workerId required' });
            const golemId = resolveGolemId(req);
            const patch = (req.body && req.body.patch && typeof req.body.patch === 'object')
                ? req.body.patch
                : req.body;
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};
            const finalOptions = withMutationOptions(req, options || {}, true);
            const result = await runtime.updateAgentWorker(golemId, workerId, patch || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/workers/:workerId/message', requireAgentMutation, async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const workerId = compactText(req.params.workerId, '');
            if (!workerId) return res.status(400).json({ error: 'workerId required' });
            const golemId = resolveGolemId(req);
            const input = (req.body && req.body.input && typeof req.body.input === 'object')
                ? req.body.input
                : req.body;
            const options = (req.body && req.body.options && typeof req.body.options === 'object')
                ? req.body.options
                : {};
            const finalOptions = withMutationOptions(req, options || {}, false);
            const result = await runtime.sendAgentMessage(golemId, {
                ...(input || {}),
                workerId,
            }, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/message', requireAgentMutation, async (req, res) => {
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
            const result = await runtime.sendAgentMessage(golemId, input || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/recovery', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const result = await runtime.getAgentRecoverySummary(golemId);
            return res.json({
                success: true,
                golemId,
                recovery: result && result.recovery ? result.recovery : null,
                pendingSummary: result && result.pendingSummary ? result.pendingSummary : '',
                resumeBrief: result && result.resumeBrief ? result.resumeBrief : null,
                metrics: result && result.metrics ? result.metrics : null,
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/resume-brief', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const options = {
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.getAgentResumeBrief(golemId, options);
            return res.json({
                success: true,
                golemId,
                brief: result && result.brief ? result.brief : null,
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/audit', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const filters = {
                sessionId: compactText(req.query.sessionId, ''),
                workerId: compactText(req.query.workerId, ''),
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            };
            const result = await runtime.getAgentAudit(golemId, filters);
            return res.json({
                success: true,
                golemId,
                events: result && Array.isArray(result.events) ? result.events : [],
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/metrics', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const result = await runtime.getAgentMetrics(golemId);
            return res.json({
                success: true,
                golemId,
                metrics: result && result.metrics ? result.metrics : null,
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.get('/api/agents/budgets', async (req, res) => {
        try {
            const runtime = requireRuntime(res);
            if (!runtime) return;
            const golemId = resolveGolemId(req);
            const result = await runtime.getAgentBudgets(golemId);
            return res.json({
                success: true,
                golemId,
                budgets: result && result.budgets ? result.budgets : null,
            });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    router.post('/api/agents/budgets', requireAgentMutation, async (req, res) => {
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
            const result = await runtime.setAgentBudgets(golemId, policy || {}, finalOptions);
            return res.json({ success: true, golemId, ...result });
        } catch (error) {
            return respondAgentError(res, error);
        }
    });

    return router;
};
