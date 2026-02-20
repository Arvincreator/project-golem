/**
 * 🦞 Project Golem v9.0.2 (Integrity Core Edition)
 * -------------------------------------------------------------------------
 * 架構：[Universal Context] -> [Conversation Queue] -> [NeuroShunter] <==> [Web Gemini]
 * * 🎯 V9.0.2 核心升級：
 * 1. 🧬 記憶轉生系統 (Memory Reincarnation): 支援無限期延續對話上下文，自動重置底層 Web 會話。
 * 2. 🔌 Telegram Topic 支援: 修正在 Forum 模式下的精準回覆。
 * 3. 🚑 輕量級 SOS 急救: 不重啟進程，單純物理刪除污染快取，觸發 DOM Doctor 無縫修復。
 * 4. 🧠 智慧指令引擎: Node.js 原生支援解析結構化技能，自動處理 Bash 引號跳脫防呆。
 * 5. 🔗 強韌神經連結 (v2): 徹底修復 APPROVE 授權後的結果斷鏈問題，確保 [System Observation] 必定回傳。
 * * [保留功能]
 * - ⚡ 非同步部署 (Async Deployment)
 * - 🛡️ 全域錯誤防護 (Global Error Guard)
 * - 🧠 深度整合 Introspection
 * - v9.0 所有功能 (InteractiveMultiAgent, WebSkillEngine)
 */
require('dotenv').config();

process.on('uncaughtException', (err) => {
    console.error('🔥 [CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [WARNING] Unhandled Rejection at:', promise, 'reason:', reason);
});

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

const fs = require('fs').promises; 
const path = require('path');
const os = require('os'); 
const { spawn } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

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
const introspection = require('./src/services/Introspection');

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

const brain = new GolemBrain();
const controller = new TaskController();
const autonomy = new AutonomyManager(brain, controller, brain.memoryDriver); 
const convoManager = new ConversationManager(brain, NeuroShunter, controller);

autonomy.setIntegrations(tgBot, dcClient, convoManager);

const BOOT_TIME = Date.now();
console.log(`🛡️ [Flood Guard] 系統啟動時間: ${new Date(BOOT_TIME).toLocaleString('zh-TW', { hour12: false })}`);
const pendingTasks = controller.pendingTasks; 

