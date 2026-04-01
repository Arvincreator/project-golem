const fs = require('fs');
const path = require('path');
const { createBillingAdapter } = require('./billing/ProviderBillingAdapter');

const AGENT_ERROR_CODES = Object.freeze({
    AGENT_OBJECTIVE_REQUIRED: 'AGENT_OBJECTIVE_REQUIRED',
    AGENT_SESSION_ID_REQUIRED: 'AGENT_SESSION_ID_REQUIRED',
    AGENT_WORKER_ID_REQUIRED: 'AGENT_WORKER_ID_REQUIRED',
    AGENT_MESSAGE_REQUIRED: 'AGENT_MESSAGE_REQUIRED',
    AGENT_SESSION_ALREADY_EXISTS: 'AGENT_SESSION_ALREADY_EXISTS',
    AGENT_WORKER_ALREADY_EXISTS: 'AGENT_WORKER_ALREADY_EXISTS',
    AGENT_SESSION_NOT_FOUND: 'AGENT_SESSION_NOT_FOUND',
    AGENT_WORKER_NOT_FOUND: 'AGENT_WORKER_NOT_FOUND',
    AGENT_INVALID_STATUS: 'AGENT_INVALID_STATUS',
    AGENT_INVALID_TRANSITION: 'AGENT_INVALID_TRANSITION',
    AGENT_INVALID_WORKER_ROLE: 'AGENT_INVALID_WORKER_ROLE',
    AGENT_MAX_WORKERS_EXCEEDED: 'AGENT_MAX_WORKERS_EXCEEDED',
    AGENT_VERSION_CONFLICT: 'AGENT_VERSION_CONFLICT',
    AGENT_PROTOCOL_UNSUPPORTED: 'AGENT_PROTOCOL_UNSUPPORTED',
    AGENT_BUDGET_HARD_LIMIT: 'AGENT_BUDGET_HARD_LIMIT',
    AGENT_MUTATION_DENIED: 'AGENT_MUTATION_DENIED',
    AGENT_MUTATION_REQUIRES_APPROVAL: 'AGENT_MUTATION_REQUIRES_APPROVAL',
});

const AGENT_ERROR_HTTP_STATUS = Object.freeze({
    AGENT_OBJECTIVE_REQUIRED: 400,
    AGENT_SESSION_ID_REQUIRED: 400,
    AGENT_WORKER_ID_REQUIRED: 400,
    AGENT_MESSAGE_REQUIRED: 400,
    AGENT_SESSION_ALREADY_EXISTS: 409,
    AGENT_WORKER_ALREADY_EXISTS: 409,
    AGENT_SESSION_NOT_FOUND: 404,
    AGENT_WORKER_NOT_FOUND: 404,
    AGENT_INVALID_STATUS: 422,
    AGENT_INVALID_TRANSITION: 422,
    AGENT_INVALID_WORKER_ROLE: 422,
    AGENT_MAX_WORKERS_EXCEEDED: 422,
    AGENT_VERSION_CONFLICT: 409,
    AGENT_PROTOCOL_UNSUPPORTED: 422,
    AGENT_BUDGET_HARD_LIMIT: 409,
    AGENT_MUTATION_DENIED: 403,
    AGENT_MUTATION_REQUIRES_APPROVAL: 403,
});

const SESSION_STATUSES = Object.freeze({
    pending: 'pending',
    running: 'running',
    synthesizing: 'synthesizing',
    completed: 'completed',
    failed: 'failed',
    blocked: 'blocked',
    killed: 'killed',
});

const WORKER_STATUSES = Object.freeze({
    pending: 'pending',
    running: 'running',
    completed: 'completed',
    failed: 'failed',
    blocked: 'blocked',
    killed: 'killed',
});

const VALID_SESSION_STATUSES = new Set(Object.values(SESSION_STATUSES));
const VALID_WORKER_STATUSES = new Set(Object.values(WORKER_STATUSES));
const VALID_WORKER_ROLES = new Set(['research', 'synthesis', 'implementation', 'verification']);

const TERMINAL_SESSION_STATUSES = new Set([
    SESSION_STATUSES.completed,
    SESSION_STATUSES.failed,
    SESSION_STATUSES.killed,
]);

const TERMINAL_WORKER_STATUSES = new Set([
    WORKER_STATUSES.completed,
    WORKER_STATUSES.failed,
    WORKER_STATUSES.killed,
]);

const RESUMABLE_SESSION_STATUSES = new Set([
    SESSION_STATUSES.pending,
    SESSION_STATUSES.running,
    SESSION_STATUSES.synthesizing,
    SESSION_STATUSES.blocked,
    SESSION_STATUSES.failed,
]);

const SESSION_TRANSITIONS = Object.freeze({
    pending: new Set(['running', 'blocked', 'failed', 'killed']),
    running: new Set(['synthesizing', 'completed', 'failed', 'blocked', 'killed']),
    synthesizing: new Set(['running', 'completed', 'failed', 'blocked', 'killed']),
    blocked: new Set(['pending', 'running', 'failed', 'killed']),
    failed: new Set(['running', 'killed']),
    completed: new Set([]),
    killed: new Set([]),
});

const WORKER_TRANSITIONS = Object.freeze({
    pending: new Set(['running', 'completed', 'failed', 'blocked', 'killed']),
    running: new Set(['completed', 'failed', 'blocked', 'killed']),
    blocked: new Set(['pending', 'running', 'failed', 'killed']),
    failed: new Set(['pending', 'running', 'killed']),
    completed: new Set([]),
    killed: new Set([]),
});

function nowTs() {
    return Date.now();
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function normalizeId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
}

function asNonNegativeNumber(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return num >= 0 ? num : fallback;
}

class AgentKernelError extends Error {
    constructor(code, message, details = {}) {
        super(message || code || 'AgentKernelError');
        this.name = 'AgentKernelError';
        this.code = String(code || 'AGENT_KERNEL_ERROR');
        this.statusCode = Number(AGENT_ERROR_HTTP_STATUS[this.code] || 500);
        this.details = (details && typeof details === 'object') ? clone(details) : {};
    }
}

class AgentKernel {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.logDir = options.logDir || path.join(process.cwd(), 'logs');
        this.storageDir = path.join(this.logDir, 'agents');
        this.maxEvents = Number(options.maxEvents || 2500);
        this.maxIdempotencyKeys = Number(options.maxIdempotencyKeys || 800);
        this.strictMode = options.strictMode !== false;
        this.maxWorkers = Math.max(
            1,
            Number(options.maxWorkers || process.env.GOLEM_AGENT_MAX_WORKERS || 3) || 3
        );
        this.billingAdapter = createBillingAdapter(
            options.providerBillingAdapter || process.env.GOLEM_AGENT_BILLING_ADAPTER || 'estimate'
        );
        this._onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        this._listeners = new Set();
        this._recoverySummary = {
            recoveredAt: nowTs(),
            pendingSessions: 0,
            runningSessions: 0,
            blockedSessions: 0,
            failedSessions: 0,
            runningWorkers: 0,
            nextSessionId: null,
        };

