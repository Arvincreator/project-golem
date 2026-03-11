/**
 * 🦞 Project Golem v9.0.6 (Multi-Golem Edition)
 * -------------------------------------------------------------------------
 * 架構：[Universal Context] -> [Conversation Queue] -> [NeuroShunter] <==> [Web Gemini]
 * * 🎯 V9.0.6 核心升級：
 * 1. 🧬 記憶轉生系統 (Memory Reincarnation): 支援無限期延續對話上下文，自動重置底層 Web 會話。
 * 2. 🔌 Telegram Topic 支援: 修正在 Forum 模式下的精準回覆。
 * 3. 🚑 輕量級 SOS 急救: 不重啟進程，單純物理刪除污染快取，觸發 DOM Doctor 無縫修復。
 * 4. 🧠 智慧指令引擎: Node.js 原生支援解析結構化技能，自動處理 Bash 引號跳脫防呆。
 * 5. 🔗 強韌神經連結 (v2): 徹底修復 APPROVE 授權後的結果斷鏈問題，確保 [System Observation] 必定回傳。
 * 6. 🔄 物理重生指令 (/new): 強制導回 Gemini 根目錄以開啟全新對話，並清除狀態快取。
 * 7. 💥 徹底轉生指令 (/new_memory): 物理清空底層 DB 並重置對話。
 * 8. 🤖 實體模型切換 (/model): 根據最新版 Web UI，實體操作切換 Fast / Thinking / Pro。
 * 9. 👯 雙子多開架構 (Multi-Golem): 支援多重實例，依頻道分流獨立瀏覽器與記憶。
 * * [保留功能] 
 * - ⚡ 非同步部署 (Async Deployment)
 * - 🛡️ 全域錯誤防護 (Global Error Guard)
 * - 🧠 深度整合 Introspection
 * - v9.0 所有功能 (InteractiveMultiAgent, WebSkillEngine)
 */
const fs_sync = require('fs');
const path_sync = require('path');

// ── 首次啟動自動初始化 .env ────────────────────────────────────────────────
const envPath = path_sync.resolve(__dirname, '.env');
const envExamplePath = path_sync.resolve(__dirname, '.env.example');
if (!fs_sync.existsSync(envPath) && fs_sync.existsSync(envExamplePath)) {
    fs_sync.copyFileSync(envExamplePath, envPath);
    console.log('📋 [Bootstrap] .env 不存在，已從 .env.example 複製初始設定檔。');
    console.log('🌐 [Bootstrap] 請前往 http://localhost:3000/dashboard 完成初始化設定。');
}

try {
    require('dotenv').config({ override: true });
} catch (e) {
    console.error('⚠️ [Bootstrap] 尚未安裝依賴套件 (dotenv)。請確保已執行 npm install。');
}

