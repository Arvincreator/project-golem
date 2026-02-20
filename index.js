/**
 * 🦞 Project Golem v9.0.2 (Integrity Core Edition)
 * -------------------------------------------------------------------------
 * 架構：[Universal Context] -> [Conversation Queue] -> [NeuroShunter] <==> [Web Gemini]
 * * 🎯 V9.0.2 核心升級：
 * 1. 🧬 記憶轉生系統 (Memory Reincarnation): 支援無限期延續對話上下文，自動重置底層 Web 會話。
 * 2. 🔌 Telegram Topic 支援: 修正在 Forum 模式下的精準回覆。
 * * [保留功能]
 * - ⚡ 非同步部署 (Async Deployment): 自我升級不再卡住 Event Loop。
 * - 🛡️ 全域錯誤防護 (Global Error Guard): 防止未捕獲的 Promise 導致崩潰。
 * - 🧠 深度整合 Introspection: 啟動時建立自我結構快取。
 * - v9.0 所有功能 (InteractiveMultiAgent, WebSkillEngine)
 * - KeyChain v2 智慧冷卻機制
 * - Flood Guard 啟動時間過濾
 * - DOM Doctor 自動修復
 */
require('dotenv').config();

// ==========================================
// 🛡️ [v9.0.1 NEW] 全域錯誤防護 (Global Safety Nets)
// ==========================================
process.on('uncaughtException', (err) => {
    console.error('🔥 [CRITICAL] Uncaught Exception:', err);
    // 保持進程存活，避免直接重啟導致 Context 丟失
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [WARNING] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ==========================================
// 📟 儀表板外掛 (Dashboard Switch)
// ==========================================
if (process.argv.includes('dashboard')) {
    try {
        require('./dashboard');
        console.log("✅ 戰術控制台已啟動 (繁體中文版)");
    } catch (e) {
        console.error("❌ 無法載入 Dashboard:", e.message);
    }
} else {
    console.log("ℹ️  以標準模式啟動 (無 Dashboard)。若需介面請輸入 'npm start dashboard'");
}

// ==========================================
const fs = require('fs').promises; // ✨ [v9.0.1 Update] 改為 Promise 版本以支援非同步部署
const path = require('path');
const { spawn } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Import Modules
const { CONFIG } = require('./src/config');
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

// ✨ [v9.0.1 NEW] 整合內省模組
const introspection = require('./src/services/Introspection');

// Initialize Integrations
const tgBot = CONFIG.TG_TOKEN ? new TelegramBot(CONFIG.TG_TOKEN, { polling: true }) : null;
const dcClient = CONFIG.DC_TOKEN ? new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
}) : null;

// Initialize Core Systems
const brain = new GolemBrain();
const controller = new TaskController();
const autonomy = new AutonomyManager(brain, controller, brain.memoryDriver); // Pass dependencies
const convoManager = new ConversationManager(brain, NeuroShunter, controller);

// Setup Autonomy Integrations
autonomy.setIntegrations(tgBot, dcClient, convoManager);

// --- 初始化組件 ---
// ⏱️ [v8.7 保留] Flood Guard - 啟動時間戳記
const BOOT_TIME = Date.now();
console.log(`🛡️ [v8.7 Flood Guard] 系統啟動時間: ${new Date(BOOT_TIME).toLocaleString('zh-TW', { hour12: false })}`);
const pendingTasks = controller.pendingTasks; // Shared reference

