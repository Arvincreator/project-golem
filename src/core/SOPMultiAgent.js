// ============================================================
// SOPMultiAgent — MetaGPT SOP-Encoded Multi-Agent Collaboration
// Structured handoffs with role-specific artifacts
// ============================================================

const SOP_PRESETS = {
    DEV_TEAM: {
        name: 'Development Team',
        roles: [
            { name: 'PM', role: 'Product Manager', personality: '用戶導向、需求分析', expertise: ['需求分析', '產品規劃', '使用者故事'], outputKey: 'requirements' },
            { name: 'Architect', role: 'System Architect', personality: '全局視野、技術選型', expertise: ['系統設計', '架構評估', 'API設計'], outputKey: 'design' },
            { name: 'Engineer', role: 'Software Engineer', personality: '嚴謹務實、程式碼品質', expertise: ['實作', '程式開發', '最佳實踐'], outputKey: 'code' },
            { name: 'QA', role: 'Quality Assurance', personality: '細節導向、品質把關', expertise: ['測試設計', '邊界條件', '回歸測試'], outputKey: 'tests' },
        ],
        handoffs: [
            { from: 'PM', to: 'Architect', artifact: 'requirements' },
            { from: 'Architect', to: 'Engineer', artifact: 'design' },
            { from: 'Engineer', to: 'QA', artifact: 'code' },
            { from: 'QA', to: 'Engineer', condition: 'bugs_found', artifact: 'tests' },
        ],
        maxCycles: 2,
    },
    RESEARCH: {
        name: 'Research Team',
        roles: [
            { name: 'Analyst', role: 'Research Analyst', personality: '深入挖掘、數據驅動', expertise: ['資料收集', '趨勢分析', '文獻回顧'], outputKey: 'analysis' },
            { name: 'Critic', role: 'Critical Reviewer', personality: '懷疑精神、邏輯嚴謹', expertise: ['漏洞分析', '反例構建', '方法論批判'], outputKey: 'critique' },
            { name: 'Synthesizer', role: 'Knowledge Synthesizer', personality: '整合能力、洞察力', expertise: ['知識整合', '模式識別', '結論提煉'], outputKey: 'synthesis' },
        ],
        handoffs: [
            { from: 'Analyst', to: 'Critic', artifact: 'analysis' },
            { from: 'Critic', to: 'Synthesizer', artifact: 'critique' },
            { from: 'Synthesizer', to: 'Analyst', condition: 'gaps_found', artifact: 'synthesis' },
        ],
        maxCycles: 2,
    },
    STRATEGY: {
        name: 'Strategy Team',
        roles: [
            { name: 'Strategist', role: 'Chief Strategist', personality: '遠見卓識、系統思維', expertise: ['策略規劃', '競爭分析', '市場洞察'], outputKey: 'strategy' },
            { name: 'RiskAnalyst', role: 'Risk Analyst', personality: '謹慎周密、風險意識', expertise: ['風險評估', '情境分析', '應急計畫'], outputKey: 'risks' },
            { name: 'DecisionMaker', role: 'Decision Maker', personality: '果斷、平衡', expertise: ['決策分析', '優先排序', '資源分配'], outputKey: 'decision' },
        ],
        handoffs: [
            { from: 'Strategist', to: 'RiskAnalyst', artifact: 'strategy' },
            { from: 'RiskAnalyst', to: 'DecisionMaker', artifact: 'risks' },
        ],
        maxCycles: 1,
    },
};

class SOPMultiAgent {
    constructor(brain, options = {}) {
        this.brain = brain;
        this.golemId = options.golemId || 'default';
    }

