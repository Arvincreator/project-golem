const { CONFIG } = require('../config');
const path = require('path');
const HelpManager = require('../managers/HelpManager');
const skills = require('../skills');
const skillManager = require('../managers/SkillManager');
const SkillArchitect = require('../managers/SkillArchitect');
const wikiSkill = require('../skills/modules/wiki/index.js');
const { toolsetManager, SCENE_TOOLSETS } = require('../managers/ToolsetManager');
const { hookSystem } = require('./HookSystem'); // ⚡ [OpenHarness-inspired]
const { buildFreshStockSnapshotInjection } = require('../services/StockDashboardSnapshot');
const fs = require('fs');

// ✨ [v9.1 Addon] 初始化技能架構師 (Web Gemini Mode)
// 注意：這裡不傳入 Model，因為我們將在 NodeRouter 中傳入 Web Brain
const architect = new SkillArchitect();
console.log("🏗️ [SkillArchitect] 技能架構師已就緒 (Web Mode)");

const STOCK_NAME_SYMBOLS = {
    '台積電': '2330.TW',
    'tsmc': 'TSM',
    '鴻海': '2317.TW',
    '富士康': '2317.TW',
    '聯發科': '2454.TW',
    '聯電': '2303.TW',
    '元大台灣50': '0050.TW',
    '台灣50': '0050.TW',
    '元大高股息': '0056.TW',
    '高股息': '0056.TW',
    '中華電': '2412.TW',
    '富邦金': '2881.TW',
    '國泰金': '2882.TW',
    '中信金': '2891.TW',
};
const TAIWAN_SYMBOL_RE = /^\d{4,6}[A-Z]{0,3}$/;
const STOCK_SYMBOL_STOP_WORDS = new Set([
    'BOARD',
    'STOCK',
    'STOCKS',
    'DASHBOARD',
    'MARKET',
    'ANALYSIS',
    'DATA',
    'LIVE',
    'SIDE',
    'RANGE',
    'JSON',
    'TRUE',
    'FALSE',
    'NULL',
    'SOURCE',
    'STATUS',
]);

function normalizeStockSymbol(input) {
    const value = String(input || '').trim().toUpperCase();
    if (!value) return '';
    if (TAIWAN_SYMBOL_RE.test(value)) return `${value}.TW`;
    return value.replace(/[^A-Z0-9.^=-]/g, '').slice(0, 24);
}

function extractStockSymbolsFromText(text) {
    const found = new Set();
    const lower = String(text || '').toLowerCase();
    Object.entries(STOCK_NAME_SYMBOLS).forEach(([name, symbol]) => {
        if (lower.includes(name.toLowerCase())) found.add(symbol);
    });
    const symbolMatches = String(text || '').match(/\b[A-Z]{1,5}\b|\b\d{4,6}[A-Z]{0,3}(?:\.(?:TW|TWO))?\b/gi) || [];
    symbolMatches
        .map(normalizeStockSymbol)
        .filter((symbol) => {
            if (!symbol) return false;
            const displaySymbol = symbol.replace(/\.(TW|TWO)$/i, '');
            if (STOCK_SYMBOL_STOP_WORDS.has(displaySymbol)) return false;
            if (/^(19|20)\d{2}$/.test(displaySymbol)) return false;
            return true;
        })
        .forEach((symbol) => found.add(symbol));
    return Array.from(found).slice(0, 8);
}