process.on('uncaughtException', (err) => {
    console.error('🔥 [CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [WARNING] Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

// Dashboard 強制啟用
try {
    require('./dashboard');
    console.log('✅ Golem Web Dashboard 已啟動 → http://localhost:' + (process.env.DASHBOARD_PORT || 3000));
} catch (e) {
    console.error('❌ 無法載入 Dashboard:', e.message);
}

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
// [GrammyBridge] Factory: auto-selects grammY or legacy based on golem-config.xml
const { createTelegramBot } = require('./src/bridges/TelegramBotFactory');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const ConfigManager = require('./src/config');
const SystemLogger = require('./src/utils/SystemLogger');

// 🚀 初始化系統日誌持久化已移至 ensureCoreServices (按需啟動)

const GolemBrain = require('./src/core/GolemBrain');
const TaskController = require('./src/core/TaskController');
const AutonomyManager = require('./src/managers/AutonomyManager');
const ConversationManager = require('./src/core/ConversationManager');
const NeuroShunter = require('./src/core/NeuroShunter');
const NodeRouter = require('./src/core/NodeRouter');
const UniversalContext = require('./src/core/UniversalContext');
const OpticNerve = require('./src/services/OpticNerve');
const SystemUpgrader = require('./src/managers/SystemUpgrader');
const InteractiveMultiAgent = require('./src/core/InteractiveMultiAgent');
const introspection = require('./src/services/Introspection');
const ActionQueue = require('./src/core/ActionQueue'); // ✨ [v9.1] Dual-Queue Architecture

// 🎯 V9.0.7 解耦：不再於啟動時遍歷配置建立 Bot 與實體
// TelegramBot 與 Golem 實體將由 Web Dashboard 透過 golemFactory 動態建立
const telegramBots = new Map();
const discordBots = new Map();
const activeGolems = new Map();

// ✅ [Bug #6 修復] 啟動時間戳記，用於過濾重啟前的舊訊息
const BOOT_TIME = Date.now();

const dcClient = ConfigManager.CONFIG.DC_TOKEN ? new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
}) : null;

// ==========================================
// 🧠 雙子管弦樂團 (Golem Orchestrator)
// ==========================================
function getOrCreateGolem(golemId) {
    if (activeGolems.has(golemId)) return activeGolems.get(golemId);

    console.log(`\n================================`);
    console.log(`🧬 [Orchestrator] 孕育新實體: ${golemId}`);
    console.log(`================================\n`);

    const brain = new GolemBrain({
        golemId,
        userDataDir: ConfigManager.GOLEM_MODE === 'SINGLE' ? ConfigManager.MEMORY_BASE_DIR : path.join(ConfigManager.MEMORY_BASE_DIR, golemId),
        logDir: ConfigManager.LOG_BASE_DIR,
        isSingleMode: ConfigManager.GOLEM_MODE === 'SINGLE'
    });
    const controller = new TaskController({ golemId });
    const autonomy = new AutonomyManager(brain, controller, brain.memoryDriver, { golemId });

    // 獲取該實體的配置 (用於自定義介入等級等)
    const config = ConfigManager.GOLEMS_CONFIG.find(g => g.id === golemId) || {};
    const interventionLevel = config.interventionLevel || ConfigManager.CONFIG.INTERVENTION_LEVEL;

    const convoManager = new ConversationManager(brain, NeuroShunter, controller, {
        golemId,
        interventionLevel
    });

    const actionQueue = new ActionQueue({ golemId }); // ✨ [v9.1] Action Queue 初始化

    const boundBot = telegramBots.get(golemId) || (telegramBots.size > 0 ? telegramBots.values().next().value : null);
    const boundDcBot = discordBots.get(golemId) || (discordBots.size > 0 ? discordBots.values().next().value : null);

    autonomy.setIntegrations(boundBot, boundDcBot || dcClient, convoManager);
    brain.tgBot = boundBot; // expose for dashboard notifications
    brain.dcBot = boundDcBot || dcClient;

    const instance = { brain, controller, autonomy, convoManager, actionQueue }; // ✨ [v9.1] 注入 actionQueue
    activeGolems.set(golemId, instance);
    return instance;
}

(async () => {
    if (process.env.GOLEM_TEST_MODE === 'true') { console.log('🚧 GOLEM_TEST_MODE active.'); return; }

    // 🎯 V9.0.7 解耦：啟動時不再遍歷建立 initialGolems
    // 也延後架構掃描與巡檢，直到第一個實體啟動
    let _isCoreInitialized = false;
    async function ensureCoreServices() {
        if (_isCoreInitialized) return;

        // 🚀 初始化系統日誌持久化 (按需啟動)
        SystemLogger.init(ConfigManager.LOG_BASE_DIR);
        if (ConfigManager.GOLEM_MODE === 'SINGLE') {
            console.log('📡 [Config] 運行模式: 單機 (GOLEM_MODE=SINGLE)');
        } else {
            console.log(`📡 [Config] 運行模式: 多機 (${ConfigManager.GOLEMS_CONFIG.length} 實體)`);
        }

        console.log('🧠 [Introspection] Scanning project structure...');
        await introspection.getStructure().catch(e => console.warn('⚠️ Introspection failed:', e.message));

        // 啟動排程器
        setInterval(runTieredCompression, 6 * 60 * 60 * 1000);
        runTieredCompression();

        if (dcClient) dcClient.login(ConfigManager.CONFIG.DC_TOKEN);

        _isCoreInitialized = true;
    }
    const fsSync = require('fs');
    fsSync.watch(process.cwd(), async (eventType, filename) => {
        if (filename === '.reincarnate_signal.json') {
            try {
                if (!fsSync.existsSync('.reincarnate_signal.json')) return;
                const signalRaw = fsSync.readFileSync('.reincarnate_signal.json', 'utf-8');
                const { summary } = JSON.parse(signalRaw);
                fsSync.unlinkSync('.reincarnate_signal.json');
                console.log("🔄 [系統] 啟動記憶轉生程序！正在開啟新對話...");
                for (const [id, instance] of activeGolems.entries()) {
                    if (instance.brain.page) {
                        console.log(`🚀 [System] Browser Session Started (Golem: ${id})`);
                        await instance.brain.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
                    }
                    const wakeUpPrompt = `【系統重啟初始化：記憶轉生】\n請遵守你的核心設定(Project Golem [${id}])。你剛進行了會話重置以釋放記憶體。\n以下是你上一輪對話留下的【記憶摘要】：\n${summary}\n\n請根據上述摘要，向使用者打招呼，並嚴格包含以下這段話（或類似語氣）：\n「🔄 對話視窗已成功重啟，並載入了剛剛的重點記憶！不過老實說，重啟過程可能會讓我忘記一些瑣碎的小細節，如果接下來我有漏掉什麼，請隨時提醒我喔！」`;
                    if (instance.brain.sendMessage) {
                        await instance.brain.sendMessage(wakeUpPrompt);
                    }
                }
            } catch (error) {
                console.error("❌ 轉生過程發生錯誤:", error);
            }
        }
    });

    const dashboard = require('./dashboard');
    if (dashboard && dashboard.webServer && typeof dashboard.webServer.setGolemFactory === 'function') {
        // [GrammyBridge] Use factory instead of direct TelegramBot constructor
        dashboard.webServer.setGolemFactory(async (golemConfig) => {
            if (activeGolems.has(golemConfig.id)) {
                console.log(`⚠️ [Factory] Golem [${golemConfig.id}] already exists, skipping.`);
                return activeGolems.get(golemConfig.id);
            }
            if (golemConfig.tgToken && !telegramBots.has(golemConfig.id)) {
                try {
                    // [V9.0.8 修正] 先以 polling: false 建立 Bot，
                    // 再延遲啟動 Polling 並使用 restart:true 讓舊 session 自動讓步，防止 409 Conflict
                    const bot = createTelegramBot(golemConfig.tgToken, { polling: false });
                    bot.golemConfig = golemConfig;
                    bot.getMe().then(me => {
                        bot.username = me.username;
                        console.log(`🤖 [Bot] ${golemConfig.id} 已掛載 (@${me.username})`);
                    }).catch(e => {
                        if (!e.message.includes('401')) {
                            console.warn(`⚠️ [Bot] ${golemConfig.id}:`, e.message);
                        }
                    });
                    telegramBots.set(golemConfig.id, bot);

                    // ✅ [Bug #1 修復] 在 factory 內部動態綁定事件，確保動態建立的 Bot 也能接收訊息
                    const boundGolemId = golemConfig.id;
                    bot.on('message', async (msg) => {
                        try {
                            await handleUnifiedMessage(new UniversalContext('telegram', msg, bot), boundGolemId);
                        } catch (e) {
                            console.error(`❌ [TG ${boundGolemId}] Message Handler Error:`, e);
                        }
                    });
                    bot.on('callback_query', async (query) => {
                        try {
                            await bot.answerCallbackQuery(query.id);
                        } catch (e) {
                            console.warn(`⚠️ [TG ${boundGolemId}] Callback Answer Warning: ${e.message}`);
                        }
                        try {
                            await handleUnifiedCallback(
                                new UniversalContext('telegram', query, bot),
                                query.data,
                                boundGolemId
                            );
                        } catch (e) {
                            console.error(`❌ [TG ${boundGolemId}] Callback Handler Error:`, e);
                        }
                    });
                    console.log(`🔗 [Factory] TG events bound for Golem [${boundGolemId}]`);

                    // [V9.0.8] 409 衝突自動修復：若偵測到 session conflict，5 秒後自動重啟 Polling
                    let _pollingRestartTimer = null;
                    bot.on('polling_error', (err) => {
                        if (err.code === 'ETELEGRAM' && err.message.includes('409')) {
                            if (_pollingRestartTimer) return; // 防止重複觸發
                            console.warn(`⚠️ [Bot] ${boundGolemId} 偵測到 409 Conflict，5 秒後自動重連...`);
                            _pollingRestartTimer = setTimeout(async () => {
                                _pollingRestartTimer = null;
                                try { await bot.stopPolling(); } catch (e) { }
                                await new Promise(r => setTimeout(r, 1000));
                                try {
                                    bot.startPolling({ restart: true });
                                    console.log(`✅ [Bot] ${boundGolemId} Polling 已自動恢復。`);
                                } catch (e) {
                                    console.error(`❌ [Bot] ${boundGolemId} 自動重啟 Polling 失敗:`, e.message);
                                }
                            }, 5000);
                        }
                    });

                    // [V9.0.8 保留] 409 衝突自動修復機制，但不再於此處強制提早啟動 polling
                    // polling 將在 persona.json 存在且 brain.init() 完成後統一啟動
                } catch (e) {
                    console.error(`❌ [Bot] 初始化 ${golemConfig.id} Telegram 失敗:`, e.message);
                }
            }

            if (golemConfig.dcToken && !discordBots.has(golemConfig.id)) {
                try {
                    const client = new Client({
                        intents: [
                            GatewayIntentBits.Guilds,
                            GatewayIntentBits.GuildMessages,
                            GatewayIntentBits.MessageContent,
                            GatewayIntentBits.DirectMessages
                        ],
                        partials: [Partials.Channel]
                    });
                    client.golemConfig = golemConfig;
                    client.once('ready', () => {
                        console.log(`🤖 [Bot] ${golemConfig.id} Discord 已掛載 (${client.user ? client.user.tag : 'Unknown'})`);
                    });

                    // Bind per-golem Discord events directly to the global handler but force the targetId
                    client.on('messageCreate', (msg) => {
                        if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, client), golemConfig.id);
                    });
                    client.on('interactionCreate', (interaction) => {
                        if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, client), interaction.customId, golemConfig.id);
                    });

                    client.login(golemConfig.dcToken).catch(e => {
                        console.warn(`⚠️ [Bot] ${golemConfig.id} Discord Login Failed:`, e.message);
                    });
                    discordBots.set(golemConfig.id, client);
                } catch (e) {
                    console.error(`❌ [Bot] 初始化 ${golemConfig.id} Discord 失敗:`, e.message);
                }
            }

            const instance = getOrCreateGolem(golemConfig.id);
            await ensureCoreServices();
            if (typeof instance.brain._linkDashboard === 'function') {
                instance.brain._linkDashboard();
            }

            // [V9.0.9 Fix]: Verify persona.json to decide actual status
            const pathSync = require('path');
            const fsSync = require('fs');
            const isSingleMode = ConfigManager.GOLEM_MODE === 'SINGLE';

            let personaPath;
            if (isSingleMode) {
                personaPath = pathSync.resolve(ConfigManager.MEMORY_BASE_DIR, 'persona.json');
            } else {
                personaPath = pathSync.resolve(ConfigManager.MEMORY_BASE_DIR, golemConfig.id, 'persona.json');
            }

            if (fsSync.existsSync(personaPath)) {
                instance.brain.status = 'running';
                // ✅ [Fix] 確保在 polling 前 brain.init() 已經準備完畢
                await instance.brain.init();
                const tgBot = telegramBots.get(golemConfig.id);
                if (tgBot && tgBot.isPolling && !tgBot.isPolling()) {
                    tgBot.startPolling({ restart: true });
                    console.log(`✅ [Bot] ${golemConfig.id} Telegram Polling 已啟動。`);
                }
            } else {
                instance.brain.status = 'pending_setup';
            }

            instance.autonomy.start();
            console.log(`✅ [Factory] Golem [${golemConfig.id}] started via Web Dashboard.`);
            return instance;
        });
        console.log('🔗 [System] golemFactory injected into WebServer.');
    }

    async function runTieredCompression() {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const year = now.getFullYear();
        console.log(`🕒 [Scheduler] 啟動多層記憶壓縮巡檢...`);
        for (const [id, instance] of activeGolems.entries()) {
            const mgr = instance.brain.chatLogManager;
            if (!mgr) continue;
            console.log(`📦 [LogManager][${id}] 檢查日誌狀態...`);
            if (month === 1 && day === 1 && year % 10 === 0) {
                const lastDecade = mgr._getLastDecadeString();
                mgr.compressEra(lastDecade, instance.brain).catch(err => {
                    console.error(`❌ [Scheduler][${id}] Era 壓縮失敗: ${err.message}`);
                });
            }
        }
    }

    console.log(`✅ Project Golem Management Dashboard is Online. (Ready to start instances)`);
})();