// ============================================================
// 🎮 Hydra Main Loop
// ============================================================
(async () => {
    if (process.env.GOLEM_TEST_MODE === 'true') { console.log('🚧 GOLEM_TEST_MODE active.'); return; }
    await brain.init();
    
    // ✨ [v9.0.1 NEW] 啟動時預掃描專案結構，建立快取
    console.log('🧠 [Introspection] Pre-scanning project structure...');
    await introspection.getStructure();

    // ==========================================
    // 🧬 [V9.0.2 新增] Web 記憶轉生接收器 (Memory Reincarnation)
    // ==========================================
    const fsSync = require('fs');
    fsSync.watch(process.cwd(), async (eventType, filename) => {
        if (filename === '.reincarnate_signal.json') {
            try {
                // 確保檔案真的存在，避免重複觸發
                if (!fsSync.existsSync('.reincarnate_signal.json')) return;
                
                const signalRaw = fsSync.readFileSync('.reincarnate_signal.json', 'utf-8');
                const { summary } = JSON.parse(signalRaw);
                fsSync.unlinkSync('.reincarnate_signal.json'); 
                
                console.log("🔄 [系統] 啟動記憶轉生程序！正在開啟新對話...");

                // 物理重置 Web Gemini 視窗
                if (brain.page) {
                    await brain.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
                }

                // 準備注入的甦醒提示詞
                const wakeUpPrompt = `【系統重啟初始化：記憶轉生】\n請遵守你的核心設定(Project Golem)。你剛進行了會話重置以釋放記憶體。\n以下是你上一輪對話留下的【記憶摘要】：\n${summary}\n\n請根據上述摘要，向使用者打招呼，並嚴格包含以下這段話（或類似語氣）：\n「🔄 對話視窗已成功重啟，並載入了剛剛的重點記憶！不過老實說，重啟過程可能會讓我忘記一些瑣碎的小細節，如果接下來我有漏掉什麼，請隨時提醒我喔！」`;

                if (brain.sendMessage) {
                    await brain.sendMessage(wakeUpPrompt); 
                }

            } catch (error) {
                console.error("❌ 轉生過程發生錯誤:", error);
            }
        }
    });

    autonomy.start();
    console.log('✅ Golem v9.0.2 (Integrity Core Edition) is Online.');
    if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();

// ============================================================
// 📨 Event Handlers
// ============================================================

async function handleUnifiedMessage(ctx) {
    // ⏱️ [v8.7 保留] Flood Guard - 忽略離線期間訊息
    const msgTime = ctx.messageTime;
    if (msgTime && msgTime < BOOT_TIME) {
        // console.log(`⏸️ [Flood Guard] 忽略離線訊息 (${new Date(msgTime).toLocaleString('zh-TW')})`);
        return;
    }

    // 🚨 ==========================================
    // 🚑 [緊急後門] SOS 物理急救與重啟
    // ==========================================
    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/sos') {
        await ctx.reply("🚨 [SOS 緊急協定啟動] 正在強制清除可能污染的快取檔並重啟系統...");
        try {
            const fsSync = require('fs');
            const path = require('path');
            
            // 1. 定義要清除的「毒蘋果」名單 (包含常見的存放位置)
            const toxicFiles = [
                path.join(process.cwd(), 'selectors.json'),
                path.join(process.cwd(), 'src', 'core', 'selectors.json')
            ];

            // 2. 執行物理刪除
            for (const file of toxicFiles) {
                if (fsSync.existsSync(file)) {
                    fsSync.unlinkSync(file);
                    console.log(`🗑️ [SOS] 已刪除污染檔案: ${file}`);
                }
            }

            await ctx.reply("✅ 潛在的污染檔案已清除，正在重新啟動 Golem 進程...");
            
            // 3. 呼叫 Node.js 重啟自己
            const { spawn } = require('child_process');
            const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
            subprocess.unref();
            process.exit(0);

        } catch (e) {
            await ctx.reply(`❌ 緊急重啟失敗，需要手動終端機介入: ${e.message}`);
        }
        return; // 🛑 終止後續處理，絕對不讓這條指令進入 AI 大腦
    }
    // 🚨 ==========================================

    // ✨ [v9.0 保留] 優先檢查：是否在 MultiAgent 等待用戶輸入
    if (global.multiAgentListeners && global.multiAgentListeners.has(ctx.chatId)) {
        const callback = global.multiAgentListeners.get(ctx.chatId);
        callback(ctx.text); // 將輸入傳給 MultiAgent
        return; // 不進入正常流程
    }

    // ✨ [v9.0 保留] 檢查：是否要恢復會議
    if (ctx.text && ['恢復會議', 'resume', '繼續會議'].includes(ctx.text.toLowerCase())) {
        if (InteractiveMultiAgent.canResume(ctx.chatId)) {
            await InteractiveMultiAgent.resumeConversation(ctx, brain);
            return;
        }
    }

    if (!ctx.text && !ctx.getAttachment) return;
    if (!ctx.isAdmin) return;
    if (await NodeRouter.handle(ctx, brain)) return;
    
    // 部署指令攔截
    const lowerText = ctx.text ? ctx.text.toLowerCase() : '';
    if (global.pendingPatch) {
        if (['ok', 'deploy', 'y', '部署'].includes(lowerText)) return executeDeploy(ctx);
        if (['no', 'drop', 'n', '丟棄'].includes(lowerText)) return executeDrop(ctx);
    }

    if (lowerText.startsWith('/patch') || lowerText.includes('優化代碼')) {
        await autonomy.performSelfReflection(ctx);
        return;
    }

    await ctx.sendTyping();
    try {
        let finalInput = ctx.text;
        const attachment = await ctx.getAttachment();

        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve 分析檔案...");
            const apiKey = await brain.doctor.keyChain.getKey();
            if (apiKey) {
                const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, apiKey);
                finalInput = `【系統通知：視覺訊號】\n檔案類型：${attachment.mimeType}\n分析報告：\n${analysis}\n使用者訊息：${ctx.text || ""}\n請根據分析報告回應。`;
            } else {
                await ctx.reply("⚠️ 視覺系統暫時過熱 (API Rate Limit)，無法分析圖片，將僅處理文字訊息。");
            }
        }
        if (!finalInput && !attachment) return;
        await convoManager.enqueue(ctx, finalInput);
    } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }
}