        const safeId = normalizeId(this.golemId) || 'default';
        this.filePath = path.join(this.storageDir, `agent_kernel_${safeId}.json`);
        this.state = this._createInitialState();
        this._init();
    }

    _createInitialTelemetry() {
        const ts = nowTs();
        return {
            sessionsCreated: 0,
            workersCreated: 0,
            sessionUpdates: 0,
            workerUpdates: 0,
            stopCalls: 0,
            resumeCalls: 0,
            waitCalls: 0,
            notifications: 0,
            violations: 0,
            idempotencyHits: 0,
            versionConflicts: 0,
            recovery: {
                attempts: 0,
                successes: 0,
                lastRecoveredCount: 0,
                lastRecoveredAt: 0,
            },
            lastUpdatedAt: ts,
        };
    }

    _createInitialState() {
        return {
            version: 1,
            golemId: this.golemId,
            lastSessionSeq: 0,
            lastWorkerSeq: 0,
            lastEventSeq: 0,
            lastRecoverySeq: 0,
            sessions: {},
            workers: {},
            events: [],
            idempotency: {},
            telemetry: this._createInitialTelemetry(),
            budgets: this._createDefaultBudgetPolicy(),
        };
    }

    _init() {
        try {
            fs.mkdirSync(this.storageDir, { recursive: true });
            if (!fs.existsSync(this.filePath)) {
                this._persist();
                this._recomputeRecoverySummary();
                return;
            }

            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                this._persist();
                this._recomputeRecoverySummary();
                return;
            }

            this.state = {
                ...this._createInitialState(),
                ...parsed,
            };
            this.state.sessions = (parsed.sessions && typeof parsed.sessions === 'object') ? parsed.sessions : {};
            this.state.workers = (parsed.workers && typeof parsed.workers === 'object') ? parsed.workers : {};
            this.state.events = Array.isArray(parsed.events) ? parsed.events.slice(-this.maxEvents) : [];
            this.state.idempotency = (parsed.idempotency && typeof parsed.idempotency === 'object')
                ? parsed.idempotency
                : {};
            this.state.telemetry = {
                ...this._createInitialTelemetry(),
                ...(parsed.telemetry && typeof parsed.telemetry === 'object' ? parsed.telemetry : {}),
                recovery: {
                    ...this._createInitialTelemetry().recovery,
                    ...((parsed.telemetry && parsed.telemetry.recovery && typeof parsed.telemetry.recovery === 'object')
                        ? parsed.telemetry.recovery
                        : {}),
                },
            };
            this.state.budgets = this._normalizeBudgetPolicy(parsed.budgets || {});
            this._recomputeRecoverySummary();
            this._recordRecoveryAttempt(this._countRecoverableSessions());
        } catch (error) {
            console.warn(`[AgentKernel:${this.golemId}] init failed: ${error.message}`);
            this.state = this._createInitialState();
            this._persist();
            this._recomputeRecoverySummary();
        }
    }

    _persist() {
        this._touchTelemetry();
        fs.mkdirSync(this.storageDir, { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    }

    _touchTelemetry() {
        if (!this.state.telemetry || typeof this.state.telemetry !== 'object') {
            this.state.telemetry = this._createInitialTelemetry();
        }
        this.state.telemetry.lastUpdatedAt = nowTs();
    }

    _incrementTelemetryCounter(key, delta = 1) {
        if (!this.state.telemetry || typeof this.state.telemetry !== 'object') {
            this.state.telemetry = this._createInitialTelemetry();
        }
        this.state.telemetry[key] = asNonNegativeNumber(this.state.telemetry[key], 0) + delta;
        this._touchTelemetry();
    }

    _emit(type, payload = {}) {
        const event = {
            id: `agent_evt_${String(++this.state.lastEventSeq).padStart(8, '0')}`,
            type: compactText(type, 'agent.event'),
            timestamp: nowTs(),
            golemId: this.golemId,
            ...clone(payload),
        };

        this.state.events.push(event);
        if (this.state.events.length > this.maxEvents) {
            this.state.events.shift();
        }

        if (this._onEvent) {
            try {
                this._onEvent(event);
            } catch (error) {
                console.error(`[AgentKernel:${this.golemId}] onEvent callback failed: ${error.message}`);
            }
        }

        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error(`[AgentKernel:${this.golemId}] listener failed: ${error.message}`);
            }
        }
    }

    onUpdate(listener) {
        if (typeof listener !== 'function') return () => {};
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _toKernelError(code, message, details = {}) {
        return new AgentKernelError(code, message, details);
    }

    _decisionFromOptions(options = {}) {
        if (!options || typeof options !== 'object') return null;
        const decision = options.decision;
        if (!decision || typeof decision !== 'object') return null;
        const mode = compactText(decision.mode, '').toLowerCase();
        if (!mode) return null;
        return {
            mode,
            reason: compactText(decision.reason, ''),
            expiresAt: asNonNegativeNumber(decision.expiresAt, 0),
        };
    }

    _enforceDecision(actionName, options = {}, context = {}) {
        const decision = this._decisionFromOptions(options);
        if (!decision) return;
        const now = nowTs();
        if (decision.expiresAt > 0 && decision.expiresAt <= now) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_MUTATION_REQUIRES_APPROVAL,
                `Approval expired for ${actionName}`,
                {
                    action: actionName,
                    decision,
                    ...context,
                }
            );
        }
        if (decision.mode === 'deny') {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_MUTATION_DENIED,
                `Agent mutation denied for ${actionName}`,
                {
                    action: actionName,
                    decision,
                    ...context,
                }
            );
        }
        if (decision.mode === 'ask') {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_MUTATION_REQUIRES_APPROVAL,
                `Agent mutation requires approval for ${actionName}`,
                {
                    action: actionName,
                    decision,
                    ...context,
                }
            );
        }
    }

    _rememberIdempotency(key, result) {
        const normalized = compactText(key, '');
        if (!normalized) return;
        this.state.idempotency[normalized] = {
            ts: nowTs(),
            result: clone(result),
        };
        this._trimIdempotency();
    }

    _checkIdempotency(key) {
        const normalized = compactText(key, '');
        if (!normalized) return null;
        const hit = this.state.idempotency[normalized];
        if (!hit || typeof hit !== 'object') return null;
        this._incrementTelemetryCounter('idempotencyHits', 1);
        return clone(hit.result);
    }

    _trimIdempotency() {
        const entries = Object.entries(this.state.idempotency || {});
        if (entries.length <= this.maxIdempotencyKeys) return;
        entries.sort((a, b) => Number(a[1].ts || 0) - Number(b[1].ts || 0));
        const overflow = entries.length - this.maxIdempotencyKeys;
        for (let i = 0; i < overflow; i++) {
            delete this.state.idempotency[entries[i][0]];
        }
    }

    _nextSessionId() {
        this.state.lastSessionSeq += 1;
        return `agent_session_${String(this.state.lastSessionSeq).padStart(6, '0')}`;
    }

    _nextWorkerId() {
        this.state.lastWorkerSeq += 1;
        return `agent_worker_${String(this.state.lastWorkerSeq).padStart(6, '0')}`;
    }

    _recordRecoveryAttempt(recoveredCount = 0) {
        const safeCount = asNonNegativeNumber(recoveredCount, 0);
        if (!this.state.telemetry || typeof this.state.telemetry !== 'object') {
            this.state.telemetry = this._createInitialTelemetry();
        }
        this.state.telemetry.recovery = {
            ...this._createInitialTelemetry().recovery,
            ...(this.state.telemetry.recovery || {}),
            attempts: asNonNegativeNumber(this.state.telemetry.recovery && this.state.telemetry.recovery.attempts, 0) + 1,
            successes: asNonNegativeNumber(this.state.telemetry.recovery && this.state.telemetry.recovery.successes, 0)
                + (safeCount > 0 ? 1 : 0),
            lastRecoveredCount: safeCount,
            lastRecoveredAt: nowTs(),
        };
        this._touchTelemetry();
    }

    _countRecoverableSessions() {
        return this.listSessions({ includeTerminal: false }).length;
    }

    _normalizeSessionStatus(value, fallback = SESSION_STATUSES.pending) {
        const normalized = compactText(value, fallback).toLowerCase();
        if (!VALID_SESSION_STATUSES.has(normalized)) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_INVALID_STATUS,
                `Invalid session status: ${value}`,
                { allowed: Array.from(VALID_SESSION_STATUSES) }
            );
        }
        return normalized;
    }

    _normalizeWorkerStatus(value, fallback = WORKER_STATUSES.pending) {
        const normalized = compactText(value, fallback).toLowerCase();
        if (!VALID_WORKER_STATUSES.has(normalized)) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_INVALID_STATUS,
                `Invalid worker status: ${value}`,
                { allowed: Array.from(VALID_WORKER_STATUSES) }
            );
        }
        return normalized;
    }

    _normalizeWorkerRole(value) {
        const role = compactText(value, 'research').toLowerCase();
        if (!VALID_WORKER_ROLES.has(role)) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_INVALID_WORKER_ROLE,
                `Invalid worker role: ${value}`,
                { allowed: Array.from(VALID_WORKER_ROLES) }
            );
        }
        return role;
    }

    _validateSessionTransition(session, nextStatus) {
        const from = compactText(session && session.status, '');
        const to = compactText(nextStatus, '');
        if (!from || !to || from === to) return;
        const allowed = SESSION_TRANSITIONS[from];
        if (!allowed || !allowed.has(to)) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                `Session transition ${from} -> ${to} is not allowed`,
                { sessionId: session && session.id, from, to, allowed: allowed ? Array.from(allowed) : [] }
            );
        }
    }

    _validateWorkerTransition(worker, nextStatus) {
        const from = compactText(worker && worker.status, '');
        const to = compactText(nextStatus, '');
        if (!from || !to || from === to) return;
        const allowed = WORKER_TRANSITIONS[from];
        if (!allowed || !allowed.has(to)) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                `Worker transition ${from} -> ${to} is not allowed`,
                { workerId: worker && worker.id, from, to, allowed: allowed ? Array.from(allowed) : [] }
            );
        }
    }

    _createInitialUsage() {
        return {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            model: '',
            updatedAt: 0,
        };
    }

    _normalizeUsagePatch(rawUsage = {}) {
        const normalized = this.billingAdapter.normalizeUsage(rawUsage);
        if (!normalized || typeof normalized !== 'object') return null;

        return {
            promptTokens: asNonNegativeNumber(normalized.promptTokens, 0),
            completionTokens: asNonNegativeNumber(normalized.completionTokens, 0),
            totalTokens: asNonNegativeNumber(normalized.totalTokens, 0),
            costUsd: asNonNegativeNumber(normalized.costUsd, 0),
            model: compactText(normalized.model, ''),
            replace: normalized.replace === true,
        };
    }

    _mergeUsage(currentUsage = {}, usagePatch = {}, ts = nowTs()) {
        const usage = {
            ...this._createInitialUsage(),
            ...(currentUsage && typeof currentUsage === 'object' ? currentUsage : {}),
        };
        const patch = (usagePatch && typeof usagePatch === 'object') ? usagePatch : {};
        const replace = patch.replace === true;

        const promptTokens = asNonNegativeNumber(patch.promptTokens, 0);
        const completionTokens = asNonNegativeNumber(patch.completionTokens, 0);
        const totalTokensPatch = asNonNegativeNumber(patch.totalTokens, 0);
        const costPatch = asNonNegativeNumber(patch.costUsd, 0);
        const model = compactText(patch.model, '');

        if (replace) {
            usage.promptTokens = promptTokens;
            usage.completionTokens = completionTokens;
            usage.totalTokens = totalTokensPatch > 0 ? totalTokensPatch : (promptTokens + completionTokens);
            usage.costUsd = costPatch;
            usage.model = model || usage.model;
        } else {
            usage.promptTokens += promptTokens;
            usage.completionTokens += completionTokens;
            usage.totalTokens += totalTokensPatch > 0 ? totalTokensPatch : (promptTokens + completionTokens);
            usage.costUsd += costPatch;
            if (model) usage.model = model;
        }

        usage.updatedAt = ts;
        return usage;
    }

    _normalizeBudgetPolicy(input = {}) {
        const base = this._createDefaultBudgetPolicy();
        const safeInput = (input && typeof input === 'object') ? input : {};
        const worker = (safeInput.worker && typeof safeInput.worker === 'object') ? safeInput.worker : {};
        const session = (safeInput.session && typeof safeInput.session === 'object') ? safeInput.session : {};

        return {
            enabled: safeInput.enabled !== false,
            worker: {
                tokenSoftLimit: asNonNegativeNumber(worker.tokenSoftLimit, base.worker.tokenSoftLimit),
                tokenHardLimit: asNonNegativeNumber(worker.tokenHardLimit, base.worker.tokenHardLimit),
                costSoftLimitUsd: asNonNegativeNumber(worker.costSoftLimitUsd, base.worker.costSoftLimitUsd),
                costHardLimitUsd: asNonNegativeNumber(worker.costHardLimitUsd, base.worker.costHardLimitUsd),
            },
            session: {
                tokenSoftLimit: asNonNegativeNumber(session.tokenSoftLimit, base.session.tokenSoftLimit),
                tokenHardLimit: asNonNegativeNumber(session.tokenHardLimit, base.session.tokenHardLimit),
                costSoftLimitUsd: asNonNegativeNumber(session.costSoftLimitUsd, base.session.costSoftLimitUsd),
                costHardLimitUsd: asNonNegativeNumber(session.costHardLimitUsd, base.session.costHardLimitUsd),
            },
            updatedAt: nowTs(),
        };
    }

    _createDefaultBudgetPolicy() {
        return {
            enabled: true,
            worker: {
                tokenSoftLimit: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_WORKER_TOKEN_SOFT_LIMIT, 0),
                tokenHardLimit: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_WORKER_TOKEN_HARD_LIMIT, 0),
                costSoftLimitUsd: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_WORKER_COST_SOFT_LIMIT_USD, 0),
                costHardLimitUsd: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_WORKER_COST_HARD_LIMIT_USD, 0),
            },
            session: {
                tokenSoftLimit: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_SESSION_TOKEN_SOFT_LIMIT, 0),
                tokenHardLimit: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_SESSION_TOKEN_HARD_LIMIT, 0),
                costSoftLimitUsd: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_SESSION_COST_SOFT_LIMIT_USD, 0),
                costHardLimitUsd: asNonNegativeNumber(process.env.GOLEM_AGENT_BUDGET_SESSION_COST_HARD_LIMIT_USD, 0),
            },
            updatedAt: nowTs(),
        };
    }

    _evaluateUsageAgainstBudget(usage = {}, limits = {}) {
        const safeUsage = (usage && typeof usage === 'object') ? usage : {};
        const safeLimits = (limits && typeof limits === 'object') ? limits : {};
        const violations = [];

        const tokenHard = asNonNegativeNumber(safeLimits.tokenHardLimit, 0);
        const costHard = asNonNegativeNumber(safeLimits.costHardLimitUsd, 0);

        if (tokenHard > 0 && asNonNegativeNumber(safeUsage.totalTokens, 0) > tokenHard) {
            violations.push({
                metric: 'totalTokens',
                value: asNonNegativeNumber(safeUsage.totalTokens, 0),
                limit: tokenHard,
            });
        }

        if (costHard > 0 && asNonNegativeNumber(safeUsage.costUsd, 0) > costHard) {
            violations.push({
                metric: 'costUsd',
                value: asNonNegativeNumber(safeUsage.costUsd, 0),
                limit: costHard,
            });
        }

        return violations;
    }

    _enforceBudgets(sessionCandidate = null, workerCandidate = null) {
        const policy = this.state.budgets || this._createDefaultBudgetPolicy();
        if (!policy.enabled) return;

        if (workerCandidate) {
            const workerViolations = this._evaluateUsageAgainstBudget(workerCandidate.usage, policy.worker);
            if (workerViolations.length > 0) {
                throw this._toKernelError(
                    AGENT_ERROR_CODES.AGENT_BUDGET_HARD_LIMIT,
                    'Worker budget hard limit exceeded',
                    {
                        scope: 'worker',
                        workerId: workerCandidate.id,
                        violations: workerViolations,
                    }
                );
            }
        }

        if (sessionCandidate) {
            const sessionViolations = this._evaluateUsageAgainstBudget(sessionCandidate.usage, policy.session);
            if (sessionViolations.length > 0) {
                throw this._toKernelError(
                    AGENT_ERROR_CODES.AGENT_BUDGET_HARD_LIMIT,
                    'Session budget hard limit exceeded',
                    {
                        scope: 'session',
                        sessionId: sessionCandidate.id,
                        violations: sessionViolations,
                    }
                );
            }
        }
    }

    _rebuildSessionUsage(sessionId) {
        const session = this.state.sessions[sessionId];
        if (!session) return this._createInitialUsage();

        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        let costUsd = 0;
        let latestUpdatedAt = 0;
        let latestModel = '';

        const workerIds = Array.isArray(session.workerIds) ? session.workerIds : [];
        for (const workerId of workerIds) {
            const worker = this.state.workers[workerId];
            if (!worker || !worker.usage) continue;
            const usage = worker.usage;
            promptTokens += asNonNegativeNumber(usage.promptTokens, 0);
            completionTokens += asNonNegativeNumber(usage.completionTokens, 0);
            totalTokens += asNonNegativeNumber(usage.totalTokens, 0);
            costUsd += asNonNegativeNumber(usage.costUsd, 0);
            const updatedAt = asNonNegativeNumber(usage.updatedAt, 0);
            if (updatedAt >= latestUpdatedAt) {
                latestUpdatedAt = updatedAt;
                latestModel = compactText(usage.model, latestModel);
            }
        }

        return {
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
            model: latestModel,
            updatedAt: latestUpdatedAt,
        };
    }

    _reconcileSessionStatus(session) {
        if (!session || TERMINAL_SESSION_STATUSES.has(session.status)) {
            return { changed: false, from: session ? session.status : '', to: session ? session.status : '' };
        }

        const workers = (Array.isArray(session.workerIds) ? session.workerIds : [])
            .map((workerId) => this.state.workers[workerId])
            .filter(Boolean);

        if (workers.length === 0) {
            return { changed: false, from: session.status, to: session.status };
        }

        const activeCount = workers.filter((worker) => (
            worker.status === WORKER_STATUSES.pending || worker.status === WORKER_STATUSES.running
        )).length;
        const workflow = (session.metadata && session.metadata.workflow && typeof session.metadata.workflow === 'object')
            ? session.metadata.workflow
            : {};
        const workflowPhase = compactText(workflow.phase, 'research').toLowerCase();
        const managedByCoordinator = workflow.managedByCoordinator === true;

        let nextStatus = session.status;
        if (activeCount > 0) {
            if (session.status === SESSION_STATUSES.pending || session.status === SESSION_STATUSES.blocked || session.status === SESSION_STATUSES.failed) {
                nextStatus = SESSION_STATUSES.running;
            }
        } else if (workers.every((worker) => worker.status === WORKER_STATUSES.completed)) {
            if (managedByCoordinator && workflowPhase !== 'verification') {
                nextStatus = workflowPhase === 'synthesis'
                    ? SESSION_STATUSES.synthesizing
                    : SESSION_STATUSES.running;
            } else {
                nextStatus = SESSION_STATUSES.completed;
            }
        } else if (workers.every((worker) => worker.status === WORKER_STATUSES.killed)) {
            nextStatus = SESSION_STATUSES.killed;
        } else if (workers.some((worker) => worker.status === WORKER_STATUSES.failed)) {
            nextStatus = SESSION_STATUSES.failed;
        } else if (workers.some((worker) => worker.status === WORKER_STATUSES.blocked)) {
            nextStatus = SESSION_STATUSES.blocked;
        }

        if (nextStatus === session.status) {
            return { changed: false, from: session.status, to: session.status };
        }

        this._validateSessionTransition(session, nextStatus);
        const from = session.status;
        session.status = nextStatus;
        if (TERMINAL_SESSION_STATUSES.has(nextStatus)) {
            session.completedAt = nowTs();
        }
        session.version = asNonNegativeNumber(session.version, 0) + 1;
        session.updatedAt = nowTs();
        return { changed: true, from, to: nextStatus };
    }

    _getSessionOrThrow(sessionId) {
        const id = compactText(sessionId, '');
        if (!id) {
            throw this._toKernelError(AGENT_ERROR_CODES.AGENT_SESSION_ID_REQUIRED, 'sessionId is required');
        }
        const session = this.state.sessions[id];
        if (!session) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_SESSION_NOT_FOUND,
                `Session not found: ${id}`,
                { sessionId: id }
            );
        }
        return session;
    }

    _getWorkerOrThrow(workerId) {
        const id = compactText(workerId, '');
        if (!id) {
            throw this._toKernelError(AGENT_ERROR_CODES.AGENT_WORKER_ID_REQUIRED, 'workerId is required');
        }
        const worker = this.state.workers[id];
        if (!worker) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_WORKER_NOT_FOUND,
                `Worker not found: ${id}`,
                { workerId: id }
            );
        }
        return worker;
    }

    _emitBudgetViolation(error, payload = {}) {
        this._incrementTelemetryCounter('violations', 1);
        this._emit('agent.violation', {
            code: error.code || AGENT_ERROR_CODES.AGENT_BUDGET_HARD_LIMIT,
            message: error.message,
            details: error.details || {},
            ...payload,
        });
    }

    _recomputeRecoverySummary() {
        const sessions = this.listSessions({ includeTerminal: false });
        const pendingSessions = sessions.filter((session) => session.status === SESSION_STATUSES.pending).length;
        const runningSessions = sessions.filter((session) => (
            session.status === SESSION_STATUSES.running || session.status === SESSION_STATUSES.synthesizing
        )).length;
        const blockedSessions = sessions.filter((session) => session.status === SESSION_STATUSES.blocked).length;
        const failedSessions = sessions.filter((session) => session.status === SESSION_STATUSES.failed).length;
        const runningWorkers = this.listWorkers({ statuses: [WORKER_STATUSES.running] }).length;
        const nextSession = sessions.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0] || null;

        this._recoverySummary = {
            recoveredAt: nowTs(),
            pendingSessions,
            runningSessions,
            blockedSessions,
            failedSessions,
            runningWorkers,
            nextSessionId: nextSession ? nextSession.id : null,
        };
    }

    getRecoverySummary() {
        return clone(this._recoverySummary);
    }

    getResumeBrief(options = {}) {
        const limitRaw = Number(options.limit || 12);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 12;

        const sessions = this.listSessions({ includeTerminal: false })
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
            .slice(0, limit)
            .map((session) => ({
                id: session.id,
                objective: session.objective,
                status: session.status,
                phase: session && session.metadata && session.metadata.workflow && session.metadata.workflow.phase
                    ? session.metadata.workflow.phase
                    : 'research',
                workerCount: Array.isArray(session.workerIds) ? session.workerIds.length : 0,
                updatedAt: session.updatedAt,
            }));

        const runningSession = sessions.find((session) => session.status === SESSION_STATUSES.running)
            || sessions.find((session) => session.status === SESSION_STATUSES.synthesizing)
            || null;
        const nextSession = runningSession || sessions[0] || null;

        return {
            recoveredAt: this._recoverySummary.recoveredAt,
            recoveredSessions: sessions.length,
            runningWorkers: this._recoverySummary.runningWorkers,
            runningSession,
            nextSession,
            sessions,
        };
    }

    nextRecoverySequence(options = {}) {
        this.state.lastRecoverySeq = asNonNegativeNumber(this.state.lastRecoverySeq, 0) + 1;
        if (options.persist !== false) this._persist();
        return this.state.lastRecoverySeq;
    }

    createSession(input = {}, options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_session_create', options, {
            objective: compactText(input.objective || input.subject, ''),
        });

        const objective = compactText(input.objective || input.subject, '');
        if (!objective) {
            throw this._toKernelError(AGENT_ERROR_CODES.AGENT_OBJECTIVE_REQUIRED, 'Session objective is required');
        }

        const requestedId = compactText(input.sessionId || input.id, '');
        const sessionId = requestedId || this._nextSessionId();
        if (this.state.sessions[sessionId]) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_SESSION_ALREADY_EXISTS,
                `Session already exists: ${sessionId}`,
                { sessionId }
            );
        }

        const now = nowTs();
        const status = this._normalizeSessionStatus(input.status, SESSION_STATUSES.pending);
        const metadata = (input.metadata && typeof input.metadata === 'object') ? clone(input.metadata) : {};
        const workflow = (metadata.workflow && typeof metadata.workflow === 'object') ? metadata.workflow : {};
        metadata.workflow = {
            ...(workflow && typeof workflow === 'object' ? workflow : {}),
            phase: compactText(workflow.phase, 'research'),
            order: Array.isArray(workflow.order) && workflow.order.length > 0
                ? workflow.order.slice(0, 8)
                : ['research', 'synthesis', 'implementation', 'verification'],
            updatedAt: now,
            managedByCoordinator: workflow.managedByCoordinator === true,
        };

        const session = {
            id: sessionId,
            objective,
            strategy: compactText(input.strategy, ''),
            status,
            version: 1,
            createdAt: now,
            updatedAt: now,
            completedAt: 0,
            source: compactText(input.source || options.source, 'agent_action'),
            actor: compactText(options.actor, 'system'),
            workerIds: [],
            messageQueue: [],
            usage: this._createInitialUsage(),
            metadata,
            nextStep: compactText(input.nextStep, ''),
            lastError: compactText(input.lastError, ''),
        };

        this.state.sessions[sessionId] = session;
        this._incrementTelemetryCounter('sessionsCreated', 1);
        this._recomputeRecoverySummary();
        this._persist();
        this._emit('agent.session.created', {
            sessionId,
            session: clone(session),
            actor: compactText(options.actor, 'system'),
            source: compactText(options.source, 'agent_action'),
        });

        const result = { session: clone(session) };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    getSession(sessionId) {
        const id = compactText(sessionId, '');
        if (!id) return null;
        const session = this.state.sessions[id];
        return session ? clone(session) : null;
    }

    listSessions(filters = {}) {
        const includeTerminal = filters.includeTerminal === true || filters.includeCompleted === true;
        const statuses = new Set(
            Array.isArray(filters.statuses)
                ? filters.statuses.map((status) => compactText(status, '').toLowerCase()).filter(Boolean)
                : []
        );
        const limitRaw = Number(filters.limit || 0);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 0;

        let sessions = Object.values(this.state.sessions || {});
        if (!includeTerminal) {
            sessions = sessions.filter((session) => !TERMINAL_SESSION_STATUSES.has(session.status));
        }
        if (statuses.size > 0) {
            sessions = sessions.filter((session) => statuses.has(session.status));
        }
        sessions = sessions.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        if (limit > 0) sessions = sessions.slice(0, limit);
        return clone(sessions);
    }

    updateSession(sessionId, patch = {}, options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_session_update', options, {
            sessionId: compactText(sessionId, ''),
        });

        const session = this._getSessionOrThrow(sessionId);
        const expectedVersion = options.expectedVersion;
        if (expectedVersion !== undefined && asNonNegativeNumber(session.version, 0) !== asNonNegativeNumber(expectedVersion, -1)) {
            this._incrementTelemetryCounter('versionConflicts', 1);
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_VERSION_CONFLICT,
                `Session version conflict: expected=${expectedVersion}, actual=${session.version}`,
                { sessionId: session.id, expectedVersion, actualVersion: session.version }
            );
        }

        const previous = clone(session);
        const now = nowTs();

        if (patch.status !== undefined) {
            const nextStatus = this._normalizeSessionStatus(patch.status, session.status);
            this._validateSessionTransition(session, nextStatus);
            session.status = nextStatus;
            if (TERMINAL_SESSION_STATUSES.has(nextStatus)) {
                session.completedAt = now;
            }
        }
        if (patch.objective !== undefined) session.objective = compactText(patch.objective, session.objective);
        if (patch.strategy !== undefined) session.strategy = compactText(patch.strategy, session.strategy);
        if (patch.nextStep !== undefined) session.nextStep = compactText(patch.nextStep, session.nextStep);
        if (patch.lastError !== undefined) session.lastError = compactText(patch.lastError, session.lastError);
        if (patch.clearError === true) session.lastError = '';

        if (patch.metadata && typeof patch.metadata === 'object') {
            if (patch.replaceMetadata === true) {
                session.metadata = clone(patch.metadata);
            } else {
                session.metadata = {
                    ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
                    ...clone(patch.metadata),
                };
            }
        }

        const usagePatch = this._normalizeUsagePatch(patch.usage || {});
        if (usagePatch) {
            session.usage = this._mergeUsage(session.usage, usagePatch, now);
        }

        try {
            this._enforceBudgets(session, null);
        } catch (error) {
            this._emitBudgetViolation(error, { sessionId: session.id });
            throw error;
        }

        session.version = asNonNegativeNumber(session.version, 0) + 1;
        session.updatedAt = now;
        this._incrementTelemetryCounter('sessionUpdates', 1);
        this._recomputeRecoverySummary();
        this._persist();

        const eventPayload = {
            sessionId: session.id,
            previousStatus: previous.status,
            status: session.status,
            session: clone(session),
            actor: compactText(options.actor, 'system'),
            source: compactText(options.source, 'agent_action'),
        };
        this._emit('agent.session.updated', eventPayload);
        if (session.status === SESSION_STATUSES.failed || session.status === SESSION_STATUSES.blocked) {
            this._emit('agent.violation', {
                sessionId: session.id,
                status: session.status,
                reason: session.lastError || 'session_transition',
                source: compactText(options.source, 'agent_action'),
            });
        }

        const result = { session: clone(session) };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    spawnWorker(input = {}, options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_worker_spawn', options, {
            sessionId: compactText(input.sessionId, ''),
            role: compactText(input.role, ''),
        });

        const sessionId = compactText(input.sessionId, '');
        if (!sessionId) {
            throw this._toKernelError(AGENT_ERROR_CODES.AGENT_SESSION_ID_REQUIRED, 'sessionId is required for worker spawn');
        }
        const session = this._getSessionOrThrow(sessionId);
        const currentWorkers = Array.isArray(session.workerIds) ? session.workerIds : [];
        if (currentWorkers.length >= this.maxWorkers) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_MAX_WORKERS_EXCEEDED,
                `Session worker limit reached (${this.maxWorkers})`,
                { sessionId, maxWorkers: this.maxWorkers, currentWorkers: currentWorkers.length }
            );
        }

        const requestedWorkerId = compactText(input.workerId || input.id, '');
        const workerId = requestedWorkerId || this._nextWorkerId();
        if (this.state.workers[workerId]) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_WORKER_ALREADY_EXISTS,
                `Worker already exists: ${workerId}`,
                { workerId }
            );
        }

        const now = nowTs();
        const worker = {
            id: workerId,
            sessionId,
            role: this._normalizeWorkerRole(input.role),
            prompt: compactText(input.prompt || input.message, ''),
            model: compactText(input.model, ''),
            runInBackground: input.runInBackground === true,
            isolation: compactText(input.isolation, ''),
            status: this._normalizeWorkerStatus(input.status, WORKER_STATUSES.pending),
            version: 1,
            createdAt: now,
            updatedAt: now,
            completedAt: 0,
            usage: this._createInitialUsage(),
            progress: {
                phase: compactText(input.progress && input.progress.phase, 'queued'),
                percent: asNonNegativeNumber(input.progress && input.progress.percent, 0),
            },
            metadata: (input.metadata && typeof input.metadata === 'object') ? clone(input.metadata) : {},
            messages: [],
            output: '',
            lastError: '',
        };

        this.state.workers[workerId] = worker;
        session.workerIds = [...currentWorkers, workerId];
        session.updatedAt = now;
        session.version = asNonNegativeNumber(session.version, 0) + 1;
        if (session.status === SESSION_STATUSES.pending) {
            this._validateSessionTransition(session, SESSION_STATUSES.running);
            session.status = SESSION_STATUSES.running;
        }

        session.usage = this._rebuildSessionUsage(session.id);
        try {
            this._enforceBudgets(session, worker);
        } catch (error) {
            delete this.state.workers[workerId];
            session.workerIds = currentWorkers;
            session.version = Math.max(1, asNonNegativeNumber(session.version, 1) - 1);
            this._emitBudgetViolation(error, { sessionId: session.id, workerId });
            throw error;
        }

        this._incrementTelemetryCounter('workersCreated', 1);
        this._recomputeRecoverySummary();
        this._persist();
        this._emit('agent.worker.created', {
            sessionId: session.id,
            workerId: worker.id,
            worker: clone(worker),
            actor: compactText(options.actor, 'system'),
            source: compactText(options.source, 'agent_action'),
        });
        this._emit('agent.session.updated', {
            sessionId: session.id,
            status: session.status,
            session: clone(session),
            source: compactText(options.source, 'agent_action'),
            actor: compactText(options.actor, 'system'),
        });

        const result = {
            session: clone(session),
            worker: clone(worker),
        };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    getWorker(workerId) {
        const id = compactText(workerId, '');
        if (!id) return null;
        const worker = this.state.workers[id];
        return worker ? clone(worker) : null;
    }

    listWorkers(filters = {}) {
        const sessionId = compactText(filters.sessionId, '');
        const statuses = new Set(
            Array.isArray(filters.statuses)
                ? filters.statuses.map((status) => compactText(status, '').toLowerCase()).filter(Boolean)
                : []
        );
        const limitRaw = Number(filters.limit || 0);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 0;

        let workers = Object.values(this.state.workers || {});
        if (sessionId) workers = workers.filter((worker) => worker.sessionId === sessionId);
        if (statuses.size > 0) workers = workers.filter((worker) => statuses.has(worker.status));
        workers = workers.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        if (limit > 0) workers = workers.slice(0, limit);
        return clone(workers);
    }

    updateWorker(workerId, patch = {}, options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_worker_update', options, {
            workerId: compactText(workerId, ''),
        });

        const worker = this._getWorkerOrThrow(workerId);
        const session = this._getSessionOrThrow(worker.sessionId);
        const expectedVersion = options.expectedVersion;
        if (expectedVersion !== undefined && asNonNegativeNumber(worker.version, 0) !== asNonNegativeNumber(expectedVersion, -1)) {
            this._incrementTelemetryCounter('versionConflicts', 1);
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_VERSION_CONFLICT,
                `Worker version conflict: expected=${expectedVersion}, actual=${worker.version}`,
                { workerId: worker.id, expectedVersion, actualVersion: worker.version }
            );
        }

        const previousWorker = clone(worker);
        const previousSession = clone(session);
        const now = nowTs();

        try {
            if (patch.status !== undefined) {
                const nextStatus = this._normalizeWorkerStatus(patch.status, worker.status);
                this._validateWorkerTransition(worker, nextStatus);
                worker.status = nextStatus;
                if (TERMINAL_WORKER_STATUSES.has(nextStatus)) {
                    worker.completedAt = now;
                }
            }

            if (patch.prompt !== undefined) worker.prompt = compactText(patch.prompt, worker.prompt);
            if (patch.model !== undefined) worker.model = compactText(patch.model, worker.model);
            if (patch.output !== undefined) worker.output = compactText(patch.output, worker.output);
            if (patch.lastError !== undefined) worker.lastError = compactText(patch.lastError, worker.lastError);
            if (patch.clearError === true) worker.lastError = '';
            if (patch.progress && typeof patch.progress === 'object') {
                worker.progress = {
                    ...(worker.progress && typeof worker.progress === 'object' ? worker.progress : {}),
                    ...clone(patch.progress),
                    percent: asNonNegativeNumber(
                        patch.progress.percent,
                        asNonNegativeNumber(worker.progress && worker.progress.percent, 0)
                    ),
                    phase: compactText(
                        patch.progress.phase,
                        compactText(worker.progress && worker.progress.phase, 'running')
                    ),
                };
            }
            if (patch.metadata && typeof patch.metadata === 'object') {
                worker.metadata = {
                    ...(worker.metadata && typeof worker.metadata === 'object' ? worker.metadata : {}),
                    ...clone(patch.metadata),
                };
            }

            const usagePatch = this._normalizeUsagePatch(patch.usage || {});
            if (usagePatch) {
                worker.usage = this._mergeUsage(worker.usage, usagePatch, now);
            }

            worker.version = asNonNegativeNumber(worker.version, 0) + 1;
            worker.updatedAt = now;

            if (session.status === SESSION_STATUSES.pending && worker.status === WORKER_STATUSES.running) {
                this._validateSessionTransition(session, SESSION_STATUSES.running);
                session.status = SESSION_STATUSES.running;
            }

            session.usage = this._rebuildSessionUsage(session.id);
            const reconcile = this._reconcileSessionStatus(session);
            session.updatedAt = now;

            this._enforceBudgets(session, worker);

            this._incrementTelemetryCounter('workerUpdates', 1);
            if (reconcile.changed) {
                this._incrementTelemetryCounter('sessionUpdates', 1);
            }
            this._recomputeRecoverySummary();
            this._persist();

            this._emit('agent.worker.updated', {
                sessionId: session.id,
                workerId: worker.id,
                previousStatus: previousWorker.status,
                status: worker.status,
                worker: clone(worker),
                actor: compactText(options.actor, 'system'),
                source: compactText(options.source, 'agent_action'),
            });

            if (reconcile.changed) {
                this._emit('agent.session.updated', {
                    sessionId: session.id,
                    previousStatus: reconcile.from,
                    status: reconcile.to,
                    session: clone(session),
                    actor: compactText(options.actor, 'system'),
                    source: compactText(options.source, 'agent_action'),
                });
            }

            if (worker.status === WORKER_STATUSES.failed || worker.status === WORKER_STATUSES.blocked) {
                this._emit('agent.violation', {
                    sessionId: session.id,
                    workerId: worker.id,
                    status: worker.status,
                    reason: worker.lastError || 'worker_update',
                    source: compactText(options.source, 'agent_action'),
                });
            }
        } catch (error) {
            this.state.workers[worker.id] = previousWorker;
            this.state.sessions[session.id] = previousSession;
            if (error && error.code === AGENT_ERROR_CODES.AGENT_BUDGET_HARD_LIMIT) {
                this._emitBudgetViolation(error, {
                    sessionId: session.id,
                    workerId: worker.id,
                });
            }
            throw error;
        }

        const result = {
            session: clone(this.state.sessions[session.id]),
            worker: clone(this.state.workers[worker.id]),
        };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    message(input = {}, options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_message', options, {
            sessionId: compactText(input.sessionId, ''),
            workerId: compactText(input.workerId, ''),
        });

        const text = compactText(input.message || input.text, '');
        if (!text) {
            throw this._toKernelError(AGENT_ERROR_CODES.AGENT_MESSAGE_REQUIRED, 'message is required');
        }

        const actor = compactText(options.actor || input.actor, 'system');
        const source = compactText(options.source || input.source, 'agent_action');
        const now = nowTs();
        const messageItem = {
            id: `agent_msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
            actor,
            source,
            message: text,
            timestamp: now,
        };

        let session = null;
        let worker = null;

        if (input.workerId) {
            worker = this._getWorkerOrThrow(input.workerId);
            session = this._getSessionOrThrow(worker.sessionId);
            worker.messages = Array.isArray(worker.messages) ? worker.messages : [];
            worker.messages.push(messageItem);
            if (worker.messages.length > 200) worker.messages.shift();
            worker.updatedAt = now;
            worker.version = asNonNegativeNumber(worker.version, 0) + 1;
            if (worker.status === WORKER_STATUSES.pending) {
                this._validateWorkerTransition(worker, WORKER_STATUSES.running);
                worker.status = WORKER_STATUSES.running;
            }
            session.updatedAt = now;
            session.version = asNonNegativeNumber(session.version, 0) + 1;
        } else {
            session = this._getSessionOrThrow(input.sessionId);
            session.messageQueue = Array.isArray(session.messageQueue) ? session.messageQueue : [];
            session.messageQueue.push(messageItem);
            if (session.messageQueue.length > 300) session.messageQueue.shift();
            session.updatedAt = now;
            session.version = asNonNegativeNumber(session.version, 0) + 1;
        }

        this._incrementTelemetryCounter('notifications', 1);
        this._persist();
        this._emit('agent.notification', {
            sessionId: session.id,
            workerId: worker ? worker.id : null,
            notification: messageItem,
        });

        const result = {
            session: clone(session),
            worker: worker ? clone(worker) : null,
            notification: clone(messageItem),
        };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    async wait(sessionId, options = {}) {
        const session = this._getSessionOrThrow(sessionId);
        const timeoutMsRaw = Number(options.timeoutMs || 0);
        const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
            ? Math.min(300000, Math.floor(timeoutMsRaw))
            : 0;
        const startedAt = nowTs();
        this._incrementTelemetryCounter('waitCalls', 1);

        const buildSnapshot = () => {
            const current = this._getSessionOrThrow(sessionId);
            const workers = this.listWorkers({ sessionId });
            return {
                session: clone(current),
                workers,
                done: TERMINAL_SESSION_STATUSES.has(current.status),
                waitedMs: nowTs() - startedAt,
            };
        };

        if (timeoutMs <= 0) {
            return buildSnapshot();
        }

        while (true) {
            const snapshot = buildSnapshot();
            if (snapshot.done) return snapshot;
            if ((nowTs() - startedAt) >= timeoutMs) return snapshot;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    stop(input = {}, options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_stop', options, {
            sessionId: compactText(input.sessionId, ''),
            workerId: compactText(input.workerId, ''),
        });

        const actor = compactText(options.actor, 'system');
        const source = compactText(options.source, 'agent_action');
        const reason = compactText(input.reason || options.reason, 'manual-stop');

        this._incrementTelemetryCounter('stopCalls', 1);

        if (input.workerId) {
            const workerResult = this.updateWorker(input.workerId, {
                status: WORKER_STATUSES.killed,
                lastError: reason,
            }, {
                actor,
                source,
                idempotencyKey: '',
            });
            const result = {
                session: workerResult.session,
                worker: workerResult.worker,
                reason,
            };
            this._rememberIdempotency(options.idempotencyKey, result);
            return result;
        }

        const sessionId = compactText(input.sessionId, '');
        if (!sessionId) {
            throw this._toKernelError(
                AGENT_ERROR_CODES.AGENT_SESSION_ID_REQUIRED,
                'sessionId or workerId is required for stop'
            );
        }

        const session = this._getSessionOrThrow(sessionId);
        const now = nowTs();
        const affectedWorkers = [];
        for (const workerId of Array.isArray(session.workerIds) ? session.workerIds : []) {
            const worker = this.state.workers[workerId];
            if (!worker || TERMINAL_WORKER_STATUSES.has(worker.status)) continue;
            this._validateWorkerTransition(worker, WORKER_STATUSES.killed);
            worker.status = WORKER_STATUSES.killed;
            worker.lastError = reason;
            worker.completedAt = now;
            worker.updatedAt = now;
            worker.version = asNonNegativeNumber(worker.version, 0) + 1;
            affectedWorkers.push(clone(worker));
            this._emit('agent.worker.updated', {
                sessionId,
                workerId: worker.id,
                status: worker.status,
                worker: clone(worker),
                actor,
                source,
            });
        }

        this._validateSessionTransition(session, SESSION_STATUSES.killed);
        session.status = SESSION_STATUSES.killed;
        session.lastError = reason;
        session.completedAt = now;
        session.updatedAt = now;
        session.version = asNonNegativeNumber(session.version, 0) + 1;
        session.usage = this._rebuildSessionUsage(session.id);

        this._recomputeRecoverySummary();
        this._persist();
        this._emit('agent.session.updated', {
            sessionId: session.id,
            status: session.status,
            session: clone(session),
            actor,
            source,
        });

        const result = {
            session: clone(session),
            workers: affectedWorkers,
            reason,
        };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    resume(options = {}) {
        const idempotent = this._checkIdempotency(options.idempotencyKey);
        if (idempotent) return idempotent;
        this._enforceDecision('agent_resume', options, {
            sessionId: compactText(options.sessionId, ''),
        });

        const actor = compactText(options.actor, 'system');
        const source = compactText(options.source, 'agent_resume');
        const targetSessionId = compactText(options.sessionId, '');
        const now = nowTs();
        const resumedSessions = [];
        const resumedWorkers = [];

        const candidates = targetSessionId
            ? [this._getSessionOrThrow(targetSessionId)]
            : this.listSessions({ includeTerminal: false })
                .map((session) => this.state.sessions[session.id])
                .filter(Boolean);

        for (const session of candidates) {
            const beforeStatus = session.status;
            let sessionChanged = false;
            if (session.status === SESSION_STATUSES.pending || session.status === SESSION_STATUSES.blocked || session.status === SESSION_STATUSES.failed) {
                this._validateSessionTransition(session, SESSION_STATUSES.running);
                session.status = SESSION_STATUSES.running;
                sessionChanged = true;
            }

            for (const workerId of Array.isArray(session.workerIds) ? session.workerIds : []) {
                const worker = this.state.workers[workerId];
                if (!worker) continue;
                if (worker.status === WORKER_STATUSES.blocked || worker.status === WORKER_STATUSES.failed) {
                    this._validateWorkerTransition(worker, WORKER_STATUSES.pending);
                    worker.status = WORKER_STATUSES.pending;
                    worker.lastError = '';
                    worker.updatedAt = now;
                    worker.version = asNonNegativeNumber(worker.version, 0) + 1;
                    resumedWorkers.push(clone(worker));
                    this._emit('agent.worker.updated', {
                        sessionId: session.id,
                        workerId: worker.id,
                        previousStatus: beforeStatus,
                        status: worker.status,
                        worker: clone(worker),
                        actor,
                        source,
                    });
                }
            }

            if (sessionChanged) {
                session.updatedAt = now;
                session.version = asNonNegativeNumber(session.version, 0) + 1;
                resumedSessions.push(clone(session));
                this._emit('agent.session.updated', {
                    sessionId: session.id,
                    previousStatus: beforeStatus,
                    status: session.status,
                    session: clone(session),
                    actor,
                    source,
                });
            } else if (RESUMABLE_SESSION_STATUSES.has(session.status)) {
                resumedSessions.push(clone(session));
            }
        }

        this._incrementTelemetryCounter('resumeCalls', 1);
        this._recomputeRecoverySummary();
        this._persist();

        const brief = this.getResumeBrief({ limit: Number(options.limit || 20) || 20 });
        const result = {
            resumed: resumedSessions.length > 0,
            resumedCount: resumedSessions.length,
            sessions: resumedSessions,
            workers: resumedWorkers,
            session: resumedSessions[0] || null,
            brief,
        };

        this._emit('agent.resume', {
            resumedCount: resumedSessions.length,
            sessionIds: resumedSessions.map((session) => session.id),
            workerIds: resumedWorkers.map((worker) => worker.id),
            brief,
            actor,
            source,
        });

        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    getAuditEvents(filters = {}) {
        const sessionId = compactText(filters.sessionId, '');
        const workerId = compactText(filters.workerId, '');
        const limitRaw = Number(filters.limit || 0);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 0;

        let events = Array.isArray(this.state.events) ? this.state.events : [];
        if (sessionId) {
            events = events.filter((event) => String(event.sessionId || '') === sessionId);
        }
        if (workerId) {
            events = events.filter((event) => String(event.workerId || '') === workerId);
        }
        events = events.slice().sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        if (limit > 0) events = events.slice(0, limit);
        return clone(events);
    }

    getTelemetrySnapshot() {
        return clone(this.state.telemetry || this._createInitialTelemetry());
    }

    getMetrics() {
        const sessions = this.listSessions({ includeTerminal: true });
        const workers = this.listWorkers({});

        const sessionByStatus = {};
        for (const status of VALID_SESSION_STATUSES) sessionByStatus[status] = 0;
        for (const session of sessions) {
            sessionByStatus[session.status] = asNonNegativeNumber(sessionByStatus[session.status], 0) + 1;
        }

        const workerByStatus = {};
        for (const status of VALID_WORKER_STATUSES) workerByStatus[status] = 0;
        for (const worker of workers) {
            workerByStatus[worker.status] = asNonNegativeNumber(workerByStatus[worker.status], 0) + 1;
        }

        const totalUsage = workers.reduce((acc, worker) => {
            const usage = worker.usage || {};
            acc.promptTokens += asNonNegativeNumber(usage.promptTokens, 0);
            acc.completionTokens += asNonNegativeNumber(usage.completionTokens, 0);
            acc.totalTokens += asNonNegativeNumber(usage.totalTokens, 0);
            acc.costUsd += asNonNegativeNumber(usage.costUsd, 0);
            return acc;
        }, {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
        });

        return {
            totals: {
                sessions: sessions.length,
                workers: workers.length,
                sessionByStatus,
                workerByStatus,
            },
            usage: totalUsage,
            telemetry: this.getTelemetrySnapshot(),
            recovery: this.getRecoverySummary(),
        };
    }

    buildPendingSessionSummary(limit = 8) {
        const safeLimit = Math.max(1, Number(limit) || 8);
        const sessions = this.listSessions({ includeTerminal: false })
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
            .slice(0, safeLimit);
        if (sessions.length === 0) return '';

        const lines = sessions.map((session) => {
            const phase = session && session.metadata && session.metadata.workflow && session.metadata.workflow.phase
                ? session.metadata.workflow.phase
                : 'research';
            return `- [${session.id}] (${session.status}/${phase}) ${session.objective} | workers=${Array.isArray(session.workerIds) ? session.workerIds.length : 0}`;
        });
        return lines.join('\n');
    }

    getBudgetPolicy() {
        return clone(this.state.budgets || this._createDefaultBudgetPolicy());
    }

    setBudgetPolicy(policy = {}, options = {}) {
        this._enforceDecision('agent_budget_set', options, {});
        const normalized = this._normalizeBudgetPolicy(policy);
        this.state.budgets = normalized;
        this._persist();
        this._emit('agent.session.updated', {
            sessionId: null,
            status: 'budget_policy_updated',
            source: compactText(options.source, 'agent_budget'),
            actor: compactText(options.actor, 'system'),
            policy: clone(normalized),
        });
        return { budgets: clone(normalized) };
    }

    getBudgets() {
        return {
            policy: this.getBudgetPolicy(),
            usage: this.getMetrics().usage,
        };
    }

    getSnapshot() {
        return clone({
            state: this.state,
            recovery: this.getRecoverySummary(),
            resumeBrief: this.getResumeBrief({ limit: 20 }),
            metrics: this.getMetrics(),
            budgets: this.getBudgets(),
        });
    }
}

module.exports = AgentKernel;
module.exports.AgentKernelError = AgentKernelError;
module.exports.AGENT_ERROR_CODES = AGENT_ERROR_CODES;
module.exports.AGENT_ERROR_HTTP_STATUS = AGENT_ERROR_HTTP_STATUS;
module.exports.VALID_SESSION_STATUSES = VALID_SESSION_STATUSES;
module.exports.VALID_WORKER_STATUSES = VALID_WORKER_STATUSES;
module.exports.VALID_WORKER_ROLES = VALID_WORKER_ROLES;
