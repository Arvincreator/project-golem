const AgentKernel = require('../managers/AgentKernel');

const PHASE_ORDER = ['research', 'synthesis', 'implementation', 'verification'];
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'killed']);
const TERMINAL_WORKER_STATUSES = new Set(['completed', 'failed', 'killed']);
const PHASE_ROLE = Object.freeze({
    research: 'research',
    synthesis: 'synthesis',
    implementation: 'implementation',
    verification: 'verification',
});

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function phaseIndex(phase) {
    const idx = PHASE_ORDER.indexOf(String(phase || '').trim().toLowerCase());
    return idx >= 0 ? idx : 0;
}

function roleStatusSummary(workers = []) {
    const summary = {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        killed: 0,
        terminal: 0,
    };
    for (const worker of workers) {
        if (!worker) continue;
        summary.total += 1;
        const status = compactText(worker.status, '');
        if (summary[status] === undefined) summary[status] = 0;
        summary[status] += 1;
        if (TERMINAL_WORKER_STATUSES.has(status)) summary.terminal += 1;
    }
    return summary;
}

function safeWorkflowMetadata(metadata = {}) {
    const safe = (metadata && typeof metadata === 'object') ? metadata : {};
    const workflow = (safe.workflow && typeof safe.workflow === 'object') ? safe.workflow : {};
    const phase = compactText(workflow.phase, 'research').toLowerCase();
    return {
        ...safe,
        workflow: {
            phase: PHASE_ORDER.includes(phase) ? phase : 'research',
            order: Array.isArray(workflow.order) && workflow.order.length > 0
                ? workflow.order.slice(0, 8)
                : PHASE_ORDER.slice(),
            updatedAt: Number(workflow.updatedAt || Date.now()) || Date.now(),
            managedByCoordinator: workflow.managedByCoordinator === true,
        },
    };
}

class CoordinatorEngine {
    constructor(options = {}) {
        this.agentKernel = options.agentKernel || null;
        this.agentRunner = options.agentRunner || null;
        this.strictMode = options.strictMode !== false;
    }

    _ensureKernel() {
        if (!this.agentKernel) {
            throw new Error('CoordinatorEngine requires agentKernel');
        }
    }

    _getSessionPhase(session) {
        const metadata = safeWorkflowMetadata(session && session.metadata);
        return metadata.workflow.phase;
    }

    _setSessionPhase(session, phase, options = {}) {
        const sessionId = session && session.id;
        if (!sessionId) return session;
        const metadata = safeWorkflowMetadata(session.metadata);
        metadata.workflow.phase = PHASE_ORDER.includes(phase) ? phase : metadata.workflow.phase;
        metadata.workflow.updatedAt = Date.now();

        const patch = {
            metadata,
        };

        if (phase === 'synthesis' && session.status === 'running') {
            patch.status = 'synthesizing';
        }
        if ((phase === 'implementation' || phase === 'verification') && session.status === 'synthesizing') {
            patch.status = 'running';
        }

        const result = this.agentKernel.updateSession(sessionId, patch, {
            actor: compactText(options.actor, 'coordinator'),
            source: compactText(options.source, 'agent_coordinator'),
        });
        return result.session;
    }

    _workersByRole(sessionId, role) {
        return this.agentKernel.listWorkers({ sessionId }).filter((worker) => worker.role === role);
    }

    _hasAtLeastOneCompleted(sessionId, role) {
        return this._workersByRole(sessionId, role).some((worker) => worker.status === 'completed');
    }