async function handleUnifiedCallback(ctx, actionData) {
    if (ctx.platform === 'discord' && ctx.isInteraction) {
        try {
            await ctx.event.deferReply({ flags: 64 });
        } catch (e) {
            console.error('Callback Discord deferReply Error:', e.message);
        }
    }

    if (!ctx.isAdmin) return;
    if (actionData === 'PATCH_DEPLOY') return executeDeploy(ctx);
    if (actionData === 'PATCH_DROP') return executeDrop(ctx);
    if (actionData === 'SYSTEM_FORCE_UPDATE') return SystemUpgrader.performUpdate(ctx);
    if (actionData === 'SYSTEM_UPDATE_CANCEL') return await ctx.reply("已取消更新操作。");

    if (actionData.includes('_')) {
        const [action, taskId] = actionData.split('_');
        const task = pendingTasks.get(taskId);
        if (!task) return await ctx.reply('⚠️ 任務已失效');
        if (action === 'DENY') {
            pendingTasks.delete(taskId);
            await ctx.reply('🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            const { steps, nextIndex } = task;
            pendingTasks.delete(taskId);
            await ctx.reply("✅ 授權通過，執行中...");
            const approvedStep = steps[nextIndex];
            const cmd = approvedStep.cmd || approvedStep.parameter || approvedStep.command || "";
            let execResult = "";
            try {
                const output = await controller.executor.run(cmd);
                execResult = `[Step ${nextIndex + 1} Success] cmd: ${cmd}\nResult:\n${(output || "").trim()}`;
            } catch (e) {
                execResult = `[Step ${nextIndex + 1} Failed] cmd: ${cmd}\nError:\n${e.message}`;
            }
            const remainingResult = await controller.runSequence(ctx, steps, nextIndex + 1);
            const observation = [execResult, remainingResult].filter(Boolean).join('\n\n----------------\n\n');
            if (observation) {
                const feedbackPrompt = `[System Observation]\nUser approved actions.\nResult:\n${observation}\nReport to user using [GOLEM_REPLY].`;
                const finalResponse = await brain.sendMessage(feedbackPrompt);
                await NeuroShunter.dispatch(ctx, finalResponse, brain, controller);
            }
        }
    }
}

// ============================================================
// 🚀 [v9.0.1 Update] Async Deployment System
// ============================================================
async function executeDeploy(ctx) {
    if (!global.pendingPatch) return;
    try {
        const { path: patchPath, target: targetPath, name: targetName } = global.pendingPatch;
        
        // ✨ [v9.0.1] 非同步複製備份
        try {
            await fs.copyFile(targetPath, `${targetName}.bak-${Date.now()}`);
        } catch (e) {
            // 忽略備份錯誤 (可能是新檔案)
        }

        // ✨ [v9.0.1] 非同步讀寫操作，避免卡死 Bot
        const patchContent = await fs.readFile(patchPath);
        await fs.writeFile(targetPath, patchContent);
        await fs.unlink(patchPath);
        
        global.pendingPatch = null;
        if (brain && brain.memoryDriver && brain.memoryDriver.recordSuccess) {
            try { await brain.memoryDriver.recordSuccess(); } catch (e) { }
        }
        await ctx.reply(`🚀 ${targetName} 升級成功！正在重啟...`);
        const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
        subprocess.unref();
        process.exit(0);
    } catch (e) { await ctx.reply(`❌ 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx) {
    if (!global.pendingPatch) return;
    try { 
        // ✨ [v9.0.1] 非同步刪除
        await fs.unlink(global.pendingPatch.path); 
    } catch (e) { }
    global.pendingPatch = null;
    if (brain && brain.memoryDriver && brain.memoryDriver.recordRejection) {
        try { await brain.memoryDriver.recordRejection(); } catch (e) { }
    }
    await ctx.reply("🗑️ 提案已丟棄");
}

// Register Listeners
if (tgBot) {
    tgBot.on('message', (msg) => handleUnifiedMessage(new UniversalContext('telegram', msg, tgBot)));

    tgBot.on('callback_query', async (query) => {
        tgBot.answerCallbackQuery(query.id).catch(e => {
            console.warn(`⚠️ [TG] Callback Answer Warning: ${e.message}`);
        });

        await handleUnifiedCallback(
            new UniversalContext('telegram', query, tgBot),
            query.data
        );
    });
}
if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}

module.exports = { brain, controller, autonomy, convoManager };