// ============================================================
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
    static async handle(ctx, brain) {
        const text = (ctx.text || "").trim();
        const lowerText = text.toLowerCase();
        const isNewCommand = /^\/new$/.test(lowerText);
        const isNewMemoryCommand = /^\/(new[_-]?memory|memory[_-]?reset)$/.test(lowerText);
        const isWeb = !ctx.reply; // 判斷是否為網頁端 (無原生 reply 函數)

        // 輔助函式：統一回覆邏輯
        const reply = async (message, options = {}) => {
            if (!isWeb) {
                await ctx.reply(message, options);
            }
            return message; // 網頁端直接返回字串
        };
        const notifyBrainSystemChange = async (title, details) => {
            if (!brain || typeof brain.sendMessage !== 'function') return;
            const message = `[System Observation]\n` +
                `${title}\n` +
                `${details}\n` +
                `請將此變更視為最新系統狀態並遵循。`;
            try {
                await brain.sendMessage(message, false, {
                    isSystemFeedback: true,
                    allowActions: false,
                    disableToolRouting: true,
                });
            } catch (err) {
                console.warn(`[NodeRouter] system change sync failed: ${err.message}`);
            }
        };
        const notifyLearnOutcome = async ({ success, actionId = '', filePath = '', reason = '' } = {}) => {
            if (!brain || typeof brain.sendMessage !== 'function') return;
            const lines = success
                ? [
                    '[Learn Observation]',
                    `status=success`,
                    `action=${actionId || 'unknown'}`,
                    `file=${filePath || 'unknown'}`,
                    '請記住此技能已可執行；後續若要使用，請用 action JSON 格式呼叫。'
                ]
                : [
                    '[Learn Observation]',
                    'status=failed',
                    `reason=${reason || 'unknown error'}`,
                    '請先向使用者說明失敗原因，並詢問是否同意你再重試一次 /learn；未獲同意前請勿自動重試。'
                ];
            try {
                await brain.sendMessage(lines.join('\n'), false, {
                    isSystemFeedback: true,
                    allowActions: false,
                    disableToolRouting: true,
                });
            } catch (err) {
                console.warn(`[NodeRouter] learn outcome sync failed: ${err.message}`);
            }
        };
        const inferAutomationModeFromEnv = (env = {}) => {
            const asBool = (v) => String(v || '').trim().toLowerCase() === 'true';
            const autoApprove = asBool(env.GOLEM_AUTO_APPROVE_ALL);
            const silent = asBool(env.GOLEM_SILENT_AUTO_APPROVE);
            const trustLibrary = asBool(env.GOLEM_TRUST_SYSTEM_COMMANDS);
            const maxTurns = Number(env.GOLEM_MAX_AUTO_TURNS || 5);
            const level = Number(env.AUTONOMY_LEVEL || 2);
            if (level <= 0) return 'lockdown';
            if (autoApprove && silent) return 'silent';
            if (autoApprove) return 'autopilot';
            if (!autoApprove && trustLibrary && maxTurns >= 2) return 'balanced';
            return 'guided';
        };
        const applyAutomationMode = async (mode) => {
            const EnvManager = require('../utils/EnvManager');
            const SecurityManager = require('../../packages/security/SecurityManager');
            const ConfigManager = require('../config');
            const presets = {
                lockdown: {
                    GOLEM_AUTO_APPROVE_ALL: 'false',
                    GOLEM_SILENT_AUTO_APPROVE: 'false',
                    GOLEM_TRUST_SYSTEM_COMMANDS: 'false',
                    GOLEM_STRICT_SAFEGUARD: 'true',
                    GOLEM_MAX_AUTO_TURNS: '1',
                    GOLEM_INTERVENTION_LEVEL: 'CONSERVATIVE',
                    AUTONOMY_LEVEL: '0',
                },
                guided: {
                    GOLEM_AUTO_APPROVE_ALL: 'false',
                    GOLEM_SILENT_AUTO_APPROVE: 'false',
                    GOLEM_TRUST_SYSTEM_COMMANDS: 'false',
                    GOLEM_STRICT_SAFEGUARD: 'true',
                    GOLEM_MAX_AUTO_TURNS: '1',
                    GOLEM_INTERVENTION_LEVEL: 'CONSERVATIVE',
                    AUTONOMY_LEVEL: '0',
                },
                balanced: {
                    GOLEM_AUTO_APPROVE_ALL: 'false',
                    GOLEM_SILENT_AUTO_APPROVE: 'false',
                    GOLEM_TRUST_SYSTEM_COMMANDS: 'true',
                    GOLEM_STRICT_SAFEGUARD: 'true',
                    GOLEM_MAX_AUTO_TURNS: '2',
                    GOLEM_INTERVENTION_LEVEL: 'NORMAL',
                    AUTONOMY_LEVEL: '1',
                },
                autopilot: {
                    GOLEM_AUTO_APPROVE_ALL: 'true',
                    GOLEM_SILENT_AUTO_APPROVE: 'false',
                    GOLEM_TRUST_SYSTEM_COMMANDS: 'true',
                    GOLEM_STRICT_SAFEGUARD: 'true',
                    GOLEM_MAX_AUTO_TURNS: '4',
                    GOLEM_INTERVENTION_LEVEL: 'NORMAL',
                    AUTONOMY_LEVEL: '2',
                },
                silent: {
                    GOLEM_AUTO_APPROVE_ALL: 'true',
                    GOLEM_SILENT_AUTO_APPROVE: 'true',
                    GOLEM_TRUST_SYSTEM_COMMANDS: 'true',
                    GOLEM_STRICT_SAFEGUARD: 'true',
                    GOLEM_MAX_AUTO_TURNS: '4',
                    GOLEM_INTERVENTION_LEVEL: 'PROACTIVE',
                    AUTONOMY_LEVEL: '3',
                }
            };
            const payload = presets[mode];
            if (!payload) throw new Error(`unknown automation mode: ${mode}`);
            EnvManager.updateEnv(payload);
            ConfigManager.reloadConfig();
            SecurityManager.currentLevel = Number(payload.AUTONOMY_LEVEL || '2');
            return payload;
        };

        if (text.match(/^\/(help|menu|指令|功能)/)) {
            return await reply(await HelpManager.getManual(), { parse_mode: 'Markdown' });
        }

        if (text === '/donate' || text === '/support' || text === '贊助') {
            return await reply(`☕ **感謝您的支持！**\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
        }

        if (isNewCommand) {
            if (ctx.isAdmin !== true) {
                return await reply("⛔ 權限不足：/new 僅限管理員使用。");
            }
            if (!brain) {
                return await reply("⚠️ 大腦尚未初始化，無法執行 /new。");
            }
            await reply("🔄 收到 /new 指令！正在為您開啟全新的大腦對話神經元...");
            try {
                const isApiBackend = brain.backend === 'ollama' || brain.backend === 'lmstudio';
                const apiBackendLabel = brain.backend === 'lmstudio' ? 'LM Studio' : 'Ollama';
                if (brain.page || isApiBackend) {
                    await brain.init(true);
                    return await reply(isApiBackend
                        ? `✅ ${apiBackendLabel} 對話狀態已重置完成！目前大腦記憶脈絡已重新注入。`
                        : "✅ 物理重置完成！已經為您切斷舊有記憶，現在這是一個全新且乾淨的 Golem 實體。");
                }
                return await reply("⚠️ 找不到活躍的網頁視窗，無法執行物理重置。");
            } catch (e) {
                return await reply(`❌ 物理重置失敗: ${e.message}`);
            }
        }

        if (isNewMemoryCommand) {
            if (ctx.isAdmin !== true) {
                return await reply("⛔ 權限不足：/new_memory 僅限管理員使用。");
            }
            if (!brain) {
                return await reply("⚠️ 大腦尚未初始化，無法執行 /new_memory。");
            }
            await reply("💥 收到 /new_memory 指令！正在執行 Deep Wipe（記憶庫 + ChatLog + Wiki + Learnings）...");
            try {
                const wipeReport = (typeof brain.deepResetMemory === 'function')
                    ? await brain.deepResetMemory()
                    : { memoryDriver: null, chatLogs: null, wikiPagesCleared: 0, learningsCleared: false, errors: ['brain.deepResetMemory unavailable'] };
                const isApiBackend = brain.backend === 'ollama' || brain.backend === 'lmstudio';
                const apiBackendLabel = brain.backend === 'lmstudio' ? 'LM Studio' : 'Ollama';
                if (brain.page || isApiBackend) {
                    await brain.init(true);
                    if (typeof brain.waitUntilUserInputReady === 'function') {
                        await brain.waitUntilUserInputReady({ maxReadyWaitMs: 90000 });
                    }
                    const memoryCleared = Number(wipeReport?.memoryDriver?.cleared || 0);
                    const messageCleared = Number(wipeReport?.chatLogs?.messages || 0);
                    const summariesCleared = Number(wipeReport?.chatLogs?.summaries || 0);
                    const wikiCleared = Number(wipeReport?.wikiPagesCleared || 0);
                    const learningsCleared = wipeReport?.learningsCleared ? 'yes' : 'no';
                    const errorText = Array.isArray(wipeReport?.errors) && wipeReport.errors.length > 0
                        ? `\n⚠️ 部分清理失敗: ${wipeReport.errors.join(' | ')}`
                        : '';

                    return await reply(
                        (isApiBackend
                            ? `✅ Deep Wipe 完成，且 ${apiBackendLabel} 大腦脈絡已重新初始化。`
                            : `✅ Deep Wipe 完成，網頁已重置，這是一個全新且乾淨的 Golem 實體。`) +
                        `\n- memoryDriver.cleared=${memoryCleared}` +
                        `\n- chatlog.messages=${messageCleared}` +
                        `\n- chatlog.summaries=${summariesCleared}` +
                        `\n- wiki.files=${wikiCleared}` +
                        `\n- learnings.cleared=${learningsCleared}` +
                        errorText
                    );
                }
                return await reply("⚠️ 找不到活躍的網頁視窗。");
            } catch (e) {
                return await reply(`❌ 深度轉生失敗: ${e.message}`);
            }
        }

        if (text === '/update' || text === '/reset') {
            if (isWeb) return await reply("⚠️ **系統更新** 功能目前僅限於機器人終端使用。");
            await ctx.reply("⚠️ **系統更新警告**\n這將強制覆蓋本地代碼。", {
                reply_markup: { inline_keyboard: [[{ text: '🔥 確認', callback_data: 'SYSTEM_FORCE_UPDATE' }, { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }]] }
            });
            return true;
        }

        if (text === '/level' || text.startsWith('/level ')) {
            if (ctx.isAdmin !== true) {
                return await reply('⛔ 權限不足：/level 僅限管理員使用。');
            }
            const arg = text.replace(/^\/level\s*/i, '').trim().toLowerCase();
            const argToMode = {
                '0': 'lockdown',
                '1': 'guided',
                '2': 'balanced',
                '3': 'autopilot',
                '4': 'silent',
                lockdown: 'lockdown',
                guided: 'guided',
                balanced: 'balanced',
                autopilot: 'autopilot',
                silent: 'silent',
            };
            if (!arg) {
                const EnvManager = require('../utils/EnvManager');
                const env = EnvManager.readEnv();
                const mode = inferAutomationModeFromEnv(env);
                const currentLevel = String(env.AUTONOMY_LEVEL || '2');
                return await reply(
                    `🛡️ /level 說明（目前模式：\`${mode}\`）\n` +
                    `- \`/level 0\` Lockdown：最保守（只允許最低風險）\n` +
                    `- \`/level 1\` Guided：保守確認\n` +
                    `- \`/level 2\` Balanced：平衡模式（推薦）\n` +
                    `- \`/level 3\` Autopilot：高自動化\n` +
                    `- \`/level 4\` Silent：最高自動化 + 靜默\n` +
                    `- AUTONOMY_LEVEL: \`${currentLevel}\`\n` +
                    `- GOLEM_INTERVENTION_LEVEL: \`${env.GOLEM_INTERVENTION_LEVEL || 'NORMAL'}\`\n` +
                    `- GOLEM_AUTO_APPROVE_ALL: \`${env.GOLEM_AUTO_APPROVE_ALL || 'false'}\`\n` +
                    `- GOLEM_SILENT_AUTO_APPROVE: \`${env.GOLEM_SILENT_AUTO_APPROVE || 'false'}\``
                );
            }

            const nextMode = argToMode[arg];
            if (!nextMode) {
                return await reply('⚠️ 用法：`/level 0|1|2|3|4`（只輸入 `/level` 可查看說明）');
            }

            try {
                const payload = await applyAutomationMode(nextMode);
                await notifyBrainSystemChange(
                    '安全與自動化模式已更新',
                    `mode=${nextMode}\nAUTONOMY_LEVEL=${payload.AUTONOMY_LEVEL}\nGOLEM_INTERVENTION_LEVEL=${payload.GOLEM_INTERVENTION_LEVEL}`
                );
                return await reply(
                    `✅ 已切換至 \`${nextMode}\` 模式（已同步 Dashboard 安全與指令設定）。\n` +
                    `- AUTONOMY_LEVEL=${payload.AUTONOMY_LEVEL}\n` +
                    `- GOLEM_INTERVENTION_LEVEL=${payload.GOLEM_INTERVENTION_LEVEL}`
                );
            } catch (e) {
                return await reply(`❌ 模式切換失敗: ${e.message}`);
            }
        }

        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                const persona = require('../skills/core/persona');
                persona.setName(brain.userDataDir, 'user', newName);
                await brain.init(true); // forceReload
                await notifyBrainSystemChange(
                    '使用者稱呼已更新',
                    `callme=${newName}`
                );
                return await reply(`👌 沒問題，以後稱呼您為 **${newName}**。`);
            }
        }

        if (text === '/install' || text.startsWith('/install ')) {
            const InstallerManager = require('../managers/InstallerManager');
            const payload = text.replace(/^\/install\s*/i, '').trim();
            if (!payload) {
                return await reply(
                    '🧩 用法:\n' +
                    '`/install skill <本機技能資料夾路徑>`\n' +
                    '`/install skill-gh <github repo/tree url>`\n' +
                    '`/install mcp-file <本機 mcp json 路徑>`\n' +
                    '`/install mcp-json <單行 JSON>`\n' +
                    '`/install mcp-url <https json url>`\n\n' +
                    'MCP JSON 至少需包含：`name`, `command`'
                );
            }

            const [subCmdRaw, ...rest] = payload.split(/\s+/);
            const subCmd = String(subCmdRaw || '').toLowerCase();
            const argText = rest.join(' ').trim();

            try {
                if (subCmd === 'skill') {
                    if (!argText) return await reply('⚠️ 用法：`/install skill <本機技能資料夾路徑>`');
                    const result = await InstallerManager.installSkillFromPath(argText, brain);
                    return await reply(
                        `✅ 技能安裝完成\n` +
                        `- ID: ${result.id}\n` +
                        `- Name: ${result.name}\n` +
                        `- Path: \`${result.path}\`\n` +
                        `- 新增範例: ${result.syncResult.added}\n` +
                        `- 範例檔: \`${result.syncResult.customPath}\``
                    );
                }

                if (subCmd === 'mcp-file') {
                    if (!argText) return await reply('⚠️ 用法：`/install mcp-file <本機 mcp json 路徑>`');
                    const result = await InstallerManager.installMcpFromFile(argText, brain);
                    return await reply(
                        `✅ MCP 安裝完成\n` +
                        `- Name: ${result.name}\n` +
                        `- Command: \`${result.command}\`\n` +
                        `- Source: \`${result.source}\`\n` +
                        `- 新增範例: ${result.syncResult.added}\n` +
                        `- 範例檔: \`${result.syncResult.customPath}\``
                    );
                }

                if (subCmd === 'mcp-json') {
                    if (!argText) return await reply('⚠️ 用法：`/install mcp-json <單行 JSON>`');
                    const result = await InstallerManager.installMcpFromJson(argText, brain);
                    return await reply(
                        `✅ MCP 安裝完成\n` +
                        `- Name: ${result.name}\n` +
                        `- Command: \`${result.command}\`\n` +
                        `- 新增範例: ${result.syncResult.added}\n` +
                        `- 範例檔: \`${result.syncResult.customPath}\``
                    );
                }

                if (subCmd === 'skill-gh') {
                    if (!argText) return await reply('⚠️ 用法：`/install skill-gh <github repo/tree url>`');
                    const result = await InstallerManager.installSkillFromGithub(argText, brain);
                    return await reply(
                        `✅ 遠端技能安裝完成\n` +
                        `- ID: ${result.id}\n` +
                        `- Name: ${result.name}\n` +
                        `- Repo: ${result.remote.owner}/${result.remote.repo}\n` +
                        `- Branch: ${result.remote.branch}\n` +
                        `- Path: \`${result.path}\`\n` +
                        `- 新增範例: ${result.syncResult.added}\n` +
                        `- 範例檔: \`${result.syncResult.customPath}\``
                    );
                }

                if (subCmd === 'mcp-url') {
                    if (!argText) return await reply('⚠️ 用法：`/install mcp-url <https json url>`');
                    const result = await InstallerManager.installMcpFromUrl(argText, brain);
                    return await reply(
                        `✅ 遠端 MCP 安裝完成\n` +
                        `- Name: ${result.name}\n` +
                        `- Command: \`${result.command}\`\n` +
                        `- 新增範例: ${result.syncResult.added}\n` +
                        `- 範例檔: \`${result.syncResult.customPath}\``
                    );
                }

                return await reply(
                    `⚠️ 不支援的 install 子指令: \`${subCmd}\`\n` +
                    '可用：`skill`, `skill-gh`, `mcp-file`, `mcp-json`, `mcp-url`'
                );
            } catch (e) {
                return await reply(`❌ 安裝失敗: ${e.message}`);
            }
        }

        // ✨ [v9.1 Feature] 學習新技能 (Web Gemini Mode)
        if (text === '/learn' || text.startsWith('/learn ')) {
            const intent = text.replace(/^\/learn\s*/i, '').trim();
            if (!intent) {
                return await reply("🧠 用法：`/learn <你要學習的技能描述>`\n例如：`/learn 建立一個股票查詢技能`");
            }
            if (!isWeb) {
                await ctx.reply(`🏗️ **Web 技能架構師啟動...**\n正在使用網頁算力為您設計：\`${intent}\``);
                await ctx.sendTyping();
            }

            try {
                const result = await architect.designSkill(brain, intent, skillManager.listSkills());

                if (result.success) {
                    const runtimeSkillId = String(
                        result.id || require('path').basename(result.path || '', '.js')
                    ).toLowerCase();
                    if (!result.path || !fs.existsSync(result.path)) {
                        const reason = `技能檔案未成功寫入（${result.path || 'unknown path'}）`;
                        await notifyLearnOutcome({ success: false, reason });
                        return await reply(`❌ **學習失敗**: ${reason}。未進行註冊。`);
                    }
                    // 1) 熱重載 SkillManager，讓動態 JS 技能可立即執行
                    try {
                        skillManager.refresh();
                    } catch (refreshError) {
                        console.warn(`⚠️ [NodeRouter] SkillManager refresh failed after /learn: ${refreshError.message}`);
                    }
                    const loadedSkill = skillManager.getSkill(runtimeSkillId);
                    if (!loadedSkill || typeof loadedSkill.run !== 'function') {
                        const reason = `技能已生成但未成功載入（action: ${runtimeSkillId}）`;
                        await notifyLearnOutcome({ success: false, reason });
                        return await reply(
                            `❌ **學習失敗**: 技能已生成但未成功載入（action: \`${runtimeSkillId}\`）。為避免假技能，系統已阻止註冊。`
                        );
                    }

                    // 2) 直接寫入 SQLite 索引，讓 Dashboard 立即可見
                    try {
                        const SkillIndexManager = require('../managers/SkillIndexManager');

                    if (runtimeSkillId) {
                            const SkillPackageRegistry = require('../managers/SkillPackageRegistry');
                            const runtimeTitle = result.name || runtimeSkillId;
                            const runtimeDescription = result.preview || "由 /learn 動態生成的使用者技能";
                            const runtimeContent = result.packagePath
                                ? SkillPackageRegistry.buildPromptContent(SkillPackageRegistry.loadPackage(result.packagePath))
                                : [
                                    `# ${runtimeTitle}`,
                                    runtimeDescription,
                                    "## Runtime Action",
                                    `- action: \`${runtimeSkillId}\``,
                                    "## Source",
                                    "```js",
                                    result.code || "// source unavailable",
                                    "```"
                                ].join('\n\n');

                            const index = brain && brain.skillIndex
                                ? brain.skillIndex
                                : new SkillIndexManager(brain.userDataDir);

                            await index.upsertSkillRecord({
                                id: runtimeSkillId,
                                name: runtimeTitle,
                                description: runtimeDescription,
                                content: runtimeContent,
                                path: result.path || '',
                                category: 'user_dynamic',
                                last_modified: Date.now()
                            });

                            if (!brain || !brain.skillIndex) {
                                await index.close();
                            }
                        }
                    } catch (indexError) {
                        console.warn(`⚠️ [NodeRouter] /learn skill index sync failed: ${indexError.message}`);
                    }
                    // 自動同步 capability/example + 向量索引
                    try {
                        const ExampleSyncManager = require('../managers/ExampleSyncManager');
                        ExampleSyncManager.sync(brain.userDataDir);
                        if (brain && typeof brain._syncToolVectorIndex === 'function') {
                            await brain._syncToolVectorIndex();
                        }
                    } catch (syncError) {
                        console.warn(`⚠️ [NodeRouter] /learn capability/example sync failed: ${syncError.message}`);
                    }
                }

                const response = result.success
                    ? `✅ **新技能編寫完成！**\n📜 **名稱**: \`${result.name}\`\n🧩 **Action**: \`${result.id || require('path').basename(result.path || '', '.js')}\`\n📝 **描述**: ${result.preview}\n📂 **檔案**: \`${require('path').basename(result.path)}\`\n\n` +
                      `建議呼叫格式：\n\`\`\`json\n{"action":"${result.id || require('path').basename(result.path || '', '.js')}","args":{"input":"..."}}\n\`\`\`\n` +
                      `_現在可以直接命令我使用此功能，且已同步到 SQLite，可在 Dashboard 看見。_`
                    : `❌ **學習失敗**: ${result.error}`;

                if (result.success) {
                    await notifyLearnOutcome({
                        success: true,
                        actionId: String(result.id || require('path').basename(result.path || '', '.js')).toLowerCase(),
                        filePath: result.path || ''
                    });
                } else {
                    await notifyLearnOutcome({ success: false, reason: result.error || 'unknown error' });
                }

                return await reply(response);
            } catch (e) {
                console.error(e);
                await notifyLearnOutcome({ success: false, reason: e.message || 'fatal error' });
                return await reply(`❌ **致命錯誤**: ${e.message}`);
            }
        }

        // ✨ [v9.1 Feature] 匯出/匯入/列表
        if (text.startsWith('/export ')) {
            try {
                const token = skillManager.exportSkill(text.replace('/export ', '').trim());
                return await reply(`📦 **技能膠囊**:\n\`${token}\``);
            } catch (e) {
                return await reply(`❌ ${e.message}`);
            }
        }

        if (text.startsWith('GOLEM_SKILL::')) {
            const res = skillManager.importSkill(text.trim());
            if (res.success) {
                try {
                    const SkillIndexManager = require('../managers/SkillIndexManager');
                    const SkillPackageRegistry = require('../managers/SkillPackageRegistry');
                    const packageSkill = res.packagePath ? SkillPackageRegistry.loadPackage(res.packagePath) : null;
                    const importedId = String(
                        (packageSkill && packageSkill.id) ||
                        require('path').basename(res.path || '', '.js')
                    ).toLowerCase();
                    const sourceCode = require('fs').readFileSync(res.path, 'utf8');
                    const title = res.name || (packageSkill && packageSkill.id) || importedId;
                    const content = packageSkill
                        ? SkillPackageRegistry.buildPromptContent(packageSkill)
                        : [
                            `# ${title}`,
                            "由 GOLEM_SKILL 膠囊匯入的使用者技能",
                            "## Runtime Action",
                            `- action: \`${importedId}\``,
                            "## Source",
                            "```js",
                            sourceCode,
                            "```"
                        ].join('\n\n');

                    const index = brain && brain.skillIndex
                        ? brain.skillIndex
                        : new SkillIndexManager(brain.userDataDir);

                    await index.upsertSkillRecord({
                        id: packageSkill ? packageSkill.id : importedId,
                        name: title,
                        description: "由 GOLEM_SKILL 匯入",
                        content,
                        path: res.packagePath || res.path || '',
                        category: 'user_dynamic',
                        last_modified: Date.now()
                    });

                    if (!brain || !brain.skillIndex) {
                        await index.close();
                    }
                } catch (e) {
                    console.warn(`⚠️ [NodeRouter] GOLEM_SKILL index sync failed: ${e.message}`);
                }
                try {
                    const ExampleSyncManager = require('../managers/ExampleSyncManager');
                    ExampleSyncManager.sync(brain.userDataDir);
                    if (brain && typeof brain._syncToolVectorIndex === 'function') {
                        await brain._syncToolVectorIndex();
                    }
                } catch (syncError) {
                    console.warn(`⚠️ [NodeRouter] GOLEM_SKILL capability/example sync failed: ${syncError.message}`);
                }
            }
            return await reply(res.success ? `✅ 安裝成功: ${res.name}` : `⚠️ ${res.error}`);
        }

        if (text === '/skills') {
            try {
                const SkillPackageRegistry = require('../managers/SkillPackageRegistry');
                const SkillIndexManager = require('../managers/SkillIndexManager');
                const MCPToolCatalog = require('../mcp/MCPToolCatalog');
                const mcpPath = require('path').resolve(process.cwd(), 'data', 'mcp-servers.json');
                const fsSync = require('fs');

                // ── 1. 從 SkillPackageRegistry 取得所有已安裝的 package 技能（最即時）
                const pkgs = SkillPackageRegistry.listSkillPackages({ userDataDir: brain.userDataDir })
                    .filter(p => p.enabled !== false)
                    .sort((a, b) => a.id.localeCompare(b.id));

                // ── 2. 從 SQLite 補充 lib 技能（/learn 動態生成的技能也在這裡）
                const index = new SkillIndexManager(brain.userDataDir);
                const dbSkills = await index.listAllSkills();
                await index.close();

                // 合併：以 package 為主，SQLite 補充 package 沒有的
                const pkgIds = new Set(pkgs.map(p => p.id));
                const libSkills = dbSkills.filter(s => !pkgIds.has(s.id));

                // ── 3. MCP 工具摘要
                let mcpSummary = '';
                try {
                    if (fsSync.existsSync(mcpPath)) {
                        const servers = JSON.parse(fsSync.readFileSync(mcpPath, 'utf8'));
                        const enabled = (Array.isArray(servers) ? servers : []).filter(s => s.enabled !== false);
                        if (enabled.length > 0) {
                            const toolCount = enabled.reduce((n, s) => n + (s.cachedTools?.length || 0), 0);
                            mcpSummary = `\n\n🔌 **MCP 工具** (${enabled.length} 個伺服器 / ${toolCount} 個工具):\n`;
                            mcpSummary += enabled.map(s => `• **${s.name}** — ${s.description || ''} (${s.cachedTools?.length || 0} 工具)`).join('\n');
                        }
                    }
                } catch (_) {}

                const totalSkills = pkgs.length + libSkills.length;
                if (totalSkills === 0 && !mcpSummary) {
                    return await reply("📭 目前尚未安裝或同步任何技能。");
                }

                let skillMsg = `📚 **Golem 已安裝系統能力清單** (共 ${totalSkills} 個技能):\n\n`;

                if (pkgs.length > 0) {
                    skillMsg += `**🧩 Package 技能** (${pkgs.length} 個):\n`;
                    skillMsg += pkgs.map(p => `• **${p.id}**${p.name && p.name !== p.id ? ` — ${p.name}` : ''}${p.description ? `: ${p.description.slice(0, 60)}` : ''}`).join('\n');
                }

                if (libSkills.length > 0) {
                    if (pkgs.length > 0) skillMsg += '\n\n';
                    skillMsg += `**📖 動態技能** (${libSkills.length} 個):\n`;
                    skillMsg += libSkills.map(s => `• **${s.id}**${s.name ? ` — ${s.name}` : ''}`).join('\n');
                }

                skillMsg += mcpSummary;
                skillMsg += `\n\n_使用 \`/toolset\` 查看場景工具集，\`/toolset status\` 查看目前啟用的工具。_`;

                return await reply(skillMsg);
            } catch (e) {
                console.error("Failed to list skills:", e);
                return await reply(`❌ **讀取技能清單失敗**: ${e.message}`);
            }
        }

        if (text === '/capabilities') {
            try {
                const CapabilityRegistry = require('../managers/CapabilityRegistry');
                const { registry, path: registryPath } = CapabilityRegistry.sync(brain.userDataDir);
                const covered = Number(registry.summary.coveredExamples || 0);
                const total = Number(registry.summary.total || 0);
                const percent = total > 0 ? ((covered / total) * 100).toFixed(1) : '0.0';
                return await reply(
                    `🧭 **Capability Registry 已同步**\n` +
                    `- Skills: ${registry.summary.skills}\n` +
                    `- MCP Tools: ${registry.summary.mcpTools}\n` +
                    `- Total: ${total}\n` +
                    `- Example Coverage: ${covered}/${total} (${percent}%)\n` +
                    `- File: \`${registryPath}\``
                );
            } catch (e) {
                return await reply(`❌ 同步 Capability Registry 失敗: ${e.message}`);
            }
        }

        if (text === '/examples sync' || text.startsWith('/examples sync ')) {
            try {
                const ExampleSyncManager = require('../managers/ExampleSyncManager');
                const CapabilityRegistry = require('../managers/CapabilityRegistry');
                const syncResult = ExampleSyncManager.sync(brain.userDataDir);
                const { registry } = CapabilityRegistry.sync(brain.userDataDir);

                if (brain && typeof brain._syncToolVectorIndex === 'function') {
                    await brain._syncToolVectorIndex();
                }

                const covered = Number(registry.summary.coveredExamples || 0);
                const total = Number(registry.summary.total || 0);
                return await reply(
                    `🧩 **Example Sync 完成**\n` +
                    `- 新增範例: ${syncResult.added}\n` +
                    `- 自訂範例總數: ${syncResult.totalCustom}\n` +
                    `- Coverage: ${covered}/${total}\n` +
                    `- Custom File: \`${syncResult.customPath}\``
                );
            } catch (e) {
                return await reply(`❌ Example Sync 失敗: ${e.message}`);
            }
        }

        if (text === '/examples validate' || text.startsWith('/examples validate ')) {
            try {
                const ExampleValidator = require('../managers/ExampleValidator');
                const report = ExampleValidator.validateAll();
                const topIssues = report.results
                    .filter(item => item.issues.length > 0)
                    .slice(0, 12)
                    .map(item => `- ${item.id}: ${item.issues.join(', ')}`)
                    .join('\n');
                return await reply(
                    `🧪 **Example Validate 完成**\n` +
                    `- Total: ${report.total}\n` +
                    `- Valid: ${report.valid}\n` +
                    `- Invalid: ${report.invalid}\n` +
                    `${topIssues ? `\n問題摘要:\n${topIssues}` : '\n✅ 未發現結構錯誤'}`
                );
            } catch (e) {
                return await reply(`❌ Example Validate 失敗: ${e.message}`);
            }
        }

        if (text === '/mcp sync' || text.startsWith('/mcp sync ')) {
            try {
                const CapabilityRegistry = require('../managers/CapabilityRegistry');
                const ExampleSyncManager = require('../managers/ExampleSyncManager');
                const MCPManager = require('../mcp/MCPManager');
                CapabilityRegistry.sync(brain.userDataDir);
                const syncResult = ExampleSyncManager.sync(brain.userDataDir);

                const mcpManager = MCPManager.getInstance();
                await mcpManager.load();
                const tools = mcpManager.getCachedTools();

                if (brain && typeof brain._syncToolVectorIndex === 'function') {
                    await brain._syncToolVectorIndex();
                }

                return await reply(
                    `🔄 **MCP Sync 完成**\n` +
                    `- 已載入 MCP 工具: ${tools.length}\n` +
                    `- 新增範例: ${syncResult.added}\n` +
                    `- 範例檔: \`${syncResult.customPath}\`\n` +
                    `- 向量索引: 已觸發同步`
                );
            } catch (e) {
                return await reply(`❌ MCP Sync 失敗: ${e.message}`);
            }
        }

        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;

        const wantsStockDashboard =
            /^\/(stockboard|stock-dashboard|stocks?)(\s|$)/i.test(text) ||
            /(分析|研究|評估|看看|幫我看).{0,24}(股票|股價|台股|美股|個股|台積電|鴻海|聯發科|NVDA|AAPL|TSM|\d{4,6})/i.test(text) ||
            /(股票|股價|台股|美股|個股|台積電|鴻海|聯發科|NVDA|AAPL|TSM|\d{4,6}).{0,24}(分析|研究|評估|能不能|可不可以|追|買|賣)/i.test(text) ||
            /(股市|股票|行情).{0,8}(看板|dashboard)/i.test(text) ||
            /(看板|dashboard).{0,8}(股市|股票|行情)/i.test(text) ||
            /stock\s+dashboard/i.test(text);

        if (wantsStockDashboard) {
            const userRequest = text.replace(/^\/(stockboard|stock-dashboard|stocks?)\s*/i, '').trim() || '請分析目前股市看板。';
            const symbols = extractStockSymbolsFromText(userRequest);
            const enrichedText = [
                userRequest,
                '',
                await buildFreshStockSnapshotInjection({
                    trigger: 'telegram-stock-dashboard-command',
                    symbols: symbols.length ? symbols : undefined,
                    selectedSymbol: symbols[0],
                }),
                '',
                '請輸出：市場概況、主要強弱標的、技術指標重點、兩週內中文優先新聞脈絡、風險提醒、接下來可觀察的價位或事件。不要做保證式投資建議。',
            ].join('\n');
            if (typeof ctx.setTextOverride === 'function') {
                ctx.setTextOverride(enrichedText);
            } else {
                ctx.textOverride = enrichedText;
            }
            return false;
        }

        // ── /wiki 指令 ───────────────────────────────────────────
        if (text.startsWith('/wiki')) {
            const parts  = text.slice(5).trim().split(/\s+/);
            const action = parts[0] || 'help';
            const input  = parts.slice(1).join(' ');
            // ⚡ [OpenHarness-inspired] Skill Execution Trace + Hook
            const hookCtx = { type: 'skill', name: 'wiki', trigger: text, _startMs: Date.now() };
            await hookSystem.emit('pre_tool_use', hookCtx);
            try {
                const result = await wikiSkill.run({ args: { action, input }, brain });
                await hookSystem.emit('post_tool_use', hookCtx, { output: result });
                if (brain && brain.chatLogManager) {
                    brain.chatLogManager.appendTrace({
                        skill: 'wiki', trigger: text, durationMs: Date.now() - hookCtx._startMs,
                        result_summary: String(result || '').slice(0, 150)
                    });
                }
                return await reply(result);
            } catch (e) {
                await hookSystem.emit('post_tool_use', hookCtx, { error: e.message });
                return await reply(`❌ [Wiki] 執行失敗: ${e.message}`);
            }
        }

        // ── /compress 指令 ─────────────────────────────────────────
        // Hermes-inspired: 手動觸發 TrajectoryCompressor 壓縮目前會話
        if (text === '/compress' || text.startsWith('/compress ')) {
            if (!brain || !brain.compressSession) {
                return await reply('❌ [Compress] 大腦未初始化，無法執行壓縮。');
            }
            await reply('🗜️ 正在壓縮當前會話記憶，請稍候...');
            try {
                const result = await brain.compressSession();
                if (result.compressed) {
                    return await reply(`✅ **會話壓縮完成！**\n📉 節省了 **${result.savedChars.toLocaleString()}** 字元的上下文空間。`);
                } else {
                    return await reply('ℹ️ 當前會話尚未超過壓縮門檻，或無可壓縮的中段內容。');
                }
            } catch (e) {
                return await reply(`❌ 壓縮失敗: ${e.message}`);
            }
        }

        // ── /project 指令 ─────────────────────────────────────────
        // 提供「整個專案資料夾讀取」與「Web Gemini 分段執行」能力
        // 用法：
        //   /project scan <path>
        //   /project inject <path>
        //   /project run <path> | <task>
        if (text === '/project' || text.startsWith('/project ')) {
            if (!brain || typeof brain.injectProjectContext !== 'function') {
                return await reply('❌ [Project] 大腦尚未就緒，無法執行專案上下文作業。');
            }

            const payload = text.replace(/^\/project\s*/i, '').trim();
            if (!payload) {
                return await reply(
                    '🧩 用法:\n' +
                    '`/project scan <path>`\n' +
                    '`/project inject <path>`\n' +
                    '`/project run <path> | <task>`'
                );
            }

            const [subRaw, ...rest] = payload.split(/\s+/);
            const subCmd = String(subRaw || '').toLowerCase();

            const resolveTargetPath = (rawPath) => {
                const p = String(rawPath || '').trim();
                if (!p || p === '.') return process.cwd();
                return path.resolve(p);
            };

            if (subCmd === 'scan') {
                const targetPath = resolveTargetPath(rest.join(' '));
                try {
                    const { summary } = await brain.projectContextService.createProjectChunks(targetPath, {
                        maxFiles: 500,
                        maxFileChars: 5000,
                        maxChunkChars: 10000,
                        readTopFiles: 120,
                        scanOnly: true,
                    });
                    return await reply(
                        `✅ 掃描完成\n` +
                        `📂 Root: \`${summary.rootDir}\`\n` +
                        `📚 Indexed Files: ${summary.indexedFileCount}\n` +
                        `🎯 Selected Files: ${summary.selectedFileCount}\n` +
                        `🕒 At: ${summary.generatedAt}`
                    );
                } catch (e) {
                    return await reply(`❌ [Project] 掃描失敗: ${e.message}`);
                }
            }

            if (subCmd === 'inject') {
                const targetPath = resolveTargetPath(rest.join(' '));
                await reply(`⏳ 正在分段注入專案上下文：\`${targetPath}\` ...`);
                try {
                    const result = await brain.injectProjectContext(targetPath, {
                        maxFiles: 500,
                        maxFileChars: 5000,
                        maxChunkChars: 10000,
                    });
                    if (!result.ok) {
                        return await reply(`⚠️ [Project] 注入失敗: ${result.reason || 'unknown'}`);
                    }
                    const s = result.summary;
                    return await reply(
                        `✅ 專案上下文注入完成\n` +
                        `📂 Root: \`${s.rootDir}\`\n` +
                        `📚 Indexed Files: ${s.indexedFileCount || 0}\n` +
                        `🎯 Selected Files: ${s.selectedFileCount || 0}\n` +
                        `🧩 Chunks: ${s.chunkCount}`
                    );
                } catch (e) {
                    return await reply(`❌ [Project] 注入失敗: ${e.message}`);
                }
            }

            if (subCmd === 'run') {
                const raw = payload.replace(/^run\s*/i, '');
                const splitIdx = raw.indexOf('|');
                if (splitIdx === -1) {
                    return await reply('⚠️ 用法：`/project run <path> | <task>`');
                }
                const targetPath = resolveTargetPath(raw.slice(0, splitIdx).trim());
                const task = raw.slice(splitIdx + 1).trim();
                if (!task) {
                    return await reply('⚠️ 請提供 task。用法：`/project run <path> | <task>`');
                }

                const taskId = `P${Date.now().toString().slice(-6)}`;
                const ackMessage = `⏳ [Project:${taskId}] 任務已開始，正在背景分段讀取與分析：\`${targetPath}\`\n完成後我會主動回報結果。`;
                await reply(ackMessage);

                // Telegram / Dashboard：背景執行，避免前端卡在「執行中」
                // Web fallback (無 ctx.reply)：改為同步執行並回傳最終字串
                const runner = async () => {
                    try {
                        let lastProgressChunk = 0;
                        const result = await brain.runProjectTaskWithSegmentedContext(targetPath, task, {
                            maxFiles: 500,
                            maxFileChars: 5000,
                            maxChunkChars: 10000,
                            readTopFiles: 140,
                            readConcurrency: 12,
                            maxTaskSegmentChars: 9000,
                            onProgress: async (ev) => {
                                if (!ctx.reply || !ev) return;
                                if (ev.phase === 'inject_chunk') {
                                    if (ev.chunkIndex === 1 || ev.chunkIndex === ev.chunkTotal || ev.chunkIndex - lastProgressChunk >= 10) {
                                        lastProgressChunk = ev.chunkIndex;
                                        await ctx.reply(`🔄 [Project:${taskId}] 專案上下文注入進度 ${ev.chunkIndex}/${ev.chunkTotal}`);
                                    }
                                }
                            }
                        });
                        const s = result.projectSummary || {};
                        await reply(
                            `✅ [Project:${taskId}] 任務執行完成 (分段模式)\n` +
                            `📂 Root: \`${s.rootDir || targetPath}\`\n` +
                            `📚 Indexed: ${s.indexedFileCount || 0}, Selected: ${s.selectedFileCount || 0}, Chunks: ${s.chunkCount || 0}\n\n` +
                            `${result.text || ''}`
                        );
                    } catch (e) {
                        await reply(`❌ [Project:${taskId}] run 失敗: ${e.message}`);
                    }
                };

                if (isWeb) {
                    // 無 reply channel（例如直接函式呼叫）時，仍可同步拿最終結果
                    try {
                        const result = await brain.runProjectTaskWithSegmentedContext(targetPath, task, {
                            maxFiles: 500,
                            maxFileChars: 5000,
                            maxChunkChars: 10000,
                            readTopFiles: 140,
                            readConcurrency: 12,
                            maxTaskSegmentChars: 9000,
                        });
                        const s = result.projectSummary || {};
                        return (
                            `✅ [Project:${taskId}] 任務執行完成 (分段模式)\n` +
                            `📂 Root: \`${s.rootDir || targetPath}\`\n` +
                            `📚 Indexed: ${s.indexedFileCount || 0}, Selected: ${s.selectedFileCount || 0}, Chunks: ${s.chunkCount || 0}\n\n` +
                            `${result.text || ''}`
                        );
                    } catch (e) {
                        return `❌ [Project:${taskId}] run 失敗: ${e.message}`;
                    }
                }

                runner().catch((e) => {
                    console.error('[NodeRouter] /project run background error:', e);
                });
                return true;
            }

            return await reply('⚠️ 未知子命令。可用：`scan`、`inject`、`run`');
        }

        // ── /search 指令 ────────────────────────────────────────────
        // Hermes-inspired: 快速搜尋歷史對話記錄
        if (text.startsWith('/search ') || text.startsWith('/search\n')) {
            const query = text.replace(/^\/search\s*/i, '').trim();
            if (!query) {
                return await reply('🔍 用法：`/search <關鍵字>` 或使用 `/search <關鍵字> --days 60`\n例如：`/search memory bug`');
            }
            // 解析可選的 --days 參數
            const daysMatch = query.match(/--days\s+(\d+)/);
            const days = daysMatch ? parseInt(daysMatch[1]) : 30;
            const cleanQuery = query.replace(/--days\s+\d+/i, '').trim();

            // ⚡ [OpenHarness-inspired] Skill Execution Trace + Hook
            const hookCtx = { type: 'skill', name: 'session-search', trigger: text, _startMs: Date.now() };
            await hookSystem.emit('pre_tool_use', hookCtx);
            try {
                const searchSkill = require('../skills/modules/session-search/index.js');
                const result = await searchSkill.run({
                    args: { query: cleanQuery, mode: 'keyword', days },
                    brain
                });
                await hookSystem.emit('post_tool_use', hookCtx, { output: result });
                if (brain && brain.chatLogManager) {
                    brain.chatLogManager.appendTrace({
                        skill: 'session-search', trigger: text, durationMs: Date.now() - hookCtx._startMs,
                        result_summary: String(result || '').slice(0, 150)
                    });
                }
                return await reply(result);
            } catch (e) {
                await hookSystem.emit('post_tool_use', hookCtx, { error: e.message });
                return await reply(`❌ 搜尋失敗: ${e.message}`);
            }
        }

        // ── /toolset 指令 ────────────────────────────────────────────
        // [Phase 2] Hermes-inspired: 切換場景化工具集
        if (text === '/toolset' || text.startsWith('/toolset ')) {
            const subCmd = text.replace(/^\/toolset\s*/i, '').trim().toLowerCase();
            const isGolemAutonomousCall = ctx && (ctx.isFromGolemAction === true || ctx.source === 'golem_action');
            const AUTO_SWITCH_ALLOWLIST = new Set(['assistant', 'coding', 'research', 'creative', 'safe']);

            if (!subCmd || subCmd === 'list') {
                return await reply(toolsetManager.listScenes());
            }

            if (subCmd === 'status') {
                const active = toolsetManager.getActiveScene();
                const sceneTools = toolsetManager.getActiveTools(); // 場景內的工具
                const scene  = SCENE_TOOLSETS[active];

                // 取得所有已安裝的 package 技能（不受場景限制）
                const SkillPackageRegistry = require('../managers/SkillPackageRegistry');
                const allPkgs = SkillPackageRegistry.listSkillPackages({ userDataDir: brain && brain.userDataDir })
                    .filter(p => p.enabled !== false)
                    .map(p => p.id)
                    .sort();

                // 場景內啟用的 vs 場景外（已安裝但目前場景未啟用）
                const sceneSet = new Set(sceneTools);
                const outsideScene = allPkgs.filter(id => !sceneSet.has(id));

                let msg = `${scene ? scene.emoji : '🔧'} **目前場景**: ${active}\n`;
                msg += `📦 **場景內啟用工具** (${sceneTools.length} 個):\n${sceneTools.map(t => `• ${t}`).join('\n')}`;
                if (outsideScene.length > 0) {
                    msg += `\n\n🧩 **已安裝但場景未啟用** (${outsideScene.length} 個):\n${outsideScene.map(t => `• ${t}`).join('\n')}`;
                    msg += `\n\n_使用 \`/toolset <場景名稱>\` 切換場景，或 \`/toolset list\` 查看所有場景。_`;
                }
                return await reply(msg);
            }

            // 切換場景
            if (isGolemAutonomousCall) {
                if (subCmd === 'autonomy') {
                    return await reply(
                        '⛔ [Toolset Guard] Golem 自主流程不可直接切換到 `autonomy`。請先詢問使用者是否同意，並請使用者手動輸入 `/toolset autonomy`。'
                    );
                }
                if (!AUTO_SWITCH_ALLOWLIST.has(subCmd)) {
                    const hint = Array.from(AUTO_SWITCH_ALLOWLIST).join('、');
                    return await reply(
                        `⛔ [Toolset Guard] Golem 自主流程目前僅可自動切換：${hint}。` +
                        `\n若需要切到 \`${subCmd}\`，請先詢問使用者同意後由使用者手動執行。`
                    );
                }
            }

            const result = toolsetManager.switchScene(subCmd);
            if (result && result.success) {
                const active = toolsetManager.getActiveScene();
                const activeTools = toolsetManager.getActiveTools();
                await notifyBrainSystemChange(
                    '工具場景已切換',
                    `toolset_scene=${active}\nactive_tools=${activeTools.join(',')}`
                );
            }
            return await reply(result.message);
        }

        // ── /profile 指令 ────────────────────────────────────────────
        // [Phase 2] Hermes/Honcho-inspired: 使用者模型管理
        if (text === '/profile' || text.startsWith('/profile ')) {
            const subCmd = text.replace(/^\/profile\s*/i, '').trim().toLowerCase();

            if (!brain || !brain.userProfile) {
                return await reply('❌ [Profile] 大腦未初始化，無法存取使用者模型。');
            }

            if (!subCmd || subCmd === 'show') {
                const profile = brain.userProfile.getProfile();
                let output = `👤 **使用者模型** (信心度: ${profile.meta.profileConfidence}%)\n\n`;
                if (profile.identity.knownNames.length > 0) {
                    output += `**稱呼**: ${profile.identity.knownNames.join(' / ')}\n`;
                }
                output += `**溝通風格**: ${profile.communication.tone} | 回覆長度: ${profile.communication.responseLength}\n`;
                if (profile.tech.languages.length > 0) {
                    output += `**技術偏好**: ${profile.tech.languages.join(', ')}\n`;
                }
                if (profile.preferences.topics.length > 0) {
                    output += `**關注主題**: ${profile.preferences.topics.join(', ')}\n`;
                }
                if (profile.milestones.length > 0) {
                    const recent = profile.milestones.slice(-3);
                    output += `\n**最近里程碑**:\n`;
                    recent.forEach(m => output += `• [${m.date.slice(0, 10)}] ${m.content}\n`);
                }
                output += `\n_最後更新: ${profile.updatedAt.slice(0, 16).replace('T', ' ')}_`;
                return await reply(output);
            }

            if (subCmd.startsWith('analyze')) {
                if (!brain.chatLogManager || !brain.chatLogManager._isInitialized) {
                    return await reply('❌ [Profile] ChatLogManager 未就緒。');
                }
                await reply('🔍 正在分析最近對話以更新使用者模型...');
                try {
                    const recentLogs = await brain.chatLogManager.readRecentHourlyAsync(200, 5000);
                    const extracted  = await brain.profileUser(recentLogs);
                    const keys = Object.keys(extracted).filter(k => extracted[k] !== null);
                    return await reply(
                        `✅ **使用者模型已更新！**\n發現 ${keys.length} 個新特徵：${keys.join(', ') || '（無變化）'}`
                    );
                } catch (e) {
                    return await reply(`❌ 分析失敗: ${e.message}`);
                }
            }

            return await reply('🔍 用法：`/profile` (查看) | `/profile analyze` (分析最近對話)');
        }

        // ── /api 指令 (OpenAI-Compatible Server) ────────────────────────────────────────────
        if (text === '/api' || text.startsWith('/api ')) {
            const subCmd = text.replace(/^\/api\s*/i, '').trim().toLowerCase();
            
            if (subCmd === 'start') {
                if (this.apiServer) {
                    return await reply('ℹ️ [API] 伺服器已經在執行中。');
                }
                const OpenAIServer = require('../server/OpenAIServer');
                this.apiServer = new OpenAIServer({
                    port: process.env.OPENAI_API_PORT || 3000,
                    modelAlias: 'golem-v9',
                    onRequest: (log) => {
                        // 這裡可以考慮將 log 即時輸出到對話，但可能會太洗頻
                        console.log(log);
                    }
                });
                await reply('⏳ 正在啟動 OpenAI-Compatible API 伺服器...');
                try {
                    const url = await this.apiServer.start();
                    return await reply(`✅ **API 伺服器啟動成功**\n\n🔌 Endpoint: \`${url}/chat/completions\`\n🤖 支援模型: \`golem-v9\`\n\n_現在您可以讓其他工具 (如 Claude Code) 連接此位址來使用 Golem 的智能！_`);
                } catch (e) {
                    this.apiServer = null;
                    return await reply(`❌ 啟動失敗: ${e.message}`);
                }
            }

            if (subCmd === 'stop') {
                if (!this.apiServer) {
                    return await reply('ℹ️ [API] 伺服器並未執行。');
                }
                this.apiServer.stop();
                this.apiServer = null;
                return await reply('🛑 **API 伺服器已關閉**');
            }

            if (subCmd === 'status') {
                if (this.apiServer) {
                    return await reply(`🟢 **API 伺服器正在執行**\n🔌 Endpoint: \`http://localhost:${this.apiServer.port}/v1\``);
                } else {
                    return await reply('🔴 **API 伺服器未啟動**');
                }
            }

            return await reply('🔍 用法：`/api start` | `/api stop` | `/api status`');
        }

        // ── /feedback 指令 (RL Data Collection) ─────────────────────────────────────────
        if (text === '/feedback' || text.startsWith('/feedback ')) {
            const subCmd = text.replace(/^\/feedback\s*/i, '').trim().toLowerCase();
            const rlCollector = require('../utils/RLDataCollector');
            
            if (subCmd === 'good' || subCmd === 'positive') {
                await reply('⏳ 正在擷取會話特徵並記錄正向樣本...');
                const success = await rlCollector.recordPositive(brain);
                return await reply(success ? '✅ **已經記錄為 Positive RL 樣本**\n謝謝您的回饋，這將有助於 Golem 的未來認知微調！' : '❌ 樣本記錄失敗');
            }

            if (subCmd === 'bad' || subCmd === 'negative') {
                await reply('⏳ 正在擷取會話特徵並記錄負面樣本...');
                const success = await rlCollector.recordNegative(brain);
                return await reply(success ? '📉 **已經記錄為 Negative RL 樣本**\n這些反直覺或失敗的軌跡，將作為模型學習避免錯誤的關鍵資料！' : '❌ 樣本記錄失敗');
            }

            return await reply('🔍 用法：`/feedback good` (優良對話) | `/feedback bad` (需要改進)');
        }

        return false;
    }
}

module.exports = NodeRouter;