    _allRoleWorkersTerminal(sessionId, role) {
        const workers = this._workersByRole(sessionId, role);
        if (workers.length === 0) return false;
        return workers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status));
    }

    _allRoleWorkersCompleted(sessionId, role) {
        const workers = this._workersByRole(sessionId, role);
        if (workers.length === 0) return false;
        return workers.every((worker) => worker.status === 'completed');
    }

    _ensureRolePhase(session, role, options = {}) {
        const phase = this._getSessionPhase(session);
        const sessionId = session.id;
        const normalizedRole = compactText(role, 'research').toLowerCase();

        if (normalizedRole === PHASE_ROLE.research) {
            if (phase !== 'research') {
                throw new AgentKernel.AgentKernelError(
                    AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                    `research worker cannot spawn during ${phase} phase`,
                    { sessionId, phase, role: normalizedRole }
                );
            }
            return this.agentKernel.getSession(sessionId);
        }

        if (normalizedRole === PHASE_ROLE.synthesis) {
            if (phase === PHASE_ROLE.research) {
                if (this.strictMode && !this._hasAtLeastOneCompleted(sessionId, PHASE_ROLE.research)) {
                    throw new AgentKernel.AgentKernelError(
                        AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                        'synthesis phase requires completed research worker first',
                        { sessionId, phase, role: normalizedRole }
                    );
                }
                return this._setSessionPhase(session, PHASE_ROLE.synthesis, options);
            }
            if (phase === PHASE_ROLE.synthesis) {
                return this.agentKernel.getSession(sessionId);
            }
            throw new AgentKernel.AgentKernelError(
                AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                `synthesis worker cannot spawn during ${phase} phase`,
                { sessionId, phase, role: normalizedRole }
            );
        }

        if (normalizedRole === PHASE_ROLE.implementation) {
            if (phase === 'research') {
                if (this.strictMode) {
                    throw new AgentKernel.AgentKernelError(
                        AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                        'implementation phase requires synthesis stage first in strict mode',
                        { sessionId, phase, role: normalizedRole }
                    );
                }
                let updated = this._setSessionPhase(session, 'synthesis', options);
                if (this.strictMode) {
                    const synthesisWorkers = this._workersByRole(sessionId, PHASE_ROLE.synthesis);
                    if (synthesisWorkers.length > 0 && !this._allRoleWorkersCompleted(sessionId, PHASE_ROLE.synthesis)) {
                        throw new AgentKernel.AgentKernelError(
                            AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                            'implementation phase requires completed synthesis workers first',
                            { sessionId, phase: PHASE_ROLE.synthesis, role: normalizedRole }
                        );
                    }
                }
                updated = this._setSessionPhase(updated, 'implementation', options);
                return updated;
            }
            if (phase === 'synthesis') {
                if (this.strictMode) {
                    const synthesisWorkers = this._workersByRole(sessionId, PHASE_ROLE.synthesis);
                    if (synthesisWorkers.length === 0) {
                        throw new AgentKernel.AgentKernelError(
                            AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                            'implementation phase requires synthesis worker in strict mode',
                            { sessionId, phase, role: normalizedRole }
                        );
                    }
                    if (!this._allRoleWorkersTerminal(sessionId, PHASE_ROLE.synthesis) || !this._hasAtLeastOneCompleted(sessionId, PHASE_ROLE.synthesis)) {
                        throw new AgentKernel.AgentKernelError(
                            AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                            'implementation phase requires terminal synthesis workers and at least one completion',
                            { sessionId, phase, role: normalizedRole }
                        );
                    }
                }
                return this._setSessionPhase(session, 'implementation', options);
            }
            if (phase === 'implementation') {
                return this.agentKernel.getSession(sessionId);
            }
            throw new AgentKernel.AgentKernelError(
                AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                `implementation worker cannot spawn during ${phase} phase`,
                { sessionId, phase, role: normalizedRole }
            );
        }

        if (normalizedRole === PHASE_ROLE.verification) {
            if (phase === 'implementation') {
                if (this.strictMode) {
                    if (!this._allRoleWorkersTerminal(sessionId, PHASE_ROLE.implementation)
                        || !this._hasAtLeastOneCompleted(sessionId, PHASE_ROLE.implementation)) {
                        throw new AgentKernel.AgentKernelError(
                            AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                            'verification phase requires terminal implementation workers and at least one completion',
                            { sessionId, phase, role: normalizedRole }
                        );
                    }
                }
                return this._setSessionPhase(session, 'verification', options);
            }
            if (phase === 'verification') {
                return this.agentKernel.getSession(sessionId);
            }
            throw new AgentKernel.AgentKernelError(
                AgentKernel.AGENT_ERROR_CODES.AGENT_INVALID_TRANSITION,
                `verification worker cannot spawn during ${phase} phase`,
                { sessionId, phase, role: normalizedRole }
            );
        }

        return this.agentKernel.getSession(sessionId);
    }

    createSession(input = {}, options = {}) {
        this._ensureKernel();
        const metadata = safeWorkflowMetadata(input.metadata);
        metadata.workflow.phase = 'research';
        metadata.workflow.updatedAt = Date.now();
        metadata.workflow.managedByCoordinator = true;

        return this.agentKernel.createSession({
            ...input,
            metadata,
            status: compactText(input.status, 'pending') || 'pending',
        }, options);
    }

    spawnWorker(input = {}, options = {}) {
        this._ensureKernel();
        const sessionId = compactText(input.sessionId, '');
        const role = compactText(input.role, 'research').toLowerCase();
        const session = this.agentKernel.getSession(sessionId);
        if (!session) {
            throw new AgentKernel.AgentKernelError(
                AgentKernel.AGENT_ERROR_CODES.AGENT_SESSION_NOT_FOUND,
                `Session not found: ${sessionId}`,
                { sessionId }
            );
        }

        const nextSession = this._ensureRolePhase(session, role, options);
        const spawnResult = this.agentKernel.spawnWorker({
            ...input,
            sessionId: nextSession.id,
            role,
        }, options);

        if (this.agentRunner && typeof this.agentRunner.onWorkerSpawn === 'function') {
            this.agentRunner.onWorkerSpawn(spawnResult.worker, options);
        }

        const reconcile = this.reconcileSession(spawnResult.session.id, options);
        return {
            ...spawnResult,
            session: reconcile.session || spawnResult.session,
            workers: reconcile.workers || this.agentKernel.listWorkers({ sessionId: spawnResult.session.id }),
        };
    }

    updateWorker(workerId, patch = {}, options = {}) {
        this._ensureKernel();
        const result = this.agentKernel.updateWorker(workerId, patch, options);
        const reconcile = this.reconcileSession(result.session.id, options);
        return {
            ...result,
            session: reconcile.session || result.session,
            workers: reconcile.workers || this.agentKernel.listWorkers({ sessionId: result.session.id }),
        };
    }

    updateSession(sessionId, patch = {}, options = {}) {
        this._ensureKernel();
        const result = this.agentKernel.updateSession(sessionId, patch, options);
        const reconcile = this.reconcileSession(sessionId, options);
        return {
            ...result,
            session: reconcile.session || result.session,
            workers: reconcile.workers || this.agentKernel.listWorkers({ sessionId }),
        };
    }

    message(input = {}, options = {}) {
        this._ensureKernel();
        return this.agentKernel.message(input, options);
    }

    async wait(sessionId, options = {}) {
        this._ensureKernel();
        return this.agentKernel.wait(sessionId, options);
    }

    stop(input = {}, options = {}) {
        this._ensureKernel();
        const result = this.agentKernel.stop(input, options);

        if (this.agentRunner) {
            if (input.workerId && typeof this.agentRunner.stopWorker === 'function') {
                this.agentRunner.stopWorker(input.workerId);
            }
            if (input.sessionId && typeof this.agentRunner.stopSession === 'function') {
                this.agentRunner.stopSession(input.sessionId);
            }
        }
        return result;
    }

    list(payload = {}) {
        this._ensureKernel();
        const safe = (payload && typeof payload === 'object') ? payload : {};
        const statuses = Array.isArray(safe.statuses) ? safe.statuses : (safe.status ? [safe.status] : []);
        const includeOrchestration = safe.includeOrchestration === true;
        const sessionFilters = {
            statuses,
            includeTerminal: safe.includeTerminal === true || safe.includeCompleted === true,
            limit: safe.limit,
        };
        const sessions = this.agentKernel.listSessions(sessionFilters);
        const workerFilters = {
            sessionId: compactText(safe.sessionId, ''),
            statuses,
            limit: safe.limit,
        };
        const workers = this.agentKernel.listWorkers(workerFilters);
        const result = {
            sessions,
            workers,
        };
        if (includeOrchestration) {
            result.orchestrationBySession = sessions.reduce((acc, session) => {
                const sessionWorkers = workers.filter((worker) => worker.sessionId === session.id);
                acc[session.id] = this._buildOrchestrationState(session, sessionWorkers);
                return acc;
            }, {});
        }
        return result;
    }

    getSession(sessionId) {
        this._ensureKernel();
        const session = this.agentKernel.getSession(sessionId);
        if (!session) return null;
        const workers = this.agentKernel.listWorkers({ sessionId: session.id });
        const orchestration = this._buildOrchestrationState(session, workers);
        return {
            session,
            workers,
            orchestration,
        };
    }

    getWorker(workerId) {
        this._ensureKernel();
        const worker = this.agentKernel.getWorker(workerId);
        if (!worker) return null;
        return {
            worker,
            session: this.agentKernel.getSession(worker.sessionId),
        };
    }

    resume(options = {}) {
        this._ensureKernel();
        const result = this.agentKernel.resume(options);
        if (this.agentRunner && typeof this.agentRunner.handleResume === 'function') {
            this.agentRunner.handleResume(result, options);
        }
        return result;
    }

    getResumeBrief(options = {}) {
        this._ensureKernel();
        return this.agentKernel.getResumeBrief(options);
    }

    getRecoverySummary() {
        this._ensureKernel();
        return this.agentKernel.getRecoverySummary();
    }

    nextRecoverySequence(options = {}) {
        this._ensureKernel();
        return this.agentKernel.nextRecoverySequence(options);
    }

    getAuditEvents(filters = {}) {
        this._ensureKernel();
        return this.agentKernel.getAuditEvents(filters);
    }

    getMetrics() {
        this._ensureKernel();
        return this.agentKernel.getMetrics();
    }

    getBudgets() {
        this._ensureKernel();
        return this.agentKernel.getBudgets();
    }

    setBudgets(policy = {}, options = {}) {
        this._ensureKernel();
        return this.agentKernel.setBudgetPolicy(policy, options);
    }

    buildPendingSessionSummary(limit = 8) {
        this._ensureKernel();
        return this.agentKernel.buildPendingSessionSummary(limit);
    }

    _buildPhaseState(workers = [], phase = 'research') {
        const role = PHASE_ROLE[phase] || phase;
        const roleWorkers = workers.filter((worker) => worker.role === role);
        const status = roleStatusSummary(roleWorkers);
        const readyToAdvance = status.total > 0
            && status.terminal === status.total
            && status.completed > 0;
        return {
            phase,
            role,
            status,
            readyToAdvance,
            pendingWorkers: roleWorkers
                .filter((worker) => worker.status === 'pending' || worker.status === 'running')
                .map((worker) => worker.id),
        };
    }

    _buildOrchestrationState(session, workers = []) {
        if (!session) return null;
        const phase = this._getSessionPhase(session);
        const phaseStates = PHASE_ORDER.map((phaseName) => this._buildPhaseState(workers, phaseName));
        const phaseMap = phaseStates.reduce((acc, item) => {
            acc[item.phase] = item;
            return acc;
        }, {});

        const blockers = [];
        const recommendedActions = [];

        const pushAction = (action, reason, input = {}) => {
            recommendedActions.push({
                action,
                reason,
                input,
            });
        };

        if (phase === PHASE_ROLE.research) {
            if (phaseMap.research.status.total === 0) {
                pushAction('agent_worker_spawn', 'research worker missing', {
                    sessionId: session.id,
                    role: PHASE_ROLE.research,
                    prompt: 'Collect evidence and constraints for this objective',
                });
            } else if (phaseMap.research.status.completed === 0 && phaseMap.research.status.terminal === phaseMap.research.status.total) {
                blockers.push('research workers finished without successful completion');
                pushAction('agent_resume', 'recover research phase', { sessionId: session.id });
            } else if (phaseMap.research.status.pending > 0 || phaseMap.research.status.running > 0) {
                pushAction('agent_wait', 'research workers are still running', {
                    sessionId: session.id,
                    timeoutMs: 30000,
                });
            }
        }

        if (phase === PHASE_ROLE.synthesis) {
            if (phaseMap.synthesis.status.total === 0) {
                if (this.strictMode) {
                    blockers.push('strict mode requires synthesis worker before implementation');
                }
                pushAction('agent_worker_spawn', 'synthesis worker missing', {
                    sessionId: session.id,
                    role: PHASE_ROLE.synthesis,
                    prompt: 'Summarize research findings into an implementation plan',
                });
            } else if (phaseMap.synthesis.status.pending > 0 || phaseMap.synthesis.status.running > 0) {
                pushAction('agent_wait', 'synthesis workers are still running', {
                    sessionId: session.id,
                    timeoutMs: 30000,
                });
            } else if (phaseMap.synthesis.status.completed === 0) {
                blockers.push('synthesis workers completed without success');
                pushAction('agent_resume', 'retry synthesis phase', { sessionId: session.id });
            } else {
                pushAction('agent_worker_spawn', 'ready for implementation', {
                    sessionId: session.id,
                    role: PHASE_ROLE.implementation,
                    prompt: 'Implement plan produced by synthesis phase',
                });
            }
        }

        if (phase === PHASE_ROLE.implementation) {
            if (phaseMap.implementation.status.total === 0) {
                pushAction('agent_worker_spawn', 'implementation worker missing', {
                    sessionId: session.id,
                    role: PHASE_ROLE.implementation,
                    prompt: 'Execute implementation tasks from synthesis plan',
                });
            } else if (phaseMap.implementation.status.pending > 0 || phaseMap.implementation.status.running > 0) {
                pushAction('agent_wait', 'implementation workers are still running', {
                    sessionId: session.id,
                    timeoutMs: 30000,
                });
            } else if (phaseMap.implementation.status.completed === 0) {
                blockers.push('implementation workers completed without success');
                pushAction('agent_resume', 'recover implementation phase', { sessionId: session.id });
            } else if (phaseMap.implementation.readyToAdvance) {
                pushAction('agent_worker_spawn', 'ready for verification', {
                    sessionId: session.id,
                    role: PHASE_ROLE.verification,
                    prompt: 'Verify implementation result and produce final evidence',
                });
            }
        }

        if (phase === PHASE_ROLE.verification) {
            if (phaseMap.verification.status.total === 0) {
                pushAction('agent_worker_spawn', 'verification worker missing', {
                    sessionId: session.id,
                    role: PHASE_ROLE.verification,
                    prompt: 'Verify implementation output with concrete checks',
                });
            } else if (phaseMap.verification.status.pending > 0 || phaseMap.verification.status.running > 0) {
                pushAction('agent_wait', 'verification workers are still running', {
                    sessionId: session.id,
                    timeoutMs: 30000,
                });
            } else if (phaseMap.verification.status.failed > 0) {
                blockers.push('verification failed');
                pushAction('agent_resume', 'recover verification failure', { sessionId: session.id });
            } else if (phaseMap.verification.status.blocked > 0) {
                blockers.push('verification blocked');
                pushAction('agent_resume', 'recover verification blocker', { sessionId: session.id });
            }
        }

        return {
            sessionId: session.id,
            sessionStatus: session.status,
            currentPhase: phase,
            strictMode: this.strictMode,
            phaseOrder: PHASE_ORDER.slice(),
            phases: phaseStates,
            blockers,
            recommendedActions,
            nextAction: recommendedActions[0] || null,
            updatedAt: Date.now(),
        };
    }

    getOrchestrationState(sessionId) {
        this._ensureKernel();
        const session = this.agentKernel.getSession(sessionId);
        if (!session) return null;
        const workers = this.agentKernel.listWorkers({ sessionId });
        return this._buildOrchestrationState(session, workers);
    }

    reconcileSession(sessionId, options = {}) {
        this._ensureKernel();
        let session = this.agentKernel.getSession(sessionId);
        if (!session) return { session: null, workers: [] };
        if (TERMINAL_STATUSES.has(session.status)) {
            const terminalWorkers = this.agentKernel.listWorkers({ sessionId });
            const phase = this._getSessionPhase(session);
            const verification = session.metadata && session.metadata.verification;
            if ((session.status === 'failed' || session.status === 'blocked') && !compactText(session.lastError, '')) {
                const suffix = session.status === 'failed' ? 'failed' : 'blocked';
                const phaseReason = `${phase}_${suffix}`;
                session = this.agentKernel.updateSession(session.id, {
                    lastError: phaseReason,
                }, {
                    actor: compactText(options.actor, 'coordinator'),
                    source: compactText(options.source, 'agent_coordinator'),
                }).session;
            }
            if (
                session.status === 'completed'
                && phase === PHASE_ROLE.verification
                && (!verification || verification.status !== 'verified')
            ) {
                session = this.agentKernel.updateSession(session.id, {
                    clearError: true,
                    metadata: {
                        ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
                        verification: {
                            status: 'verified',
                            note: 'Coordinator verification phase completed',
                            updatedAt: Date.now(),
                        },
                    },
                }, {
                    actor: compactText(options.actor, 'coordinator'),
                    source: compactText(options.source, 'agent_coordinator'),
                }).session;
            }
            return {
                session,
                workers: terminalWorkers,
            };
        }

        let workers = this.agentKernel.listWorkers({ sessionId });
        let phase = this._getSessionPhase(session);

        if (phase === 'research') {
            const researchWorkers = workers.filter((worker) => worker.role === 'research');
            const researchDone = researchWorkers.length > 0
                && researchWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))
                && researchWorkers.some((worker) => worker.status === 'completed');
            if (researchDone) {
                session = this._setSessionPhase(session, 'synthesis', options);
                phase = 'synthesis';
            } else if (
                researchWorkers.length > 0
                && researchWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))
                && researchWorkers.some((worker) => worker.status === 'failed')
            ) {
                session = this.agentKernel.updateSession(session.id, {
                    status: 'failed',
                    lastError: 'research_failed',
                }, {
                    actor: compactText(options.actor, 'coordinator'),
                    source: compactText(options.source, 'agent_coordinator'),
                }).session;
            } else if (
                researchWorkers.length > 0
                && researchWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))
                && researchWorkers.some((worker) => worker.status === 'blocked')
            ) {
                session = this.agentKernel.updateSession(session.id, {
                    status: 'blocked',
                    lastError: 'research_blocked',
                }, {
                    actor: compactText(options.actor, 'coordinator'),
                    source: compactText(options.source, 'agent_coordinator'),
                }).session;
            }
        }

        if (phase === 'synthesis') {
            const synthesisWorkers = workers.filter((worker) => worker.role === PHASE_ROLE.synthesis);
            if (synthesisWorkers.length > 0) {
                const synthesisTerminal = synthesisWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status));
                const synthesisCompleted = synthesisWorkers.some((worker) => worker.status === 'completed');
                if (synthesisTerminal && synthesisCompleted) {
                    session = this._setSessionPhase(session, PHASE_ROLE.implementation, options);
                    phase = PHASE_ROLE.implementation;
                } else if (synthesisTerminal && synthesisWorkers.some((worker) => worker.status === 'failed')) {
                    session = this.agentKernel.updateSession(session.id, {
                        status: 'failed',
                        lastError: 'synthesis_failed',
                    }, {
                        actor: compactText(options.actor, 'coordinator'),
                        source: compactText(options.source, 'agent_coordinator'),
                    }).session;
                } else if (synthesisTerminal && synthesisWorkers.some((worker) => worker.status === 'blocked')) {
                    session = this.agentKernel.updateSession(session.id, {
                        status: 'blocked',
                        lastError: 'synthesis_blocked',
                    }, {
                        actor: compactText(options.actor, 'coordinator'),
                        source: compactText(options.source, 'agent_coordinator'),
                    }).session;
                }
            } else if (!this.strictMode) {
                const implementationWorkers = workers.filter((worker) => worker.role === PHASE_ROLE.implementation);
                if (implementationWorkers.length > 0) {
                    session = this._setSessionPhase(session, PHASE_ROLE.implementation, options);
                    phase = PHASE_ROLE.implementation;
                }
            }
        }

        if (phase === 'implementation') {
            const implementationWorkers = workers.filter((worker) => worker.role === 'implementation');
            const implementationDone = implementationWorkers.length > 0
                && implementationWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))
                && implementationWorkers.some((worker) => worker.status === 'completed');
            if (implementationDone) {
                session = this._setSessionPhase(session, 'verification', options);
                phase = 'verification';
            } else if (
                implementationWorkers.length > 0
                && implementationWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))
                && implementationWorkers.some((worker) => worker.status === 'failed')
            ) {
                session = this.agentKernel.updateSession(session.id, {
                    status: 'failed',
                    lastError: 'implementation_failed',
                }, {
                    actor: compactText(options.actor, 'coordinator'),
                    source: compactText(options.source, 'agent_coordinator'),
                }).session;
            } else if (
                implementationWorkers.length > 0
                && implementationWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))
                && implementationWorkers.some((worker) => worker.status === 'blocked')
            ) {
                session = this.agentKernel.updateSession(session.id, {
                    status: 'blocked',
                    lastError: 'implementation_blocked',
                }, {
                    actor: compactText(options.actor, 'coordinator'),
                    source: compactText(options.source, 'agent_coordinator'),
                }).session;
            }
        }

        if (phase === 'verification') {
            const verificationWorkers = workers.filter((worker) => worker.role === 'verification');
            if (verificationWorkers.length > 0 && verificationWorkers.every((worker) => TERMINAL_WORKER_STATUSES.has(worker.status))) {
                if (verificationWorkers.some((worker) => worker.status === 'failed')) {
                    session = this.agentKernel.updateSession(session.id, {
                        status: 'failed',
                        lastError: 'verification_failed',
                    }, {
                        actor: compactText(options.actor, 'coordinator'),
                        source: compactText(options.source, 'agent_coordinator'),
                    }).session;
                } else if (verificationWorkers.some((worker) => worker.status === 'blocked')) {
                    session = this.agentKernel.updateSession(session.id, {
                        status: 'blocked',
                        lastError: 'verification_blocked',
                    }, {
                        actor: compactText(options.actor, 'coordinator'),
                        source: compactText(options.source, 'agent_coordinator'),
                    }).session;
                } else if (verificationWorkers.some((worker) => worker.status === 'completed')) {
                    session = this.agentKernel.updateSession(session.id, {
                        status: 'completed',
                        clearError: true,
                        metadata: {
                            ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
                            verification: {
                                status: 'verified',
                                note: 'Coordinator verification phase completed',
                                updatedAt: Date.now(),
                            },
                        },
                    }, {
                        actor: compactText(options.actor, 'coordinator'),
                        source: compactText(options.source, 'agent_coordinator'),
                    }).session;
                }
            }
        }

        session = this.agentKernel.getSession(sessionId);
        workers = this.agentKernel.listWorkers({ sessionId });
        return { session, workers };
    }
}

module.exports = CoordinatorEngine;
