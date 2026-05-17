const ResponseParser = require('../../src/utils/ResponseParser');
const MultiAgentHandler = require('../../src/core/action_handlers/MultiAgentHandler');
const SkillHandler = require('../../src/core/action_handlers/SkillHandler');
const CommandHandler = require('../../src/core/action_handlers/CommandHandler');
const ActionExecutionGate = require('../../src/managers/ActionExecutionGate');
const { CONFIG } = require('../../src/config');
const skillManager = require('../../src/managers/SkillManager');
const COMMAND_DEFS = require('../../src/config/commands');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const MCP_CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');

function normalizeToken(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function loadEnabledMcpTools() {
    try {
        if (!fs.existsSync(MCP_CONFIG_PATH)) return [];
        const parsed = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
        const servers = Array.isArray(parsed) ? parsed.filter((item) => item && item.enabled !== false) : [];
        const output = [];
        for (const server of servers) {
            for (const tool of (server.cachedTools || [])) {
                if (!tool || !tool.name) continue;
                output.push({
                    server: String(server.name || '').trim(),
                    name: String(tool.name || '').trim(),
                    description: String(tool.description || '').trim()
                });
            }
        }
        return output.filter((item) => item.server && item.name);
    } catch (_) {
        return [];
    }
}

function loadSlashCommandAliases() {
    const aliases = new Set();
    for (const item of (Array.isArray(COMMAND_DEFS) ? COMMAND_DEFS : [])) {
        const cmd = String(item && item.command ? item.command : '').trim();
        if (!cmd.startsWith('/')) continue;
        const noSlash = cmd.slice(1).trim();
        if (!noSlash) continue;
        aliases.add(normalizeToken(noSlash));
    }
    return aliases;
}

const SLASH_COMMAND_ALIASES = loadSlashCommandAliases();

function sanitizeReply(text) {
    if (!text) return "";
    if (typeof ResponseParser.sanitizeProtocolTags === 'function' && !ResponseParser.sanitizeProtocolTags._isMockFunction) {
        return ResponseParser.sanitizeProtocolTags(text);
    }
    return String(text)
        .replace(/\[{1,2}\s*(?:BEGIN|END)\s*:[^\]\n\r]+?\]{1,2}/gi, '')
        .replace(/\[\s*(?:BEGIN|END)\s*:[^\]\n\r]+?\]\]/gi, '')
        .replace(/\[\[?\s*(?:BEGIN|END)\s*:[^\]\n\r]+?\]?\]?/gi, '')
        .replace(/\[\/?GOLEM_(?:MEMORY|ACTION|REPLY)\]/gi, '')
        .trim();
}

function hasMarkdownHttpLink(text) {
    return /\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/.test(String(text || ''));
}

function buildReplyOptions(ctx, finalReply, extra = {}) {
    const options = { ...extra };
    if (ctx.platform === 'telegram' && hasMarkdownHttpLink(finalReply)) {
        options._telegramHtmlLinks = true;
    }
    return options;
}