(async () => {
    if (process.env.GOLEM_TEST_MODE === 'true') { console.log('🚧 GOLEM_TEST_MODE active.'); return; }
    await brain.init();
    
    console.log('🧠 [Introspection] Pre-scanning project structure...');
    await introspection.getStructure();

    const fsSync = require('fs');
    fsSync.watch(process.cwd(), async (eventType, filename) => {
        if (filename === '.reincarnate_signal.json') {
            try {
                if (!fsSync.existsSync('.reincarnate_signal.json')) return;
                
                const signalRaw = fsSync.readFileSync('.reincarnate_signal.json', 'utf-8');
                const { summary } = JSON.parse(signalRaw);
                fsSync.unlinkSync('.reincarnate_signal.json'); 
                
                console.log("🔄 [系統] 啟動記憶轉生程序！正在開啟新對話...");

                if (brain.page) {
                    await brain.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
                }

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

async function handleUnifiedMessage(ctx) {
    const msgTime = ctx.messageTime;
    if (msgTime && msgTime < BOOT_TIME) {
        return;
    }

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
            
            await ctx.reply("✅ 授權通過，執行中 (這可能需要幾秒鐘)...");
            const approvedStep = steps[nextIndex];
            
            let cmd = "";

            if (approvedStep.action === 'command' || approvedStep.cmd || approvedStep.parameter) {
                cmd = approvedStep.cmd || approvedStep.parameter || approvedStep.command || "";
            } 
            else if (approvedStep.action && approvedStep.action !== 'command') {
                const actionName = String(approvedStep.action).toLowerCase().replace(/_/g, '-');
                let payload = "";
                if (approvedStep.summary) payload = String(approvedStep.summary);
                else if (approvedStep.args) payload = typeof approvedStep.args === 'string' ? approvedStep.args : JSON.stringify(approvedStep.args);
                
                const safePayload = payload.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
                cmd = `node src/skills/lib/${actionName}.js "${safePayload}"`;
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

            // 🧠 【神經貫通修復核心】強制使用 Native Exec，無論 TaskController 怎麼 return null，這裡一定抓得到結果！
            const util = require('util');
            const execPromise = util.promisify(require('child_process').exec);
            
            let execResult = "";
            let finalOutput = "";
            try {
                // 給予腳本最高 45 秒的執行時間，並限制最大 buffer (10MB) 避免長內容撐爆記憶體
                const { stdout, stderr } = await execPromise(cmd, { timeout: 45000, maxBuffer: 1024 * 1024 * 10 });
                finalOutput = (stdout || stderr || "✅ 指令執行成功，無特殊輸出").trim();
                execResult = `[Step ${nextIndex + 1} Success] cmd: ${cmd}\nResult:\n${finalOutput}`;
                console.log(`✅ [Executor] 成功捕獲終端機輸出 (${finalOutput.length} 字元)`);
            } catch (e) {
                finalOutput = `Error: ${e.message}\n${e.stderr || ''}`;
                execResult = `[Step ${nextIndex + 1} Failed] cmd: ${cmd}\nResult:\n${finalOutput}`;
                console.error(`❌ [Executor] 執行錯誤: ${e.message}`);
            }

            // ✨ 【關鍵修復】如果內容太長 (超過 Gemini 舒適區)，我們主動幫它裁切
            const MAX_LENGTH = 15000;
            if (execResult.length > MAX_LENGTH) {
                execResult = execResult.substring(0, MAX_LENGTH) + `\n\n... (為保護記憶體，內容已截斷，共省略 ${execResult.length - MAX_LENGTH} 字元) ...`;
                console.log(`✂️ [System] 執行結果過長，已自動截斷為 ${MAX_LENGTH} 字元。`);
            }

            // 嘗試執行佇列中剩餘的任務 (如果有)
            let remainingResult = "";
            try {
                remainingResult = await controller.runSequence(ctx, steps, nextIndex + 1) || "";
            } catch (err) {
                console.warn(`⚠️ [System] 執行後續步驟時發生警告: ${err.message}`);
            }

            // 把本次結果和後續結果拼裝起來，這就是神經要傳回大腦的封包！
            const observation = [execResult, remainingResult].filter(Boolean).join('\n\n----------------\n\n');
            
            if (observation) {
                await ctx.reply(`📤 指令執行完畢 (共抓取 ${finalOutput.length} 字元)！正在將結果回傳給大腦神經進行分析...`);
                
                const feedbackPrompt = `[System Observation]\nUser approved actions.\nExecution Result:\n${observation}\n\nPlease analyze this result and report to the user using [GOLEM_REPLY].`;
                try {
                    // 把裝滿檔案內容的 observation 打進輸入框！
                    const finalResponse = await brain.sendMessage(feedbackPrompt);
                    // 把 Gemini 看完檔案後說的話，丟回給使用者
                    await NeuroShunter.dispatch(ctx, finalResponse, brain, controller);
                } catch (err) {
                    await ctx.reply(`❌ 傳送結果回大腦時發生異常：${err.message}`);
                }
            }
        }
    }
}

async function executeDeploy(ctx) {
    if (!global.pendingPatch) return;
    try {
        const { path: patchPath, target: targetPath, name: targetName } = global.pendingPatch;
        
        try {
            await fs.copyFile(targetPath, `${targetName}.bak-${Date.now()}`);
        } catch (e) { }

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
        await fs.unlink(global.pendingPatch.path); 
    } catch (e) { }
    global.pendingPatch = null;
    if (brain && brain.memoryDriver && brain.memoryDriver.recordRejection) {
        try { await brain.memoryDriver.recordRejection(); } catch (e) { }
    }
    await ctx.reply("🗑️ 提案已丟棄");
}

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
