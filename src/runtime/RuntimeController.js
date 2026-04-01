'use strict';

const path = require('path');
const { fork } = require('child_process');
const ManagedProcessRegistry = require('./ManagedProcessRegistry');
const { setManagedProcessRegistry, setRuntimeController } = require('./RuntimeState');

let nextRpcId = 1;

function createDefaultRuntimeSnapshot() {
    return {
        mode: 'supervisor-worker',
        supervisor: {
            pid: process.pid,
            status: 'running',
            uptimeSec: Math.floor(process.uptime()),
        },
        worker: {
            pid: 0,
            status: 'stopped',
            uptimeSec: 0,
            restarts: 0,
            lastExitReason: '',
        },
        memory: {
            pressure: 'normal',
            rssMb: 0,
            heapUsedMb: 0,
            heapTotalMb: 0,
            lastMitigation: '',
            memoryLimitMb: 0,
            memoryLimitSource: 'unknown',
            fatalEligible: false,
            fatalConsecutive: 0,
            fatalRequired: 0,
            fatalStartupGraceMs: 0,
            fatalSuppressedReason: '',
            fatalReason: '',
        },
        managedChildren: {
            total: 0,
            protected: 0,
            recyclable: 0,
        },
    };
}

class ProxyTelegramBot {
    constructor(controller, golemId) {
        this._controller = controller;
        this._golemId = golemId;
    }

    async startPolling() {
        return this._controller.invokeContextMethod(this._golemId, 'brain.tgBot', 'startPolling', []);
    }

    async sendMessage(chatId, text, options = {}) {
        return this._controller.invokeContextMethod(this._golemId, 'brain.tgBot', 'sendMessage', [chatId, text, options]);
    }
}

class ProxyBrain {
    constructor(controller, golemId) {
        this._controller = controller;
        this._golemId = golemId;
        this.status = 'not_started';
        this.userDataDir = '';
        this.chatLogFile = '';
        this.page = null;
        this.config = {};
        this.tgBot = new ProxyTelegramBot(controller, golemId);
    }

    async init(forceReload = false) {
        return this._controller.invokeContextMethod(this._golemId, 'brain', 'init', [forceReload]);
    }

    async reloadSkills() {
        return this._controller.invokeContextMethod(this._golemId, 'brain', 'reloadSkills', []);
    }

    async sendMessage(text, isSystem = false, options = {}) {
        return this._controller.invokeContextMethod(this._golemId, 'brain', 'sendMessage', [text, isSystem, options]);
    }

    applySnapshot(snapshot = {}) {
        this.status = snapshot.status || this.status;
        this.userDataDir = snapshot.userDataDir || this.userDataDir;
        this.chatLogFile = snapshot.chatLogFile || this.chatLogFile;
        this.page = snapshot.hasPage ? { connected: true } : null;
        this.config = { chatId: snapshot.chatId || '' };
    }
}

class ProxyMemory {
    constructor(controller, golemId) {
        this._controller = controller;
        this._golemId = golemId;
        this.data = null;
    }

    async recall(text = '') {
        return this._controller.invokeContextMethod(this._golemId, 'memory', 'recall', [text]);
    }

    async clearMemory() {
        return this._controller.invokeContextMethod(this._golemId, 'memory', 'clearMemory', []);
    }

    async exportMemory() {
        return this._controller.invokeContextMethod(this._golemId, 'memory', 'exportMemory', []);
    }

    async importMemory(payload) {
        return this._controller.invokeContextMethod(this._golemId, 'memory', 'importMemory', [payload]);
    }

    async memorize(text, metadata = {}) {
        return this._controller.invokeContextMethod(this._golemId, 'memory', 'memorize', [text, metadata]);
    }
}

class ProxyAutonomy {
    constructor(controller, golemId) {
        this._controller = controller;
        this._golemId = golemId;
    }

    async start() {
        return this._controller.invokeContextMethod(this._golemId, 'autonomy', 'start', []);
    }

    async scheduleNextArchive() {
        return this._controller.invokeContextMethod(this._golemId, 'autonomy', 'scheduleNextArchive', []);
    }
}