// ============================================================
// 🧬 NeuroShunter (神經分流中樞 - 核心路由器)
// ============================================================
class NeuroShunter {
    static _normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s._/-]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static _score(query, candidate) {
        const q = this._normalize(query);
        const c = this._normalize(candidate);
        if (!q || !c) return 0;

        let score = 0;
        if (c.includes(q)) score += 8;
        const tokens = q.split(' ').filter((token) => token.length >= 2);
        for (const token of tokens) {
            if (c.includes(token)) score += token.length >= 4 ? 3 : 2;
        }
        return score;
    }

    static _isCommandLikeAction(act) {
        if (!act || typeof act !== 'object') return false;
        if (act.action === 'command') return true;
        return Boolean(
            act.cmd ||
            act.parameter ||
            act.command ||
            (act.parameters && typeof act.parameters === 'object' && act.parameters.command)
        );
    }

    static _tryRecoverSlashAction(act) {
        if (!act || typeof act !== 'object') return null;
        const actionName = String(act.action || '').trim();
        if (!actionName) return null;
        if (['command', 'mcp_call', 'multi_agent'].includes(actionName)) return null;

        const normalized = normalizeToken(actionName.replace(/^\//, ''));
        if (!SLASH_COMMAND_ALIASES.has(normalized)) return null;

        const tail =
            typeof act.parameter === 'string' ? act.parameter.trim() :
                (typeof act.parameters === 'string' ? act.parameters.trim() : '');
        const slashCommand = `/${normalized.replace(/-/g, '_')}${tail ? ` ${tail}` : ''}`;
        return {
            action: {
                action: 'command',
                parameter: slashCommand
            },
            note: `🧭 [Routing] 偵測到 action **${actionName}** 是斜線指令，已改寫為 shell lane：\`${slashCommand}\``
        };
    }

    static _tryRecoverAsMcpCall(act) {
        if (!act || typeof act !== 'object') return null;
        const actionName = String(act.action || '').trim();
        if (!actionName) return null;
        if (['command', 'mcp_call', 'multi_agent'].includes(actionName)) return null;

        const tools = loadEnabledMcpTools();
        const normalizedAction = normalizeToken(actionName);
        const exactMatches = tools.filter((item) => normalizeToken(item.name) === normalizedAction);
        if (exactMatches.length === 0) return null;
        if (exactMatches.length > 1) {
            const choices = exactMatches
                .slice(0, 4)
                .map((item) => `\`${item.server}/${item.name}\``)
                .join(', ');
            return {
                ambiguous: true,
                note: `⚠️ [Routing] action **${actionName}** 對應多個 MCP 工具，請指定 server：${choices}`
            };
        }

        const matched = exactMatches[0];
        const parameters = act.parameters && typeof act.parameters === 'object'
            ? act.parameters
            : (act.args && typeof act.args === 'object' ? act.args : {});

        return {
            action: {
                action: 'mcp_call',
                server: matched.server,
                tool: matched.name,
                parameters,
            },
            note: `🧭 [Routing] 偵測到 action **${actionName}** 為 MCP 工具名稱，已改寫為 **mcp_call ${matched.server}/${matched.name}**`
        };
    }

    static _buildUnknownActionMessage(actionName) {
        const skills = (() => {
            try {
                return skillManager.listSkills();
            } catch (_) {
                return [];
            }
        })();
        const mcpTools = loadEnabledMcpTools();

        const skillHints = (Array.isArray(skills) ? skills : [])
            .map((skill) => ({
                name: String(skill && skill.name ? skill.name : '').trim(),
                score: this._score(actionName, `${skill && skill.name ? skill.name : ''} ${skill && skill.description ? skill.description : ''}`),
            }))
            .filter((item) => item.name && item.score > 0)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, 3)
            .map((item) => `\`${item.name}\``);

        const mcpHints = mcpTools
            .map((tool) => ({
                id: `${tool.server}/${tool.name}`,
                score: this._score(actionName, `${tool.server} ${tool.name} ${tool.description}`),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
            .slice(0, 3)
            .map((item) => `\`${item.id}\``);

        return `❌ 無法識別 action **${actionName}**。\n建議改用以下之一：\n- command: \`{"action":"command","parameter":"<native command>"}\`\n- skill action: ${skillHints.join(', ') || '（無）'}\n- mcp_call: ${mcpHints.join(', ') || '（無）'}`;
    }

    static async dispatch(ctx, rawResponse, brain, controller, options = {}) {
        let textToParse = rawResponse;
        let attachments = options.attachments || [];

        // 📥 [v9.1.10] 支援結構化回應物件 { text, attachments }
        if (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)) {
            textToParse = rawResponse.text || "";
            attachments = [...attachments, ...(rawResponse.attachments || [])];
        }

        const parsed = ResponseParser.parse(textToParse);
        let shouldSuppressReply = options.suppressReply === true;
        const isSystemFeedback = options.isSystemFeedback === true;
        const allowActions = options.allowActions === true;
        const actionDepth = Number(options.actionDepth || 0);
        const maxActionDepth = Math.max(1, Number(options.maxActionDepth || CONFIG.MAX_AUTO_TURNS || 5));

        // 🎯 [v9.1.13] 靜默模式自癒：如果沒有後續動作 (Action)，代表任務結束，強制解除靜默以顯示最終回覆
        if (shouldSuppressReply && parsed.actions.length === 0) {
            console.log(`📢 [NeuroShunter] 偵測到任務結束或無後續動作，自動解除靜默模式。`);
            shouldSuppressReply = false;
        }

        // 核心：偵測 [INTERVENE] 標籤以實現觀察者模式自主介入
        if (textToParse.includes('[INTERVENE]')) {
            console.log(`🚀 [NeuroShunter] 偵測到 AI 自主介入請求 [INTERVENE]！`);
            shouldSuppressReply = false;
        }

        if (parsed.reply && parsed.reply.includes('[INTERVENE]')) {
            parsed.reply = parsed.reply.replace(/\[INTERVENE\]/g, '').trim();
        }
        if (parsed.reply) {
            parsed.reply = sanitizeReply(parsed.reply);
        }

        // 1. 處理長期記憶寫入
        if (parsed.memory) {
            console.log(`[GOLEM_MEMORY]\n${parsed.memory}`);
            await brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
        }

        // 1. 處理直接回覆 (讓 AI 的解說文字在行動之前出現)
        if (parsed.reply && !shouldSuppressReply) {
            let finalReply = parsed.reply;
            if (ctx.platform === 'telegram' && ctx.shouldMentionSender) {
                finalReply = `${ctx.senderMention} ${parsed.reply}`;
            }
            console.log(`[TERMINAL] 🤖 [Golem] 說: ${finalReply}${attachments.length > 0 ? ' 📎 含有附件' : ''}`);

            // ✨ [Log] 記錄 AI 回應
            if (brain && typeof brain._appendChatLog === 'function') {
                brain._appendChatLog({
                    sender: 'Golem',
                    content: finalReply,
                    type: 'ai',
                    role: 'Assistant',
                    isSystem: false,
                    attachments: attachments
                });
            }

            // 附件處理：若無附件則維持單參數呼叫，相容既有上下文與測試
            if (attachments.length > 0) {
                await ctx.reply(finalReply, buildReplyOptions(ctx, finalReply, { attachments: attachments }));
            } else {
                const replyOptions = buildReplyOptions(ctx, finalReply);
                if (Object.keys(replyOptions).length > 0) {
                    await ctx.reply(finalReply, replyOptions);
                } else {
                    await ctx.reply(finalReply);
                }
            }
        } else if (parsed.reply && shouldSuppressReply) {
            console.log(`🤫 [NeuroShunter] 檢測到靜默模式，已攔截回覆內容。`);
        }

        const blockedObservationActions = isSystemFeedback
            && parsed.actions.length > 0
            && (!allowActions || actionDepth >= maxActionDepth);

        if (blockedObservationActions) {
            console.warn(
                `[NeuroShunter] System Observation 產生 ${parsed.actions.length} 個 action，已阻擋。` +
                ` allowActions=${allowActions}, depth=${actionDepth}/${maxActionDepth}`
            );

            if (!shouldSuppressReply) {
                const retryAttempt = Number(options.observationRetryAttempt || 0);
                const compactActions = JSON.stringify(parsed.actions, null, 2);
                // 第一次錯誤：不需要使用者批准，先要求 Golem 依範例重寫並自動再執行一次
                if (retryAttempt < 1 && controller && controller.convoManager) {
                    const rewritePrompt = `[System Observation]\n` +
                        `你上一輪輸出的 [GOLEM_ACTION] 無法執行，請先重寫成正確格式後再執行一次。\n\n` +
                        `[PREVIOUS_INVALID_ACTIONS]\n` +
                        `${compactActions}\n\n` +
                        `修正規則：\n` +
                        `- 只輸出一個最小必要 action。\n` +
                        `- 若是行事曆，請用：{"action":"collab-calendar","args":{"action":"add","title":"...","start":"...","end":"..."}}\n` +
                        `- mcp_call 必須包含 server + tool + parameters。\n` +
                        `- command 必須放在 parameter 欄位。\n`;
                    await ctx.reply(
                        `⚠️ 系統偵測到指令格式錯誤，已先要求 Golem 依範例重寫並自動再試一次。`
                    );
                    await controller.convoManager.enqueue(ctx, rewritePrompt, {
                        isPriority: true,
                        bypassDebounce: true,
                        isSystemFeedback: true,
                        allowActions: true,
                        actionDepth: Number(actionDepth || 0) + 1,
                        maxActionDepth: Number(maxActionDepth || CONFIG.MAX_AUTO_TURNS || 5),
                        observationRetryAttempt: retryAttempt + 1,
                    });
                } else if (controller && controller.pendingTasks) {
                    // 第二次仍錯：才出現通訊端批准按鈕
                    const approvalId = uuidv4();
                    controller.pendingTasks.set(approvalId, {
                        type: 'OBSERVATION_ACTION_APPROVAL',
                        ctx,
                        timestamp: Date.now(),
                        proposedActions: parsed.actions,
                        actionDepth: Number(actionDepth || 0),
                        maxActionDepth: Number(maxActionDepth || CONFIG.MAX_AUTO_TURNS || 5),
                    });
                    await ctx.reply(
                        `⚠️ 指令重寫後仍然失敗，系統已暫停自動再執行。\n\n` +
                        `以下是被擋下的候選 action：\n` +
                        `\`\`\`json\n${compactActions.slice(0, 3500)}\n\`\`\`\n` +
                        `是否要要求 Golem 依範例重寫後再執行？`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ 要求 Golem 重寫再執行', callback_data: `RETRYOBS_${approvalId}` },
                                    { text: '🛑 停止本輪 action', callback_data: `STOPOBS_${approvalId}` }
                                ]]
                            }
                        }
                    );
                } else {
                    await ctx.reply(
                        `⚠️ 指令重寫後仍失敗，系統已阻擋自動再執行。\n` +
                        `請在通訊端明確批准下一步（例如回覆「再來一次」或按審批按鈕）後才會繼續。`
                    );
                }
            }
            parsed.actions = [];
        }

        // 2. 處理結構化 Action 分配 (讓批准視窗在回覆之後彈出)
        if (parsed.actions.length > 0) {
            console.log(`[GOLEM_ACTION] (${shouldSuppressReply ? 'Silent' : 'Normal'})\n${JSON.stringify(parsed.actions, null, 2)}`);
            const normalActions = [];
            const rejectedActions = [];

            for (const originalAct of parsed.actions) {
                let act = originalAct;

                if (!ActionExecutionGate.validate(act).ok) {
                    const slashRecovery = this._tryRecoverSlashAction(act);
                    if (slashRecovery && slashRecovery.action) {
                        console.log(slashRecovery.note);
                        act = slashRecovery.action;
                    }
                }

                const gate = ActionExecutionGate.validate(act);
                if (!gate.ok) {
                    rejectedActions.push({ action: act, error: gate.error, code: gate.code });
                    continue;
                }
                if (gate.normalizedAction && gate.normalizedAction !== act.action) {
                    act.action = gate.normalizedAction;
                }
                switch (act.action) {
                    case 'multi_agent':
                        await MultiAgentHandler.execute(ctx, act, controller, brain);
                        break;
                    case 'command':
                        normalActions.push(act);
                        break;
                    default:
                        // 檢查是否為動態擴充技能
                        const isSkillHandled = await SkillHandler.execute(ctx, act, brain, controller, {
                            actionDepth,
                            maxActionDepth,
                            allowActions
                        });
                        if (!isSkillHandled) {
                            // 若不是已知框架 Action 和非動態技能，則視為底層 Shell 指令
                            normalActions.push(act);
                        }
                        break;
                }
            }

            if (rejectedActions.length > 0) {
                const reasonText = rejectedActions
                    .map((item, idx) => {
                        const compactAction = JSON.stringify(item.action || {})
                            .replace(/\s+/g, ' ')
                            .slice(0, 220);
                        return `- [${idx + 1}] ${item.code}: ${item.error} | action=${compactAction}`;
                    })
                    .join('\n');
                console.warn(`[ActionGate] Rejected ${rejectedActions.length} invalid actions:\n${reasonText}`);

                // ── 建構結構化的 [System Observation] 回饋給 Golem ──────────
                // 讓 Golem 知道哪些 action 失敗、原因是什麼，並能自行修正
                const observationLines = [
                    `[System Observation] ⚠️ ActionGate 攔截報告：${rejectedActions.length} 個 action 執行失敗`,
                    '',
                ];

                for (const item of rejectedActions) {
                    const actionName = String(item.action?.action || '(unknown)');
                    observationLines.push(`❌ action="${actionName}" → 失敗原因: ${item.code}`);
                    observationLines.push(`   詳情: ${item.error}`);

                    if (item.code === 'TOOLSET_DISABLED') {
                        observationLines.push(`   ⚡ 修正方式: 此技能存在但目前場景未啟用。請告知使用者需要切換場景，或直接輸出 /toolset <場景名稱> 指令。`);
                    } else if (item.code === 'UNKNOWN_ACTION') {
                        observationLines.push(`   ⚡ 修正方式: 此 action 不存在。請改用 command / mcp_call / 已安裝技能的 action 名稱。`);
                        observationLines.push(`   ✅ MCP 複合指令範例(先瀏覽再快照): [{"action":"mcp_call","server":"chrome-devtools","tool":"navigate_page","parameters":{"url":"https://example.com","timeout":60000}},{"action":"mcp_call","server":"chrome-devtools","tool":"take_snapshot","parameters":{}}]`);
                        observationLines.push(`   ✅ MCP 正確範例(搜尋): {"action":"mcp_call","server":"chrome-devtools","tool":"navigate_page","parameters":{"url":"https://html.duckduckgo.com/html/?q=%E9%97%9C%E9%8D%B5%E5%AD%97&kl=tw-tzh","timeout":60000}}`);
                        observationLines.push(`   ✅ MCP 正確範例(抽結果): {"action":"mcp_call","server":"chrome-devtools","tool":"evaluate_script","parameters":{"function":"() => Array.from(document.querySelectorAll('a.result__a')).slice(0, 10).map(a => ({ title: a.textContent.trim(), url: a.href }))"}}`);
                    } else if (item.code === 'INVALID_MCP_CALL') {
                        observationLines.push(`   ⚡ 修正方式: mcp_call 必須包含 server 和 tool 欄位。`);
                        observationLines.push(`   ✅ 格式模板: {"action":"mcp_call","server":"<server>","tool":"<tool>","parameters":{...}}`);
                        observationLines.push(`   ✅ 瀏覽模板(兩步): [{"action":"mcp_call","server":"chrome-devtools","tool":"navigate_page","parameters":{"url":"https://example.com","timeout":60000}},{"action":"mcp_call","server":"chrome-devtools","tool":"take_snapshot","parameters":{}}]`);
                    }
                    observationLines.push('');
                }

                observationLines.push('請根據以上資訊修正你的 [GOLEM_ACTION]，或告知使用者需要的操作。');
                const observationText = observationLines.join('\n');
                const canRetryFromGateFeedback = actionDepth < maxActionDepth;

                // 透過 convoManager 注入 [System Observation]（讓 Golem 的下一輪能看到）
                // ActionGate 回灌後允許進行修正重試（受 actionDepth/maxActionDepth 保護）。
                if (controller && controller.convoManager) {
                    await controller.convoManager.enqueue(ctx, observationText, {
                        isPriority: true,
                        bypassDebounce: true,
                        isSystemFeedback: true,
                        suppressReply: true,
                        allowActions: canRetryFromGateFeedback,
                        actionDepth: actionDepth + 1,
                        maxActionDepth,
                    });
                } else if (brain && typeof brain.sendMessage === 'function') {
                    try {
                        await brain.sendMessage(observationText, false, {
                            isSystemFeedback: true,
                            allowActions: canRetryFromGateFeedback,
                            disableToolRouting: true,
                            suppressReply: true,
                            actionDepth: actionDepth + 1,
                            maxActionDepth,
                        });
                    } catch (injectErr) {
                        console.warn(`[ActionGate] Failed to inject fallback observation to brain: ${injectErr.message}`);
                    }
                } else if (!shouldSuppressReply) {
                    // fallback：直接 reply 給使用者（不走 feedback loop）
                    const firstUnknown = rejectedActions.find((item) => item.code === 'UNKNOWN_ACTION');
                    if (firstUnknown && firstUnknown.action && firstUnknown.action.action) {
                        await ctx.reply(this._buildUnknownActionMessage(String(firstUnknown.action.action)));
                    }
                    const toolsetRejected = rejectedActions.filter(i => i.code === 'TOOLSET_DISABLED');
                    if (toolsetRejected.length > 0) {
                        const names = toolsetRejected.map(i => `\`${i.action?.action}\``).join(', ');
                        await ctx.reply(`⚠️ 技能 ${names} 在目前場景未啟用。\n${toolsetRejected[0].error}`);
                    } else {
                        await ctx.reply(
                            `⚠️ 已阻擋 ${rejectedActions.length} 個無效行動（格式或權限不符）。\n` +
                            `請改用有效 action（command / mcp_call / 已安裝技能）。`
                        );
                    }
                }
            }

            // 處理剩餘的終端指令序列並自動啟動回饋循環 (Feedback Loop)
            if (normalActions.length > 0) {
                await CommandHandler.execute(ctx, normalActions, controller, brain, (c, r, b, ctrl) => this.dispatch(c, r, b, ctrl, options), {
                    actionDepth,
                    maxActionDepth,
                    allowActions
                });
            }
        }
    }
}

module.exports = NeuroShunter;