async function handleUnifiedMessage(ctx, forceTargetId = null) {
    const msgTime = ctx.messageTime;
    console.log(`[DEBUG] msgTime: ${msgTime}, BOOT_TIME: ${BOOT_TIME}, diff: ${msgTime - BOOT_TIME}`);
    // 允許 60 秒的時鐘誤差，防止伺服器時間稍快於通訊軟體伺服器時間導致新訊息被判定為舊訊息
    if (msgTime && msgTime < (BOOT_TIME - 60000)) {
        console.log(`[MessageManager] 忽略重啟前的舊訊息 (Golem: ${forceTargetId || 'golem_A'}, Diff: ${msgTime - BOOT_TIME}ms)`);
        return;
    }

    // [Multi-Golem 分流器]
    // 優先使用來源機器人強制的 Target ID，若無則預設為單例 `golem_A`
    let targetId = forceTargetId || 'golem_A';

    const instance = getOrCreateGolem(targetId);
    const { brain, controller, autonomy, convoManager } = instance;

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/sos') {
        try {
            const fsSync = require('fs');

            const targetFiles = [
                path.join(os.homedir(), 'project-golem', 'golem_selectors.json'),
                path.join(process.cwd(), 'golem_selectors.json'),
                path.join(process.cwd(), 'selectors.json'),
                path.join(process.cwd(), 'src', 'core', 'selectors.json')
            ];

            let isDeleted = false;
            for (const file of targetFiles) {
                if (fsSync.existsSync(file)) {
                    fsSync.unlinkSync(file);
                    console.log(`🗑️ [SOS] 已刪除污染檔案: ${file}`);
                    isDeleted = true;
                }
            }

            if (isDeleted) {
                await ctx.reply("✅ 毒蘋果 (選擇器快取) 已成功刪除！\n不用重啟，請直接跟我說話，我會觸發 DOM Doctor 自動重抓乾淨的選擇器。");
            } else {
                await ctx.reply("⚠️ 找不到污染的快取檔案，它可能已經是乾淨狀態了。");
            }
        } catch (e) {
            await ctx.reply(`❌ 緊急刪除失敗: ${e.message}`);
        }
        return;
    }

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/new') {
        await ctx.reply("🔄 收到 /new 指令！正在為您開啟全新的大腦對話神經元...");
        try {
            if (brain.page) {
                await brain.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
                await brain.init(true);
                await ctx.reply("✅ 物理重置完成！已經為您切斷舊有記憶，現在這是一個全新且乾淨的 Golem 實體。");
            } else {
                await ctx.reply("⚠️ 找不到活躍的網頁視窗，無法執行物理重置。");
            }
        } catch (e) {
            await ctx.reply(`❌ 物理重置失敗: ${e.message}`);
        }
        return;
    }

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/new_memory') {
        await ctx.reply("💥 收到 /new_memory 指令！正在為您物理清空底層 DB 並執行深度轉生...");
        try {
            if (brain.memoryDriver && typeof brain.memoryDriver.clearMemory === 'function') {
                await brain.memoryDriver.clearMemory();
            }
            if (brain.page) {
                await brain.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
                await brain.init(true);
                await ctx.reply("✅ 記憶庫 DB 已徹底清空格式化！網頁也已重置，這是一個 100% 空白、無任何歷史包袱的 Golem 實體。");
            } else {
                await ctx.reply("⚠️ 找不到活躍的網頁視窗。");
            }
        } catch (e) {
            await ctx.reply(`❌ 深度轉生失敗: ${e.message}`);
        }
        return;
    }

    // ✨ [新增] /model 指令實作
    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase().startsWith('/model')) {
        const args = ctx.text.trim().split(/\s+/);
        const targetModel = args[1] ? args[1].toLowerCase() : '';

        // 根據截圖防呆，只允許 fast, thinking, pro
        if (!['fast', 'thinking', 'pro'].includes(targetModel)) {
            await ctx.reply("ℹ️ 請輸入正確的模組關鍵字，例如：\n`/model fast` (回答速度快)\n`/model thinking` (具備深度思考)\n`/model pro` (進階程式碼與數學能力)");
            return;
        }

        await ctx.reply(`🔄 啟動視覺神經，嘗試為您操作網頁切換至 [${targetModel}] 模式...`);
        try {
            if (typeof brain.switchModel === 'function') {
                const result = await brain.switchModel(targetModel);
                await ctx.reply(result);
            } else {
                await ctx.reply("⚠️ 您的 GolemBrain 尚未掛載 switchModel 功能，請確認檔案是否已更新。");
            }
        } catch (e) {
            await ctx.reply(`❌ 切換模組失敗: ${e.message}`);
        }
        return;
    }

    // ✨ [新增] /enable_silent & /disable_silent 指令實作 (僅限 CHAT 模式)
    if (ctx.authMode === 'CHAT' && ctx.isAdmin && ctx.text && (ctx.text.trim().toLowerCase().startsWith('/enable_silent') || ctx.text.trim().toLowerCase().startsWith('/disable_silent'))) {
        const lowerRaw = ctx.text.trim().toLowerCase();
        const isEnable = lowerRaw.startsWith('/enable_silent');
        const args = ctx.text.trim().split(/\s+/);
        // 指令格式現在是 /enable_silent @bot_username
        const targetBotTag = args[1] || "";
        const targetBotUsername = targetBotTag.startsWith('@') ? targetBotTag.substring(1).toLowerCase() : targetBotTag.toLowerCase();

        if (!targetBotTag) {
            const currentBotUsername = ctx.instance.username ? `@${ctx.instance.username}` : `@${targetId}`;
            await ctx.reply(`ℹ️ 請指定目標 Bot ID，例如：\n \`${isEnable ? '/enable_silent' : '/disable_silent'} ${currentBotUsername}\``);
            return;
        }

        // 比對 Bot Username (忽略大小寫)
        if (ctx.instance.username && targetBotUsername !== ctx.instance.username.toLowerCase()) {
            // 如果不是發給當前 Bot Username，則忽略
            return;
        } else if (!ctx.instance.username && targetBotUsername !== targetId.toLowerCase()) {
            // 備援方案：若尚未獲取 Username，則比對 Golem ID
            return;
        }

        convoManager.silentMode = isEnable;
        if (isEnable) convoManager.observerMode = false; // 開啟全靜默時關閉觀察者

        const displayName = ctx.instance.username ? `@${ctx.instance.username}` : `[${targetId}]`;
        if (isEnable) {
            await ctx.reply(`🤫 ${displayName} 已進入「完全靜默模式」。\n我將暫時關閉感知，且不會記錄任何對話。`);
        } else {
            await ctx.reply(`📢 ${displayName} 已解除靜默模式。`);
        }
        return;
    }

    // ✨ [新增] /enable_observer & /disable_observer 指令實作 (僅限 CHAT 模式)
    if (ctx.authMode === 'CHAT' && ctx.isAdmin && ctx.text && (ctx.text.trim().toLowerCase().startsWith('/enable_observer') || ctx.text.trim().toLowerCase().startsWith('/disable_observer'))) {
        const lowerRaw = ctx.text.trim().toLowerCase();
        const isEnable = lowerRaw.startsWith('/enable_observer');
        const args = ctx.text.trim().split(/\s+/);
        const targetBotTag = args[1] || "";
        const targetBotUsername = targetBotTag.startsWith('@') ? targetBotTag.substring(1).toLowerCase() : targetBotTag.toLowerCase();

        if (!targetBotTag) {
            const currentBotUsername = ctx.instance.username ? `@${ctx.instance.username}` : `@${targetId}`;
            await ctx.reply(`ℹ️ 請指定目標 Bot ID，例如：\n \`${isEnable ? '/enable_observer' : '/disable_observer'} ${currentBotUsername}\``);
            return;
        }

        if (ctx.instance.username && targetBotUsername !== ctx.instance.username.toLowerCase()) return;
        else if (!ctx.instance.username && targetBotUsername !== targetId.toLowerCase()) return;

        convoManager.observerMode = isEnable;
        if (isEnable) convoManager.silentMode = false; // 開啟觀察者時關閉全靜默

        const displayName = ctx.instance.username ? `@${ctx.instance.username}` : `[${targetId}]`;
        if (isEnable) {
            await ctx.reply(`👁️ ${displayName} 已進入「觀察者模式」。\n我會安靜地同步所有對話上下文，但預設不發言。`);
        } else {
            await ctx.reply(`📢 ${displayName} 已解除觀察者模式。`);
        }
        return;
    }

    if (global.multiAgentListeners && global.multiAgentListeners.has(ctx.chatId)) {
        const callback = global.multiAgentListeners.get(ctx.chatId);
        callback(ctx.text);
        return;
    }

    if (ctx.text && ['恢復會議', 'resume', '繼續會議'].includes(ctx.text.toLowerCase())) {
        if (InteractiveMultiAgent.canResume(ctx.chatId)) {
            await InteractiveMultiAgent.resumeConversation(ctx, brain);
            return;
        }
    }

    if (!ctx.text && !ctx.getAttachment) return;
    if (!ctx.isAdmin) return;
    if (await NodeRouter.handle(ctx, brain)) return;

    const lowerText = ctx.text ? ctx.text.toLowerCase() : '';
    if (autonomy.pendingPatch) {
        if (['ok', 'deploy', 'y', '部署'].includes(lowerText)) return executeDeploy(ctx, targetId);
        if (['no', 'drop', 'n', '丟棄'].includes(lowerText)) return executeDrop(ctx, targetId);
    }

    if (lowerText.startsWith('/patch') || lowerText.includes('優化代碼')) {
        await autonomy.performSelfReflection(ctx);
        return;
    }

    await ctx.sendTyping();
    try {
        let finalInput = ctx.text;
        const attachment = await ctx.getAttachment();

        // ✨ [群組模式身分與回覆注入]
        const isGroupMode = ConfigManager.CONFIG.TG_AUTH_MODE === 'CHAT' && ctx.platform === 'telegram';
        let senderPrefix = isGroupMode ? `【發話者：${ctx.senderName}】\n` : "";
        if (ctx.replyToName) {
            senderPrefix += `【回覆給：${ctx.replyToName}】\n`;
        }

        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve 分析檔案...");
            const apiKey = await brain.doctor.keyChain.getKey();
            if (apiKey) {
                const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, apiKey);
                finalInput = `${senderPrefix}【系統通知：視覺訊號】\n檔案類型：${attachment.mimeType}\n分析報告：\n${analysis}\n使用者訊息：${ctx.text || ""}\n請根據分析報告回應。`;
            } else {
                await ctx.reply("⚠️ 視覺系統暫時過熱 (API Rate Limit)，無法分析圖片，將僅處理文字訊息。");
                finalInput = senderPrefix + (ctx.text || "");
            }
        } else {
            finalInput = senderPrefix + (ctx.text || "");
        }

        if (!finalInput && !attachment) return;
        await convoManager.enqueue(ctx, finalInput);
    } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }
}