class RuntimeContextProxy {
    constructor(controller, golemId) {
        this.golemId = golemId;
        this.brain = new ProxyBrain(controller, golemId);
        this.memory = new ProxyMemory(controller, golemId);
        this.autonomy = new ProxyAutonomy(controller, golemId);
    }

    applySnapshot(snapshot = {}) {
        this.brain.applySnapshot(snapshot);
    }
}

class RuntimeController {
    constructor(options = {}) {
        this.workerPath = options.workerPath || path.resolve(process.cwd(), 'apps/runtime/worker.js');
        this.contexts = new Map();
        this.server = null;
        this.workerProcess = null;
        this._workerRegistration = null;
        this._pendingRpc = new Map();
        this._stopping = false;
        this._restartInFlight = false;
        this._restartCooldownMs = Number(process.env.GOLEM_WORKER_RESTART_COOLDOWN_MS || 30000);
        this._runtimeSnapshot = createDefaultRuntimeSnapshot();
        this._registry = new ManagedProcessRegistry({ owner: 'supervisor' });
        this._registry.protectPid(process.pid, { name: 'supervisor' });

        setManagedProcessRegistry(this._registry);
        setRuntimeController(this);
    }

    attachServer(server) {
        this.server = server;
        server.runtimeController = this;
        server.contexts = this.contexts;
    }

    getRuntimeSnapshot() {
        return {
            ...this._runtimeSnapshot,
            supervisor: {
                ...this._runtimeSnapshot.supervisor,
                pid: process.pid,
                status: this._runtimeSnapshot.supervisor.status || 'running',
                uptimeSec: Math.floor(process.uptime()),
            },
            managedChildren: this._runtimeSnapshot.managedChildren || this._registry.getStats(),
        };
    }

    getOrCreateContext(golemId = 'golem_A') {
        if (!this.contexts.has(golemId)) {
            this.contexts.set(golemId, new RuntimeContextProxy(this, golemId));
        }
        return this.contexts.get(golemId);
    }