    /**
     * Run a SOP workflow
     * @param {Object} ctx - Platform context
     * @param {string} task - Task description
     * @param {string} presetName - SOP preset key
     * @returns {{ artifacts, messages, summary }}
     */
    async run(ctx, task, presetName = 'DEV_TEAM') {
        const preset = SOP_PRESETS[presetName];
        if (!preset) {
            throw new Error(`Unknown SOP preset: ${presetName}. Available: ${Object.keys(SOP_PRESETS).join(', ')}`);
        }

        console.log(`[SOPMultiAgent] Starting ${preset.name} workflow for: ${task.substring(0, 80)}`);

        const artifacts = {};
        const messages = [];
        let cycle = 0;

        // Initial introduction
        if (ctx && ctx.reply) {
            const roleIntro = preset.roles.map((r, i) => `${i + 1}. **${r.name}** — ${r.role}`).join('\n');
            await ctx.reply(
                `🏭 **SOP 工作流啟動: ${preset.name}**\n\n` +
                `📋 任務: ${task}\n\n` +
                `👥 角色:\n${roleIntro}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
            );
        }

        while (cycle < preset.maxCycles) {
            cycle++;
            let needsAnotherCycle = false;

            for (const handoff of preset.handoffs) {
                const fromRole = preset.roles.find(r => r.name === handoff.from);
                const toRole = preset.roles.find(r => r.name === handoff.to);
                if (!fromRole) continue;

                // Check conditional handoffs
                if (handoff.condition && cycle > 1) {
                    const conditionMet = this._checkCondition(handoff.condition, artifacts, messages);
                    if (!conditionMet) continue;
                    needsAnotherCycle = true;
                }

                // Execute from-role if artifact not yet produced this cycle
                if (!artifacts[fromRole.outputKey] || cycle > 1) {
                    const result = await this._executeRole(fromRole, task, artifacts, messages, cycle);
                    artifacts[fromRole.outputKey] = result.output;
                    messages.push(result.message);

                    if (ctx && ctx.reply) {
                        await ctx.reply(`🤖 **${fromRole.name}** _(${fromRole.role})_\n${result.output.substring(0, 300)}`);
                    }
                }

                // Handoff notification
                if (toRole) {
                    console.log(`[SOPMultiAgent] Handoff: ${fromRole.name} → ${toRole.name} (artifact: ${handoff.artifact})`);
                }
            }

            // Execute the final role in the chain if not yet done
            const lastHandoff = preset.handoffs[preset.handoffs.length - 1];
            const lastToRole = preset.roles.find(r => r.name === lastHandoff?.to);
            if (lastToRole && !lastToRole.outputKey.startsWith(lastHandoff?.from) && !artifacts[lastToRole.outputKey]) {
                const result = await this._executeRole(lastToRole, task, artifacts, messages, cycle);
                artifacts[lastToRole.outputKey] = result.output;
                messages.push(result.message);

                if (ctx && ctx.reply) {
                    await ctx.reply(`🤖 **${lastToRole.name}** _(${lastToRole.role})_\n${result.output.substring(0, 300)}`);
                }
            }

            if (!needsAnotherCycle) break;
        }

        // Generate summary
        const summary = await this._generateSummary(task, artifacts, messages);

        if (ctx && ctx.reply) {
            await ctx.reply(
                `🎯 **SOP 工作流完成**\n\n${summary}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 角色: ${preset.roles.length} | 產出: ${Object.keys(artifacts).length} | 輪次: ${cycle}`
            );
        }

        return { artifacts, messages, summary, cycles: cycle };
    }

    /**
     * Execute a role's task
     */
    async _executeRole(role, task, artifacts, messages, cycle) {
        const artifactContext = Object.entries(artifacts)
            .map(([key, val]) => `【${key}】\n${String(val).substring(0, 500)}`)
            .join('\n\n');

        const recentMessages = messages.slice(-3)
            .map(m => `[${m.speaker}]: ${m.content.substring(0, 200)}`)
            .join('\n');

        const prompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【SOP 工作流 — ${role.name}】
你是 ${role.name} (${role.role})
性格: ${role.personality}
專長: ${role.expertise.join('、')}

【任務】${task}

${artifactContext ? `【已有產出】\n${artifactContext}\n` : ''}
${recentMessages ? `【近期討論】\n${recentMessages}\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
請以 ${role.name} 的專業角度${cycle > 1 ? '（根據前一輪的回饋）' : ''}提供你的產出。
回覆格式:
[GOLEM_REPLY]
（你的專業產出，2-5 段落）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const replyMatch = raw.match(/\[GOLEM_REPLY\]([\s\S]*?)(?=\[GOLEM_|$)/i);
            const output = replyMatch ? replyMatch[1].trim() : raw.trim();

            return {
                output: output.substring(0, 2000),
                message: {
                    speaker: role.name,
                    role: role.role,
                    content: output.substring(0, 2000),
                    cycle,
                    outputKey: role.outputKey,
                    timestamp: Date.now(),
                },
            };
        } catch (e) {
            console.error(`[SOPMultiAgent] ${role.name} execution failed:`, e.message);
            return {
                output: `(${role.name} 暫時無法產出)`,
                message: {
                    speaker: role.name,
                    role: role.role,
                    content: `Error: ${e.message}`,
                    cycle,
                    outputKey: role.outputKey,
                    timestamp: Date.now(),
                },
            };
        }
    }

    /**
     * Check if a conditional handoff should proceed
     */
    _checkCondition(condition, artifacts, messages) {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) return false;

        switch (condition) {
            case 'bugs_found':
                return /bug|issue|fail|error|問題|缺陷/i.test(lastMessage.content);
            case 'gaps_found':
                return /gap|missing|incomplete|不足|缺少|需要補充/i.test(lastMessage.content);
            default:
                return false;
        }
    }

    /**
     * Generate final summary
     */
    async _generateSummary(task, artifacts, messages) {
        const artifactSummary = Object.entries(artifacts)
            .map(([key, val]) => `**${key}**: ${String(val).substring(0, 200)}`)
            .join('\n');

        try {
            const prompt = `整合以下 SOP 工作流產出為簡短總結 (3-5 句):

任務: ${task}

產出:
${artifactSummary}

回覆純文字總結:`;

            const raw = await this.brain.sendMessage(prompt, true);
            return typeof raw === 'string' ? raw.substring(0, 500) : artifactSummary;
        } catch (e) {
            return artifactSummary;
        }
    }

    /**
     * List available presets
     */
    static getPresets() {
        return Object.entries(SOP_PRESETS).map(([key, preset]) => ({
            key,
            name: preset.name,
            roles: preset.roles.map(r => r.name),
        }));
    }
}

SOPMultiAgent.PRESETS = SOP_PRESETS;
module.exports = SOPMultiAgent;
