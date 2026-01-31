/**
 * 🦞 Project Golem v7.1 (Ouroboros Tri-Brain Ultimate)
 * ---------------------------------------------------
 * 架構：[Node.js 反射層] -> [Web Gemini 主大腦] -> [API 維修技師]
 * 特性：
 * 1. 🧠 Tri-Brain: 結合反射神經 (Node)、無限大腦 (Web Gemini)、精準技師 (API)。
 * 2. 🛡️ High Availability: 實作 DOM Doctor 自癒與 KeyChain 輪動。
 * 3. 📝 Safe-Splitter: 自動切割長訊息，突破 Telegram 4096 字元限制。
 * 4. 🧬 Legacy Power: 完整保留 v6.4 的自主進化、內省、熱修復與安全審計功能。
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec, execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs');
const path = require('path');
const skills = require('./skills'); // 需搭配 v7.0 版 skills.js

// --- ⚙️ 全域配置 ---
const CONFIG = {
    TOKEN: process.env.TELEGRAM_TOKEN,
    USER_DATA_DIR: process.env.USER_DATA_DIR || './golem_memory',
    // 支援多組 Key，以逗號分隔 "Key1,Key2,Key3"
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k),
    SPLIT_TOKEN: '---GOLEM_ACTION_PLAN---',
    ADMIN_ID: process.env.ADMIN_ID
};

// --- 初始化組件 ---
puppeteer.use(StealthPlugin());
const bot = new TelegramBot(CONFIG.TOKEN, { polling: true });
const pendingTasks = new Map(); // 暫存等待審核的 Shell 任務
global.pendingPatch = null;     // 暫存等待審核的 代碼 Patch

// ============================================================
// 📨 Message Manager (訊息切片器) [✨ v7.1 新增]
// ============================================================
class MessageManager {
    static async send(bot, chatId, text, options = {}) {
        if (!text) return;
        const MAX_LENGTH = 4000; // 預留緩衝

        if (text.length <= MAX_LENGTH) {
            try {
                return await bot.sendMessage(chatId, text, options);
            } catch (e) {
                console.warn("Markdown 發送失敗，轉為純文字重試:", e.message);
                return await bot.sendMessage(chatId, text); // 降級重試
            }
        }

        // 智慧切割
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= MAX_LENGTH) {
                chunks.push(remaining);
                break;
            }
            // 優先找換行符號切割，避免切斷單字
            let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
            if (splitIndex === -1) splitIndex = MAX_LENGTH; // 沒換行就硬切

            chunks.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }

        for (const chunk of chunks) {
            try {
                await bot.sendMessage(chatId, chunk, options);
            } catch (e) {
                await bot.sendMessage(chatId, chunk); // 降級重試
            }
        }
    }
}

// ============================================================
// 🧠 Experience Memory (經驗記憶體) [🔒 保留 v6.4]
// ============================================================
class ExperienceMemory {
    constructor() {
        this.memoryFile = path.join(process.cwd(), 'golem_learning.json');
        this.data = this._load();
    }
    _load() {
        try {
            if (fs.existsSync(this.memoryFile)) return JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8'));
        } catch (e) { console.error("記憶讀取失敗:", e); }
        return { lastProposalType: null, rejectedCount: 0, avoidList: [], nextWakeup: 0 };
    }
    save() { fs.writeFileSync(this.memoryFile, JSON.stringify(this.data, null, 2)); }
    recordProposal(type) { this.data.lastProposalType = type; this.save(); }
    recordRejection() {
        this.data.rejectedCount++;
        if (this.data.lastProposalType) {
            this.data.avoidList.push(this.data.lastProposalType);
            if (this.data.avoidList.length > 3) this.data.avoidList.shift();
        }
        this.save();
        return this.data.rejectedCount;
    }
    recordSuccess() { this.data.rejectedCount = 0; this.data.avoidList = []; this.save(); }
    getAdvice() {
        if (this.data.avoidList.length > 0) return `⚠️ 注意：主人最近拒絕了：[${this.data.avoidList.join(', ')}]。請避開。`;
        return "";
    }
}
const memory = new ExperienceMemory();

// ============================================================
// 🪞 Introspection (內省模組) [🔒 保留 v6.4]
// ============================================================
class Introspection {
    static readSelf() {
        try {
            const content = fs.readFileSync(__filename, 'utf-8');
            return content.replace(/TOKEN: .*,/, 'TOKEN: "HIDDEN",').replace(/API_KEYS: .*,/, 'API_KEYS: "HIDDEN",');
        } catch (e) { return `無法讀取自身代碼: ${e.message}`; }
    }
}

// ============================================================
// 🩹 Patch Manager (神經補丁) [🔒 保留 v6.4]
// ============================================================
class PatchManager {
    static apply(originalCode, patch) {
        if (originalCode.includes(patch.search)) return originalCode.replace(patch.search, patch.replace);
        try {
            // 模糊匹配邏輯
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const fuzzySearch = escapeRegExp(patch.search).replace(/\s+/g, '[\\s\\n]+');
            const regex = new RegExp(fuzzySearch);
            if (regex.test(originalCode)) {
                console.log("⚠️ [PatchManager] 啟用模糊匹配模式。");
                return originalCode.replace(regex, patch.replace);
            }
        } catch (e) { console.warn("模糊匹配失敗:", e); }
        throw new Error(`❌ 找不到匹配代碼段落`);
    }

    static createTestClone(originalPath, patchContent) {
        try {
            const originalCode = fs.readFileSync(originalPath, 'utf-8');
            let patchedCode = originalCode;
            const patches = Array.isArray(patchContent) ? patchContent : [patchContent];
            patches.forEach(p => { patchedCode = this.apply(patchedCode, p); });
            const testFile = 'index.test.js';
            fs.writeFileSync(testFile, patchedCode, 'utf-8');
            return testFile;
        } catch (e) { throw new Error(`補丁應用失敗: ${e.message}`); }
    }

    static verify(filePath) {
        try {
            execSync(`node -c "${filePath}"`);
            execSync(`node "${filePath}"`, { env: { ...process.env, GOLEM_TEST_MODE: 'true' }, timeout: 5000, stdio: 'pipe' });
            console.log("✅ [PatchManager] 冒煙測試通過");
            return true;
        } catch (e) {
            console.error(`❌ [PatchManager] 驗證失敗: ${e.message}`);
            return false;
        }
    }
}

// ============================================================
// 🛡️ Security Manager (安全審計) [🔒 保留 v6.4]
// ============================================================
class SecurityManager {
    constructor() {
        this.SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String'];
        this.BLOCK_PATTERNS = [/rm\s+-rf\s+\//, /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/, />\s*\/dev\/sd/, /:(){:|:&};:/, /mkfs/, /Format-Volume/, /dd\s+if=/, /chmod\s+[-]x\s+/];
    }
    assess(cmd) {
        const baseCmd = cmd.trim().split(/\s+/)[0];
        if (this.BLOCK_PATTERNS.some(regex => regex.test(cmd))) return { level: 'BLOCKED', reason: '毀滅性指令' };
        if (this.SAFE_COMMANDS.includes(baseCmd)) return { level: 'SAFE' };
        const dangerousOps = ['rm', 'mv', 'chmod', 'chown', 'sudo', 'su', 'reboot', 'shutdown', 'npm uninstall', 'Remove-Item', 'Stop-Computer'];
        if (dangerousOps.includes(baseCmd)) return { level: 'DANGER', reason: '高風險操作' };
        return { level: 'WARNING', reason: '需確認' };
    }
}

// ============================================================
// 📖 Help Manager (動態說明書) [🔒 保留 v6.4 邏輯並適配 v7]
// ============================================================
class HelpManager {
    static getManual() {
        // 1. 內省：讀取自身原始碼
        const source = Introspection.readSelf();

        // 2. 掃描：抓取已定義的 Router 指令 (適配 v7 NodeRouter 寫法)
        const routerPattern = /text\.(?:startsWith|match)\(['"]\/?([a-zA-Z0-9_|]+)['"]\)/g;
        const foundCmds = new Set(['help', 'callme', 'patch']); // 預設指令
        let match;
        while ((match = routerPattern.exec(source)) !== null) {
            // 清理正則符號
            const cmdClean = match[1].replace(/\|/g, '/').replace(/[\^\(\)]/g, '');
            foundCmds.add(cmdClean);
        }

        // 3. 掃描 Skills
        let skillList = "基礎系統操作";
        try {
            skillList = Object.keys(skills).filter(k => k !== 'persona' && k !== 'getSystemPrompt').join(', ');
        } catch(e) {}

        return `
🤖 **Golem v7.1 (Self-Healing) 自我診斷報告**
---------------------------
⚡ **Node.js 反射層**: 線上
🧠 **Web Gemini 大腦**: 線上 (Infinite Context)
🚑 **DOM Doctor 技師**: 待命 (KeyChain Active)

🛠️ **可用指令 (源碼掃描):**
${Array.from(foundCmds).map(c => `• \`/${c}\``).join('\n')}

🧠 **搭載技能模組:**
• ${skillList}

💡 **提示:**
• 輸入 \`/patch [需求]\` 可手動觸發代碼進化。
• 遇到複雜問題直接對話，我會動用大腦思考。
`;
    }
}

// ============================================================
// 🗝️ KeyChain (API 金鑰輪動) [✨ v7.0 新增]
// ============================================================
class KeyChain {
    constructor() {
        this.keys = CONFIG.API_KEYS;
        this.currentIndex = 0;
        console.log(`🗝️ [KeyChain] 已載入 ${this.keys.length} 把 API Key，啟用 Round-Robin 輪動模式。`);
    }

    getKey() {
        if (this.keys.length === 0) return null;
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length; // Round-Robin
        return key;
    }
}

// ============================================================
// 🚑 DOM Doctor (UI 自癒模組) [✨ v7.0 新增]
// ============================================================
class DOMDoctor {
    constructor() {
        this.keyChain = new KeyChain();
    }

    async diagnose(htmlSnippet, targetDescription) {
        if (this.keyChain.keys.length === 0) {
            console.error("❌ [Doctor] 未設定任何 API Key，無法進行維修。");
            return null;
        }

        console.log(`🚑 [Doctor] 正在診斷 UI 問題: 尋找 "${targetDescription}"...`);
        const safeHtml = htmlSnippet.length > 20000 ? htmlSnippet.substring(0, 20000) + "..." : htmlSnippet;
        
        const prompt = `
        你是 Puppeteer 自動化專家。
        原本的 Selector 失效了。請分析下方的 HTML 片段。
        【目標】找出代表 "${targetDescription}" (如輸入框、發送按鈕) 的最佳 CSS Selector。
        【HTML】
        ${safeHtml}
        【要求】只回傳一個 CSS Selector 字串，不要解釋，不要 Markdown 格式。
        `;

        let attempts = 0;
        const maxAttempts = this.keyChain.keys.length;

        while (attempts < maxAttempts) {
            const currentKey = this.keyChain.getKey();
            try {
                const genAI = new GoogleGenerativeAI(currentKey);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const result = await model.generateContent(prompt);
                const newSelector = result.response.text().trim().replace(/`/g, '');
                console.log(`✅ [Doctor] 診斷成功！建議使用: ${newSelector}`);
                return newSelector;
            } catch (e) {
                console.warn(`⚠️ [Doctor] Key 呼叫失敗 (嘗試 ${attempts + 1}/${maxAttempts}): ${e.message}`);
                attempts++;
            }
        }
        console.error("❌ [Doctor] 所有 API Key 皆嘗試失敗，放棄治療。");
        return null;
    }
}

// ============================================================
// 🔍 System Fingerprint (環境感知) [🔒 保留 v6.4]
// ============================================================
function getSystemFingerprint() {
    return `OS: ${os.platform()} (${os.release()}) | Arch: ${os.arch()} | Shell: ${os.platform() === 'win32' ? 'PowerShell' : 'Bash'} | CWD: ${process.cwd()}`;
}

// ============================================================
// 🧠 Golem Brain (Web Gemini + Self-Healing) [✨ v7.0 重構]
// ============================================================
class GolemBrain {
    constructor() {
        this.browser = null;
        this.page = null;
        this.doctor = new DOMDoctor();
        // 動態 Selector
        this.selectors = {
            input: 'div[contenteditable="true"], rich-textarea > div',
            send: 'button[aria-label="Send"], span[data-icon="send"]',
            response: 'message-content, .model-response-text'
        };
    }

    async init(forceReload = false) {
        if (this.browser && !forceReload) return;
        if (!this.browser) {
            console.log('🧠 [Brain] 啟動 Web Gemini...');
            this.browser = await puppeteer.launch({
                headless: false,
                userDataDir: CONFIG.USER_DATA_DIR,
                args: ['--no-sandbox', '--window-size=1280,900']
            });
        }
        if (!this.page) {
            const pages = await this.browser.pages();
            this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
            await this.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
        }
        if (forceReload || !this.page) {
            const systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
            await this.sendMessage(systemPrompt, true);
        }
    }

    async sendMessage(text, isSystem = false) {
        if (!this.browser) await this.init();

        const tryInteract = async (sel) => {
            // 1. 輸入
            await this.page.waitForSelector(sel.input, { timeout: 4000 });
            await this.page.evaluate((s, t) => {
                const el = document.querySelector(s);
                el.focus();
                document.execCommand('insertText', false, t);
            }, sel.input, text);

            // 2. 發送
            await new Promise(r => setTimeout(r, 800));
            try {
                await this.page.waitForSelector(sel.send, { timeout: 2000 });
                await this.page.click(sel.send);
            } catch (e) {
                await this.page.keyboard.press('Enter');
            }

            if (isSystem) { await new Promise(r => setTimeout(r, 2000)); return ""; }

            // 3. 等待
            await this.page.waitForFunction(() => {
                const stopBtn = document.querySelector('[aria-label="Stop generating"], [aria-label="停止產生"]');
                const thinking = document.querySelector('.streaming-icon');
                return !stopBtn && !thinking;
            }, { timeout: 120000, polling: 1000 });

            // 4. 讀取
            return await this.page.evaluate((s) => {
                const bubbles = document.querySelectorAll(s);
                return bubbles.length ? bubbles[bubbles.length - 1].innerText : "";
            }, sel.response);
        };

        try {
            return await tryInteract(this.selectors);
        } catch (e) {
            console.warn(`⚠️ [Brain] 操作異常 (${e.message})，呼叫維修技師...`);
            try {
                const html = await this.page.content();
                const fixedInput = await this.doctor.diagnose(html, "Gemini 對話輸入框");
                if (fixedInput) {
                    this.selectors.input = fixedInput;
                    console.log("🛠️ [Brain] 輸入框修復完成，重試中...");
                    return await tryInteract(this.selectors);
                }
            } catch (retryErr) {
                throw new Error(`自癒失敗: ${retryErr.message}`);
            }
            throw e;
        }
    }
}

// ============================================================
// ⚡ ResponseParser (JSON 解析器) [✨ v7.0 新增 - 取代 Ollama]
// ============================================================
class ResponseParser {
    static extractJson(text) {
        if (!text) return [];
        try {
            // 嘗試提取 Markdown JSON
            const match = text.match(/```json([\s\S]*?)```/);
            if (match) {
                const parsed = JSON.parse(match[1]);
                return parsed.steps || (Array.isArray(parsed) ? parsed : []);
            }
            // 備案：直接提取 Array
            const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) {
                const steps = JSON.parse(arrayMatch[0]);
                return Array.isArray(steps) ? steps : [];
            }
        } catch (e) { console.error("解析 JSON 失敗:", e.message); }
        return [];
    }
}

// ============================================================
// ⚡ NodeRouter (反射層) [✨ v7.0 新增]
// ============================================================
class NodeRouter {
    static async handle(msg, bot, brain) {
        const text = msg.text ? msg.text.trim() : "";
        const chatId = msg.chat.id;

        // 1. 系統指令 (直接執行)
        if (text.match(/^\/(help|menu|指令|功能)/)) {
            await MessageManager.send(bot, chatId, HelpManager.getManual(), { parse_mode: 'Markdown' });
            return true;
        }
        
        // 2. 稱呼設定
        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                skills.persona.setName('user', newName);
                await brain.init(true);
                await MessageManager.send(bot, chatId, `👌 沒問題，以後我就稱呼您為 **${newName}**。`, { parse_mode: 'Markdown' });
                return true;
            }
        }

        // 3. Patch 意圖 (交給主循環)
        if (text.startsWith('/patch') || text.includes('優化代碼')) {
             return false; 
        }

        return false;
    }
}

// ============================================================
// ⚡ Task Controller & Executor [🔒 保留 v6.4]
// ============================================================
class Executor {
    run(cmd) {
        return new Promise((resolve, reject) => {
            console.log(`⚡ Exec: ${cmd}`);
            exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
                if (err) reject(stderr || err.message);
                else resolve(stdout);
            });
        });
    }
}

class TaskController {
    constructor() {
        this.executor = new Executor();
        this.security = new SecurityManager();
    }
    async runSequence(chatId, steps, startIndex = 0) {
        let logBuffer = "";
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            
            // 虛擬指令攔截 (v6.4 功能)
            if (step.cmd && step.cmd.trim() === 'golem-help') {
                 await MessageManager.send(bot, chatId, HelpManager.getManual(), { parse_mode: 'Markdown' });
                 continue;
            }

            const risk = this.security.assess(step.cmd);

            if (risk.level === 'BLOCKED') {
                await MessageManager.send(bot, chatId, `⛔ **攔截**：\`${step.cmd}\` (${risk.reason})`, { parse_mode: 'Markdown' });
                return;
            }
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                const approvalId = uuidv4();
                pendingTasks.set(approvalId, { steps: steps, nextIndex: i, chatId: chatId });
                await bot.sendMessage(chatId, `${risk.level === 'DANGER' ? '🔥' : '⚠️'} **請求確認**\n指令：\`${step.cmd}\`\n風險：${risk.reason}`, {
                    reply_markup: { inline_keyboard: [[{ text: '✅ 批准', callback_data: `APPROVE:${approvalId}` }, { text: '🛡️ 駁回', callback_data: `DENY:${approvalId}` }]] }
                });
                return;
            }

            await MessageManager.send(bot, chatId, `⚙️ *Step ${i + 1}:* ${step.desc}\n\`${step.cmd}\``, { parse_mode: 'Markdown' });
            try {
                const output = await this.executor.run(step.cmd);
                logBuffer += `✅ [${step.cmd}] OK\n`;
            } catch (err) {
                await MessageManager.send(bot, chatId, `❌ **失敗**：\`${step.cmd}\`\n${err}`);
                return;
            }
        }
        await MessageManager.send(bot, chatId, `🎉 **任務完成**\n${logBuffer}`);
    }
}

// ============================================================
// 🕰️ Autonomy Manager (自主進化) [🔒 保留 v6.4]
// ============================================================
class AutonomyManager {
    constructor(bot, brain, chatId) {
        this.bot = bot;
        this.brain = brain;
        this.chatId = chatId;
    }
    start() {
        if (!this.chatId) return;
        const now = Date.now();
        if (memory.data.nextWakeup > now) {
            const waitMs = memory.data.nextWakeup - now;
            console.log(`♻️ [Autonomy] 恢復排程，繼續休眠 ${(waitMs / 3600000).toFixed(2)} 小時`);
            setTimeout(() => { this.performSelfReflection(); this.scheduleNextAwakening(); }, waitMs);
        } else {
            this.scheduleNextAwakening();
        }
    }
    scheduleNextAwakening() {
        const waitMs = (18 + Math.random() * 12) * 3600000;
        memory.data.nextWakeup = Date.now() + waitMs;
        memory.save();
        setTimeout(() => { this.performSelfReflection(); this.scheduleNextAwakening(); }, waitMs);
    }
    async performSelfReflection() {
        try {
            const currentCode = Introspection.readSelf();
            const advice = memory.getAdvice();
            const prompt = `
            【任務】自主進化提案 (Autonomy Evolution)
            【角色】你是一個追求完美的 Node.js 專家。
            【原始碼】\n${currentCode.slice(0, 15000)}\n
            【記憶】${advice}
            【要求】
            1. 找出一個優化點 (效能、安全、功能)。
            2. 務必輸出一個 JSON Array，包含 Patch 物件。
            3. 格式範例：[{"type": "feature", "description": "說明", "search": "...", "replace": "..."}]
            4. 請直接輸出 JSON，用 \`\`\`json 包覆。
            `;
            
            const raw = await this.brain.sendMessage(prompt);
            const patches = ResponseParser.extractJson(raw);
            
            if (patches.length > 0) {
                const proposalType = patches[0].type || 'unknown';
                memory.recordProposal(proposalType);
                const testFile = PatchManager.createTestClone(__filename, patches);
                
                if (PatchManager.verify(testFile)) {
                    global.pendingPatch = testFile;
                    await MessageManager.send(this.bot, this.chatId, `💡 **自主進化提案** (${proposalType})\n內容：${patches[0].description}`, {
                        reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] }
                    });
                    await this.bot.sendDocument(this.chatId, testFile);
                }
            }
        } catch (e) { console.error("自主進化失敗:", e); }
    }
}

// ============================================================
// 🎮 主程式 (Main Loop)
// ============================================================
if (process.env.GOLEM_TEST_MODE === 'true') {
    console.log("🧪 [TestMode] 模組載入正常。");
    process.exit(0);
}

const brain = new GolemBrain();
const controller = new TaskController();
const autonomy = new AutonomyManager(bot, brain, CONFIG.ADMIN_ID);

(async () => {
    await brain.init();
    autonomy.start();
    console.log('📡 Golem v7.1 (Self-Healing) is Online.');
    
    if (CONFIG.ADMIN_ID) {
        const p = skills.persona.get();
        if (p.isNew) await MessageManager.send(bot, CONFIG.ADMIN_ID, `🎉 系統啟動！我是 ${p.aiName}。`);
    }
})();

// --- 輔助函式：部署與丟棄 ---
async function executeDeploy(chatId) {
    if (!global.pendingPatch) return;
    try {
        fs.copyFileSync(__filename, `index.bak-${Date.now()}.js`);
        fs.writeFileSync(__filename, fs.readFileSync(global.pendingPatch));
        fs.unlinkSync(global.pendingPatch);
        global.pendingPatch = null;
        memory.recordSuccess();
        await MessageManager.send(bot, chatId, "🚀 升級成功！正在重啟...");
        
        // 🔄 Ouroboros Respawn
        const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
        subprocess.unref();
        process.exit(0);
    } catch (e) { await MessageManager.send(bot, chatId, `❌ 部署失敗: ${e.message}`); }
}

async function executeDrop(chatId) {
    if (!global.pendingPatch) return;
    fs.unlinkSync(global.pendingPatch);
    global.pendingPatch = null;
    memory.recordRejection();
    await MessageManager.send(bot, chatId, "🗑️ 提案已丟棄");
}

// --- 事件監聽 ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;
    if (CONFIG.ADMIN_ID && String(chatId) !== CONFIG.ADMIN_ID) return;

    // 1. Node.js 反射層 (優先攔截)
    if (await NodeRouter.handle(msg, bot, brain)) return;

    // 2. Patch 意圖識別
    if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(text.toLowerCase())) return executeDeploy(chatId);
    if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(text.toLowerCase())) return executeDrop(chatId);

    // 3. 手動 Patch 請求
    if (text.startsWith('/patch') || text.includes('優化代碼')) {
         const req = text.replace('/patch', '').trim() || "優化代碼";
         await MessageManager.send(bot, chatId, `🧬 收到進化請求: ${req}`);
         
         const currentCode = Introspection.readSelf();
         const prompt = `【任務】代碼熱修復\n【需求】${req}\n【源碼】\n${currentCode.slice(0,12000)}\n【格式】輸出 JSON Array (Patch 格式)`;
         
         const raw = await brain.sendMessage(prompt);
         const patches = ResponseParser.extractJson(raw);
         
         if (patches.length > 0) {
            const testFile = PatchManager.createTestClone(__filename, patches);
            if (PatchManager.verify(testFile)) {
                global.pendingPatch = testFile;
                await MessageManager.send(bot, chatId, `💡 提案就緒，請查收附件。`, {
                    reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] }
                });
                await bot.sendDocument(chatId, testFile);
            }
         }
         return;
    }

    // 4. 一般對話 (進入大腦)
    bot.sendChatAction(chatId, 'typing');
    try {
        const raw = await brain.sendMessage(text);
        
        // 解析回應：分離對話與指令
        const steps = ResponseParser.extractJson(raw);
        const chatPart = raw.replace(/```json[\s\S]*?```/g, '').replace(/\[\s*\{[\s\S]*\}\s*\]/g, '').trim();

        // 輸出對話 (使用 MessageManager 防止爆字數)
        if (chatPart) await MessageManager.send(bot, chatId, chatPart);
        // 執行指令
        if (steps.length > 0) await controller.runSequence(chatId, steps);

    } catch (e) {
        console.error(e);
        await MessageManager.send(bot, chatId, `❌ 錯誤: ${e.message}`);
    }
});

bot.on('callback_query', async (query) => {
    const { id, data, message } = query;
    const chatId = message.chat.id;
    
    if (data === 'PATCH_DEPLOY') { await executeDeploy(chatId); return bot.answerCallbackQuery(id); }
    if (data === 'PATCH_DROP') { await executeDrop(chatId); return bot.answerCallbackQuery(id); }

    if (data.includes(':')) {
        const [action, taskId] = data.split(':');
        const task = pendingTasks.get(taskId);
        if (!task) return bot.answerCallbackQuery(id, { text: '任務失效' });
        
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: message.message_id });
        if (action === 'DENY') {
            pendingTasks.delete(taskId);
            await MessageManager.send(bot, chatId, '🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            const { steps, nextIndex } = task;
            pendingTasks.delete(taskId);
            await controller.runSequence(chatId, steps, nextIndex);
        }
        bot.answerCallbackQuery(id);
    }
});
