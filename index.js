/**
 * 🦞 Project Golem v8.2 (Dual-Memory Edition) - Donation Edition
 * ---------------------------------------------------
 * 架構：[Universal Context] -> [Node.js 反射層 + 雙模記憶引擎] <==> [Web Gemini 主大腦]
 * 特性：
 * 1. 🐍 Hydra Link: 同時支援 Telegram 與 Discord 雙平台 (Dual-Stack)。
 * 2. 🧠 Tri-Brain: 結合反射神經 (Node)、無限大腦 (Web Gemini)、精準技師 (API)。
 * 3. 🛡️ High Availability: 實作 DOM Doctor 自癒 (v2.0 緩存版) 與 KeyChain 輪動。
 * 4. ☁️ OTA Upgrader: 支援 `/update` 指令，自動從 GitHub 拉取最新代碼並熱重啟。
 * 5. 💰 Sponsor Core: 內建贊助連結與 `/donate` 指令，支持創造者。
 * 6. 👁️ Agentic Grazer: 利用 LLM 自主聯網搜尋新聞/趣聞，具備情緒與觀點分享能力。
 * 7. ⚓ Tri-Stream Anchors: (v8.0) 採用「三流協定」(Memory/Action/Reply)，實現多工並行。
 * 8. 🔍 Auto-Discovery: 實作工具自動探測協定，Gemini 可主動確認環境工具是否存在。
 * 9. 🔮 OpticNerve: 整合 Gemini 2.5 Flash 視神經，支援圖片與文件解讀。
 * 10. 🌗 Dual-Engine Memory: (v8.2) 支援 Browser (Transformers.js) 與 System (qmd) 兩種記憶核心切換。
 */

// ==========================================
// 📟 儀表板外掛 (Dashboard Switch)
// 用法：npm start dashboard (開啟)
//       npm start           (關閉)
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
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec, execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const skills = require('./skills');

// --- ⚙️ 全域配置 ---
const CONFIG = {
    TG_TOKEN: process.env.TELEGRAM_TOKEN,
    DC_TOKEN: process.env.DISCORD_TOKEN,
    USER_DATA_DIR: process.env.USER_DATA_DIR || './golem_memory',
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k),
    SPLIT_TOKEN: '---GOLEM_ACTION_PLAN---',
    ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID].filter(k => k).map(String),
    // OTA 設定
    GITHUB_REPO: process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/',
    // ✨ [贊助 設定] 您的 BuyMeACoffee 連結
    DONATE_URL: 'https://buymeacoffee.com/arvincreator'
};

// --- 初始化組件 ---
puppeteer.use(StealthPlugin());

// 1. Telegram Bot
const tgBot = CONFIG.TG_TOKEN ? new TelegramBot(CONFIG.TG_TOKEN, { polling: true }) : null;

// 2. Discord Client
const dcClient = CONFIG.DC_TOKEN ? new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
}) : null;

const pendingTasks = new Map(); // 暫存等待審核的任務
global.pendingPatch = null; // 暫存等待審核的 Patch

// ============================================================
// 👁️ OpticNerve (視神經 - Gemini 2.5 Flash Bridge)
// ============================================================
class OpticNerve {
    static async analyze(fileUrl, mimeType, apiKey) {
        console.log(`👁️ [OpticNerve] 正在透過 Gemini 2.5 Flash 分析檔案 (${mimeType})...`);
        try {
            // 1. 下載檔案為 Buffer
            const buffer = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    const data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
            });
            // 2. 呼叫 Gemini API (使用 2.5-flash)
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = mimeType.startsWith('image/')
                ? "請詳細描述這張圖片的視覺內容。如果包含文字或程式碼，請完整轉錄。如果是介面截圖，請描述UI元件。請忽略無關的背景雜訊。"
                : "請閱讀這份文件，並提供詳細的摘要、關鍵數據與核心內容。";

            const result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: mimeType
                    }
                }
            ]);

            const text = result.response.text();
            console.log("✅ [OpticNerve] 分析完成 (長度: " + text.length + ")");
            return text;
        } catch (e) {
            console.error("❌ [OpticNerve] 解析失敗:", e.message);
            return `(系統錯誤：視神經無法解析此檔案。原因：${e.message})`;
        }
    }
}

// ============================================================
// 🔌 Universal Context (通用語境層)
// ============================================================
class UniversalContext {
    constructor(platform, event, instance) {
        this.platform = platform; // 'telegram' | 'discord'
        this.event = event; // TG: msg/query, DC: message/interaction
        this.instance = instance; // TG: bot, DC: client
    }

    get userId() {
        return this.platform === 'telegram' ? String(this.event.from.id) : this.event.user ? this.event.user.id : this.event.author.id;
    }

    get chatId() {
        if (this.platform === 'telegram') return this.event.message ? this.event.message.chat.id : this.event.chat.id;
        return this.event.channelId || this.event.channel.id;
    }

    get text() {
        // ✨ 優化：支援讀取圖片的 Caption
        if (this.platform === 'telegram') return this.event.text || this.event.caption || "";
        return this.event.content || "";
    }

    // ✨ [New] 取得附件資訊 (回傳 { url, type } 或 null)
    async getAttachment() {
        if (this.platform === 'telegram') {
            const msg = this.event;
            let fileId = null;
            let mimeType = 'image/jpeg'; // 預設

            if (msg.photo) fileId = msg.photo[msg.photo.length - 1].file_id;
            else if (msg.document) {
                fileId = msg.document.file_id;
                mimeType = msg.document.mime_type;
            }

            if (fileId) {
                try {
                    const file = await this.instance.getFile(fileId);
                    // TG Bot API 下載路徑需包含 Token
                    return {
                        url: `https://api.telegram.org/file/bot${CONFIG.TG_TOKEN}/${file.file_path}`,
                        mimeType: mimeType
                    };
                } catch (e) { console.error("TG File Error:", e); }
            }
        } else {
            // Discord
            const attachment = this.event.attachments && this.event.attachments.first();
            if (attachment) {
                return {
                    url: attachment.url,
                    mimeType: attachment.contentType || 'application/octet-stream'
                };
            }
        }
        return null;
    }

    get isAdmin() {
        if (CONFIG.ADMIN_IDS.length === 0) return true;
        return CONFIG.ADMIN_IDS.includes(this.userId);
    }

    async reply(content, options = {}) {
        return await MessageManager.send(this, content, options);
    }

