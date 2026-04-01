const ResponseParser = require('../utils/ResponseParser');

const PHASE_ORDER = ['research', 'synthesis', 'implementation', 'verification'];
const PHASE_LABELS = {
    research: '研究',
    synthesis: '彙整',
    implementation: '實作',
    verification: '驗證',
};

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function truncate(value, max = 300) {
    const text = String(value || '');
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
}

function stripProtocolNoise(rawText = '') {
    return String(rawText || '')
        .replace(/\[\[BEGIN:[^\]]+\]\]/g, '')
        .replace(/\[\[END:[^\]]+\]\]/g, '')
        .replace(/\[GOLEM_MEMORY\][\s\S]*?(?=\[GOLEM_REPLY\]|\[GOLEM_ACTION\]|$)/gi, '')
        .replace(/\[GOLEM_ACTION\][\s\S]*$/gi, '')
        .replace(/\[GOLEM_REPLY\]/gi, '')
        .trim();
}

function toPlainText(raw = '') {
    return String(raw || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

class PlanningModeExecutor {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this.controller = options.controller || null;
        this.maxWorkerOutputChars = Math.max(
            600,
            Number(options.maxWorkerOutputChars || 2400) || 2400
        );
    }

    _ensureDependencies() {
        if (!this.brain) throw new Error('PlanningModeExecutor requires brain');
        if (!this.controller) throw new Error('PlanningModeExecutor requires controller');
    }

    _buildObjective(userInput = '') {
        const compact = compactText(userInput, '').replace(/\s+/g, ' ');
        if (!compact) return 'Handle complex planning request';
        const firstLine = compact.split('\n')[0];
        return truncate(firstLine, 140);
    }

    _phaseStartIndex(session = {}) {
        const workflow = session && session.metadata && session.metadata.workflow
            ? session.metadata.workflow
            : {};
        const phase = compactText(workflow.phase, 'research').toLowerCase();
        const index = PHASE_ORDER.indexOf(phase);
        return index >= 0 ? index : 0;
    }

    _buildWorkerPrompt({ phase, userInput, phaseOutputs = {}, objective = '' }) {
        const priorContext = [];
        for (const priorPhase of PHASE_ORDER) {
            if (!phaseOutputs[priorPhase]) continue;
            priorContext.push(`- ${priorPhase}: ${truncate(phaseOutputs[priorPhase], 1200)}`);
        }
        const priorBlock = priorContext.length > 0
            ? priorContext.join('\n')
            : '- (none)';

        return `
你現在是 Planning Mode 下的 ${phase} worker，僅負責此階段。

[Objective]
${objective || 'N/A'}

[User Request]
${userInput}

[Previous Phase Outputs]
${priorBlock}

[Hard Rules]
1. 僅輸出本階段所需結果，不要輸出 JSON，不要輸出 action，不要呼叫 task/agent/command。
2. 回覆必須可落地、可驗證，避免空泛敘述。
3. 若資訊不足，明確列出缺口與下一步，不要假裝完成。
4. 請使用中文自然語言，維持精簡與可執行。

[Deliverable]
- research: 梳理需求、風險、限制與可行策略。
- synthesis: 產出可執行計畫與優先順序。
- implementation: 產出實作方案、關鍵變更點、驗證步驟。
- verification: 產出驗證結論、殘留風險、是否可交付。
`.trim();
    }

    _extractWorkerResponse(rawResponse) {
        let text = rawResponse;
        if (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)) {
            text = rawResponse.text || '';
        }

        const parsed = ResponseParser.parse(String(text || ''));
        const parsedReply = compactText(parsed.reply, '');
        const fallbackReply = stripProtocolNoise(String(text || ''));
        const reply = toPlainText(parsedReply || fallbackReply || '(no worker output)');

        return {
            reply: truncate(reply, this.maxWorkerOutputChars),
            actionCount: Array.isArray(parsed.actions) ? parsed.actions.length : 0,
            extractedFromReplyTag: Boolean(parsedReply),
            rawText: String(text || ''),
        };
    }

    async _runWorkerPrompt(prompt, attachment = null) {
        const response = await this.brain.sendMessage(prompt, false, { attachment });
        return this._extractWorkerResponse(response);
    }

    async _runPhases(session, payload = {}) {
        const actor = compactText(payload.actor, 'system');
        const source = compactText(payload.source, 'planning_auto');
        const userInput = compactText(payload.userInput, '');
        const attachment = payload.attachment || null;
        const routeDecision = (payload.routeDecision && typeof payload.routeDecision === 'object')
            ? payload.routeDecision
            : {};
        const phaseOutputs = {};
        const objective = compactText(session.objective, this._buildObjective(userInput));

        let latestSession = session;
        const startIndex = this._phaseStartIndex(session);

        for (let index = startIndex; index < PHASE_ORDER.length; index++) {
            const phase = PHASE_ORDER[index];
            const prompt = this._buildWorkerPrompt({
                phase,
                userInput,
                phaseOutputs,
                objective,
            });

            let worker = null;
            try {
                const spawnResult = this.controller.agentWorkerSpawn({
                    sessionId: latestSession.id,
                    role: phase,
                    prompt,
                    runInBackground: false,
                    metadata: {
                        executionMode: 'planning_auto',
                        phase,
                        routeDecision,
                    },
                }, {
                    actor,
                    source,
                });
                worker = spawnResult && spawnResult.worker ? spawnResult.worker : null;
                if (!worker || !worker.id) {
                    throw new Error(`worker spawn failed at phase=${phase}`);
                }

                this.controller.agentWorkerUpdate(worker.id, {
                    status: 'running',
                    progress: {
                        phase: `${phase}:running`,
                        percent: 10,
                    },
                    metadata: {
                        executionMode: 'planning_auto',
                        phase,
                    },
                    clearError: true,
                }, {
                    actor,
                    source,
                });

                const workerResult = await this._runWorkerPrompt(
                    prompt,
                    index === startIndex ? attachment : null
                );

                phaseOutputs[phase] = workerResult.reply;

                this.controller.agentWorkerUpdate(worker.id, {
                    status: 'completed',
                    output: workerResult.reply,
                    progress: {
                        phase: `${phase}:completed`,
                        percent: 100,
                    },
                    metadata: {
                        executionMode: 'planning_auto',
                        phase,
                        actionCount: workerResult.actionCount,
                        extractedFromReplyTag: workerResult.extractedFromReplyTag,
                    },
                    clearError: true,
                }, {
                    actor,
                    source,
                });

                this.controller.agentMessage({
                    sessionId: latestSession.id,
                    message: `[${phase}] ${truncate(workerResult.reply, 1200)}`,
                }, {
                    actor,
                    source,
                });

                const nextPhase = PHASE_ORDER[index + 1] || null;
                this.controller.agentSessionUpdate(latestSession.id, {
                    nextStep: nextPhase ? `prepare_${nextPhase}` : 'report_to_user',
                    metadata: {
                        ...(latestSession.metadata && typeof latestSession.metadata === 'object'
                            ? latestSession.metadata
                            : {}),
                        planningAuto: {
                            updatedAt: Date.now(),
                            lastPhase: phase,
                            routeDecision,
                        },
                    },
                }, {
                    actor,
                    source,
                });

                const refreshed = this.controller.agentGetSession(latestSession.id);
                if (refreshed && refreshed.session) {
                    latestSession = refreshed.session;
                }
            } catch (error) {
                const reason = compactText(error && error.message, `phase ${phase} failed`);
                if (worker && worker.id) {
                    try {
                        this.controller.agentWorkerUpdate(worker.id, {
                            status: 'failed',
                            lastError: reason,
                            progress: {
                                phase: `${phase}:failed`,
                                percent: 100,
                            },
                        }, {
                            actor,
                            source,
                        });
                    } catch {}
                }

                try {
                    this.controller.agentSessionUpdate(latestSession.id, {
                        status: 'failed',
                        lastError: reason,
                        nextStep: `recover_${phase}`,
                        metadata: {
                            ...(latestSession.metadata && typeof latestSession.metadata === 'object'
                                ? latestSession.metadata
                                : {}),
                            planningAuto: {
                                updatedAt: Date.now(),
                                failedPhase: phase,
                                routeDecision,
                            },
                        },
                    }, {
                        actor,
                        source,
                    });
                } catch {}

                return {
                    success: false,
                    failedPhase: phase,
                    error: reason,
                    phaseOutputs,
                };
            }
        }

        try {
            const snapshot = this.controller.agentGetSession(latestSession.id);
            const current = snapshot && snapshot.session ? snapshot.session : latestSession;
            if (current && current.status !== 'completed') {
                this.controller.agentSessionUpdate(current.id, {
                    status: 'completed',
                    clearError: true,
                    metadata: {
                        ...(current.metadata && typeof current.metadata === 'object' ? current.metadata : {}),
                        verification: {
                            status: 'verified',
                            note: 'Planning mode auto workflow completed',
                            updatedAt: Date.now(),
                        },
                    },
                }, {
                    actor,
                    source,
                });
            }
        } catch {}

        return {
            success: true,
            phaseOutputs,
        };
    }

    _buildSuccessReply({ resumed = false, phaseOutputs = {} } = {}) {
        const lines = [];
        lines.push(resumed
            ? '我已先接續你先前未完成的規劃任務，並完成這一輪多代理流程。'
            : '我已在 Planning Mode 自動啟動多代理流程，並完成這一輪處理。');

        if (phaseOutputs.research) {
            lines.push(`研究結論：${truncate(phaseOutputs.research, 220)}`);
        }
        if (phaseOutputs.synthesis) {
            lines.push(`執行計畫：${truncate(phaseOutputs.synthesis, 220)}`);
        }
        if (phaseOutputs.implementation) {
            lines.push(`實作重點：${truncate(phaseOutputs.implementation, 220)}`);
        }
        if (phaseOutputs.verification) {
            lines.push(`驗證結果：${truncate(phaseOutputs.verification, 260)}`);
        }

        if (lines.length === 1) {
            lines.push('多代理流程已完成，我可以直接進入下一輪細化與落地。');
        }

        return lines.join('\n\n');
    }

    _buildFailureReply({ phase = 'research', error = '' } = {}) {
        const phaseLabel = PHASE_LABELS[phase] || phase;
        const reason = truncate(compactText(error, 'unknown failure'), 260);
        return [
            `我已啟動 Planning Mode 多代理流程，但在「${phaseLabel}」階段遇到阻塞：${reason}。`,
            '進度已保留，後續可以直接從目前階段續跑，不會遺失任務上下文。',
            '建議下一步：確認限制條件或補充需求細節後，我就能立即繼續。',
        ].join('\n\n');
    }

    async execute(payload = {}) {
        this._ensureDependencies();

        const ctx = payload.ctx || null;
        const actor = compactText(payload.actor || (ctx && ctx.senderName), 'user');
        const source = compactText(payload.source, 'planning_auto');
        const userInput = compactText(payload.userInput || payload.finalInput, '');
        const attachment = payload.attachment || null;
        const routeDecision = (payload.routeDecision && typeof payload.routeDecision === 'object')
            ? payload.routeDecision
            : {};
        const suppressFinalReply = payload.suppressFinalReply === true;

        let resumed = false;
        let session = null;

        try {
            const resumeResult = this.controller.agentResume({
                actor,
                source,
                limit: 20,
            });
            if (resumeResult && resumeResult.session && resumeResult.session.id) {
                session = resumeResult.session;
                resumed = true;
            }
        } catch {}

        if (!session) {
            const createResult = this.controller.agentSessionCreate({
                objective: this._buildObjective(userInput),
                strategy: 'planning_mode_auto',
                metadata: {
                    workflow: {
                        phase: 'research',
                        order: PHASE_ORDER.slice(),
                        managedByCoordinator: true,
                    },
                    planningAuto: {
                        createdAt: Date.now(),
                        routeDecision,
                    },
                },
            }, {
                actor,
                source,
            });
            session = createResult && createResult.session ? createResult.session : null;
        } else {
            try {
                this.controller.agentMessage({
                    sessionId: session.id,
                    message: `[planning_auto] ${truncate(userInput, 1200)}`,
                }, {
                    actor,
                    source,
                });
            } catch {}
        }

        if (!session || !session.id) {
            throw new Error('Failed to initialize planning session');
        }

        const runPhases = async () => this._runPhases(session, {
            actor,
            source,
            userInput,
            attachment,
            routeDecision,
        });

        const phaseResult = (this.brain && typeof this.brain.runInIsolatedTab === 'function')
            ? await this.brain.runInIsolatedTab(() => runPhases(), {
                reason: 'planning_auto',
                sessionId: session.id,
            })
            : await runPhases();

        const finalReply = phaseResult && phaseResult.success
            ? this._buildSuccessReply({
                resumed,
                phaseOutputs: phaseResult.phaseOutputs || {},
            })
            : this._buildFailureReply({
                phase: phaseResult && phaseResult.failedPhase ? phaseResult.failedPhase : 'research',
                error: phaseResult && phaseResult.error ? phaseResult.error : 'unknown failure',
            });

        if (!suppressFinalReply && ctx && typeof ctx.reply === 'function') {
            await ctx.reply(finalReply);
        }

        return {
            executionMode: 'planning_auto',
            resumed,
            sessionId: session.id,
            success: Boolean(phaseResult && phaseResult.success),
            failedPhase: phaseResult && phaseResult.failedPhase ? phaseResult.failedPhase : null,
            phaseOutputs: (phaseResult && phaseResult.phaseOutputs) || {},
            finalReply,
        };
    }
}

module.exports = PlanningModeExecutor;
