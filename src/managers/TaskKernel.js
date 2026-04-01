const fs = require('fs');
const path = require('path');

const VALID_STATUSES = new Set([
    'pending',
    'in_progress',
    'completed',
    'failed',
    'blocked',
    'killed',
]);

const TERMINAL_STATUSES = new Set([
    'completed',
    'failed',
    'killed',
]);

const TRANSITIONS = Object.freeze({
    pending: new Set(['in_progress', 'blocked', 'failed', 'killed']),
    in_progress: new Set(['blocked', 'failed', 'killed', 'completed']),
    blocked: new Set(['pending', 'in_progress', 'failed', 'killed']),
    failed: new Set(['in_progress', 'killed']),
    completed: new Set([]),
    killed: new Set([]),
});

function nowTs() {
    return Date.now();
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
}

function dedupeIdList(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const out = [];
    for (const item of values) {
        const id = String(item || '').trim();
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

function compactString(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function asFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function normalizeNonNegativeNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return num >= 0 ? num : 0;
}

function safeRatio(numerator, denominator) {
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
    return n / d;
}

function roundNumber(value, digits = 6) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const factor = Math.pow(10, digits);
    return Math.round(num * factor) / factor;
}

class TaskKernel {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.logDir = options.logDir || path.join(process.cwd(), 'logs');
        this.storageDir = path.join(this.logDir, 'tasks');
        this.maxEvents = Number(options.maxEvents || 2000);
        this.maxIdempotencyKeys = Number(options.maxIdempotencyKeys || 500);
        this.strictMode = options.strictMode !== false;
        this.defaultApprovalTtlMs = Number(options.defaultApprovalTtlMs || (5 * 60 * 1000));
        this._onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        this._listeners = new Set();
        this._recoverySummary = {
            recoveredAt: nowTs(),
            pendingCount: 0,
            inProgressCount: 0,
            blockedCount: 0,
            nextTaskId: null,
        };

        const safeId = normalizeId(this.golemId) || 'default';
        this.filePath = path.join(this.storageDir, `task_kernel_${safeId}.json`);
        this.state = this._createInitialState();
        this._init();
    }

    _createInitialTelemetry() {
        const ts = nowTs();
        return {
            created: 0,
            updates: 0,
            stopCalls: 0,
            todoWrites: 0,
            idempotencyHits: 0,
            versionConflicts: 0,
            transitions: {
                pending: 0,
                in_progress: 0,
                completed: 0,
                failed: 0,
                blocked: 0,
                killed: 0,
            },
            strictIntercepts: {
                invalidTransition: 0,
                multipleInProgress: 0,
                invalidCompleteNoVerification: 0,
                invalidCompleteWithError: 0,
            },
            recovery: {
                attempts: 0,
                successes: 0,
                lastRecoveredCount: 0,
                lastRecoveredAt: 0,
            },
            lastUpdatedAt: ts,
        };
    }

    _normalizeTelemetry(input = {}) {
        const base = this._createInitialTelemetry();
        const telemetry = (input && typeof input === 'object') ? input : {};
        const transitions = (telemetry.transitions && typeof telemetry.transitions === 'object')
            ? telemetry.transitions
            : {};
        const strictIntercepts = (telemetry.strictIntercepts && typeof telemetry.strictIntercepts === 'object')
            ? telemetry.strictIntercepts
            : {};
        const recovery = (telemetry.recovery && typeof telemetry.recovery === 'object')
            ? telemetry.recovery
            : {};

        const normalized = {
            ...base,
            ...telemetry,
            created: normalizeNonNegativeNumber(telemetry.created),
            updates: normalizeNonNegativeNumber(telemetry.updates),
            stopCalls: normalizeNonNegativeNumber(telemetry.stopCalls),
            todoWrites: normalizeNonNegativeNumber(telemetry.todoWrites),
            idempotencyHits: normalizeNonNegativeNumber(telemetry.idempotencyHits),
            versionConflicts: normalizeNonNegativeNumber(telemetry.versionConflicts),
            transitions: {
                ...base.transitions,
                ...transitions,
            },
            strictIntercepts: {
                ...base.strictIntercepts,
                ...strictIntercepts,
            },
            recovery: {
                ...base.recovery,
                ...recovery,
            },
            lastUpdatedAt: normalizeNonNegativeNumber(telemetry.lastUpdatedAt || nowTs()),
        };

        for (const key of Object.keys(base.transitions)) {
            normalized.transitions[key] = normalizeNonNegativeNumber(normalized.transitions[key]);
        }
        for (const key of Object.keys(base.strictIntercepts)) {
            normalized.strictIntercepts[key] = normalizeNonNegativeNumber(normalized.strictIntercepts[key]);
        }
        normalized.recovery.attempts = normalizeNonNegativeNumber(normalized.recovery.attempts);
        normalized.recovery.successes = normalizeNonNegativeNumber(normalized.recovery.successes);
        normalized.recovery.lastRecoveredCount = normalizeNonNegativeNumber(normalized.recovery.lastRecoveredCount);
        normalized.recovery.lastRecoveredAt = normalizeNonNegativeNumber(normalized.recovery.lastRecoveredAt);

        return normalized;
    }

    _createInitialState() {
        return {
            version: 3,
            golemId: this.golemId,
            lastTaskSeq: 0,
            tasks: {},
            events: [],
            approvals: {},
            idempotency: {},
            telemetry: this._createInitialTelemetry(),
        };
    }

    _init() {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }

        if (!fs.existsSync(this.filePath)) {
            this._ensureTelemetry();
            this._recomputeRecoverySummary();
            this._recordRecoveryAttempt(0);
            this._persist();
            return;
        }

        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            this.state = {
                ...this._createInitialState(),
                ...(parsed && typeof parsed === 'object' ? parsed : {}),
            };
            if (!this.state.tasks || typeof this.state.tasks !== 'object') this.state.tasks = {};
            if (!this.state.events || !Array.isArray(this.state.events)) this.state.events = [];
            if (!this.state.approvals || typeof this.state.approvals !== 'object') this.state.approvals = {};
            if (!this.state.idempotency || typeof this.state.idempotency !== 'object') this.state.idempotency = {};
            this._ensureTelemetry();
            this.trimExpiredApprovals();
            this._trimIdempotency();
            this._recomputeRecoverySummary();
            this._recordRecoveryAttempt(this._countRecoverableTasks());
            this._persist();
        } catch (error) {
            console.error(`[TaskKernel:${this.golemId}] Failed to load persisted state, fallback to empty: ${error.message}`);
            this.state = this._createInitialState();
            this._ensureTelemetry();
            this._recomputeRecoverySummary();
            this._recordRecoveryAttempt(0);
            this._persist();
        }
    }

    _persist() {
        const tmpPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
        fs.renameSync(tmpPath, this.filePath);
    }

    _emit(type, payload) {
        const eventPayload = {
            type,
            golemId: this.golemId,
            ts: nowTs(),
            payload: payload || {},
        };

        for (const listener of this._listeners) {
            try {
                listener(eventPayload);
            } catch (error) {
                console.error(`[TaskKernel:${this.golemId}] Listener error: ${error.message}`);
            }
        }

        if (this._onEvent) {
            try {
                this._onEvent(eventPayload);
            } catch (error) {
                console.error(`[TaskKernel:${this.golemId}] onEvent callback error: ${error.message}`);
            }
        }
    }

    onUpdate(listener) {
        if (typeof listener !== 'function') return () => {};
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _ensureTelemetry() {
        this.state.telemetry = this._normalizeTelemetry(this.state.telemetry);
        return this.state.telemetry;
    }

    _touchTelemetry() {
        const telemetry = this._ensureTelemetry();
        telemetry.lastUpdatedAt = nowTs();
        return telemetry;
    }

    _incrementTelemetryCounter(key, delta = 1) {
        const telemetry = this._touchTelemetry();
        telemetry[key] = normalizeNonNegativeNumber(telemetry[key]) + normalizeNonNegativeNumber(delta);
        return telemetry[key];
    }

    _incrementTransition(status) {
        const key = compactString(status, '');
        if (!key) return;
        const telemetry = this._touchTelemetry();
        if (telemetry.transitions[key] === undefined) {
            telemetry.transitions[key] = 0;
        }
        telemetry.transitions[key] = normalizeNonNegativeNumber(telemetry.transitions[key]) + 1;
    }

    _recordStrictIntercept(kind) {
        const key = compactString(kind, '');
        if (!key) return;
        const telemetry = this._touchTelemetry();
        if (telemetry.strictIntercepts[key] === undefined) {
            telemetry.strictIntercepts[key] = 0;
        }
        telemetry.strictIntercepts[key] = normalizeNonNegativeNumber(telemetry.strictIntercepts[key]) + 1;
    }

    _recordRecoveryAttempt(recoveredCount = 0) {
        const telemetry = this._touchTelemetry();
        const recovery = telemetry.recovery || {};
        recovery.attempts = normalizeNonNegativeNumber(recovery.attempts) + 1;
        const safeRecoveredCount = normalizeNonNegativeNumber(recoveredCount);
        if (safeRecoveredCount > 0) {
            recovery.successes = normalizeNonNegativeNumber(recovery.successes) + 1;
        } else {
            recovery.successes = normalizeNonNegativeNumber(recovery.successes);
        }
        recovery.lastRecoveredCount = safeRecoveredCount;
        recovery.lastRecoveredAt = nowTs();
        telemetry.recovery = recovery;
    }

    _countRecoverableTasks() {
        return Object.values(this.state.tasks || {})
            .filter((task) => task && !TERMINAL_STATUSES.has(task.status))
            .length;
    }

    _nextTaskId() {
        this.state.lastTaskSeq = Number(this.state.lastTaskSeq || 0) + 1;
        return `task_${String(this.state.lastTaskSeq).padStart(6, '0')}`;
    }

    _appendAudit(type, taskId, detail = {}, actor = 'system') {
        const eventId = `evt_${nowTs()}_${Math.random().toString(36).slice(2, 8)}`;
        const entry = {
            id: eventId,
            ts: nowTs(),
            type,
            taskId: taskId || null,
            actor: actor || 'system',
            detail: detail || {},
        };

        this.state.events.push(entry);
        if (this.state.events.length > this.maxEvents) {
            this.state.events.splice(0, this.state.events.length - this.maxEvents);
        }
        return entry;
    }

    _rememberIdempotency(key, result) {
        const idempotencyKey = String(key || '').trim();
        if (!idempotencyKey) return;
        this.state.idempotency[idempotencyKey] = {
            ts: nowTs(),
            result: clone(result),
        };
        this._trimIdempotency();
    }

    _checkIdempotency(key) {
        const idempotencyKey = String(key || '').trim();
        if (!idempotencyKey) return null;
        const hit = this.state.idempotency[idempotencyKey];
        if (!hit) return null;
        this._incrementTelemetryCounter('idempotencyHits');
        return clone(hit.result);
    }

    _trimIdempotency() {
        const entries = Object.entries(this.state.idempotency || {});
        if (entries.length <= this.maxIdempotencyKeys) return;

        entries.sort((a, b) => {
            const tsA = Number((a[1] && a[1].ts) || 0);
            const tsB = Number((b[1] && b[1].ts) || 0);
            return tsB - tsA;
        });

        const trimmed = {};
        for (const [key, value] of entries.slice(0, this.maxIdempotencyKeys)) {
            trimmed[key] = value;
        }
        this.state.idempotency = trimmed;
    }

    _createInitialUsage() {
        return {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            model: '',
            updateCount: 0,
            updatedAt: 0,
        };
    }

    _normalizeUsagePatch(rawUsage) {
        if (!rawUsage || typeof rawUsage !== 'object') return null;

        const promptTokens = normalizeNonNegativeNumber(
            rawUsage.promptTokens ?? rawUsage.prompt_tokens ?? rawUsage.inputTokens ?? rawUsage.input_tokens
        );
        const completionTokens = normalizeNonNegativeNumber(
            rawUsage.completionTokens ?? rawUsage.completion_tokens ?? rawUsage.outputTokens ?? rawUsage.output_tokens
        );
        const explicitTotalTokens = rawUsage.totalTokens ?? rawUsage.total_tokens;
        let totalTokens = normalizeNonNegativeNumber(explicitTotalTokens);
        if (totalTokens <= 0) {
            totalTokens = promptTokens + completionTokens;
        }
        const costUsd = normalizeNonNegativeNumber(
            rawUsage.costUsd ?? rawUsage.cost_usd ?? rawUsage.estimatedCostUsd ?? rawUsage.estimated_cost_usd ?? rawUsage.usd
        );
        const model = compactString(rawUsage.model || rawUsage.modelName || rawUsage.providerModel, '');
        const mode = compactString(rawUsage.mode, '');
        const replace = rawUsage.absolute === true || rawUsage.replace === true || mode === 'replace';

        const hasSignal = promptTokens > 0 || completionTokens > 0 || totalTokens > 0 || costUsd > 0 || !!model;
        if (!hasSignal) return null;

        return {
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
            model,
            replace,
        };
    }

    _extractUsagePatch(update = {}) {
        if (!update || typeof update !== 'object') return null;
        if (update.usage && typeof update.usage === 'object') {
            return this._normalizeUsagePatch(update.usage);
        }
        if (update.metadata && typeof update.metadata === 'object' && update.metadata.usage && typeof update.metadata.usage === 'object') {
            return this._normalizeUsagePatch(update.metadata.usage);
        }
        return null;
    }

    _mergeUsage(currentUsage, usagePatch, ts = nowTs()) {
        if (!usagePatch) return currentUsage ? clone(currentUsage) : null;

        const existing = {
            ...this._createInitialUsage(),
            ...((currentUsage && typeof currentUsage === 'object') ? currentUsage : {}),
        };

        const next = clone(existing);
        if (usagePatch.replace) {
            next.promptTokens = usagePatch.promptTokens;
            next.completionTokens = usagePatch.completionTokens;
            next.totalTokens = usagePatch.totalTokens > 0
                ? usagePatch.totalTokens
                : usagePatch.promptTokens + usagePatch.completionTokens;
            next.costUsd = usagePatch.costUsd;
        } else {
            next.promptTokens = normalizeNonNegativeNumber(next.promptTokens) + usagePatch.promptTokens;
            next.completionTokens = normalizeNonNegativeNumber(next.completionTokens) + usagePatch.completionTokens;
            next.totalTokens = normalizeNonNegativeNumber(next.totalTokens) + (
                usagePatch.totalTokens > 0
                    ? usagePatch.totalTokens
                    : (usagePatch.promptTokens + usagePatch.completionTokens)
            );
            next.costUsd = normalizeNonNegativeNumber(next.costUsd) + usagePatch.costUsd;
        }

        if (next.totalTokens < (next.promptTokens + next.completionTokens)) {
            next.totalTokens = next.promptTokens + next.completionTokens;
        }

        if (usagePatch.model) {
            next.model = usagePatch.model;
        }
        next.costUsd = roundNumber(next.costUsd, 8);
        next.updateCount = normalizeNonNegativeNumber(next.updateCount) + 1;
        next.updatedAt = normalizeNonNegativeNumber(ts);
        return next;
    }

    _collectUsageTotals(tasks = []) {
        const totals = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            taskCountWithUsage: 0,
            averageCostPerTaskUsd: 0,
            averageTokensPerTask: 0,
        };

        for (const task of tasks) {
            const usage = task && typeof task === 'object' ? task.usage : null;
            if (!usage || typeof usage !== 'object') continue;
            totals.taskCountWithUsage += 1;
            totals.promptTokens += normalizeNonNegativeNumber(usage.promptTokens);
            totals.completionTokens += normalizeNonNegativeNumber(usage.completionTokens);
            totals.totalTokens += normalizeNonNegativeNumber(usage.totalTokens);
            totals.costUsd += normalizeNonNegativeNumber(usage.costUsd);
        }

        totals.costUsd = roundNumber(totals.costUsd, 8);
        totals.averageCostPerTaskUsd = roundNumber(
            safeRatio(totals.costUsd, totals.taskCountWithUsage),
            8
        );
        totals.averageTokensPerTask = Math.round(safeRatio(totals.totalTokens, totals.taskCountWithUsage));
        return totals;
    }

    _validateTransition(task, nextStatus, update = {}) {
        if (!VALID_STATUSES.has(nextStatus)) {
            this._recordStrictIntercept('invalidTransition');
            throw new Error(`Invalid task status: ${nextStatus}`);
        }

        const currentStatus = task.status;
        if (currentStatus === nextStatus) return;
        const allowed = TRANSITIONS[currentStatus] || new Set();
        if (!allowed.has(nextStatus)) {
            this._recordStrictIntercept('invalidTransition');
            throw new Error(`Invalid transition ${currentStatus} -> ${nextStatus}`);
        }

        if (!this.strictMode) return;

        if (nextStatus === 'in_progress') {
            const otherRunning = Object.values(this.state.tasks).find((item) =>
                item && item.id !== task.id && item.status === 'in_progress'
            );
            if (otherRunning) {
                this._recordStrictIntercept('multipleInProgress');
                throw new Error(`Strict mode: another task already in_progress (${otherRunning.id})`);
            }
        }

        if (nextStatus === 'completed') {
            const verification = update.verification || task.verification || {};
            if (verification.status !== 'verified') {
                this._recordStrictIntercept('invalidCompleteNoVerification');
                throw new Error('Strict mode: task cannot be completed before verification.status=verified');
            }
            if (task.lastError && !update.clearError) {
                this._recordStrictIntercept('invalidCompleteWithError');
                throw new Error('Strict mode: task with unresolved errors cannot be completed');
            }
        }
    }

    _recomputeRecoverySummary() {
        const tasks = Object.values(this.state.tasks || {});
        const pending = tasks.filter((t) => t.status === 'pending');
        const inProgress = tasks.filter((t) => t.status === 'in_progress');
        const blocked = tasks.filter((t) => t.status === 'blocked');

        const ordered = tasks
            .filter((t) => !TERMINAL_STATUSES.has(t.status))
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

        this._recoverySummary = {
            recoveredAt: nowTs(),
            pendingCount: pending.length,
            inProgressCount: inProgress.length,
            blockedCount: blocked.length,
            nextTaskId: ordered.length > 0 ? ordered[0].id : null,
        };
    }

    getRecoverySummary() {
        return clone(this._recoverySummary);
    }

    createTask(input = {}, options = {}) {
        const idempotencyResult = this._checkIdempotency(options.idempotencyKey);
        if (idempotencyResult) return idempotencyResult;

        const taskId = String(input.id || this._nextTaskId()).trim();
        if (!taskId) throw new Error('Task ID is required');
        if (this.state.tasks[taskId]) throw new Error(`Task already exists: ${taskId}`);

        const ts = nowTs();
        const createdTask = {
            id: taskId,
            subject: compactString(input.subject || input.content, `Task ${taskId}`),
            description: compactString(input.description, ''),
            activeForm: compactString(input.activeForm, ''),
            status: VALID_STATUSES.has(input.status) ? input.status : 'pending',
            owner: compactString(input.owner, ''),
            blockedBy: dedupeIdList(input.blockedBy),
            blocks: dedupeIdList(input.blocks),
            metadata: (input.metadata && typeof input.metadata === 'object') ? clone(input.metadata) : {},
            source: compactString(input.source, options.source || 'unknown'),
            createdAt: ts,
            updatedAt: ts,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            killedAt: null,
            verification: {
                status: (input.verification && input.verification.status) || 'pending',
                note: compactString(input.verification && input.verification.note, ''),
                updatedAt: ts,
            },
            lastError: '',
            version: 1,
        };
        const initialUsagePatch = this._normalizeUsagePatch(
            (input && input.usage && typeof input.usage === 'object')
                ? input.usage
                : (input && input.metadata && typeof input.metadata === 'object' ? input.metadata.usage : null)
        );
        if (initialUsagePatch) {
            createdTask.usage = this._mergeUsage(null, initialUsagePatch, ts);
        }

        if (createdTask.status === 'in_progress') {
            this._validateTransition({ ...createdTask, status: 'pending' }, 'in_progress', createdTask);
            createdTask.startedAt = ts;
        }

        if (createdTask.status === 'completed') {
            this._validateTransition({ ...createdTask, status: 'in_progress' }, 'completed', createdTask);
            createdTask.completedAt = ts;
        }

        if (createdTask.status === 'failed') createdTask.failedAt = ts;
        if (createdTask.status === 'killed') createdTask.killedAt = ts;

        this.state.tasks[taskId] = createdTask;
        this._incrementTelemetryCounter('created');
        this._incrementTransition(createdTask.status);
        const audit = this._appendAudit('task.created', taskId, {
            status: createdTask.status,
            source: createdTask.source,
        }, options.actor || 'system');
        this._recomputeRecoverySummary();
        this._persist();

        const result = {
            task: clone(createdTask),
            audit,
        };
        this._rememberIdempotency(options.idempotencyKey, result);
        this._emit('task.update', {
            task: result.task,
            audit,
            recovery: this.getRecoverySummary(),
            telemetry: this.getTelemetrySnapshot(),
        });
        return result;
    }

    getTask(taskId) {
        const id = String(taskId || '').trim();
        if (!id) return null;
        const task = this.state.tasks[id];
        return task ? clone(task) : null;
    }

    listTasks(filters = {}) {
        const includeCompleted = filters.includeCompleted !== false;
        const statusFilter = Array.isArray(filters.statuses)
            ? new Set(filters.statuses.map((s) => String(s || '').trim()).filter(Boolean))
            : (filters.status ? new Set([String(filters.status).trim()]) : null);
        const ownerFilter = compactString(filters.owner, '');
        const limitRaw = Number(filters.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 0;

        let tasks = Object.values(this.state.tasks || {});
        if (!includeCompleted) {
            tasks = tasks.filter((task) => task.status !== 'completed');
        }
        if (statusFilter && statusFilter.size > 0) {
            tasks = tasks.filter((task) => statusFilter.has(task.status));
        }
        if (ownerFilter) {
            tasks = tasks.filter((task) => String(task.owner || '') === ownerFilter);
        }

        tasks.sort((a, b) => {
            const aTs = Number(a.updatedAt || a.createdAt || 0);
            const bTs = Number(b.updatedAt || b.createdAt || 0);
            if (bTs !== aTs) return bTs - aTs;
            return String(a.id).localeCompare(String(b.id));
        });

        if (limit > 0) {
            tasks = tasks.slice(0, limit);
        }

        return tasks.map((task) => clone(task));
    }

    updateTask(taskId, update = {}, options = {}) {
        const idempotencyResult = this._checkIdempotency(options.idempotencyKey);
        if (idempotencyResult) return idempotencyResult;

        const id = String(taskId || '').trim();
        if (!id) throw new Error('Task ID is required');
        const task = this.state.tasks[id];
        if (!task) throw new Error(`Task not found: ${id}`);

        if (options.expectedVersion !== undefined && Number(options.expectedVersion) !== Number(task.version)) {
            this._incrementTelemetryCounter('versionConflicts');
            this._persist();
            throw new Error(`Task version mismatch: expected ${options.expectedVersion}, actual ${task.version}`);
        }

        const next = clone(task);
        const ts = nowTs();
        const detail = {};

        if (update.subject !== undefined) {
            next.subject = compactString(update.subject, next.subject);
            detail.subject = next.subject;
        }
        if (update.description !== undefined) {
            next.description = compactString(update.description, next.description);
            detail.description = next.description;
        }
        if (update.activeForm !== undefined) {
            next.activeForm = compactString(update.activeForm, next.activeForm);
            detail.activeForm = next.activeForm;
        }
        if (update.owner !== undefined) {
            next.owner = compactString(update.owner, '');
            detail.owner = next.owner;
        }

        if (update.metadata && typeof update.metadata === 'object') {
            next.metadata = {
                ...(next.metadata || {}),
                ...clone(update.metadata),
            };
            detail.metadata = clone(next.metadata);
        }

        const usagePatch = this._extractUsagePatch(update);
        if (usagePatch) {
            next.usage = this._mergeUsage(next.usage, usagePatch, ts);
            detail.usage = clone(next.usage);
        }

        if (Array.isArray(update.addBlockedBy) || Array.isArray(update.removeBlockedBy)) {
            const blockedBy = new Set(next.blockedBy || []);
            for (const item of update.addBlockedBy || []) blockedBy.add(String(item));
            for (const item of update.removeBlockedBy || []) blockedBy.delete(String(item));
            next.blockedBy = Array.from(blockedBy).filter(Boolean);
            detail.blockedBy = clone(next.blockedBy);
        }

        if (Array.isArray(update.addBlocks) || Array.isArray(update.removeBlocks)) {
            const blocks = new Set(next.blocks || []);
            for (const item of update.addBlocks || []) blocks.add(String(item));
            for (const item of update.removeBlocks || []) blocks.delete(String(item));
            next.blocks = Array.from(blocks).filter(Boolean);
            detail.blocks = clone(next.blocks);
        }

        if (update.verification && typeof update.verification === 'object') {
            const verificationPatch = update.verification;
            const current = next.verification || { status: 'pending', note: '', updatedAt: ts };
            const nextStatus = verificationPatch.status
                || (verificationPatch.passed === true ? 'verified' : (verificationPatch.passed === false ? 'failed' : current.status));
            next.verification = {
                status: nextStatus,
                note: compactString(verificationPatch.note, current.note || ''),
                updatedAt: ts,
            };
            detail.verification = clone(next.verification);
        }

        if (update.clearError === true) {
            next.lastError = '';
            detail.lastError = '';
        }
        if (update.error) {
            next.lastError = compactString(update.error, next.lastError || '');
            detail.lastError = next.lastError;
        }

        if (update.status !== undefined) {
            const nextStatus = String(update.status || '').trim();
            this._validateTransition(task, nextStatus, update);
            if (task.status !== nextStatus) {
                detail.fromStatus = task.status;
                detail.toStatus = nextStatus;
                next.status = nextStatus;

                if (nextStatus === 'in_progress' && !next.startedAt) next.startedAt = ts;
                if (nextStatus === 'completed') next.completedAt = ts;
                if (nextStatus === 'failed') next.failedAt = ts;
                if (nextStatus === 'killed') next.killedAt = ts;
                if (!TERMINAL_STATUSES.has(nextStatus)) {
                    next.completedAt = null;
                    next.failedAt = null;
                    next.killedAt = null;
                }
                this._incrementTransition(nextStatus);
            }
        }

        next.updatedAt = ts;
        next.version = Number(next.version || 0) + 1;
        this.state.tasks[id] = next;
        this._incrementTelemetryCounter('updates');

        const audit = this._appendAudit('task.updated', id, detail, options.actor || 'system');
        this._recomputeRecoverySummary();
        this._persist();
        const result = { task: clone(next), audit };
        this._rememberIdempotency(options.idempotencyKey, result);
        this._emit('task.update', {
            task: result.task,
            audit,
            recovery: this.getRecoverySummary(),
            telemetry: this.getTelemetrySnapshot(),
        });
        return result;
    }

    stopTask(taskId, options = {}) {
        const idempotencyResult = this._checkIdempotency(options.idempotencyKey);
        if (idempotencyResult) return idempotencyResult;
        this._incrementTelemetryCounter('stopCalls');

        const task = this.getTask(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);
        if (TERMINAL_STATUSES.has(task.status)) {
            const noOp = {
                task,
                audit: this._appendAudit('task.stop.noop', task.id, { status: task.status }, options.actor || 'system'),
            };
            this._rememberIdempotency(options.idempotencyKey, noOp);
            this._persist();
            return noOp;
        }
        const result = this.updateTask(task.id, {
            status: 'killed',
            metadata: { stopReason: compactString(options.reason, 'manual-stop') },
        }, {
            actor: options.actor || 'system',
            idempotencyKey: options.idempotencyKey,
        });
        return result;
    }

    applyTodoWrite(items = [], options = {}) {
        const idempotencyResult = this._checkIdempotency(options.idempotencyKey);
        if (idempotencyResult) return idempotencyResult;
        this._incrementTelemetryCounter('todoWrites');

        if (!Array.isArray(items)) throw new Error('todo_write expects an array');
        const changed = [];

        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const taskId = compactString(item.id || item.taskId, '');
            const status = compactString(item.status, '');
            const subject = compactString(item.content || item.subject, '');
            const activeForm = compactString(item.activeForm, '');

            if (taskId && this.state.tasks[taskId]) {
                const patch = {};
                if (subject) patch.subject = subject;
                if (activeForm) patch.activeForm = activeForm;
                if (status) patch.status = status;
                if (item.description !== undefined) patch.description = compactString(item.description, '');
                if (item.owner !== undefined) patch.owner = compactString(item.owner, '');
                if (item.verification !== undefined) patch.verification = item.verification;
                if (item.metadata !== undefined) patch.metadata = item.metadata;

                const updated = this.updateTask(taskId, patch, {
                    actor: options.actor || 'system',
                });
                changed.push(updated.task);
                continue;
            }

            const created = this.createTask({
                subject: subject || `Task ${changed.length + 1}`,
                description: compactString(item.description, ''),
                activeForm,
                status: status && VALID_STATUSES.has(status) ? status : 'pending',
                owner: compactString(item.owner, ''),
                metadata: item.metadata || {},
                source: compactString(item.source, 'todo_write'),
            }, {
                actor: options.actor || 'system',
            });
            changed.push(created.task);
        }

        if (this.strictMode) {
            const allTasks = this.listTasks({ includeCompleted: false });
            const running = allTasks.filter((task) => task.status === 'in_progress');
            if (running.length > 1) {
                throw new Error('Strict mode: todo_write would produce multiple in_progress tasks');
            }
            if (running.length === 0) {
                const candidate = allTasks
                    .filter((task) => task.status === 'pending')
                    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
                if (candidate) {
                    const promoted = this.updateTask(candidate.id, {
                        status: 'in_progress',
                    }, {
                        actor: options.actor || 'system',
                    });
                    changed.push(promoted.task);
                }
            }
        }

        const result = {
            changed: changed.map((task) => clone(task)),
            recovery: this.getRecoverySummary(),
            metrics: this.getMetrics(),
        };
        this._rememberIdempotency(options.idempotencyKey, result);
        return result;
    }

    setApproval(approvalId, payload = {}, options = {}) {
        const id = String(approvalId || '').trim();
        if (!id) throw new Error('approvalId is required');
        const ts = nowTs();
        const ttlMs = Number(options.ttlMs || this.defaultApprovalTtlMs);
        const expiresAt = ts + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : this.defaultApprovalTtlMs);
        const entry = {
            id,
            createdAt: ts,
            updatedAt: ts,
            expiresAt,
            payload: clone(payload || {}),
        };
        this.state.approvals[id] = entry;
        this._appendAudit('approval.upsert', null, {
            approvalId: id,
            type: payload.type || 'unknown',
            expiresAt,
        }, options.actor || 'system');
        this._persist();
        this._emit('task.approval', {
            approvalId: id,
            action: 'upsert',
            payload: entry,
        });
        return clone(entry);
    }

    removeApproval(approvalId, options = {}) {
        const id = String(approvalId || '').trim();
        if (!id) return false;
        if (!this.state.approvals[id]) return false;
        delete this.state.approvals[id];
        this._appendAudit('approval.remove', null, {
            approvalId: id,
            reason: compactString(options.reason, 'manual'),
        }, options.actor || 'system');
        this._persist();
        this._emit('task.approval', {
            approvalId: id,
            action: 'remove',
            reason: compactString(options.reason, 'manual'),
        });
        return true;
    }

    trimExpiredApprovals(now = nowTs()) {
        const approvals = this.state.approvals || {};
        let removed = 0;
        for (const [id, entry] of Object.entries(approvals)) {
            const expiresAt = Number(entry && entry.expiresAt);
            if (!Number.isFinite(expiresAt) || expiresAt <= now) {
                delete approvals[id];
                removed++;
            }
        }
        if (removed > 0) {
            this._appendAudit('approval.trim', null, { removed }, 'system');
            this._persist();
        }
        return removed;
    }

    listApprovals() {
        this.trimExpiredApprovals();
        return Object.values(this.state.approvals || {}).map((entry) => clone(entry));
    }

    getApproval(approvalId) {
        const id = String(approvalId || '').trim();
        if (!id) return null;
        this.trimExpiredApprovals();
        const entry = this.state.approvals[id];
        return entry ? clone(entry) : null;
    }

    getAuditEvents(filters = {}) {
        const taskId = compactString(filters.taskId, '');
        const limitRaw = Number(filters.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 100;
        let events = this.state.events || [];
        if (taskId) {
            events = events.filter((event) => String(event.taskId || '') === taskId);
        }
        return events.slice(-limit).map((entry) => clone(entry));
    }

    getTelemetrySnapshot() {
        return clone(this._ensureTelemetry());
    }

    getMetrics() {
        const tasks = Object.values(this.state.tasks || {});
        const ts = nowTs();
        const byStatus = {
            pending: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
            blocked: 0,
            killed: 0,
        };
        let blockedOldestTaskId = null;
        let blockedOldestAgeMs = 0;
        let blockedAgeTotalMs = 0;
        let blockedAgeCount = 0;

        for (const task of tasks) {
            const status = compactString(task && task.status, '');
            if (status && byStatus[status] !== undefined) {
                byStatus[status] += 1;
            }
            if (status === 'blocked') {
                const anchorTs = Number(task.updatedAt || task.createdAt || ts);
                const ageMs = Math.max(0, ts - (Number.isFinite(anchorTs) ? anchorTs : ts));
                blockedAgeTotalMs += ageMs;
                blockedAgeCount += 1;
                if (ageMs >= blockedOldestAgeMs) {
                    blockedOldestAgeMs = ageMs;
                    blockedOldestTaskId = task.id || null;
                }
            }
        }

        const totalTasks = tasks.length;
        const terminalTasks = byStatus.completed + byStatus.failed + byStatus.killed;
        const nonTerminalTasks = totalTasks - terminalTasks;
        const telemetry = this.getTelemetrySnapshot();
        const fakeCompletionIntercepts = normalizeNonNegativeNumber(telemetry.strictIntercepts.invalidCompleteNoVerification)
            + normalizeNonNegativeNumber(telemetry.strictIntercepts.invalidCompleteWithError);
        const usage = this._collectUsageTotals(tasks);
        const recovery = telemetry.recovery || {};

        return {
            generatedAt: ts,
            strictMode: this.strictMode,
            totals: {
                totalTasks,
                terminalTasks,
                nonTerminalTasks,
                byStatus,
            },
            completionRate: roundNumber(safeRatio(byStatus.completed, totalTasks), 6),
            terminalSuccessRate: roundNumber(safeRatio(byStatus.completed, terminalTasks), 6),
            blockedAge: {
                count: blockedAgeCount,
                averageMs: Math.round(safeRatio(blockedAgeTotalMs, blockedAgeCount)),
                maxMs: Math.round(blockedOldestAgeMs),
                oldestTaskId: blockedOldestTaskId,
            },
            recovery: {
                attempts: normalizeNonNegativeNumber(recovery.attempts),
                successes: normalizeNonNegativeNumber(recovery.successes),
                successRate: roundNumber(safeRatio(recovery.successes, recovery.attempts), 6),
                lastRecoveredCount: normalizeNonNegativeNumber(recovery.lastRecoveredCount),
                lastRecoveredAt: normalizeNonNegativeNumber(recovery.lastRecoveredAt),
            },
            usage,
            strictIntercepts: clone(telemetry.strictIntercepts),
            fakeCompletionIntercepts,
            versionConflicts: normalizeNonNegativeNumber(telemetry.versionConflicts),
            idempotencyHits: normalizeNonNegativeNumber(telemetry.idempotencyHits),
            transitions: clone(telemetry.transitions),
            lastUpdatedAt: normalizeNonNegativeNumber(telemetry.lastUpdatedAt),
        };
    }

    getIntegrityReport(options = {}) {
        const tasks = Object.values(this.state.tasks || {});
        const limitRaw = Number(options.limit || options.maxViolations || 200);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 200;
        const byType = {};
        const violations = [];
        let violationCount = 0;
        const inProgressTaskIds = [];

        const addViolation = (type, taskId, message, detail = {}) => {
            violationCount += 1;
            byType[type] = (byType[type] || 0) + 1;
            if (violations.length < limit) {
                violations.push({
                    type,
                    taskId: taskId || null,
                    message,
                    detail: detail && typeof detail === 'object' ? clone(detail) : {},
                });
            }
        };

        for (const task of tasks) {
            if (!task || typeof task !== 'object') continue;
            const status = compactString(task.status, '');

            if (!VALID_STATUSES.has(status)) {
                addViolation('invalid_status', task.id, `Task status is invalid: ${status || '(empty)'}`);
            }

            const version = Number(task.version);
            if (!Number.isFinite(version) || version < 1) {
                addViolation('invalid_version', task.id, `Task version is invalid: ${task.version}`);
            }

            if (status === 'in_progress') {
                inProgressTaskIds.push(task.id);
            }

            if (status === 'completed') {
                const verification = task.verification || {};
                if (verification.status !== 'verified') {
                    addViolation('completed_without_verified', task.id, 'Completed task is not verified');
                }
                if (!Number(task.completedAt)) {
                    addViolation('completed_without_timestamp', task.id, 'Completed task missing completedAt');
                }
                if (compactString(task.lastError, '')) {
                    addViolation('completed_with_error', task.id, 'Completed task still has unresolved error');
                }
            } else if (Number(task.completedAt)) {
                addViolation('non_completed_has_completedAt', task.id, 'Non-completed task should not keep completedAt timestamp');
            }

            if (status === 'failed' && !Number(task.failedAt)) {
                addViolation('failed_without_timestamp', task.id, 'Failed task missing failedAt');
            }
            if (status === 'killed' && !Number(task.killedAt)) {
                addViolation('killed_without_timestamp', task.id, 'Killed task missing killedAt');
            }
            if (status === 'in_progress' && !Number(task.startedAt)) {
                addViolation('in_progress_without_startedAt', task.id, 'In-progress task missing startedAt');
            }

            for (const depId of dedupeIdList(task.blockedBy)) {
                if (!this.state.tasks[depId]) {
                    addViolation('blockedBy_missing_task', task.id, `blockedBy task does not exist: ${depId}`, { missingTaskId: depId });
                    continue;
                }
                if (depId === task.id) {
                    addViolation('blockedBy_self_reference', task.id, 'Task cannot block itself via blockedBy');
                }
            }

            for (const depId of dedupeIdList(task.blocks)) {
                if (!this.state.tasks[depId]) {
                    addViolation('blocks_missing_task', task.id, `blocks task does not exist: ${depId}`, { missingTaskId: depId });
                    continue;
                }
                if (depId === task.id) {
                    addViolation('blocks_self_reference', task.id, 'Task cannot block itself via blocks');
                }
            }
        }

        if (inProgressTaskIds.length > 1) {
            addViolation('multiple_in_progress', null, 'Strict constraint violated: multiple in_progress tasks', {
                taskIds: inProgressTaskIds,
            });
        }

        return {
            checkedAt: nowTs(),
            ok: violationCount === 0,
            violationCount,
            truncated: violations.length < violationCount,
            byType,
            stats: {
                taskCount: tasks.length,
                inProgressCount: inProgressTaskIds.length,
                strictMode: this.strictMode,
            },
            violations,
        };
    }

    buildPendingContextSummary(limit = 12) {
        const pendingTasks = this.listTasks({ includeCompleted: false })
            .filter((task) => !TERMINAL_STATUSES.has(task.status))
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
            .slice(0, Math.max(1, Number(limit) || 12));

        if (pendingTasks.length === 0) {
            return '';
        }

        const lines = pendingTasks.map((task) => {
            const blocked = Array.isArray(task.blockedBy) && task.blockedBy.length > 0
                ? ` | blockedBy: ${task.blockedBy.join(',')}`
                : '';
            return `- [${task.id}] (${task.status}) ${task.subject}${blocked}`;
        });

        return lines.join('\n');
    }

    getSnapshot() {
        return clone({
            state: this.state,
            recovery: this._recoverySummary,
            telemetry: this.getTelemetrySnapshot(),
            metrics: this.getMetrics(),
        });
    }
}

module.exports = TaskKernel;