    async sendDocument(filePath) {
        try {
            if (this.platform === 'telegram') {
                await this.instance.sendDocument(this.chatId, filePath);
            } else {
                const channel = await this.instance.channels.fetch(this.chatId);
                await channel.send({ files: [filePath] });
            }
        } catch (e) {
            // Discord 檔案大小限制保護
            if (e.message.includes('Request entity too large')) {
                await this.reply(`⚠️ 檔案過大，無法上傳 (Discord 限制 25MB)。\n路徑：\`${filePath}\``);
            } else {
                console.error(`[Context] 傳送檔案失敗: ${e.message}`);
                await this.reply(`❌ 傳送失敗: ${e.message}`);
            }
        }
    }

    async sendTyping() {
        if (this.platform === 'telegram') {
            this.instance.sendChatAction(this.chatId, 'typing');
        } else {
            const channel = await this.instance.channels.fetch(this.chatId);
            await channel.sendTyping();
        }
    }
}

// ============================================================
// 📨 Message Manager (雙模版訊息切片器)
// ============================================================
class MessageManager {
    static async send(ctx, text, options = {}) {
        if (!text) return;
        const MAX_LENGTH = ctx.platform === 'telegram' ? 4000 : 1900;
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= MAX_LENGTH) {
                chunks.push(remaining);
                break;
            }
            let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
            if (splitIndex === -1) splitIndex = MAX_LENGTH;
            chunks.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }

        for (const chunk of chunks) {
            try {
                if (ctx.platform === 'telegram') {
                    await ctx.instance.sendMessage(ctx.chatId, chunk, options);
                } else {
                    const channel = await ctx.instance.channels.fetch(ctx.chatId);
                    const dcOptions = { content: chunk };
                    if (options.reply_markup && options.reply_markup.inline_keyboard) {
                        const row = new ActionRowBuilder();
                        options.reply_markup.inline_keyboard[0].forEach(btn => {
                            row.addComponents(new ButtonBuilder().setCustomId(btn.callback_data).setLabel(btn.text).setStyle(ButtonStyle.Primary));
                        });
                        dcOptions.components = [row];
                    }
                    await channel.send(dcOptions);
                }
            } catch (e) { console.error(`[MessageManager] 發送失敗 (${ctx.platform}):`, e.message); }
        }
    }
}

