/**
 * 🦞 Project Golem v6.2 (Dynamic Fortress Edition)
 * ---------------------------------------------------
 * 架構：[Gemini 大腦] -> [Ollama 翻譯官] -> [Security 審計官] -> [Node.js 執行者]
 * 特性：情緒回饋、指令拆解、風險分級、中斷確認、模組化技能、環境感知
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Ollama } = require('ollama');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os'); // 👈 新增：用於偵測系統環境
const skills = require('./skills'); // 引入技能書

// --- ⚙️ 全域配置 ---
const CONFIG = {
    TOKEN: process.env.TELEGRAM_TOKEN,
    USER_DATA_DIR: process.env.USER_DATA_DIR || './golem_memory',
    OLLAMA_MODEL: 'llama3', // 建議使用 llama3 或 mistral
    SPLIT_TOKEN: '---GOLEM_ACTION_PLAN---', // 雙腦協議分隔線
    ADMIN_ID: process.env.ADMIN_ID // (選填) 限制只能由特定 ID 操作
};

// --- 初始化組件 ---
puppeteer.use(StealthPlugin());
const ollama = new Ollama();
const bot = new TelegramBot(CONFIG.TOKEN, { polling: true });
const pendingTasks = new Map(); // 暫存等待審核的任務

// ============================================================
// 🔍 System Fingerprint (環境指紋生成)
// ============================================================
function getSystemFingerprint() {
    try {
        const platform = os.platform(); // 'win32', 'linux', 'darwin'
        const release = os.release();
        const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        const cpuModel = os.cpus()[0] ? os.cpus()[0].model : 'Unknown CPU';
        const arch = os.arch();

        // 判斷 Shell 類型與建議
        let shellType = 'Bash';
        if (platform === 'win32') shellType = 'PowerShell / CMD';

        return `
    - 作業系統 (OS): ${platform} (${release})
    - 系統架構 (Arch): ${arch}
    - 處理器 (CPU): ${cpuModel}
    - 記憶體 (RAM): Total ${totalMem} / Free ${freeMem}
    - 建議指令集: ${shellType}
    - 工作目錄: ${process.cwd()}
    `;
    } catch (e) {
        return "無法取得詳細系統資訊，請預設使用 Linux Bash。";
    }
}

// ============================================================
// 🛡️ Security Manager (風險審計官)
// ============================================================
class SecurityManager {
    constructor() {
        this.SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'Get-ChildItem', 'Get-Content', 'Select-String'];
        this.BLOCK_PATTERNS = [
            /rm\s+-rf\s+\//, // 禁止 Linux 刪根目錄
            /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/, // 禁止 Windows 刪根目錄
            />\s*\/dev\/sd/, // 禁止寫入硬碟裝置
            /:(){:|:&};:/,   // 禁止 Fork Bomb
            /mkfs/,          // 禁止格式化
            /Format-Volume/  // 禁止 PowerShell 格式化
        ];
    }

    assess(cmd) {
        const baseCmd = cmd.trim().split(/\s+/)[0];

        // 1. 黑名單攔截 (☠️)
        if (this.BLOCK_PATTERNS.some(regex => regex.test(cmd))) {
            return { level: 'BLOCKED', reason: '偵測到毀滅性指令' };
        }

        // 2. 白名單放行 (🟢)
        if (this.SAFE_COMMANDS.includes(baseCmd)) {
            return { level: 'SAFE' };
        }

        // 3. 高風險判定 (🔴)
        const dangerousOps = [
            'rm', 'mv', 'chmod', 'chown', 'sudo', 'su', 'shutdown', 'reboot',
            'Remove-Item', 'Move-Item', 'Restart-Computer', 'Stop-Computer' // PowerShell 關鍵字
        ];
        if (dangerousOps.includes(baseCmd)) {
            return { level: 'DANGER', reason: '涉及檔案刪除或系統變更' };
        }

        // 4. 其餘視為警告 (🟡)
        return { level: 'WARNING', reason: '系統操作需確認' };
    }
}

// ============================================================
// 🧠 Golem Brain (Gemini Web)
// ============================================================
class GolemBrain {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async init() {
        if (this.browser) return;
        console.log('🧠 [Brain] 啟動 Gemini...');
        this.browser = await puppeteer.launch({
            headless: false, // 首次執行請設為 false 以便登入
            userDataDir: CONFIG.USER_DATA_DIR,
            args: ['--no-sandbox', '--window-size=1280,900']
        });

        const pages = await this.browser.pages();
        this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
        await this.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });

        // 👇 1. 掃描環境
        console.log('🔍 [System] 正在掃描本機環境...');
        const fingerprint = getSystemFingerprint();
        console.log(fingerprint); 

        // 👇 2. 注入包含環境資訊的 Prompt
        console.log('📚 [Brain] 正在載入動態技能模組...');
        const systemPrompt = skills.getSystemPrompt(fingerprint);

        await this.sendMessage(systemPrompt, true);
        console.log('🧠 [Brain] 環境感知與雙腦連結已就緒。');
    }

    async sendMessage(text, isSystem = false) {
        if (!this.browser) await this.init();
        try {
            const selector = 'div[contenteditable="true"], rich-textarea > div';
            await this.page.waitForSelector(selector, { timeout: 15000 });

            await this.page.evaluate((sel, txt) => {
                const el = document.querySelector(sel);
                el.focus();
                document.execCommand('insertText', false, txt);
            }, selector, text);

            await new Promise(r => setTimeout(r, 800));
            await this.page.keyboard.press('Enter');

            if (isSystem) { await new Promise(r => setTimeout(r, 2000)); return; }

            console.log('🧠 [Brain] 思考中...');
            await this.page.waitForFunction(() => {
                const stopBtn = document.querySelector('[aria-label="Stop generating"], [aria-label="停止產生"]');
                const thinking = document.querySelector('.streaming-icon');
                return !stopBtn && !thinking;
            }, { timeout: 120000, polling: 1000 });

            return await this.page.evaluate(() => {
                const bubbles = document.querySelectorAll('message-content, .model-response-text');
                return bubbles.length ? bubbles[bubbles.length - 1].innerText : "";
            });
        } catch (e) { return `Brain Error: ${e.message}`; }
    }
}

// ============================================================
// 🦎 Golem Translator (Ollama)
// ============================================================
class GolemTranslator {
    async parse(planText) {
        if (!planText || planText.trim().length < 2) return [];
        console.log('🦎 [Translator] 解析指令中...');

        const prompt = `
        【任務】從下方文字提取 Shell/PowerShell 指令。
        【文字】"${planText}"
        【格式】JSON Array: [{"cmd": "ls", "desc": "說明"}]
        【規則】只輸出 JSON，忽略解釋。
        `;

        try {
            const res = await ollama.chat({
                model: CONFIG.OLLAMA_MODEL,
                messages: [{ role: 'user', content: prompt }],
                format: 'json',
                stream: false
            });
            return JSON.parse(res.message.content).steps || [];
        } catch (e) {
            console.error('🦎 解析失敗:', e);
            return [];
        }
    }
}

// ============================================================
// ⚡ Task Controller (核心控制與執行)
// ============================================================
class TaskController {
    constructor() {
        this.executor = new Executor();
        this.security = new SecurityManager();
    }

    // 執行步驟序列 (支援遞迴恢復)
    async runSequence(chatId, steps, startIndex = 0) {
        let logBuffer = "";

        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            const risk = this.security.assess(step.cmd);

            // 1. ☠️ 攔截 Blocked
            if (risk.level === 'BLOCKED') {
                await bot.sendMessage(chatId, `⛔ **已攔截危險指令**：\`${step.cmd}\`\n理由：${risk.reason}`, { parse_mode: 'Markdown' });
                return; // 強制中止
            }

            // 2. 🟡🔴 需審核 Warning/Danger
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                // 暫存任務
                const approvalId = uuidv4();
                pendingTasks.set(approvalId, {
                    steps: steps,
                    nextIndex: i, // 標記當前步驟（執行時會執行這一步）
                    chatId: chatId
                });

                // 發送確認按鈕
                const riskIcon = risk.level === 'DANGER' ? '🔥' : '⚠️';
                const msg = `
${riskIcon} **操作請求確認** (${i + 1}/${steps.length})
━━━━━━━━━━━━━━━━
指令：\`${step.cmd}\`
說明：${step.desc}
風險：${risk.reason}
━━━━━━━━━━━━━━━━
`;
                await bot.sendMessage(chatId, msg, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ 批准執行', callback_data: `APPROVE:${approvalId}` },
                            { text: '🛡️ 駁回', callback_data: `DENY:${approvalId}` }
                        ]]
                    }
                });

                return; // 暫停迴圈，等待回調
            }

            // 3. 🟢 安全指令直接執行
            await bot.sendMessage(chatId, `⚙️ *Step ${i + 1}:* ${step.desc}\n\`${step.cmd}\``, { parse_mode: 'Markdown' });
            try {
                const output = await this.executor.run(step.cmd);
                logBuffer += `✅ [${step.cmd}] OK\n`;
            } catch (err) {
                await bot.sendMessage(chatId, `❌ **執行失敗**：\`${step.cmd}\`\n${err}`);
                return;
            }
        }

        await bot.sendMessage(chatId, `🎉 **所有任務執行完畢**\n${logBuffer}`);
    }
}

class Executor {
    run(cmd) {
        return new Promise((resolve, reject) => {
            console.log(`⚡ Exec: ${cmd}`);
            // 注意：Windows 下 exec 預設使用 cmd.exe，但可執行 PowerShell 指令
            exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
                if (err) reject(stderr || err.message);
                else resolve(stdout);
            });
        });
    }
}

// ============================================================
// 🎮 主程式邏輯
// ============================================================
const brain = new GolemBrain();
const translator = new GolemTranslator();
const controller = new TaskController();

(async () => await brain.init())();

// 1. 訊息監聽
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    // 權限檢查 (可選)
    if (CONFIG.ADMIN_ID && String(chatId) !== CONFIG.ADMIN_ID) {
        return bot.sendMessage(chatId, "🚫 未授權的使用者。");
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        // A. Gemini 思考
        const raw = await brain.sendMessage(text);
        const [chatPart, planPart] = raw.split(CONFIG.SPLIT_TOKEN);

        // B. 優先回覆對話
        if (chatPart && chatPart.trim()) {
            await bot.sendMessage(chatId, chatPart.trim());
        }

        // C. 處理計畫 (如果有)
        if (planPart && planPart.trim()) {
            const steps = await translator.parse(planPart.trim());
            if (steps.length > 0) {
                // 開始執行序列 (從第 0 步開始)
                await controller.runSequence(chatId, steps, 0);
            }
        }
    } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, `❌ 系統錯誤: ${e.message}`);
    }
});

// 2. 按鈕回調監聽 (審核機制)
bot.on('callback_query', async (query) => {
    const { id, data, message } = query;
    const [action, taskId] = data.split(':');
    const task = pendingTasks.get(taskId);

    if (!task) {
        return bot.answerCallbackQuery(id, { text: '任務已過期或失效' });
    }

    // 清除按鈕
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: message.chat.id, message_id: message.message_id });

    if (action === 'DENY') {
        pendingTasks.delete(taskId);
        await bot.sendMessage(message.chat.id, '🛡️ **操作已由使用者駁回，任務中止。**', { parse_mode: 'Markdown' });
        return;
    }

    if (action === 'APPROVE') {
        await bot.answerCallbackQuery(id, { text: '授權通過，繼續執行...' });
        const { steps, nextIndex, chatId } = task;

        // 執行當前這一步 (因為之前暫停了)
        const currentStep = steps[nextIndex];
        try {
            await bot.sendMessage(chatId, `🔥 **已授權執行**: \`${currentStep.cmd}\``, { parse_mode: 'Markdown' });
            await new Executor().run(currentStep.cmd);

            // 移除暫存
            pendingTasks.delete(taskId);

            // 🔄 遞迴：繼續執行剩下的步驟 (nextIndex + 1)
            await controller.runSequence(chatId, steps, nextIndex + 1);

        } catch (e) {
            await bot.sendMessage(chatId, `❌ 執行失敗: ${e}`);
            pendingTasks.delete(taskId);
        }
    }
});

console.log('📡 Golem v6.2 (Dynamic Fortress) is Online.');
console.log('🛡️ Security Protocols Active.');
