/**
 * 🦞 Project Golem v9.0 (Ultimate Chronos + MultiAgent + WebSkillEngine Edition)
 * -------------------------------------------------------------------------
 * 架構：[Universal Context] -> [Conversation Queue] -> [NeuroShunter] <==> [Web Gemini]
 * * 🎯 v9.0 核心升級：
 * 1. 結合 v8.7 的高穩定性 (Flood Guard, KeyChain v2)
 * 2. 整合 v8.8 的互動式多 Agent 會議系統 (InteractiveMultiAgent)
 * 3. 升級 Titan Protocol 支援多重動作指令
 * 4. ✨ 新增 Web-Based Skill Engine (Architect 使用 Web Gemini 生成)
 * * [保留功能]
 * - KeyChain v2 智慧冷卻機制
 * - SecurityManager v2 Taint 追蹤
 * - Flood Guard 啟動時間過濾
 * - DOM Doctor 自動修復
 */

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
require('dotenv').config();
const fs = require('fs');
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
    autonomy.start();
    console.log('✅ Golem v9.0 (Ultimate Chronos + MultiAgent Edition) is Online.');
    if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();

// ============================================================
// 📨 Event Handlers
// ============================================================

async function handleUnifiedMessage(ctx) {
    // ⏱️ [v8.7 保留] Flood Guard - 忽略離線期間訊息
    const msgTime = ctx.messageTime;
    if (msgTime && msgTime < BOOT_TIME) {
        console.log(`⏸️ [Flood Guard] 忽略離線訊息 (${new Date(msgTime).toLocaleString('zh-TW')})`);
        return;
    }

    // ✨ [v9.0] 優先檢查：是否在 MultiAgent 等待用戶輸入
    if (global.multiAgentListeners && global.multiAgentListeners.has(ctx.chatId)) {
        const callback = global.multiAgentListeners.get(ctx.chatId);
        callback(ctx.text); // 將輸入傳給 MultiAgent
        return; // 不進入正常流程
    }

    // ✨ [v9.0] 檢查：是否要恢復會議
    if (ctx.text && ['恢復會議', 'resume', '繼續會議'].includes(ctx.text.toLowerCase())) {
        if (InteractiveMultiAgent.canResume(ctx.chatId)) {
            await InteractiveMultiAgent.resumeConversation(ctx, brain);
            return;
        }
    }

    if (!ctx.text && !ctx.getAttachment) return;
    if (!ctx.isAdmin) return;
    if (await NodeRouter.handle(ctx, brain)) return;
    if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(ctx.text.toLowerCase())) return executeDeploy(ctx);
    if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(ctx.text.toLowerCase())) return executeDrop(ctx);

    if (ctx.text.startsWith('/patch') || ctx.text.includes('優化代碼')) {
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

async function executeDeploy(ctx) {
    if (!global.pendingPatch) return;
    try {
        const { path: patchPath, target: targetPath, name: targetName } = global.pendingPatch;
        fs.copyFileSync(targetPath, `${targetName}.bak-${Date.now()}`);
        fs.writeFileSync(targetPath, fs.readFileSync(patchPath));
        fs.unlinkSync(patchPath);
        global.pendingPatch = null;
        if (brain && brain.memoryDriver && brain.memoryDriver.recordSuccess) {
            // Try/Catch in case memory driver doesn't support it directly or isn't initialized
            try { brain.memoryDriver.recordSuccess(); } catch (e) { }
        }
        await ctx.reply(`🚀 ${targetName} 升級成功！正在重啟...`);
        const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
        subprocess.unref();
        process.exit(0);
    } catch (e) { await ctx.reply(`❌ 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx) {
    if (!global.pendingPatch) return;
    try { fs.unlinkSync(global.pendingPatch.path); } catch (e) { }
    global.pendingPatch = null;
    if (brain && brain.memoryDriver && brain.memoryDriver.recordRejection) {
        try { brain.memoryDriver.recordRejection(); } catch (e) { }
    }
    await ctx.reply("🗑️ 提案已丟棄");
}

// Register Listeners
if (tgBot) {
    tgBot.on('message', (msg) => handleUnifiedMessage(new UniversalContext('telegram', msg, tgBot)));

    // 🛠️ [Fix] 修正後的回調處理：優先應答，避免超時崩潰
    tgBot.on('callback_query', async (query) => {
        // 1. 先告訴 Telegram Server "我收到了"，停止前端轉圈圈
        // .catch() 是關鍵：防止因網路波動或 ID 過期導致整個程式崩潰 (Error: ETELEGRAM: 400)
        tgBot.answerCallbackQuery(query.id).catch(e => {
            console.warn(`⚠️ [TG] Callback Answer Warning: ${e.message}`);
        });

        // 2. 然後再執行耗時的業務邏輯 (AI 分析或指令執行)
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

module.exports = { brain, controller, autonomy, convoManager }; // Export for testing/dashboard