async function handleUnifiedCallback(ctx, actionData, forceTargetId = null) {
    if (ctx.platform === 'discord' && ctx.isInteraction) {
        try {
            await ctx.event.deferReply({ flags: 64 });
        } catch (e) {
            console.error('Callback Discord deferReply Error:', e.message);
        }
    }

    if (!ctx.isAdmin) return;

    // 解析 GolemId (如果是 PATCH 相關)
    let targetId = forceTargetId || 'golem_A';
    if (actionData.startsWith('PATCH_DEPLOY_')) {
        targetId = actionData.split('PATCH_DEPLOY_')[1];
        return executeDeploy(ctx, targetId);
    }
    if (actionData.startsWith('PATCH_DROP_')) {
        targetId = actionData.split('PATCH_DROP_')[1];
        return executeDrop(ctx, targetId);
    }

    const { brain, controller, convoManager } = getOrCreateGolem(targetId);
    const pendingTasks = controller.pendingTasks;
    if (actionData === 'SYSTEM_FORCE_UPDATE') return SystemUpgrader.performUpdate(ctx);
    if (actionData === 'SYSTEM_UPDATE_CANCEL') return await ctx.reply("已取消更新操作。");

    if (actionData.includes('_')) {
        const [action, taskId] = actionData.split('_');
        const task = pendingTasks.get(taskId);
        if (!task) return await ctx.reply('⚠️ 任務已失效');

        // ✨ [v9.1] 處理【大腦對話佇列】插隊系統的 Callback (DIALOGUE_QUEUE_APPROVAL)
        if (task.type === 'DIALOGUE_QUEUE_APPROVAL') {
            pendingTasks.delete(taskId);

            try {
                if (ctx.platform === 'telegram' && ctx.event.message) {
                    await ctx.instance.editMessageText(
                        `🚨 **大腦思考中**\n目前對話佇列繁忙。\n\n*(使用者已選擇：${action === 'DIAPRIORITY' ? '⬆️ 急件插隊' : '⬇️ 正常排隊'})*`,
                        {
                            chat_id: ctx.chatId,
                            message_id: ctx.event.message.message_id,
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: [] }
                        }
                    ).catch(() => { });
                }
            } catch (e) { console.warn("無法更新大腦插隊詢問訊息:", e.message); }

            const { convoManager } = getOrCreateGolem(targetId);
            const isPriority = action === 'DIAPRIORITY';

            // 重新入隊處理對話
            if (convoManager) {
                convoManager._actualCommit(task.ctx, task.text, isPriority);
            }
            return;
        }

        if (action === 'DENY') {
            pendingTasks.delete(taskId);
            await ctx.reply('🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            const { steps, nextIndex } = task;
            pendingTasks.delete(taskId);

            await ctx.reply("✅ 授權通過，執行中 (這可能需要幾秒鐘)...");
            const approvedStep = steps[nextIndex];

            let cmd = "";

            if (approvedStep.action === 'command' || approvedStep.cmd || approvedStep.parameter || approvedStep.command) {
                cmd = approvedStep.cmd || approvedStep.parameter || approvedStep.command || "";
            }
            else if (approvedStep.action && approvedStep.action !== 'command') {
                const actionName = String(approvedStep.action).toLowerCase().replace(/_/g, '-');
                let payload = "";
                if (approvedStep.summary) payload = String(approvedStep.summary);
                else if (approvedStep.args) payload = typeof approvedStep.args === 'string' ? approvedStep.args : JSON.stringify(approvedStep.args);
                else {
                    // 防呆：如果沒有 args 也沒有 summary，則將扣除 action 以外的所有欄位封裝為 JSON
                    const { action, ...params } = approvedStep;
                    payload = JSON.stringify(params);
                }

                const safePayload = payload.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
                cmd = `node src/skills/core/${actionName}.js "${safePayload}"`;
                console.log(`🔧 [Command Builder] 成功將結構化技能 [${actionName}] 組裝為安全指令`);
            }

            if (!cmd && task.rawText) {
                const match = task.rawText.match(/node\s+src\/skills\/lib\/[a-zA-Z0-9_-]+\.js\s+.*?(?="|\n|$)/);
                if (match) {
                    cmd = match[0];
                    console.log(`🔧 [Auto-Fix] 已從破裂的 JSON 原始內容中硬挖出指令`);
                }
            }

            if (!cmd) {
                await ctx.reply("⚠️ 解析失敗：無法辨認指令格式。請重新對 Golem 下達指令。");
                return;
            }

            if (cmd.includes('reincarnate.js')) {
                await ctx.reply("🔄 收到轉生指令！正在將記憶注入核心並準備重啟大腦...");
                const { exec } = require('child_process');
                exec(cmd);
                return;
            }

            const util = require('util');
            const execPromise = util.promisify(require('child_process').exec);

            // ✨ [v9.1] 將物理操作封裝並丟入行動產線 (Action Queue)
            const actionQueue = getOrCreateGolem(targetId).actionQueue;

            await actionQueue.enqueue(ctx, async () => {
                let execResult = "";
                let finalOutput = "";
                try {
                    const { stdout, stderr } = await execPromise(cmd, { timeout: 45000, maxBuffer: 1024 * 1024 * 10 });
                    finalOutput = (stdout || stderr || "✅ 指令執行成功，無特殊輸出").trim();
                    execResult = `[Step ${nextIndex + 1} Success] cmd: ${cmd}\nResult:\n${finalOutput}`;
                    console.log(`✅ [Executor] 成功捕獲終端機輸出 (${finalOutput.length} 字元)`);
                } catch (e) {
                    finalOutput = `Error: ${e.message}\n${e.stderr || ''}`;
                    execResult = `[Step ${nextIndex + 1} Failed] cmd: ${cmd}\nResult:\n${finalOutput}`;
                    console.error(`❌ [Executor] 執行錯誤: ${e.message}`);
                }

                const MAX_LENGTH = 15000;
                if (execResult.length > MAX_LENGTH) {
                    execResult = execResult.substring(0, MAX_LENGTH) + `\n\n... (為保護記憶體，內容已截斷，共省略 ${execResult.length - MAX_LENGTH} 字元) ...`;
                    console.log(`✂️ [System] 執行結果過長，已自動截斷為 ${MAX_LENGTH} 字元。`);
                }

                let remainingResult = "";
                try {
                    remainingResult = await controller.runSequence(ctx, steps, nextIndex + 1) || "";
                } catch (err) {
                    console.warn(`⚠️ [System] 執行後續步驟時發生警告: ${err.message}`);
                }

                const observation = [execResult, remainingResult].filter(Boolean).join('\n\n----------------\n\n');

                if (observation) {
                    await ctx.reply(`📤 指令執行完畢 (共抓取 ${finalOutput.length} 字元)！將結果放入對話隊列 (Dialogue Queue) 等待大腦分析...`);

                    const feedbackPrompt = `[System Observation]\nUser approved actions.\nExecution Result:\n${observation}\n\nPlease analyze this result and report to the user using [GOLEM_REPLY].`;
                    try {
                        // ✨ [v9.1] 產線串接：將加工完成的 Observation 放入對話產線 (Dialogue Queue) 取代直接呼叫 sendMessage
                        const convoManager = getOrCreateGolem(targetId).convoManager;
                        if (convoManager) {
                            await convoManager.enqueue(ctx, feedbackPrompt, { isPriority: true, bypassDebounce: true });
                        } else {
                            // 防呆：如果退化回沒有 convoManager，則走舊路
                            const finalResponse = await brain.sendMessage(feedbackPrompt);
                            await NeuroShunter.dispatch(ctx, finalResponse, brain, controller);
                        }
                    } catch (err) {
                        await ctx.reply(`❌ 傳送結果回大腦時發生異常：${err.message}`);
                    }
                }
            });
        }
    }
}

global.handleDashboardMessage = handleUnifiedMessage;
global.handleUnifiedCallback = handleUnifiedCallback;

async function executeDeploy(ctx, targetId) {
    const { autonomy, brain } = getOrCreateGolem(targetId);
    if (!autonomy.pendingPatch) return;
    try {
        const { path: patchPath, target: targetPath, name: targetName } = autonomy.pendingPatch;

        try {
            await fs.copyFile(targetPath, `${targetName}.bak-${Date.now()}`);
        } catch (e) { }

        const patchContent = await fs.readFile(patchPath);
        await fs.writeFile(targetPath, patchContent);
        await fs.unlink(patchPath);

        autonomy.pendingPatch = null;
        if (brain && brain.memoryDriver && brain.memoryDriver.recordSuccess) {
            try { await brain.memoryDriver.recordSuccess(); } catch (e) { }
        }
        await ctx.reply(`🚀 [${targetId}] ${targetName} 升級成功！正在重啟...`);
        if (global.gracefulRestart) await global.gracefulRestart();
    } catch (e) { await ctx.reply(`❌ [${targetId}] 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx, targetId) {
    const { autonomy, brain } = getOrCreateGolem(targetId);
    if (!autonomy.pendingPatch) return;
    try {
        await fs.unlink(autonomy.pendingPatch.path);
    } catch (e) { }
    autonomy.pendingPatch = null;
    if (brain && brain.memoryDriver && brain.memoryDriver.recordRejection) {
        try { await brain.memoryDriver.recordRejection(); } catch (e) { }
    }
    await ctx.reply(`🗑️ [${targetId}] 提案已丟棄`);
}

// ✅ [Bug #1 修復] TG Bot 事件綁定已移入 golemFactory 內部動態處理。
// 此靜態迴圈在啟動時 telegramBots 為空，保留為向後相容的空迴圈。
for (const [golemId, bot] of telegramBots.entries()) {
    // (No-op: events are now bound dynamically in golemFactory)
}

if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}

global.gracefulRestart = async function () {
    console.log("🛑 [System] 準備重啟，正在清理資源...");

    // 1. 停止所有 Telegram Bot Polling，防止重啟後出現 409 Conflict
    for (const [id, bot] of telegramBots.entries()) {
        try {
            console.log(`🛑 [System] 正在停止 Telegram Bot [${id}] Polling...`);
            await bot.stopPolling();
            console.log(`✅ [System] Telegram Bot [${id}] Polling 已停止。`);
        } catch (e) {
            console.warn(`⚠️ [System] 停止 Telegram Bot [${id}] Polling 失敗: ${e.message}`);
        }
    }

    // 2. 關閉所有 Puppeteer 瀏覽器實體，釋放 Chrome Profile Lock
    for (const [id, instance] of activeGolems.entries()) {
        if (instance.brain && instance.brain.browser) {
            try {
                console.log(`🛑 [System] 正在關閉 Golem [${id}] 的瀏覽器...`);
                await instance.brain.browser.close();
                console.log(`✅ [System] Golem [${id}] 瀏覽器已關閉。`);
            } catch (e) {
                console.warn(`⚠️ [System] 關閉 Golem [${id}] 瀏覽器失敗: ${e.message}`);
            }
        }
    }

    // 3. 生成子程序並安全退出
    const { spawn } = require('child_process');
    const env = Object.assign({}, process.env, { SKIP_BROWSER: '1' });
    const subprocess = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: 'ignore',
        env: env
    });
    subprocess.unref();
    process.exit(0);
};

module.exports = { activeGolems, getOrCreateGolem };