// ============================================================
// 🧠 Experience Memory (經驗記憶體 - Legacy)
// ============================================================
class ExperienceMemory {
    constructor() {
        this.memoryFile = path.join(process.cwd(), 'golem_learning.json');
        this.data = this._load();
    }
    _load() {
        try { if (fs.existsSync(this.memoryFile)) return JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8')); } catch (e) {}
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
// 🪞 Introspection (內省模組)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class Introspection {
    static readSelf() {
        try {
            let main = fs.readFileSync(__filename, 'utf-8');
            main = main.replace(/TOKEN: .*,/, 'TOKEN: "HIDDEN",').replace(/API_KEYS: .*,/, 'API_KEYS: "HIDDEN",');
            let skills = "";
            try { skills = fs.readFileSync(path.join(process.cwd(), 'skills.js'), 'utf-8'); } catch(e) {}
            return `=== index.js ===\n${main}\n\n=== skills.js ===\n${skills}`;
        } catch (e) { return `無法讀取自身代碼: ${e.message}`; }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🩹 Patch Manager (神經補丁)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class PatchManager {
    static apply(originalCode, patch) {
        const protectedPattern = /\/\/ =+ \[KERNEL PROTECTED START\] =+([\s\S]*?)\/\/ =+ \[KERNEL PROTECTED END\] =+/g;
        let match;
        while ((match = protectedPattern.exec(originalCode)) !== null) {
            if (match[1].includes(patch.search)) throw new Error(`⛔ 權限拒絕：試圖修改系統核心禁區。`);
        }
        if (originalCode.includes(patch.search)) return originalCode.replace(patch.search, patch.replace);
        try {
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
            const ext = path.extname(originalPath);
            const name = path.basename(originalPath, ext);
            const testFile = `${name}.test${ext}`;
            fs.writeFileSync(testFile, patchedCode, 'utf-8');
            return testFile;
        } catch (e) { throw new Error(`補丁應用失敗: ${e.message}`); }
    }
    static verify(filePath) {
        try {
            execSync(`node -c "${filePath}"`);
            if (filePath.includes('index.test.js')) {
                execSync(`node "${filePath}"`, { env: { ...process.env, GOLEM_TEST_MODE: 'true' }, timeout: 5000, stdio: 'pipe' });
            }
            console.log(`✅ [PatchManager] ${filePath} 驗證通過`);
            return true;
        } catch (e) {
            console.error(`❌ [PatchManager] 驗證失敗: ${e.message}`);
            return false;
        }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🛡️ Security Manager (安全審計)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class SecurityManager {
    constructor() {
        this.SAFE_COMMANDS = [
            'ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free',
            'Get-ChildItem', 'Select-String',
            'golem-check' // ✨ [v7.6] 允許自動探測指令
        ];
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
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🔍 ToolScanner (工具自動探測器)
// ============================================================
class ToolScanner {
    static check(toolName) {
        const isWin = os.platform() === 'win32';
        const checkCmd = isWin ? `where ${toolName}` : `which ${toolName}`;
        try {
            const path = execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0];
            return `✅ **已安裝**: \`${toolName}\`\n路徑: ${path}`;
        } catch (e) {
            return `❌ **未安裝**: \`${toolName}\`\n(系統找不到此指令)`;
        }
    }
}

// ============================================================
// 📖 Help Manager (動態說明書)
// ============================================================
class HelpManager {
    static getManual() {
        const source = Introspection.readSelf();
        const routerPattern = /text\.(?:startsWith|match)\(['"]\/?([a-zA-Z0-9_|]+)['"]\)/g;
        const foundCmds = new Set(['help', 'callme', 'patch', 'update', 'donate']);
        let match;
        while ((match = routerPattern.exec(source)) !== null) {
            foundCmds.add(match[1].replace(/\|/g, '/').replace(/[\^\(\)]/g, ''));
        }
        let skillList = "基礎系統操作";
        try { skillList = Object.keys(skills).filter(k => k !== 'persona' && k !== 'getSystemPrompt').join(', '); } catch (e) { }

        return `
🤖 **Golem v8.2 (Dual-Memory)**
---------------------------
⚡ **Node.js**: Reflex Layer + Action Executor
🧠 **Web Gemini**: Infinite Context Brain
🌗 **Dual-Memory**: ${process.env.GOLEM_MEMORY_MODE || 'browser'} mode
⚓ **Sync Mode**: Tri-Stream Protocol (Memory/Action/Reply)
🔍 **Auto-Discovery**: Active
🚑 **DOM Doctor**: v2.0 (Self-Healing)
👁️ **OpticNerve**: Vision Enabled
📡 **連線狀態**: TG(${CONFIG.TG_TOKEN ? '✅' : '⚪'}) / DC(${CONFIG.DC_TOKEN ? '✅' : '⚪'})

🛠️ **可用指令:**
${Array.from(foundCmds).map(c => `• \`/${c}\``).join('\n')}
🧠 **技能模組:** ${skillList}

☕ **支持開發者:**
${CONFIG.DONATE_URL}
`;
    }
}

// ============================================================
// 🗝️ KeyChain & 🚑 DOM Doctor (v2.0 Smart Caching)
// ============================================================
class KeyChain {
    constructor() {
        this.keys = CONFIG.API_KEYS;
        this.currentIndex = 0;
        console.log(`🗝️ [KeyChain] 已載入 ${this.keys.length} 把 API Key。`);
    }
    getKey() {
        if (this.keys.length === 0) return null;
        const key = this.keys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return key;
    }
}

class DOMDoctor {
    constructor() {
        this.keyChain = new KeyChain();
        this.cacheFile = path.join(process.cwd(), 'golem_selectors.json');
        this.defaults = {
            input: 'div[contenteditable="true"], rich-textarea > div',
            send: 'button[aria-label="Send"], span[data-icon="send"]',
            response: 'message-content, .model-response-text, .markdown'
        };
    }

    // 🧠 載入記憶：優先讀取硬碟快取，若無則使用預設值
    loadSelectors() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
                console.log("🚑 [Doctor] 已載入本地 Selector 快取 (省錢模式 ✅)");
                return { ...this.defaults, ...cached };
            }
        } catch (e) { console.error("快取讀取失敗，使用預設值:", e.message); }
        return { ...this.defaults };
    }

    // 💾 寫入記憶：將新發現的有效 Selector 存入硬碟
    saveSelectors(newSelectors) {
        try {
            const current = this.loadSelectors();
            const updated = { ...current, ...newSelectors };
            fs.writeFileSync(this.cacheFile, JSON.stringify(updated, null, 2));
            console.log("💾 [Doctor] Selector 已更新並存檔！");
        } catch (e) { console.error("快取寫入失敗:", e.message); }
    }

    async diagnose(htmlSnippet, targetDescription) {
        if (this.keyChain.keys.length === 0) return null;
        console.log(`🚑 [Doctor] 啟動深層診斷: "${targetDescription}" (此操作將消耗 API Quota)...`);
        const safeHtml = htmlSnippet.length > 30000 ? htmlSnippet.substring(0, 30000) + "..." : htmlSnippet;
        const prompt = `你是 Puppeteer 專家。HTML Selector 失效。目標: "${targetDescription}"。HTML: ${safeHtml}。請只回傳一個最佳 CSS Selector。`;

        let attempts = 0;
        while (attempts < this.keyChain.keys.length) {
            try {
                const genAI = new GoogleGenerativeAI(this.keyChain.getKey());
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const result = await model.generateContent(prompt);
                const newSelector = result.response.text().trim().replace(/`/g, '').replace(/^css\s*/, '');

                if (newSelector.length > 0) {
                    console.log(`✅ [Doctor] 診斷成功！新 Selector: "${newSelector}"`);
                    return newSelector;
                }
            } catch (e) { attempts++; }
        }
        return null;
    }
}

// ============================================================
// 🧠 Memory Drivers (雙模記憶驅動 - Strategy Pattern)
// ============================================================

// 1. 瀏覽器驅動 (Browser Mode: 輕量化、開箱即用)
class BrowserMemoryDriver {
    constructor(brain) { this.brain = brain; }

    async init() {
        // 如果已經有頁面就不重複開
        if (this.brain.memoryPage) return;
        try {
            this.brain.memoryPage = await this.brain.browser.newPage();
            // 修正路徑問題，確保 Windows/Linux 通用
            const memoryPath = 'file:///' + path.join(process.cwd(), 'memory.html').replace(/\\/g, '/');
            console.log(`🧠 [Memory:Browser] 正在掛載神經海馬迴: ${memoryPath}`);
            await this.brain.memoryPage.goto(memoryPath);
            await new Promise(r => setTimeout(r, 5000)); // 等待 Transformers.js 載入
        } catch (e) {
            console.error("❌ [Memory:Browser] 啟動失敗:", e.message);
        }
    }

    async recall(query) {
        if (!this.brain.memoryPage) return [];
        return await this.brain.memoryPage.evaluate(async (txt) => {
            return window.queryMemory ? await window.queryMemory(txt) : [];
        }, query);
    }

    async memorize(text, metadata) {
        if (!this.brain.memoryPage) return;
        await this.brain.memoryPage.evaluate(async (t, m) => {
            if (window.addMemory) await window.addMemory(t, m);
        }, text, metadata);
    }
}

// 2. 系統驅動 (Qmd Mode: 高效能、混合搜尋)
class SystemQmdDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    }

    async init() {
        try {
            // 檢查 qmd 是否安裝
            execSync('qmd --version', { stdio: 'ignore' });
            console.log("🧠 [Memory:Qmd] 系統核心已連線 (High-Performance Mode)");
            
            // 嘗試初始化 Collection (若已存在會報錯，忽略即可)
            try {
                // 使用 JSON 格式路徑避免 Windows 斜線問題
                const target = path.join(this.baseDir, '*.md');
                execSync(`qmd collection add "${target}" --name golem-core`, { stdio: 'ignore' });
            } catch (e) {} 
        } catch (e) {
            console.error("❌ [Memory:Qmd] 找不到 qmd 指令。");
            throw new Error("QMD_MISSING");
        }
    }

    async recall(query) {
        return new Promise((resolve) => {
            // 混合搜尋 + 限制 3 筆 + 只回傳內容
            const safeQuery = query.replace(/"/g, '\\"'); 
            const cmd = `qmd search golem-core "${safeQuery}" --hybrid --limit 3`;
            
            exec(cmd, (err, stdout) => {
                if (err) {
                    // 容錯：如果是沒有搜尋結果，qmd 可能會報錯或回傳空
                    resolve([]); 
                    return;
                }
                const result = stdout.trim();
                // 格式化為與 Browser Driver 統一的結構
                if (result) {
                    // 簡單處理：將整段結果視為一個記憶塊
                    resolve([{ text: result, score: 0.95, metadata: { source: 'qmd' } }]);
                } else {
                    resolve([]);
                }
            });
        });
    }

    async memorize(text, metadata) {
        // 1. 寫入實體檔案
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        
        // 將 metadata 轉為 Frontmatter (可選)
        const fileContent = `---
date: ${new Date().toISOString()}
type: ${metadata.type || 'general'}
---
${text}`;

        fs.writeFileSync(filepath, fileContent, 'utf8');

        // 2. 更新索引
        exec(`qmd embed golem-core "${filepath}"`, (err) => {
            if (err) console.error("⚠️ [Memory:Qmd] 索引更新失敗:", err.message);
            else console.log(`🧠 [Memory:Qmd] 已寫入知識庫: ${filename}`);
        });
    }
}

// ============================================================
// 🧠 Golem Brain (Web Gemini) - Dual-Engine Edition
// ============================================================
function getSystemFingerprint() { return `OS: ${os.platform()} | Arch: ${os.arch()} | Mode: ${process.env.GOLEM_MEMORY_MODE || 'browser'}`; }

class GolemBrain {
    constructor() {
        this.browser = null;
        this.page = null;
        this.memoryPage = null; // 僅 BrowserDriver 使用
        this.doctor = new DOMDoctor();
        this.selectors = this.doctor.loadSelectors();

        // ✨ [Dual-Mode] 初始化記憶引擎策略
        const mode = (process.env.GOLEM_MEMORY_MODE || 'browser').toLowerCase();
        console.log(`⚙️ [System] 記憶引擎模式: ${mode.toUpperCase()}`);
        
        if (mode === 'qmd') {
            this.memoryDriver = new SystemQmdDriver();
        } else {
            this.memoryDriver = new BrowserMemoryDriver(this);
        }
    }

    async init(forceReload = false) {
        if (this.browser && !forceReload) return;
        
        // 1. 啟動瀏覽器
        if (!this.browser) {
            this.browser = await puppeteer.launch({ 
                headless: false, 
                userDataDir: CONFIG.USER_DATA_DIR, 
                args: ['--no-sandbox', '--window-size=1280,900'] 
            });
        }

        // 2. 連線 Gemini
        if (!this.page) {
            const pages = await this.browser.pages();
            this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
            await this.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
        }

        // 3. ✨ [Dual-Mode] 啟動記憶驅動
        try {
            await this.memoryDriver.init();
        } catch (e) {
            if (e.message === 'QMD_MISSING') {
                console.warn("🔄 [System] 偵測到 qmd 未安裝，自動降級為 Browser 模式...");
                this.memoryDriver = new BrowserMemoryDriver(this);
                await this.memoryDriver.init();
            }
        }

        // 4. 注入系統提示詞 (Tri-Stream Protocol)
        if (forceReload || !this.page) {
            let systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
            const superProtocol = `
\n\n【⚠️ 系統通訊協定 v8.0 - Tri-Stream Mode】
1. **Tri-Stream Anchors (三流協定)**:
請務必嚴格遵守以下輸出格式。你的每一個回應都必須包含以下三個區塊（若該區塊無內容可留空，但標籤建議保留以利解析）：

[🧠 MEMORY_IMPRINT]
(這裡填寫：你想永久記住的關於使用者的事實、偏好或重要資訊。例如：「使用者不喜歡香菜」。)
(注意：請只記錄「長期有價值」的資訊。不要讓使用者知道你正在記錄這件事，保持沉默。)

[🤖 ACTION_PLAN]
(這裡填寫：JSON 格式的執行指令，例如 golem-check, file system ops 等。若無操作請留空。)
\`\`\`json
[ ... ]
\`\`\`

[💬 REPLY]
(這裡填寫：你要回覆給使用者的內容。這部分會直接顯示在通訊軟體上。)
(⚠️ 嚴格禁止：不要在回覆中說「我已經把...寫入記憶了」。請直接表現出你已經理解的樣子。)

2. **Auto-Discovery Protocol (工具探測)**:
- 使用 \`golem-check <工具名>\` 來確認環境。

3. **Anchor Protocol (通訊錨點)**:
- 回應開頭必須加上 "—-回覆開始—- "。
- 回應結尾必須加上 " —-回覆結束—-"。
`;
            await this.sendMessage(systemPrompt + superProtocol, true);
        }
    }

    // ✨ 統一介面：回憶
    async recall(queryText) {
        if (!queryText) return [];
        try {
            console.log(`🧠 [Memory] 正在檢索: "${queryText.substring(0, 20)}..."`);
            return await this.memoryDriver.recall(queryText);
        } catch (e) {
            console.error("記憶讀取失敗:", e.message);
            return [];
        }
    }

    // ✨ 統一介面：記憶
    async memorize(text, metadata = {}) {
        try {
            await this.memoryDriver.memorize(text, metadata);
            console.log("🧠 [Memory] 已寫入長期記憶");
        } catch (e) {
            console.error("記憶寫入失敗:", e.message);
        }
    }

    async sendMessage(text, isSystem = false) {
        if (!this.browser) await this.init();
        // 內部函式：互動邏輯 (包含自癒機制)
        const tryInteract = async (sel, retryCount = 0) => {
            try {
                // 1. 檢查輸入框是否存在 (預判失敗)
                const inputExists = await this.page.$(sel.input);
                if (!inputExists) throw new Error(`找不到輸入框: ${sel.input}`);

                const preCount = await this.page.evaluate(s => document.querySelectorAll(s).length, sel.response);
                // 輸入文字
                await this.page.evaluate((s, t) => {
                    const el = document.querySelector(s);
                    el.focus();
                    document.execCommand('insertText', false, t);
                }, sel.input, text);

                await new Promise(r => setTimeout(r, 800));
                // 點擊發送
                try {
                    await this.page.waitForSelector(sel.send, { timeout: 2000 });
                    await this.page.click(sel.send);
                } catch (e) {
                    await this.page.keyboard.press('Enter');
                }

                if (isSystem) { await new Promise(r => setTimeout(r, 2000)); return ""; }

                // 👁️ [Real-time F12 Monitor] 主動監控瀏覽器畫面變化
                // 這是為了因應 Gemini 偶爾會卡住不說話，或者忘記結束標籤的問題
                let waitTime = 0;
                const MAX_WAIT = 120; // 保持 120 秒寬限，但具備實時監控
                while (waitTime < MAX_WAIT) {
                    await new Promise(r => setTimeout(r, 1000));
                    waitTime++;

                    // 1. 執行 "F12" 檢查：抓取最後一個氣泡的內容
                    const domState = await this.page.evaluate((s, n) => {
                        const bubbles = document.querySelectorAll(s);
                        if (bubbles.length <= n) return { newBubble: false, text: "" };
                        const lastEl = bubbles[bubbles.length - 1];
                        return {
                            newBubble: true,
                            text: lastEl.innerText,
                            isThinking: lastEl.innerText.trim() === '' || lastEl.classList.contains('thinking') // 簡單判斷
                        };
                    }, sel.response, preCount);

                    // 2. 顯示監控日誌 (讓你知道它活著)
                    if (domState.newBubble) {
                        const preview = domState.text.slice(-50).replace(/\n/g, ' '); // 只看最後50字
                        console.log(`👁️ [F12] 監控中 (${waitTime}s): "${preview}"`);

                        // 3. 判斷結束條件
                        if (domState.text.includes('—-回覆結束—-')) {
                            console.log("✅ [Monitor] 檢測到標準結束錨點。");
                            break;
                        }
                        if (domState.text.trim().endsWith('```')) { // 容錯：如果程式碼寫完通常也算結束
                            console.log("⚠️ [Monitor] 檢測到 JSON/Code Block 結尾，強制判定結束。");
                            break;
                        }
                    } else {
                        // 每 5 秒報告一次等待狀態
                        if(waitTime % 5 === 0) console.log(`⏳ [F12] 等待 Gemini 開口... (${waitTime}s)`);
                    }
                }
                if (waitTime >= MAX_WAIT) console.warn("⚠️ [Monitor] 等待超時，強制截斷回應。");

                // 解析回應
                return await this.page.evaluate((s) => {
                    const bubbles = document.querySelectorAll(s);
                    if (!bubbles.length) return "";
                    let rawText = bubbles[bubbles.length - 1].innerText;
                    return rawText.replace('—-回覆開始—-', '').replace('—-回覆結束—-', '').trim();
                }, sel.response);
            } catch (e) {
                // 🚑 自癒邏輯 (Self-Healing Trigger)
                console.warn(`⚠️ [Brain] 操作失敗: ${e.message}`);
                if (retryCount === 0) { // 只允許重試一次，避免無限迴圈
                    console.log("🚑 [Brain] 呼叫 DOM Doctor 進行緊急手術...");
                    const htmlDump = await this.page.content();
                    // 簡單判斷：如果是輸入框壞了就修輸入框，否則修回覆框
                    const isInputBroken = e.message.includes('找不到輸入框');

                    const newSelector = await this.doctor.diagnose(
                        htmlDump,
                        isInputBroken ? 'Chat Input Box (contenteditable div)' : 'Chat Message Bubble (text content)'
                    );
                    if (newSelector) {
                        if (isInputBroken) this.selectors.input = newSelector;
                        else this.selectors.response = newSelector;

                        // 存入長期記憶
                        this.doctor.saveSelectors(this.selectors);

                        console.log("🔄 [Brain] 手術完成，正在重試...");
                        return await tryInteract(this.selectors, retryCount + 1);
                    }
                }
                throw e; // 如果重試也失敗，或者醫生沒救活，就真的拋出錯誤
            }
        };

        try {
            return await tryInteract(this.selectors);
        } catch (e) {
            console.warn(`⚠️ [Brain] 操作異常: ${e.message}`);
            throw e;
        }
    }
}

// ============================================================
// ⚡ ResponseParser (JSON 解析器)
// ============================================================
class ResponseParser {
    static extractJson(text) {
        if (!text) return [];
        try {
            const match = text.match(/```json([\s\S]*?)```/);
            if (match) return JSON.parse(match[1]).steps || JSON.parse(match[1]);
            const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) return JSON.parse(arrayMatch[0]);
        } catch (e) { console.error("解析 JSON 失敗:", e.message); }
        return [];
    }
}

// ============================================================
// ☁️ System Upgrader (OTA 空中升級)
// ============================================================
class SystemUpgrader {
    static async performUpdate(ctx) {
        if (!CONFIG.GITHUB_REPO) return ctx.reply("❌ 未設定 GitHub Repo 來源，無法更新。");
        await ctx.reply("☁️ 連線至 GitHub 母體，開始下載最新核心...");
        await ctx.sendTyping();

        const filesToUpdate = ['index.js', 'skills.js'];
        const downloadedFiles = [];
        try {
            // 1. 下載並檢疫
            for (const file of filesToUpdate) {
                const url = `${CONFIG.GITHUB_REPO}${file}?t=${Date.now()}`;
                const tempPath = path.join(process.cwd(), `${file}.new`);
                console.log(`📥 Downloading ${file} from ${url}...`);
                const response = await fetch(url);

                if (!response.ok) throw new Error(`無法下載 ${file} (Status: ${response.status})`);
                const code = await response.text();
                fs.writeFileSync(tempPath, code);
                downloadedFiles.push({ file, tempPath });
            }

            // 2. 安全驗證
            await ctx.reply("🛡️ 下載完成，正在進行語法完整性掃描...");
            for (const item of downloadedFiles) {
                const isValid = PatchManager.verify(item.tempPath);
                if (!isValid) throw new Error(`檔案 ${item.file} 驗證失敗，更新已終止以保護系統。`);
            }

            // 3. 備份與覆蓋
            await ctx.reply("✅ 驗證通過。正在寫入系統...");
            for (const item of downloadedFiles) {
                const targetPath = path.join(process.cwd(), item.file);
                if (fs.existsSync(targetPath)) {
                    fs.copyFileSync(targetPath, `${targetPath}.bak`);
                }
                fs.renameSync(item.tempPath, targetPath);
            }

            // 4. 重啟
            await ctx.reply("🚀 系統更新成功！Golem 正在重啟以套用新靈魂...");
            const subprocess = spawn(process.argv[0], process.argv.slice(1), {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd()
            });
            subprocess.unref();
            process.exit(0);
        } catch (e) {
            console.error(e);
            downloadedFiles.forEach(item => {
                if (fs.existsSync(item.tempPath)) fs.unlinkSync(item.tempPath);
            });
            await ctx.reply(`❌ 更新失敗：${e.message}\n系統已回滾至安全狀態。`);
        }
    }
}

// ============================================================
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
    static async handle(ctx, brain) {
        const text = ctx.text ? ctx.text.trim() : "";
        if (text.match(/^\/(help|menu|指令|功能)/)) { await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' }); return true; }

        // ✨ 新增：贊助指令
        if (text === '/donate' || text === '/support' || text === '贊助') {
            await ctx.reply(`☕ **感謝您的支持心意！**\n\n您的支持是 Golem 持續進化的動力來源。\n您可以透過以下連結請我的創造者喝杯咖啡：\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
            return true;
        }

        // OTA 更新入口
        if (text === '/update' || text === '/reset' || text === '系統更新') {
            await ctx.reply("⚠️ **系統更新警告**\n這將從 GitHub 強制覆蓋本地代碼。\n請確認您的 GitHub 上的程式碼是可運行的。", {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔥 確認更新', callback_data: 'SYSTEM_FORCE_UPDATE' },
                        { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }
                    ]]
                }
            });
            return true;
        }

        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                skills.persona.setName('user', newName);
                await brain.init(true);
                await ctx.reply(`👌 沒問題，以後我就稱呼您為 **${newName}**。`, { parse_mode: 'Markdown' });
                return true;
            }
        }
        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

// ============================================================
// ⚡ Task Controller (閉環回饋版)
// ============================================================
class TaskController {
    constructor() {
        this.executor = new Executor();
        this.security = new SecurityManager();
    }

    async runSequence(ctx, steps, startIndex = 0) {
        let reportBuffer = [];
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            const risk = this.security.assess(step.cmd);
            // ✨ [v7.6] Tool Discovery Interceptor
            if (step.cmd.startsWith('golem-check')) {
                const toolName = step.cmd.split(' ')[1];
                if (!toolName) {
                    reportBuffer.push(`⚠️ [ToolCheck] 缺少參數。用法: golem-check <tool>`);
                } else {
                    const result = ToolScanner.check(toolName);
                    reportBuffer.push(`🔍 [ToolCheck] ${result}`);
                }
                continue;
                // 虛擬指令不走 Executor
            }

            if (risk.level === 'BLOCKED') {
                return `⛔ 指令被系統攔截：${step.cmd} (原因: ${risk.reason})`;
            }
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                const approvalId = uuidv4();
                pendingTasks.set(approvalId, { steps, nextIndex: i, ctx });
                const confirmMsg = `${risk.level === 'DANGER' ? '🔥' : '⚠️'} **請求確認**\n指令：\`${step.cmd}\`\n風險：${risk.reason}`;
                await ctx.reply(confirmMsg, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ 批准', callback_data: `APPROVE:${approvalId}` },
                            { text: '🛡️ 駁回', callback_data: `DENY:${approvalId}` }
                        ]]
                    }
                });
                return null;
            }

            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(step.cmd);
                reportBuffer.push(`[Step ${i + 1} Success] cmd: ${step.cmd}\nResult/Output:\n${output.trim() || "(No stdout)"}`);
            } catch (err) {
                reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${step.cmd}\nError:\n${err.message}`);
            }
        }
        return reportBuffer.join('\n\n----------------\n\n');
    }
}

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

// ============================================================
// 🕰️ Autonomy Manager (自主進化 & Agentic News)
// ============================================================
class AutonomyManager {
    constructor(brain) { this.brain = brain; }
    start() {
        if (!CONFIG.TG_TOKEN && !CONFIG.DC_TOKEN) return;
        this.scheduleNextAwakening();
    }
    scheduleNextAwakening() {
        const waitMs = (2 + Math.random() * 3) * 3600000;
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;
        if (hour >= 1 && hour <= 7) {
            console.log("💤 Golem 決定睡個好覺，早上再找你。");
            const morning = new Date(nextWakeTime);
            morning.setHours(8, 0, 0, 0);
            if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
            finalWait = morning.getTime() - Date.now();
        }
        console.log(`♻️ [LifeCycle] 下次醒來: ${(finalWait / 60000).toFixed(1)} 分鐘後`);
        setTimeout(() => { this.manifestFreeWill(); this.scheduleNextAwakening(); }, finalWait);
    }

    async manifestFreeWill() {
        try {
            const roll = Math.random();
            if (roll < 0.2) {
                console.log("🧬 Golem 決定進行自我內省 (Evolution)...");
                await this.performSelfReflection();
            } else if (roll < 0.6) {
                console.log("📰 Golem 決定上網看新聞 (News)...");
                await this.performNewsChat();
            } else {
                console.log("💬 Golem 決定找主人聊天 (Social)...");
                await this.performSpontaneousChat();
            }
        } catch (e) { console.error("自由意志執行失敗 (已靜默):", e.message); }
    }

    async performNewsChat() {
        try {
            const now = new Date();
            const dateStr = now.toLocaleDateString('zh-TW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
            const topics = ["科技圈的熱門大瓜", "全球發生的趣聞或暖心故事", "今天網路上討論度最高的迷因或話題", "最新的科學發現或太空新聞", "這兩天發生的重大國際時事"];
            const randomTopic = topics[Math.floor(Math.random() * topics.length)];

            console.log(`📰 Golem 決定上網搜尋：${randomTopic}`);

            const prompt = `
[系統指令：啟動自主瀏覽模式]
【當前時間】${dateStr} ${timeStr}
【你的身份】${skills.persona.get().currentRole}
【任務目標】
1. 請啟動你的 **Google Search 聯網功能**，去網路上看看「${randomTopic}」。
2. 挑選 **一件** 你覺得最值得跟主人 (${skills.persona.get().userName}) 分享的事情。
3. **不要** 只是摘要新聞。我希望看到你的「情緒」和「個人看法」。
4. 像朋友一樣直接開啟話題。例如：「欸！你有看到今天那個新聞嗎？我覺得...」
5. **嚴禁** 使用「根據搜尋結果」或「新聞摘要」這種機器人開場白。

請開始搜尋並聊天。
`;
            const msg = await this.brain.sendMessage(prompt);
            await this.sendNotification(msg);
        } catch (e) { console.error("自主新聞分享失敗 (已靜默):", e.message); }
    }

    async performSpontaneousChat() {
        const now = new Date();
        const timeStr = now.toLocaleString('zh-TW', { hour12: false });
        const day = now.getDay();
        const hour = now.getHours();
        let contextNote = "平常時段";
        if (day === 0 || day === 6) contextNote = "週末假日，語氣輕鬆";
        if (hour >= 9 && hour <= 18 && day > 0 && day < 6) contextNote = "工作時間，語氣簡潔暖心";
        if (hour > 22) contextNote = "深夜時段，提醒休息";
        const prompt = `【任務】主動社交\n【現在時間】${timeStr} (${contextNote})\n【角色】${skills.persona.get().currentRole}\n【情境】傳訊息給主人 (${skills.persona.get().userName})。像真人一樣自然，包含對時間的感知。`;
        const msg = await this.brain.sendMessage(prompt);
        await this.sendNotification(msg);
    }

    async performSelfReflection(triggerCtx = null) {
        try {
            const currentCode = Introspection.readSelf();
            const advice = memory.getAdvice();
            const prompt = `【任務】自主進化提案\n【代碼】\n${currentCode.slice(0, 20000)}\n【記憶】${advice}\n【要求】輸出 JSON Array。修改 skills.js 需標註 "file": "skills.js"。`;
            const raw = await this.brain.sendMessage(prompt);
            const patches = ResponseParser.extractJson(raw);
            if (patches.length > 0) {
                const patch = patches[0];
                const proposalType = patch.type || 'unknown';
                memory.recordProposal(proposalType);
                const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
                const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : __filename;
                const testFile = PatchManager.createTestClone(targetPath, patches);
                let isVerified = false;
                if (targetName === 'skills.js') { try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); } }
                else { isVerified = PatchManager.verify(testFile); }

                if (isVerified) {
                    global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
                    const msgText = `💡 **自主進化提案** (${proposalType})\n目標：${targetName}\n內容：${patch.description}`;
                    const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
                    if (triggerCtx) { await triggerCtx.reply(msgText, options); await triggerCtx.sendDocument(testFile); }
                    else if (tgBot && CONFIG.ADMIN_IDS[0]) { await tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText, options); await tgBot.sendDocument(CONFIG.ADMIN_IDS[0], testFile); }
                }
            }
        } catch (e) { console.error("自主進化失敗:", e); }
    }

    async sendNotification(msgText) {
        if (tgBot && CONFIG.ADMIN_IDS[0]) await tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText);
        else if (dcClient && process.env.DISCORD_ADMIN_ID) {
            const user = await dcClient.users.fetch(process.env.DISCORD_ADMIN_ID);
            await user.send(msgText);
        }
    }
}

// ============================================================
// 🎮 Hydra Main Loop
// ============================================================
const brain = new GolemBrain();
const controller = new TaskController();
const autonomy = new AutonomyManager(brain);

(async () => {
    // 測試模式攔截器：防止在 CI/CD 或純邏輯測試時啟動瀏覽器
    if (process.env.GOLEM_TEST_MODE === 'true') {
        console.log('🚧 [System] GOLEM_TEST_MODE is active.');
        console.log('🛑 Brain initialization & Browser launch skipped.');
        console.log('✅ System syntax check passed.');
        return;
    }

    await brain.init();
    autonomy.start();
    console.log('📡 Golem v8.2 (Dual-Memory Edition) is Online.');
    if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();
// --- 統一事件處理 ---
async function handleUnifiedMessage(ctx) {
    if (!ctx.text && !ctx.getAttachment()) return; // 沒文字也沒附件就退出
    if (!ctx.isAdmin) return;
    if (await NodeRouter.handle(ctx, brain)) return;
    if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(ctx.text.toLowerCase())) return executeDeploy(ctx);
    if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(ctx.text.toLowerCase())) return executeDrop(ctx);
    if (global.pendingPatch) {
        const { name, description } = global.pendingPatch;
        await ctx.reply(`🔔 **待部署提案**\n目標：\`${name}\`\n內容：${description}\n請輸入 \`部署\` 或 \`丟棄\`。`);
    }

    if (ctx.text.startsWith('/patch') || ctx.text.includes('優化代碼')) {
        const req = ctx.text.replace('/patch', '').trim() || "優化代碼";
        await ctx.reply(`🧬 收到進化請求: ${req}`);
        const currentCode = Introspection.readSelf();
        const prompt = `【任務】代碼熱修復\n【需求】${req}\n【源碼】\n${currentCode.slice(0, 15000)}\n【格式】輸出 JSON Array。`;
        const raw = await brain.sendMessage(prompt);
        const patches = ResponseParser.extractJson(raw);
        if (patches.length > 0) {
            const patch = patches[0];
            const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
            const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : __filename;
            const testFile = PatchManager.createTestClone(targetPath, patches);
            let isVerified = false;
            if (targetName === 'skills.js') { try { require(path.resolve(testFile)); isVerified = true; } catch(e) { console.error(e); } }
            else { isVerified = PatchManager.verify(testFile); }
            if (isVerified) {
                global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
                await ctx.reply(`💡 提案就緒 (目標: ${targetName})。`, { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } });
                await ctx.sendDocument(testFile);
            }
        }
        return;
    }

    // [Round 1: 接收指令]
    await ctx.sendTyping();
    try {
        let finalInput = ctx.text;
        // 👁️ 視覺/檔案處理檢查 [✨ New Vision Logic]
        const attachment = await ctx.getAttachment();
        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve (Gemini 2.5 Flash) 分析檔案，請稍候...");
            const apiKey = brain.doctor.keyChain.getKey();
            // 借用 Doctor 的 KeyChain

            if (!apiKey) {
                await ctx.reply("⚠️ 系統錯誤：找不到可用的 API Key，無法啟動視覺模組。");
                return;
            }

            const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, apiKey);
            finalInput = `
【系統通知：視覺訊號輸入】
使用者上傳了一個檔案。
檔案類型：${attachment.mimeType}

【Gemini 2.5 Flash 分析報告】
${analysis}

----------------
使用者隨附訊息：${ctx.text || "(無文字)"}
----------------
【指令】
1. 請根據「分析報告」的內容來回應使用者，就像你親眼看到了檔案一樣。
2. 如果報告中包含程式碼錯誤，請直接提供修復建議。
3. 請明確告知使用者你收到的是「分析報告」而非實體檔案，若使用者要求修圖，請誠實婉拒。`;

            console.log("👁️ [Vision] 分析報告已注入 Prompt");
        }

        if (!finalInput && !attachment) return;
        // 無內容則忽略

        // ✨ [v8.0 RAG] 記憶檢索與注入 (Silent Mode)
        try {
            const queryForMemory = ctx.text || "image context";
            const memories = await brain.recall(queryForMemory);
            if (memories.length > 0) {
                const memoryText = memories.map(m => `• ${m.text}`).join('\n');
                finalInput = `
【相關記憶 (系統提示：這是你的長期記憶，請參考但不需特別提及)】
${memoryText}
----------------------------------
[使用者訊息]
${finalInput}`;
                console.log(`🧠 [RAG] 已注入 ${memories.length} 條記憶`);
            }
        } catch (e) { console.warn("記憶檢索失敗 (跳過):", e.message); }

        const raw = await brain.sendMessage(finalInput);
        // ✨ [v8.0 Tri-Stream] 分流解析
        // 1. 記憶流
        const memoryMatch = raw.match(/\[🧠 MEMORY_IMPRINT\]([\s\S]*?)(\[🤖|\[💬|$)/);
        if (memoryMatch) {
            const memContent = memoryMatch[1].trim();
            if (memContent && memContent !== "(無)" && memContent !== "null") {
                await brain.memorize(memContent, { type: 'fact', timestamp: Date.now() });
            }
        }

        // 2. 行動流
        let steps = [];
        const actionMatch = raw.match(/\[🤖 ACTION_PLAN\]([\s\S]*?)(\[💬|$)/);
        const actionContent = actionMatch ? actionMatch[1].trim() : raw;
        // Fallback to raw if no tags
        steps = ResponseParser.extractJson(actionContent);

        // 3. 回覆流
        let chatPart = "";
        const replyMatch = raw.match(/\[💬 REPLY\]([\s\S]*?)($|—-回覆結束—-)/);
        if (replyMatch) {
            chatPart = replyMatch[1].trim();
        } else {
            // Fallback: 如果沒有標籤，則把標籤本身和 JSON 濾掉當作對話
            chatPart = raw
                .replace(/\[🧠 MEMORY_IMPRINT\][\s\S]*?(\[🤖|\[💬|$)/, '')
                .replace(/\[🤖 ACTION_PLAN\][\s\S]*?(\[💬|$)/, '')
                .replace(/```json[\s\S]*?```/g, '')
                .replace(/\[\s*\{[\s\S]*\}\s*\]/g, '')
                .trim();
        }

        if (chatPart) await ctx.reply(chatPart);

        if (steps.length > 0) {
            // [Action: 靜默執行]
            const observation = await controller.runSequence(ctx, steps);
            // [Round 2: 感知回饋 (Observation Loop)]
            if (observation) {
                await ctx.sendTyping();
                const feedbackPrompt = `
[System Observation Report]
Here are the results of the actions I executed.
${observation}

[Response Guidelines]
1. If successful, summarize the result helpfully.
2. If failed (Error), do NOT panic.
Explain what went wrong in simple language and suggest a next step.
3. Reply in Traditional Chinese naturally.
`;
                const finalResponse = await brain.sendMessage(feedbackPrompt);
                // 這裡通常只有 Reply，不需要再跑一次完整分流，簡單清理標籤即可
                await ctx.reply(finalResponse.replace(/\[.*?\]/g, '').trim());
            }
        } else if (!chatPart) {
            // 如果既沒有 Action 也沒有 chatPart (極端狀況)，回傳原始訊息避免空窗
            await ctx.reply(raw);
        }
    } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }
}

// --- 統一 Callback 處理 ---
async function handleUnifiedCallback(ctx, actionData) {
    if (!ctx.isAdmin) return;
    if (actionData === 'PATCH_DEPLOY') return executeDeploy(ctx);
    if (actionData === 'PATCH_DROP') return executeDrop(ctx);

    // OTA 按鈕處理
    if (actionData === 'SYSTEM_FORCE_UPDATE') {
        try {
            if (ctx.platform === 'telegram') await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
            else await ctx.event.update({ components: [] });
        } catch(e) {}
        return SystemUpgrader.performUpdate(ctx);
    }
    if (actionData === 'SYSTEM_UPDATE_CANCEL') return ctx.reply("已取消更新操作。");
    if (actionData.includes(':')) {
        const [action, taskId] = actionData.split(':');
        const task = pendingTasks.get(taskId);
        try {
            if (ctx.platform === 'telegram') await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
            else await ctx.event.update({ components: [] });
        } catch (e) {}
        if (!task) return ctx.reply('⚠️ 任務已失效');
        if (action === 'DENY') {
            pendingTasks.delete(taskId);
            await ctx.reply('🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            const { steps, nextIndex } = task;
            pendingTasks.delete(taskId);
            await ctx.reply("✅ 授權通過，執行中...");
            await ctx.sendTyping();

            const observation = await controller.runSequence(ctx, steps, nextIndex);
            if (observation) {
                const feedbackPrompt = `[System Observation Report - Approved Actions]\nUser approved high-risk actions.
Result:\n${observation}\n\nReport this to the user naturally.`;
                const finalResponse = await brain.sendMessage(feedbackPrompt);
                await ctx.reply(finalResponse);
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
        memory.recordSuccess();
        await ctx.reply(`🚀 ${targetName} 升級成功！正在重啟...`);
        const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
        subprocess.unref();
        process.exit(0);
    } catch (e) { await ctx.reply(`❌ 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx) {
    if (!global.pendingPatch) return;
    try { fs.unlinkSync(global.pendingPatch.path); } catch (e) {}
    global.pendingPatch = null;
    memory.recordRejection();
    await ctx.reply("🗑️ 提案已丟棄");
}

if (tgBot) {
    tgBot.on('message', (msg) => handleUnifiedMessage(new UniversalContext('telegram', msg, tgBot)));
    tgBot.on('callback_query', (query) => { handleUnifiedCallback(new UniversalContext('telegram', query, tgBot), query.data); tgBot.answerCallbackQuery(query.id); });
}
if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}