    async ensureWorker(reason = 'on-demand') {
        if (this.workerProcess && this.workerProcess.exitCode === null && !this.workerProcess.killed) {
            return this.workerProcess;
        }

        const child = fork(this.workerPath, [], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                GOLEM_RUNTIME_ROLE: 'worker',
                GOLEM_SUPERVISOR_PID: String(process.pid),
            },
            stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        });

        this.workerProcess = child;
        this._runtimeSnapshot.worker = {
            ...this._runtimeSnapshot.worker,
            pid: child.pid || 0,
            status: 'starting',
        };

        this._workerRegistration = this._registry.registerResource('worker-process', {
            child,
            protected: true,
            recyclable: true,
            stop: async () => {
                if (child.exitCode !== null || child.killed) return;
                child.kill('SIGTERM');
            },
        });

        if (child.stdout) child.stdout.pipe(process.stdout);
        if (child.stderr) child.stderr.pipe(process.stderr);

        child.on('message', (message) => this._handleWorkerMessage(message));
        child.on('exit', (code, signal) => this._handleWorkerExit(code, signal, reason));

        return child;
    }

    async stopWorker(reason = 'stop') {
        const child = this.workerProcess;
        if (!child) return;

        this._stopping = true;

        await new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                resolve();
            };

            child.once('exit', finish);

            try {
                child.send({
                    type: 'control',
                    action: 'shutdown',
                    payload: { reason },
                });
            } catch {}

            setTimeout(() => {
                if (done) return;
                try {
                    child.kill('SIGTERM');
                } catch {}
            }, 3000);

            setTimeout(() => {
                if (done) return;
                try {
                    child.kill('SIGKILL');
                } catch {}
            }, 8000);
        });

        this._stopping = false;
    }

    async restartWorker(reason = 'manual-restart') {
        if (this._restartInFlight) return;
        this._restartInFlight = true;

        try {
            await this.stopWorker(reason);
            this._runtimeSnapshot.worker.status = 'restarting';
            await this.ensureWorker(reason);
        } finally {
            this._restartInFlight = false;
        }
    }

    async shutdownSupervisor(reason = 'shutdown') {
        this._runtimeSnapshot.supervisor.status = 'stopping';
        await this.stopWorker(reason);

        if (this.server && typeof this.server.stop === 'function') {
            this.server.stop();
        }

        setTimeout(() => process.exit(0), 50);
    }

    async rpc(method, params = {}, options = {}) {
        await this.ensureWorker(method);

        const child = this.workerProcess;
        if (!child) {
            throw new Error('Worker process is not available');
        }

        const id = nextRpcId++;
        const timeoutMs = Number(options.timeoutMs || 30000);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRpc.delete(id);
                reject(new Error(`RPC timeout for ${method}`));
            }, timeoutMs);

            this._pendingRpc.set(id, { resolve, reject, timer });

            try {
                child.send({ type: 'rpc', id, method, params });
            } catch (error) {
                clearTimeout(timer);
                this._pendingRpc.delete(id);
                reject(error);
            }
        });
    }

    async ensureGolem(golemConfig, options = {}) {
        await this.rpc('golem.ensure', {
            golemConfig,
            autoStart: options.autoStart !== false,
        }, { timeoutMs: 60000 });

        return this.getOrCreateContext((golemConfig && golemConfig.id) || 'golem_A');
    }

    async invokeContextMethod(golemId, target, method, args = []) {
        return this.rpc('context.call', { golemId, target, method, args }, { timeoutMs: 60000 });
    }

    async sendDashboardChat(payload) {
        return this.rpc('dashboard.chat.send', payload, { timeoutMs: 60000 });
    }

    async sendDashboardCallback(payload) {
        return this.rpc('dashboard.chat.callback', payload, { timeoutMs: 60000 });
    }

    async getMetacognitionStats(golemId) {
        return this.rpc('dashboard.chat.metacognition', { golemId }, { timeoutMs: 30000 });
    }

    async getMetacognitionHistory(golemId, limit) {
        return this.rpc('dashboard.chat.metacognitionHistory', { golemId, limit }, { timeoutMs: 30000 });
    }

    async getPendingTaskSummary(golemId, taskId) {
        return this.rpc('controller.pendingTaskSummary', { golemId, taskId }, { timeoutMs: 30000 });
    }

    async listTasks(golemId, filters = {}) {
        return this.rpc('tasks.list', { golemId, filters }, { timeoutMs: 30000 });
    }

    async getTask(golemId, taskId) {
        return this.rpc('tasks.get', { golemId, taskId }, { timeoutMs: 30000 });
    }

    async createTask(golemId, input = {}, options = {}) {
        return this.rpc('tasks.create', { golemId, input, options }, { timeoutMs: 30000 });
    }

    async updateTask(golemId, taskId, patch = {}, options = {}) {
        return this.rpc('tasks.update', { golemId, taskId, patch, options }, { timeoutMs: 30000 });
    }

    async stopTask(golemId, taskId, options = {}) {
        return this.rpc('tasks.stop', { golemId, taskId, options }, { timeoutMs: 30000 });
    }

    async todoWrite(golemId, items = [], options = {}) {
        return this.rpc('tasks.todoWrite', { golemId, items, options }, { timeoutMs: 30000 });
    }

    async getTaskRecoverySummary(golemId) {
        return this.rpc('tasks.recovery', { golemId }, { timeoutMs: 30000 });
    }

    async getTaskAudit(golemId, filters = {}) {
        return this.rpc('tasks.audit', { golemId, filters }, { timeoutMs: 30000 });
    }

    async getTaskMetrics(golemId) {
        return this.rpc('tasks.metrics', { golemId }, { timeoutMs: 30000 });
    }

    async getTaskIntegrity(golemId, options = {}) {
        return this.rpc('tasks.integrity', { golemId, options }, { timeoutMs: 30000 });
    }

    _handleWorkerMessage(message) {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'rpc_result') {
            const pending = this._pendingRpc.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this._pendingRpc.delete(message.id);
            if (message.error) {
                pending.reject(new Error(message.error));
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        if (message.type === 'runtime_snapshot') {
            this._applySnapshot(message.snapshot || {});
            return;
        }

        if (message.type === 'runtime_event') {
            this._handleRuntimeEvent(message.name, message.payload || {});
        }
    }

    _applySnapshot(snapshot) {
        const runtime = snapshot.runtime || {};
        this._runtimeSnapshot = {
            ...this._runtimeSnapshot,
            ...runtime,
            supervisor: {
                ...this._runtimeSnapshot.supervisor,
                ...(runtime.supervisor || {}),
            },
            worker: {
                ...this._runtimeSnapshot.worker,
                ...(runtime.worker || {}),
            },
            memory: {
                ...this._runtimeSnapshot.memory,
                ...(runtime.memory || {}),
            },
            managedChildren: {
                ...this._runtimeSnapshot.managedChildren,
                ...(runtime.managedChildren || {}),
            },
        };

        const snapshots = Array.isArray(snapshot.contexts) ? snapshot.contexts : [];
        const activeIds = new Set();
        for (const item of snapshots) {
            const golemId = item.id || 'golem_A';
            activeIds.add(golemId);
            this.getOrCreateContext(golemId).applySnapshot(item);
        }

        for (const existingId of Array.from(this.contexts.keys())) {
            if (!activeIds.has(existingId) && (snapshots.length > 0 || this._runtimeSnapshot.worker.status === 'stopped')) {
                this.contexts.delete(existingId);
            }
        }
    }

    _handleRuntimeEvent(name, payload) {
        if (name === 'memory.fatal') {
            const eventPayload = payload && typeof payload === 'object' ? payload : {};
            const eligible = eventPayload.eligible === true || eventPayload.fatalEligible === true;
            const fatalReason = typeof eventPayload.fatalReason === 'string' && eventPayload.fatalReason
                ? eventPayload.fatalReason
                : 'rss-limit';
            const restartReason = typeof eventPayload.restartReason === 'string' && eventPayload.restartReason
                ? eventPayload.restartReason
                : `memory-fatal:${fatalReason}`;

            this._runtimeSnapshot.memory = {
                ...this._runtimeSnapshot.memory,
                ...eventPayload,
                fatalEligible: eligible,
            };

            if (!eligible) {
                this._runtimeSnapshot.worker = {
                    ...this._runtimeSnapshot.worker,
                    status: this._runtimeSnapshot.worker.status === 'stopped' ? 'stopped' : 'degraded',
                };
                const suppressionReason = typeof eventPayload.fatalSuppressedReason === 'string'
                    ? eventPayload.fatalSuppressedReason
                    : 'not-eligible';
                this._runtimeSnapshot.memory.lastMitigation = `fatal-suppressed:${suppressionReason}`;
                return;
            }

            this._runtimeSnapshot.worker = {
                ...this._runtimeSnapshot.worker,
                status: 'restarting',
            };
            this._runtimeSnapshot.memory.lastMitigation = `fatal:${restartReason}`;

            this.restartWorker(restartReason).catch((error) => {
                console.error('[RuntimeController] Failed to recycle worker after fatal memory pressure:', error.message);
            });
            return;
        }

        if (name === 'dashboard.reply' && this.server && typeof this.server.broadcastLog === 'function') {
            this.server.broadcastLog(payload);
            return;
        }

        if (name === 'task.event' && this.server && typeof this.server.broadcastTaskEvent === 'function') {
            this.server.broadcastTaskEvent(payload);
            return;
        }

        if (name === 'task.recovery' && this.server && typeof this.server.broadcastTaskRecovery === 'function') {
            this.server.broadcastTaskRecovery(payload);
        }
    }

    _handleWorkerExit(code, signal, reason) {
        if (this._workerRegistration) {
            this._workerRegistration.unregister();
            this._workerRegistration = null;
        }

        this.workerProcess = null;
        for (const pending of this._pendingRpc.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Worker disconnected'));
        }
        this._pendingRpc.clear();

        this._runtimeSnapshot.worker = {
            ...this._runtimeSnapshot.worker,
            pid: 0,
            status: 'stopped',
            restarts: this._runtimeSnapshot.worker.restarts + (this._stopping ? 0 : 1),
            lastExitReason: signal || `exit:${code}:${reason}`,
        };
        this.contexts.clear();

        if (!this._stopping && !this._restartInFlight) {
            setTimeout(() => {
                this.ensureWorker('unexpected-exit').catch((error) => {
                    console.error('[RuntimeController] Failed to restart worker:', error.message);
                });
            }, this._restartCooldownMs);
        }
    }
}

module.exports = RuntimeController;
