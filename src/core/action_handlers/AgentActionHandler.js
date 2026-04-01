const AGENT_ACTIONS = new Set([
    'agent_session_create',
    'agent_worker_spawn',
    'agent_message',
    'agent_wait',
    'agent_stop',
    'agent_list',
    'agent_get',
    'agent_resume',
    'agent_focus',
]);

function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function truncate(value, max = 88) {
    const text = String(value || '');
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
}

function phaseOf(session) {
    if (!session || !session.metadata || !session.metadata.workflow) return 'research';
    return compactText(session.metadata.workflow.phase, 'research');
}

function renderSessionLine(session) {
    if (!session) return '- [session missing]';
    return `- [${session.id}] (${session.status}/${phaseOf(session)}) ${truncate(session.objective, 120)}`;
}

function renderWorkerLine(worker) {
    if (!worker) return '- [worker missing]';
    return `- [${worker.id}] (${worker.status}/${worker.role}) session=${worker.sessionId}`;
}

class AgentActionHandler {
    static isAgentAction(actionName) {
        return AGENT_ACTIONS.has(compactText(actionName, '').toLowerCase());
    }

    static async execute(ctx, act, controller) {
        const action = compactText(act && act.action, '').toLowerCase();
        if (!AgentActionHandler.isAgentAction(action)) return false;
        if (!controller) {
            await ctx.reply('⚠️ Agent controller is unavailable.');
            return true;
        }

        const actor = compactText((ctx && ctx.senderName) || 'system', 'system');
        const source = 'agent_action';

        try {
            if (action === 'agent_session_create') {
                const input = (act.input && typeof act.input === 'object')
                    ? act.input
                    : act;
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.agentSessionCreate(input, { actor, source, ...options });
                await ctx.reply(`🧭 Agent session created\n${renderSessionLine(result.session)}`);
                return true;
            }

            if (action === 'agent_worker_spawn') {
                const input = (act.input && typeof act.input === 'object') ? act.input : act;
                const sessionId = compactText(input.sessionId, '');
                if (!sessionId) {
                    await ctx.reply('⚠️ agent_worker_spawn requires sessionId.');
                    return true;
                }
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.agentWorkerSpawn(input, { actor, source, ...options });
                await ctx.reply([
                    '👷 Agent worker spawned',
                    renderSessionLine(result.session),
                    renderWorkerLine(result.worker),
                ].join('\n'));
                return true;
            }

            if (action === 'agent_message') {
                const input = (act.input && typeof act.input === 'object')
                    ? act.input
                    : {
                        sessionId: act.sessionId,
                        workerId: act.workerId,
                        message: act.message || act.text,
                    };
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.agentMessage(input, { actor, source, ...options });
                await ctx.reply([
                    '💬 Agent message queued',
                    result && result.session ? renderSessionLine(result.session) : '- [session missing]',
                    result && result.worker ? renderWorkerLine(result.worker) : '- [worker: session queue]',
                ].join('\n'));
                return true;
            }

            if (action === 'agent_wait') {
                const sessionId = compactText(act.sessionId || (act.input && act.input.sessionId), '');
                if (!sessionId) {
                    await ctx.reply('⚠️ agent_wait requires sessionId.');
                    return true;
                }
                const timeoutMs = Number(act.timeoutMs || (act.input && act.input.timeoutMs) || 0);
                const snapshot = await controller.agentWait(sessionId, {
                    timeoutMs,
                    actor,
                    source,
                });
                const workers = Array.isArray(snapshot && snapshot.workers) ? snapshot.workers : [];
                await ctx.reply([
                    `⏳ agent_wait done=${snapshot && snapshot.done ? 'yes' : 'no'} waited=${snapshot && snapshot.waitedMs ? snapshot.waitedMs : 0}ms`,
                    snapshot && snapshot.session ? renderSessionLine(snapshot.session) : '- [session missing]',
                    `workers=${workers.length}`,
                ].join('\n'));
                return true;
            }

            if (action === 'agent_stop') {
                const input = (act.input && typeof act.input === 'object')
                    ? act.input
                    : {
                        sessionId: act.sessionId,
                        workerId: act.workerId,
                        reason: act.reason,
                    };
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.agentStop(input, {
                    actor,
                    source,
                    ...options,
                });
                const sessionLine = result && result.session ? renderSessionLine(result.session) : '- [session n/a]';
                const workerLine = result && result.worker ? renderWorkerLine(result.worker) : '';
                await ctx.reply(`🛑 Agent stop applied\n${sessionLine}${workerLine ? `\n${workerLine}` : ''}`);
                return true;
            }

            if (action === 'agent_list') {
                const filters = (act.filters && typeof act.filters === 'object')
                    ? act.filters
                    : act;
                const result = controller.agentList(filters || {});
                const sessions = Array.isArray(result && result.sessions) ? result.sessions : [];
                const workers = Array.isArray(result && result.workers) ? result.workers : [];
                const sessionLines = sessions.slice(0, 10).map(renderSessionLine);
                const workerLines = workers.slice(0, 10).map(renderWorkerLine);
                await ctx.reply([
                    `📋 Agent list sessions=${sessions.length} workers=${workers.length}`,
                    sessionLines.length > 0 ? sessionLines.join('\n') : '- [no sessions]',
                    workerLines.length > 0 ? workerLines.join('\n') : '- [no workers]',
                ].join('\n'));
                return true;
            }

            if (action === 'agent_get') {
                const sessionId = compactText(act.sessionId || (act.input && act.input.sessionId), '');
                const workerId = compactText(act.workerId || (act.input && act.input.workerId), '');
                if (!sessionId && !workerId) {
                    await ctx.reply('⚠️ agent_get requires sessionId or workerId.');
                    return true;
                }

                if (workerId) {
                    const result = controller.agentGetWorker(workerId);
                    if (!result || !result.worker) {
                        await ctx.reply(`⚠️ Worker not found: ${workerId}`);
                        return true;
                    }
                    await ctx.reply([
                        '📍 Agent worker detail',
                        renderWorkerLine(result.worker),
                        result.session ? renderSessionLine(result.session) : '- [session missing]',
                    ].join('\n'));
                    return true;
                }

                const result = controller.agentGetSession(sessionId);
                if (!result || !result.session) {
                    await ctx.reply(`⚠️ Session not found: ${sessionId}`);
                    return true;
                }
                const workers = Array.isArray(result.workers) ? result.workers : [];
                await ctx.reply([
                    '📍 Agent session detail',
                    renderSessionLine(result.session),
                    `workers=${workers.length}`,
                    ...workers.slice(0, 8).map(renderWorkerLine),
                ].join('\n'));
                return true;
            }

            if (action === 'agent_focus') {
                const input = (act.input && typeof act.input === 'object') ? act.input : act;
                const sessionId = compactText(input.sessionId, '');
                if (!sessionId) {
                    await ctx.reply('⚠️ agent_focus requires sessionId.');
                    return true;
                }
                const result = controller.agentGetSession(sessionId);
                if (!result || !result.session) {
                    await ctx.reply(`⚠️ Session not found: ${sessionId}`);
                    return true;
                }
                const orchestration = result.orchestration || null;
                const nextAction = orchestration && orchestration.nextAction ? orchestration.nextAction : null;
                await ctx.reply([
                    '🎯 Agent focus',
                    renderSessionLine(result.session),
                    `workers=${Array.isArray(result.workers) ? result.workers.length : 0}`,
                    nextAction
                        ? `next=${nextAction.action} (${nextAction.reason || 'n/a'})`
                        : 'next=none',
                ].join('\n'));
                return true;
            }

            if (action === 'agent_resume') {
                const input = (act.input && typeof act.input === 'object') ? act.input : act;
                const options = (act.options && typeof act.options === 'object') ? act.options : {};
                const result = controller.agentResume({
                    sessionId: compactText(input.sessionId, ''),
                    actor,
                    source,
                    ...options,
                });
                const brief = result && result.brief ? result.brief : {};
                const next = brief && brief.nextSession ? brief.nextSession.id : 'none';
                await ctx.reply([
                    `🔄 Agent resume resumed=${result && result.resumed ? 'yes' : 'no'} count=${result && result.resumedCount ? result.resumedCount : 0}`,
                    `runningWorkers=${brief && brief.runningWorkers ? brief.runningWorkers : 0} next=${next}`,
                ].join('\n'));
                return true;
            }
        } catch (error) {
            const code = compactText(error && error.code, '');
            const statusCode = Number(error && (error.statusCode || error.status));
            const statusInfo = Number.isFinite(statusCode) && statusCode > 0 ? ` status=${statusCode}` : '';
            await ctx.reply(`❌ Agent action failed${code ? ` [${code}]` : ''}${statusInfo}: ${error.message}`);
            return true;
        }

        return false;
    }
}

module.exports = AgentActionHandler;
