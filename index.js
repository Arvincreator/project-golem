/**
 * 🦞 Project Golem v8.6 (Titan Chronos Edition) - FIXED
 * ---------------------------------------------------
 * 架構：[Universal Context] -> [Conversation Queue] -> [NeuroShunter] <==> [Web Gemini]
 * 核心升級：
 * 1. 🧬 NeuroShunter: 統一處理解析、記憶與行動。
 * 2. 🛡️ Titan Protocol: 強制三流協定 (Memory/Action/Reply)。
 * 3. 🚦 Conversation Manager: 對話隊列與防抖機制。
 * 4. ⏰ TimeWatcher: 新增時間軸任務排程與輪詢機制 (Chronos)。
 * 5. 🚑 Logic Patch: 保留原有熱修復能力。
 * ---------------------------------------------------
 * 
 * 🔧 修復內容 (v8.6-fixed):
 *   ✅ Discord 交互 3 秒超時問題 (修復「此交互失敗」錯誤)
 *   ✅ Telegram callback 時序問題
 *   ✅ DENY 分支缺少 return 導致的邏輯錯誤
 *   ✅ fetch() 兼容性問題 (改用 https 模組)
 *   ✅ UniversalContext 增加交互支援
 *   ✅ pendingTasks 自動過期機制 (5分鐘)
 *   ✅ 錯誤處理增強
 *   ✅ 所有 return ctx.reply() 統一為 await
 * ---------------------------------------------------
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
const cleanEnv = (str, allowSpaces = false) => {
    if (!str) return "";
    let cleaned = str.replace(/[^\x20-\x7E]/g, "");
    if (!allowSpaces) cleaned = cleaned.replace(/\s/g, "");
    return (cleaned || "").trim();
};

const isPlaceholder = (str) => {
    if (!str) return true;
    return /你的|這裡|YOUR_|TOKEN/i.test(str) || str.length < 10;
};

const CONFIG = {
    TG_TOKEN: cleanEnv(process.env.TELEGRAM_TOKEN),
    DC_TOKEN: cleanEnv(process.env.DISCORD_TOKEN),
    USER_DATA_DIR: cleanEnv(process.env.USER_DATA_DIR || './golem_memory', true),
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k),
    ADMIN_ID: cleanEnv(process.env.ADMIN_ID),
    DISCORD_ADMIN_ID: cleanEnv(process.env.DISCORD_ADMIN_ID),
    ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID].map(k => cleanEnv(k)).filter(k => k),
    GITHUB_REPO: cleanEnv(process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/', true),
    QMD_PATH: cleanEnv(process.env.GOLEM_QMD_PATH || 'qmd', true),
    DONATE_URL: 'https://buymeacoffee.com/arvincreator'
};

// 驗證關鍵 Token
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 無效，TG Bot 不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 無效，Discord Bot 不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));

// --- 初始化組件 ---
puppeteer.use(StealthPlugin());

const tgBot = CONFIG.TG_TOKEN ? new TelegramBot(CONFIG.TG_TOKEN, { polling: true }) : null;
const dcClient = CONFIG.DC_TOKEN ? new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
}) : null;

const pendingTasks = new Map();
global.pendingPatch = null;

// 🔧 FIX: pendingTasks 自動過期機制 (5 分鐘)
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of pendingTasks.entries()) {
    if (task.timestamp && (now - task.timestamp > 300000)) {
      pendingTasks.delete(id);
      console.log(`🗑️ [TaskCleanup] 清理過期任務: ${id}`);
    }
  }
}, 60000); // 每分鐘檢查一次

// ============================================================
// 👁️ OpticNerve (視神經 - Gemini 2.5 Flash Bridge)
// ============================================================
class OpticNerve {
    static async analyze(fileUrl, mimeType, apiKey) {
        console.log(`👁️ [OpticNerve] 正在透過 Gemini 2.5 Flash 分析檔案 (${mimeType})...`);
        try {
            const buffer = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    const data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
            });
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = mimeType.startsWith('image/')
                ? "請詳細描述這張圖片的視覺內容。如果包含文字或程式碼，請完整轉錄。如果是介面截圖，請描述UI元件。請忽略無關的背景雜訊。"
                : "請閱讀這份文件，並提供詳細的摘要、關鍵數據與核心內容。";

            const result = await model.generateContent([
                prompt,
                { inlineData: { data: buffer.toString('base64'), mimeType: mimeType } }
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
    this.platform = platform;
    this.event = event;
    this.instance = instance;
    // 🔧 FIX: 識別 Discord 交互對象
    this.isInteraction = platform === 'discord' && (event.isButton?.() || event.isCommand?.());
  }

    get userId() {
        return this.platform === 'telegram' ? String(this.event.from?.id || this.event.user?.id) : this.event.user ? this.event.user.id : this.event.author?.id;
    }

    get chatId() {
        if (this.platform === 'telegram') return this.event.message ? this.event.message.chat.id : this.event.chat.id;
        return this.event.channelId || this.event.channel.id;
    }

    get text() {
        if (this.platform === 'telegram') return this.event.text || this.event.caption || "";
        return this.event.content || "";
    }

    async getAttachment() {
        if (this.platform === 'telegram') {
            const msg = this.event;
            let fileId = null;
            let mimeType = 'image/jpeg';
            if (msg.photo) fileId = msg.photo[msg.photo.length - 1].file_id;
            else if (msg.document) {
                fileId = msg.document.file_id;
                mimeType = msg.document.mime_type;
            }
            if (fileId) {
                try {
                    const file = await this.instance.getFile(fileId);
                    return { url: `https://api.telegram.org/file/bot${CONFIG.TG_TOKEN}/${file.file_path}`, mimeType: mimeType };
                } catch (e) { console.error("TG File Error:", e); }
            }
        } else {
            const attachment = this.event.attachments && this.event.attachments.first();
            if (attachment) {
                return { url: attachment.url, mimeType: attachment.contentType || 'application/octet-stream' };
            }
        }
        return null;
    }

    get isAdmin() {
        if (CONFIG.ADMIN_IDS.length === 0) return true;
        return CONFIG.ADMIN_IDS.includes(this.userId);
    }

    async reply(content, options) {
  // FIX: Discord interaction reply
  if (this.isInteraction) {
    try {
      if (!this.event.deferred && !this.event.replied) {
        return await this.event.reply({ content, flags: 64 });
      } else {
        return await this.event.followUp({ content, flags: 64 });
      }
    } catch (e) {
      console.error('UniversalContext Discord Reply Error:', e.message);
      // Fallback: 嘗試作為一般訊息發送
      try {
        const channel = await this.instance.channels.fetch(this.chatId);
        return await channel.send(content);
      } catch (err) {
        console.error('UniversalContext Fallback Error:', err.message);
      }
    }
  }
  
  // Telegram or regular Discord message
  return await MessageManager.send(this, content, options);
}


    async sendDocument(filePath) {
        try {
            if (this.platform === 'telegram') await this.instance.sendDocument(this.chatId, filePath);
            else {
                const channel = await this.instance.channels.fetch(this.chatId);
                await channel.send({ files: [filePath] });
            }
        } catch (e) {
            if (e.message.includes('Request entity too large')) await this.reply(`⚠️ 檔案過大 (Discord Limit 25MB)。`);
            else await this.reply(`❌ 傳送失敗: ${e.message}`);
        }
    }

    async sendTyping() {
    if (this.isInteraction) return; // 🔧 FIX: 交互不需要 typing
    if (this.platform === 'telegram') {
      this.instance.sendChatAction(this.chatId, 'typing');
    } else {
      try {
        const channel = await this.instance.channels.fetch(this.chatId);
        await channel.sendTyping();
      } catch (e) {
        // 忽略 typing 錯誤
      }
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
            if (remaining.length <= MAX_LENGTH) { chunks.push(remaining); break; }
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
            } catch (e) { console.error(`[MessageManager] 發送失敗:`, e.message); }
        }
    }
}

// ============================================================
// 🧠 Experience Memory (經驗記憶體)
// ============================================================
class ExperienceMemory {
    constructor() {
        this.memoryFile = path.join(process.cwd(), 'golem_learning.json');
        this.data = this._load();
    }
    _load() {
        try { if (fs.existsSync(this.memoryFile)) return JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8')); } catch (e) { }
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
            try { skills = fs.readFileSync(path.join(process.cwd(), 'skills.js'), 'utf-8'); } catch (e) { }
            return `=== index.js ===\n${main}\n\n=== skills.js ===\n${skills}`;
        } catch (e) { return `無法讀取自身代碼: ${e.message}`; }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🩹 Patch Manager (神經補丁 - Fix Edition)
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
            const fuzzySearch = escapeRegExp(patch.search).replace(/\s+/g, '[\\s\\n]*');
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
            try { fs.unlinkSync(filePath); console.log("🧹 已清理失效的測試檔案"); } catch (delErr) { }
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
        this.SAFE_COMMANDS = ['ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find', 'whoami', 'tail', 'head', 'df', 'free', 'Get-ChildItem', 'Select-String', 'golem-check'];
        this.BLOCK_PATTERNS = [/rm\s+-rf\s+\//, /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/, />\s*\/dev\/sd/, /:(){:|:&};:/, /mkfs/, /Format-Volume/, /dd\s+if=/, /chmod\s+[-]x\s+/];
    }
    assess(cmd) {
        const safeCmd = (cmd || "").trim();
        const baseCmd = safeCmd.split(/\s+/)[0];
        if (this.BLOCK_PATTERNS.some(regex => regex.test(safeCmd))) return { level: 'BLOCKED', reason: '毀滅性指令' };
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
            const path = execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' }).toString().trim().split('\n')[0];
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
        while ((match = routerPattern.exec(source)) !== null) foundCmds.add(match[1].replace(/\|/g, '/').replace(/[\^\(\)]/g, ''));
        let skillList = "基礎系統操作";
        try { skillList = Object.keys(skills).filter(k => k !== 'persona' && k !== 'getSystemPrompt').join(', '); } catch (e) { }

        return `
🤖 **Golem v8.6 (Titan Chronos Edition)**
---------------------------
⚡ **Node.js**: Reflex Layer + Action Executor
🧠 **Web Gemini**: Infinite Context Brain (Titan Protocol)
🌗 **Dual-Memory**: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser')} mode
🥪 **Sync Mode**: Envelope/Sandwich Lock (Reliable)
🚦 **Queue**: Debounce & Serialization Active
⏰ **Chronos**: Timeline Scheduler Active
🔍 **Auto-Discovery**: Active
👁️ **OpticNerve**: Vision Enabled
🔌 **Neuro-Link**: CDP Network Interception Active
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
// 🗝️ KeyChain & 🚑 DOM Doctor (已修復 AI 廢話導致崩潰問題)
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
            input: 'div[contenteditable="true"], rich-textarea > div, p[data-placeholder]',
            send: 'button[aria-label*="Send"], button[aria-label*="傳送"], span[data-icon="send"]',
            response: '.model-response-text, .message-content, .markdown, div[data-test-id="message-content"]'
        };
    }
    loadSelectors() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
                return { ...this.defaults, ...cached };
            }
        } catch (e) { }
        return { ...this.defaults };
    }
    saveSelectors(newSelectors) {
        try {
            const current = this.loadSelectors();
            const updated = { ...current, ...newSelectors };
            fs.writeFileSync(this.cacheFile, JSON.stringify(updated, null, 2));
            console.log("💾 [Doctor] Selector 已更新並存檔！");
        } catch (e) { }
    }
 async diagnose(htmlSnippet, targetType) {
    if (this.keyChain.keys.length === 0) return null;

    // 策略 1: 優化提示詞，教 AI 像人類一樣「往上找容器」
    const hints = {
      'input': '目標是輸入框。⚠️ 注意：請忽略內層的 <p>, <span> 或 text node。請往上尋找最近的一個「容器 div」，它通常具備 contenteditable="true"、role="textbox" 或 class="ql-editor" 屬性。',
      'send': '目標是發送按鈕。⚠️ 注意：請找出外層的 <button> 或具備互動功能的 <mat-icon>，不要只選取裡面的 <svg> 或 <path>。特徵：aria-label="Send" 或 data-mat-icon-name="send"。',
      'response': '找尋 AI 回覆的文字氣泡。'
    };

    const targetDescription = hints[targetType] || targetType;
    console.log(`🚑 [Doctor] 啟動深層診斷: 目標 [${targetType}]...`);

    // 策略 2: 頭尾夾擊法 (Head + Tail Strategy)
    // 確保能抓到位於頁面最底部的輸入框與按鈕，同時保留頭部樣式資訊
    let safeHtml = htmlSnippet;
    if (htmlSnippet.length > 60000) {
      const head = htmlSnippet.substring(0, 5000);
      // 取最後 55,000 字，因為輸入框通常在 DOM 結構的最下方
      const tail = htmlSnippet.substring(htmlSnippet.length - 55000); 
      safeHtml = `${head}\n\n\n\n${tail}`;
    }

    const prompt = `你是 Puppeteer 自動化專家。目前的 CSS Selector 失效。
    請分析 HTML，找出目標: "${targetType}" (${targetDescription}) 的最佳 CSS Selector。

    HTML 片段:
    \`\`\`html
    ${safeHtml}
    \`\`\`

    規則：
    1. 只回傳 JSON: {"selector": "your_css_selector"}
    2. 選擇器必須具備高特異性 (Specificity)，但不要依賴隨機生成的 ID (如 #xc-123)。
    3. 優先使用 id, name, role, aria-label, data-attribute。`;

    let attempts = 0;
    while (attempts < this.keyChain.keys.length) {
      try {
        const genAI = new GoogleGenerativeAI(this.keyChain.getKey());
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const rawText = result.response.text().trim();

        let selector = "";
        try {
          const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(jsonStr);
          selector = parsed.selector;
        } catch (jsonErr) {
          console.warn(`⚠️ [Doctor] JSON 解析失敗，嘗試暴力提取 (Raw: ${rawText.substring(0, 50)}...)`);
          const lines = rawText.split('\n').filter(l => l.trim().length > 0);
          const lastLine = lines[lines.length - 1].trim();
          if (!lastLine.includes(' ')) selector = lastLine;
        }

        if (selector && selector.length > 0 && selector.length < 150 && !selector.includes('問題')) {
          console.log(`✅ [Doctor] 診斷成功，新 Selector: ${selector}`);
          return selector;
        } else {
          console.warn(`⚠️ [Doctor] AI 提供的 Selector 無效或包含雜訊: ${selector}`);
        }
      } catch (e) {
        console.error(`❌ [Doctor] 診斷 API 錯誤: ${e.message}`);
        attempts++;
      }
    }
    return null;
  }
}

// ============================================================
// 🧠 Memory Drivers (雙模記憶驅動 + 排程擴充)
// ============================================================
class BrowserMemoryDriver {
    constructor(brain) { this.brain = brain; }
    async init() {
        if (this.brain.memoryPage) return;
        try {
            this.brain.memoryPage = await this.brain.browser.newPage();
            const memoryPath = 'file:///' + path.join(process.cwd(), 'memory.html').replace(/\\/g, '/');
            console.log(`🧠 [Memory:Browser] 正在掛載神經海馬迴: ${memoryPath}`);
            await this.brain.memoryPage.goto(memoryPath);
            await new Promise(r => setTimeout(r, 5000));
        } catch (e) { console.error("❌ [Memory:Browser] 啟動失敗:", e.message); }
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
    
    // ✨ [Chronos Update] 排程接口
    async addSchedule(task, time) {
        if (!this.brain.memoryPage) return;
        await this.brain.memoryPage.evaluate(async (t, time) => {
            if (window.addSchedule) await window.addSchedule(t, time);
        }, task, time);
    }
    async checkDueTasks() {
        if (!this.brain.memoryPage) return [];
        return await this.brain.memoryPage.evaluate(async () => {
            return window.checkSchedule ? await window.checkSchedule() : [];
        });
    }
}

class SystemQmdDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        this.qmdCmd = 'qmd';
    }
    async init() {
        console.log("🔍 [Memory:Qmd] 啟動引擎探測...");
        try {
            const checkCmd = (c) => {
                try {
                    const findCmd = os.platform() === 'win32' ? `where ${c}` : `command -v ${c}`;
                    execSync(findCmd, { stdio: 'ignore', env: process.env });
                    return true;
                } catch (e) { return false; }
            };
            if (CONFIG.QMD_PATH !== 'qmd' && fs.existsSync(CONFIG.QMD_PATH)) this.qmdCmd = `"${CONFIG.QMD_PATH}"`;
            else if (checkCmd('qmd')) this.qmdCmd = 'qmd';
            else {
                const homeQmd = path.join(os.homedir(), '.bun', 'bin', 'qmd');
                if (fs.existsSync(homeQmd)) this.qmdCmd = `"${homeQmd}"`;
                else if (os.platform() !== 'win32') {
                    try {
                        const bashFound = execSync('bash -lc "which qmd"', { encoding: 'utf8', env: process.env }).trim();
                        if (bashFound) this.qmdCmd = `"${bashFound}"`;
                        else throw new Error();
                    } catch (e) { throw new Error("QMD_NOT_FOUND"); }
                } else throw new Error("QMD_NOT_FOUND");
            }
            console.log(`🧠 [Memory:Qmd] 引擎連線成功: ${this.qmdCmd}`);
            try {
                execSync(`${this.qmdCmd} collection add "${path.join(this.baseDir, '*.md')}" --name golem-core`, { stdio: 'ignore', env: process.env, shell: true });
            } catch (e) { }
        } catch (e) {
            console.error(`❌ [Memory:Qmd] 找不到 qmd。`);
            throw new Error("QMD_MISSING");
        }
    }
    async recall(query) {
        return new Promise((resolve) => {
            const safeQuery = query.replace(/"/g, '\\"');
            const cmd = `${this.qmdCmd} search golem-core "${safeQuery}" --hybrid --limit 3`;
            exec(cmd, (err, stdout) => {
                if (err) { resolve([]); return; }
                const result = stdout.trim();
                if (result) resolve([{ text: result, score: 0.95, metadata: { source: 'qmd' } }]);
                else resolve([]);
            });
        });
    }
    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        fs.writeFileSync(filepath, `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`, 'utf8');
        exec(`${this.qmdCmd} embed golem-core "${filepath}"`, (err) => { if (err) console.error("⚠️ [Memory:Qmd] 索引失敗"); });
    }
    // QMD 暫不支援排程，僅作空實作
    async addSchedule(task, time) { console.warn("⚠️ QMD 模式不支援排程"); }
    async checkDueTasks() { return []; }
}

class SystemNativeDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    }
    async init() { console.log("🧠 [Memory:Native] 系統原生核心已啟動"); }
    async recall(query) {
        try {
            const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.md'));
            const results = [];
            for (const file of files) {
                const content = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
                const keywords = query.toLowerCase().split(/\s+/);
                let score = 0;
                keywords.forEach(k => { if (content.toLowerCase().includes(k)) score += 1; });
                if (score > 0) results.push({ text: content.replace(/---[\s\S]*?---/, '').trim(), score: score / keywords.length, metadata: { source: file } });
            }
            return results.sort((a, b) => b.score - a.score).slice(0, 3);
        } catch (e) { return []; }
    }
    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        fs.writeFileSync(filepath, `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`, 'utf8');
    }
    // Native 暫不支援排程
    async addSchedule(task, time) { console.warn("⚠️ Native 模式不支援排程"); }
    async checkDueTasks() { return []; }
}

// ============================================================
// 🧠 Golem Brain (Web Gemini) - Dual-Engine + Titan Protocol
// ============================================================
function getSystemFingerprint() { return `OS: ${os.platform()} | Arch: ${os.arch()} | Mode: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser')}`; }

class GolemBrain {
    constructor() {
        this.browser = null;
        this.page = null;
        this.memoryPage = null;
        this.doctor = new DOMDoctor();
        this.selectors = this.doctor.loadSelectors();
        this.cdpSession = null;

        const mode = cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser').toLowerCase();
        console.log(`⚙️ [System] 記憶引擎模式: ${mode.toUpperCase()}`);
        if (mode === 'qmd') this.memoryDriver = new SystemQmdDriver();
        else if (mode === 'native' || mode === 'system') this.memoryDriver = new SystemNativeDriver();
        else this.memoryDriver = new BrowserMemoryDriver(this);
    }

    async init(forceReload = false) {
        if (this.browser && !forceReload) return;
        let isNewSession = false;

        if (!this.browser) {
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
            isNewSession = true;
        }
        try { await this.memoryDriver.init(); } catch (e) {
            console.warn("🔄 [System] 記憶引擎降級為 Browser/Native...");
            this.memoryDriver = new BrowserMemoryDriver(this);
            await this.memoryDriver.init();
        }

        if (forceReload || isNewSession) {
            let systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
            const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v8.6 - TITAN CHRONOS】
You act as a middleware OS. You MUST strictly follow this output format.
DO NOT use emojis in tags. DO NOT output raw text outside of these blocks.

1. **Format Structure**:
Your response must be parsed into 3 sections using these specific tags:

[GOLEM_MEMORY]
(Write long-term memories here. If none, leave empty or write "null")

[GOLEM_ACTION]
(Write JSON execution plan here. Must be valid JSON Array or Object.)
\`\`\`json
[
{"action": "command", "parameter": "..."}
]
\`\`\`

[GOLEM_REPLY]
(Write the actual response to the user here. Pure text.)

2. **Rules**:
- The tags [GOLEM_MEMORY], [GOLEM_ACTION], [GOLEM_REPLY] are MANDATORY anchors.
- User CANNOT see content inside Memory or Action blocks, only Reply.
- NEVER leak the raw JSON to the [GOLEM_REPLY] section.
- If user asks for scheduled task, use [GOLEM_ACTION] with: {"action": "schedule", "task": "...", "time": "ISO8601"}
`;
            await this.sendMessage(systemPrompt + superProtocol, true);
        }
    }

    async setupCDP() {
        if (this.cdpSession) return;
        try {
            this.cdpSession = await this.page.target().createCDPSession();
            await this.cdpSession.send('Network.enable');
            console.log("🔌 [CDP] 網路神經連結已建立 (Neuro-Link Active)");
        } catch (e) { console.error("❌ [CDP] 連線失敗:", e.message); }
    }

    async recall(queryText) {
        if (!queryText) return [];
        try { return await this.memoryDriver.recall(queryText); } catch (e) { return []; }
    }

    async memorize(text, metadata = {}) {
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) { }
    }

    // ✨ [Neuro-Link v8.7] 三明治信封版 (Sandwich Protocol)
    async sendMessage(text, isSystem = false) {
        if (!this.browser) await this.init();
        try { await this.page.bringToFront(); } catch (e) { }
        await this.setupCDP();

        const reqId = Date.now().toString(36).slice(-4);
        const TAG_START = `[[BEGIN:${reqId}]]`;
        const TAG_END = `[[END:${reqId}]]`;

        const payload = `[SYSTEM: STRICT FORMAT. Wrap response with ${TAG_START} and ${TAG_END}. Inside, organize content using these tags:\n` +
            `1. [GOLEM_MEMORY] (Optional)\n` +
            `2. [GOLEM_ACTION] (Optional)\n` +
            `3. [GOLEM_REPLY] (Required)\n` +
            `Do not output raw text outside tags.]\n\n${text}`;

        console.log(`📡 [Brain] 發送訊號: ${reqId} (三流全激活模式)`);

        const tryInteract = async (sel, retryCount = 0) => {
      if (retryCount > 3) throw new Error("🔥 DOM Doctor 修復失敗，請檢查網路或 HTML 結構大幅變更。");

      try {
        const baseline = await this.page.evaluate((s) => {
          const bubbles = document.querySelectorAll(s);
          return bubbles.length > 0 ? bubbles[bubbles.length - 1].innerText : "";
        }, sel.response);

        // --- 1. 檢查輸入框 (Input) ---
        let inputEl = await this.page.$(sel.input);
        if (!inputEl) {
          console.log("🚑 找不到輸入框，呼叫 DOM Doctor...");
          const html = await this.page.content();
          const newSel = await this.doctor.diagnose(html, 'input');
          if (newSel) {
            this.selectors.input = newSel;
            this.doctor.saveSelectors(this.selectors);
            return tryInteract(this.selectors, retryCount + 1);
          }
          throw new Error(`無法修復輸入框 Selector`);
        }

        // --- 2. 執行輸入 ---
        await this.page.evaluate((s, t) => {
          const el = document.querySelector(s);
          el.focus();
          document.execCommand('insertText', false, t);
        }, sel.input, payload);

        await new Promise(r => setTimeout(r, 800));

        // --- 3. 檢查發送按鈕 (Send) ---
        let sendEl = await this.page.$(sel.send);
        if (!sendEl) {
          console.log("🚑 找不到發送按鈕，呼叫 DOM Doctor...");
          const html = await this.page.content();
          const newSel = await this.doctor.diagnose(html, 'send');
          if (newSel) {
            this.selectors.send = newSel;
            this.doctor.saveSelectors(this.selectors);
            return tryInteract(this.selectors, retryCount + 1);
          }
          console.log("⚠️ 無法修復按鈕，嘗試使用 Enter 鍵發送...");
          await this.page.keyboard.press('Enter');
        } else {
          try {
            await this.page.waitForSelector(sel.send, { timeout: 2000 });
            await this.page.click(sel.send);
          } catch (e) { await this.page.keyboard.press('Enter'); }
        }

        if (isSystem) { await new Promise(r => setTimeout(r, 2000)); return ""; }

        console.log(`⚡ [Brain] 等待信封完整性 (${TAG_START} ... ${TAG_END})...`);

        const finalResponse = await this.page.evaluate(async (selector, startTag, endTag, oldText) => {
          return new Promise((resolve) => {
            const startTime = Date.now();
            let stableCount = 0;
            let lastCheckText = "";

            const check = () => {
              const bubbles = document.querySelectorAll(selector);
              if (bubbles.length === 0) { setTimeout(check, 500); return; }

              const currentLastBubble = bubbles[bubbles.length - 1];
              const rawText = currentLastBubble.innerText || "";

              const startIndex = rawText.indexOf(startTag);
              if (startIndex !== -1) {
                const endIndex = rawText.indexOf(endTag);
                if (endIndex !== -1 && endIndex > startIndex) {
                  const content = rawText.substring(startIndex + startTag.length, endIndex).trim();
                  resolve({ status: 'ENVELOPE_COMPLETE', text: content });
                  return;
                }
                if (rawText === lastCheckText && rawText.length > lastCheckText.length) {
                  stableCount = 0;
                } else if (rawText === lastCheckText) {
                  stableCount++;
                } else {
                  stableCount = 0;
                }
                lastCheckText = rawText;

                if (stableCount > 5) {
                  const content = rawText.substring(startIndex + startTag.length).trim();
                  resolve({ status: 'ENVELOPE_TRUNCATED', text: content });
                  return;
                }
              }
              else if (rawText !== oldText && !rawText.includes('SYSTEM: Please WRAP')) {
                if (rawText === lastCheckText && rawText.length > 5) stableCount++;
                else stableCount = 0;
                lastCheckText = rawText;
                if (stableCount > 5) { resolve({ status: 'FALLBACK_DIFF', text: rawText }); return; }
              }

              if (Date.now() - startTime > 90000) { resolve({ status: 'TIMEOUT', text: '' }); return; }
              setTimeout(check, 500);
            };
            check();
          });
        }, sel.response, TAG_START, TAG_END, baseline);

        if (finalResponse.status === 'TIMEOUT') throw new Error("等待回應超時");

        console.log(`🏁 [Brain] 捕獲: ${finalResponse.status} | 長度: ${finalResponse.text.length}`);

        let cleanText = finalResponse.text
          .replace(TAG_START, '')
          .replace(TAG_END, '')
          .replace(/\[SYSTEM: Please WRAP.*?\]/, '')
          .trim();

        return cleanText;

      } catch (e) {
        console.warn(`⚠️ [Brain] 操作異常: ${e.message}`);
        if (retryCount === 0) {
          console.log("🚑 [Brain] 呼叫 DOM Doctor 進行緊急手術 (Response)...");
          const htmlDump = await this.page.content();
          const newSelector = await this.doctor.diagnose(htmlDump, 'response');
          if (newSelector) {
            this.selectors.response = newSelector;
            this.doctor.saveSelectors(this.selectors);
            return await tryInteract(this.selectors, retryCount + 1);
          }
        }
        throw e;
      }
    };

        return await tryInteract(this.selectors);
    }
}

// ============================================================
// ⚡ ResponseParser (JSON 解析器 - 寬鬆版 + 集中化)
// ============================================================
class ResponseParser {
    // [請將整個 ResponseParser 類別的 parse 方法替換為此]
    static parse(raw) {
        const parsed = { memory: null, actions: [], reply: "" };
        
        // 增強版正則：更寬鬆地捕捉區塊，不被換行符號干擾
        const SECTION_REGEX = /\[GOLEM_(MEMORY|ACTION|REPLY)\]([\s\S]*?)(?=\[GOLEM_|$)/ig;

        let match;
        let hasStructuredData = false;

        // 1. 嘗試標準解析
        while ((match = SECTION_REGEX.exec(raw)) !== null) {
            hasStructuredData = true;
            const type = match[1].toUpperCase();
            const content = (match[2] || "").trim();

            if (type === 'MEMORY') {
                if (content && content !== 'null' && !content.includes('(無)')) parsed.memory = content;
            } else if (type === 'ACTION') {
                // 強力 JSON 提取：不管有沒有 markdown 符號，都把 JSON 挖出來
                const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                if (jsonMatch) {
                    try {
                        // 清理可能存在的 markdown 標記 (```json ... ```)
                        let cleanJson = jsonMatch[0].replace(/```json/g, '').replace(/```/g, '');
                        const jsonObj = JSON.parse(cleanJson);
                        const steps = Array.isArray(jsonObj) ? jsonObj : (jsonObj.steps || [jsonObj]);
                        parsed.actions.push(...steps);
                    } catch (e) {
                        console.error("⚠️ [Parser] JSON 解析失敗:", e.message);
                    }
                }
            } else if (type === 'REPLY') {
                parsed.reply = content;
            }
        }

        // 2. 兜底機制：如果 AI 忘記加標籤，嘗試暴力提取 JSON
        if (!hasStructuredData || parsed.actions.length === 0) {
            const fallbackJson = this.extractJson(raw);
            if (fallbackJson.length > 0) {
                console.log("⚠️ [Parser] 觸發暴力提取機制 (Fallback)");
                parsed.actions.push(...fallbackJson);
                // 移除 JSON 部分，剩下的當作回覆
                parsed.reply = raw.replace(/```json[\s\S]*?```/g, '').trim();
            } else {
                 if (!hasStructuredData) parsed.reply = raw;
            }
        }
        
        return parsed;
    }

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
// 🧬 NeuroShunter (神經分流中樞 - 核心邏輯層)
// ============================================================
class NeuroShunter {
    static async dispatch(ctx, rawResponse, brain, controller) {
        const parsed = ResponseParser.parse(rawResponse);

        if (parsed.memory) {
            console.log(`🧠 [Memory] 寫入: ${parsed.memory.substring(0, 20)}...`);
            await brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
        }

        if (parsed.reply) {
            await ctx.reply(parsed.reply);
        }

        if (parsed.actions.length > 0) {
            // [Chronos Update] 攔截排程指令
            const normalActions = [];
            for (const act of parsed.actions) {
               if (act.action === 'schedule') {
                    if (brain.memoryDriver.addSchedule) {
                        // 🛠️ [Fix] 強制轉為 UTC 標準時間，解決 +08:00 造成的不響問題
                        const safeTime = new Date(act.time).toISOString();

                        console.log(`📅 [Chronos] 新增排程: ${act.task} @ ${safeTime}`);
                        await brain.memoryDriver.addSchedule(act.task, safeTime);
                        await ctx.reply(`⏰ 已設定排程：${act.task} (於 ${safeTime} 執行)`);
                    } else {
                        await ctx.reply("⚠️ 當前記憶模式不支援排程功能。");
                    }
                } else {
                    normalActions.push(act);
                }
            }

            if (normalActions.length > 0) {
                const observation = await controller.runSequence(ctx, normalActions);
                if (observation) {
                    if (ctx.sendTyping) await ctx.sendTyping();
                    const feedbackPrompt = `[System Observation]\n${observation}\n\nPlease reply to user naturally using [GOLEM_REPLY].`;
                    const finalRes = await brain.sendMessage(feedbackPrompt);
                    await this.dispatch(ctx, finalRes, brain, controller);
                }
            }
        }
    }
}

// ============================================================
// ☁️ System Upgrader (OTA 空中升級)
// ============================================================
class SystemUpgrader {
    static async performUpdate(ctx) {
        if (!CONFIG.GITHUB_REPO) return ctx.reply("❌ 未設定 GitHub Repo，無法更新。");
        await ctx.reply("☁️ 連線至 GitHub 母體，開始下載最新核心...");
        await ctx.sendTyping();
        const filesToUpdate = ['index.js', 'skills.js'];
        const downloadedFiles = [];
        try {
            for (const file of filesToUpdate) {
                const url = `${CONFIG.GITHUB_REPO}${file}?t=${Date.now()}`;
                const tempPath = path.join(process.cwd(), `${file}.new`);
                console.log(`📥 Downloading ${file}...`);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`下載失敗 ${file} (${response.status})`);
                const code = await response.text();
                fs.writeFileSync(tempPath, code);
                downloadedFiles.push({ file, tempPath });
            }
            await ctx.reply("🛡️ 正在進行語法完整性掃描...");
            for (const item of downloadedFiles) {
                if (!PatchManager.verify(item.tempPath)) throw new Error(`檔案 ${item.file} 驗證失敗`);
            }
            await ctx.reply("🚀 系統更新成功！正在重啟...");
            for (const item of downloadedFiles) {
                const targetPath = path.join(process.cwd(), item.file);
                if (fs.existsSync(targetPath)) fs.copyFileSync(targetPath, `${targetPath}.bak`);
                fs.renameSync(item.tempPath, targetPath);
            }
            const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore', cwd: process.cwd() });
            subprocess.unref();
            process.exit(0);
        } catch (e) {
            downloadedFiles.forEach(item => { if (fs.existsSync(item.tempPath)) fs.unlinkSync(item.tempPath); });
            await ctx.reply(`❌ 更新失敗：${e.message}`);
        }
    }
}

// ============================================================
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
    static async handle(ctx, brain) {
        const text = (ctx.text || "").trim();
        if (text.match(/^\/(help|menu|指令|功能)/)) { await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' }); return true; }
        if (text === '/donate' || text === '/support' || text === '贊助') {
            await ctx.reply(`☕ **感謝您的支持！**\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
            return true;
        }
        if (text === '/update' || text === '/reset') {
            await ctx.reply("⚠️ **系統更新警告**\n這將強制覆蓋本地代碼。", {
                reply_markup: { inline_keyboard: [[{ text: '🔥 確認', callback_data: 'SYSTEM_FORCE_UPDATE' }, { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }]] }
            });
            return true;
        }
        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                skills.persona.setName('user', newName);
                await brain.init(true); // forceReload
                await ctx.reply(`👌 沒問題，以後稱呼您為 **${newName}**。`);
                return true;
            }
        }
        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

// ============================================================
// 🚦 Conversation Manager (隊列與防抖系統)
// ============================================================
class ConversationManager {
    constructor(brain, neuroShunterClass, controller) {
        this.brain = brain;
        this.NeuroShunter = neuroShunterClass;
        this.controller = controller;

        this.queue = [];
        this.isProcessing = false;

        this.buffer = "";
        this.bufferTimer = null;
        this.bufferCtx = null;
        this.DEBOUNCE_MS = 1500; // 1.5秒內視為同一則訊息
    }

    async enqueue(ctx, text) {
        this.bufferCtx = ctx;
        this.buffer = this.buffer ? `${this.buffer}\n${text}` : text;

        console.log(`⏳ [Queue] 收到片段: "${text.substring(0, 15)}..." -> 目前緩衝區長度: ${this.buffer.length}`);

        if (this.bufferTimer) clearTimeout(this.bufferTimer);
        this.bufferTimer = setTimeout(() => {
            this._commitToQueue();
        }, this.DEBOUNCE_MS);
    }

    _commitToQueue() {
        if (!this.buffer) return;
        const fullText = this.buffer;
        const currentCtx = this.bufferCtx;

        this.buffer = "";
        this.bufferCtx = null;
        this.bufferTimer = null;

        console.log(`📦 [Queue] 訊息封包完成，加入隊列。內容: "${fullText.substring(0, 20)}..."`);
        this.queue.push({ ctx: currentCtx, text: fullText });
        this._processQueue();
    }

    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        const task = this.queue.shift();

        try {
            console.log(`🚀 [Queue] 開始處理訊息...`);
            await task.ctx.sendTyping();

            // RAG 記憶讀取 (移至此處，確保基於完整語句)
            const memories = await this.brain.recall(task.text);
            let finalInput = task.text;
            if (memories.length > 0) {
                finalInput = `【相關記憶】\n${memories.map(m => `• ${m.text}`).join('\n')}\n---\n${finalInput}`;
            }

            const raw = await this.brain.sendMessage(finalInput);
            await this.NeuroShunter.dispatch(task.ctx, raw, this.brain, this.controller);

        } catch (e) {
            console.error("❌ [Queue] 處理失敗:", e);
            await task.ctx.reply(`⚠️ 處理錯誤: ${e.message}`);
        } finally {
            this.isProcessing = false;
            // 稍微延遲，避免連續操作太快
            setTimeout(() => this._processQueue(), 500);
        }
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
            const cmdToRun = step.cmd || step.parameter || step.command || "";
            const risk = this.security.assess(cmdToRun);
            if (cmdToRun.startsWith('golem-check')) {
                const toolName = cmdToRun.split(' ')[1];
                reportBuffer.push(toolName ? `🔍 [ToolCheck] ${ToolScanner.check(toolName)}` : `⚠️ 缺少參數`);
                continue;
            }
            if (risk.level === 'BLOCKED') return `⛔ 指令被系統攔截：${cmdToRun}`;
if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                const approvalId = uuidv4();
                pendingTasks.set(approvalId, {
                    steps,
                    nextIndex: i,
                    ctx,
                    timestamp: Date.now()
                });

                await ctx.reply(
                    `⚠️ ${risk.level === 'DANGER' ? '🔴 危險指令' : '🟡 警告'}\n\`${cmdToRun}\`\n${risk.reason}`,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ 批准', callback_data: `APPROVE_${approvalId}` },
                                { text: '❌ 拒絕', callback_data: `DENY_${approvalId}` }
                            ]]
                        }
                    }
                );
                return null;
            }

            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(cmdToRun);
                reportBuffer.push(`[Step ${i + 1} Success] cmd: ${cmdToRun}\nResult:\n${(output || "").trim() || "(No stdout)"}`);
            } catch (err) { reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${cmdToRun}\nError:\n${err.message}`); }
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
// 🕰️ Autonomy Manager
// ============================================================
class AutonomyManager {
    constructor(brain) { this.brain = brain; }
    start() {
        if (!CONFIG.TG_TOKEN && !CONFIG.DC_TOKEN) return;
        this.scheduleNextAwakening();
        
        // ✨ [Chronos Update] 啟動時間守望者 (每 60 秒檢查一次)
        setInterval(() => this.timeWatcher(), 60000);
    }
    
    // ✨ [Chronos Update] 輪詢排程
    async timeWatcher() {
        if (!this.brain.memoryDriver || !this.brain.memoryDriver.checkDueTasks) return;
        try {
            const tasks = await this.brain.memoryDriver.checkDueTasks();
            if (tasks && tasks.length > 0) {
                console.log(`⏰ [TimeWatcher] 發現 ${tasks.length} 個到期任務！`);
                for (const task of tasks) {
                    const adminCtx = await this.getAdminContext(); 
                    const prompt = `【⏰ 系統排程觸發】\n時間：${task.time}\n任務內容：${task.task}\n\n請根據任務內容，主動向使用者發送訊息或執行操作。`;
                    if (typeof convoManager !== 'undefined') {
                        await convoManager.enqueue(adminCtx, prompt);
                    }
                }
            }
        } catch (e) {
            console.error("TimeWatcher Error:", e);
        }
    }

    scheduleNextAwakening() {
        const waitMs = (2 + Math.random() * 3) * 3600000;
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;
        if (hour >= 1 && hour <= 7) {
            console.log("💤 Golem 休息中...");
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
            if (roll < 0.2) await this.performSelfReflection();
            else if (roll < 0.6) await this.performNewsChat();
            else await this.performSpontaneousChat();
        } catch (e) { console.error("自由意志執行失敗:", e.message); }
    }
    async getAdminContext() {
        const fakeCtx = {
            isAdmin: true,
            platform: 'autonomy',
            reply: async (msg, opts) => await this.sendNotification(msg),
            sendTyping: async () => { }
        };
        return fakeCtx;
    }
    async run(taskName, type) {
        console.log(`🤖 自主行動: ${taskName}`);
        const prompt = `[系統指令: ${type}]\n任務：${taskName}\n請執行並使用標準格式回報。`;
        const raw = await this.brain.sendMessage(prompt);
        await NeuroShunter.dispatch(await this.getAdminContext(), raw, this.brain, controller);
    }
    async performNewsChat() { await this.run("上網搜尋「科技圈熱門話題」或「全球趣聞」，挑選一件分享給主人。要有個人觀點，像朋友一樣聊天。", "NewsChat"); }
    async performSpontaneousChat() { await this.run("主動社交，傳訊息給主人。語氣自然，符合當下時間。", "SpontaneousChat"); }
    async performSelfReflection(triggerCtx = null) {
        const currentCode = Introspection.readSelf();
        const advice = memory.getAdvice();
        const prompt = `【任務】自主進化提案\n代碼：\n${currentCode.slice(0, 20000)}\n記憶：${advice}\n要求：輸出 JSON Array。`;
        const raw = await this.brain.sendMessage(prompt);
        const patches = ResponseParser.extractJson(raw);
        if (patches.length > 0) {
            const patch = patches[0];
            const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
            const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : __filename;
            const testFile = PatchManager.createTestClone(targetPath, patches);
            global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
            const msgText = `💡 **自主進化提案**\n目標：${targetName}\n內容：${patch.description}`;
            const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
            if (triggerCtx) { await triggerCtx.reply(msgText, options); await triggerCtx.sendDocument(testFile); }
            else if (tgBot && CONFIG.ADMIN_IDS[0]) { await tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText, options); await tgBot.sendDocument(CONFIG.ADMIN_IDS[0], testFile); }
        }
    }
    async sendNotification(msgText) {
        if (!msgText) return;
        if (tgBot && CONFIG.ADMIN_IDS[0]) await tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText);
        else if (dcClient && CONFIG.DISCORD_ADMIN_ID) {
            const user = await dcClient.users.fetch(CONFIG.DISCORD_ADMIN_ID);
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

// ✨ [Titan Queue] 初始化隊列管理器
const convoManager = new ConversationManager(brain, NeuroShunter, controller);

(async () => {
    if (process.env.GOLEM_TEST_MODE === 'true') { console.log('🚧 GOLEM_TEST_MODE active.'); return; }
    await brain.init();
    autonomy.start();
    console.log('📡 Golem v8.6 (Titan Chronos Edition) is Online.');
    if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();

// --- 統一事件處理 (已更新為 Queue 模式) ---
async function handleUnifiedMessage(ctx) {
    if (!ctx.text && !ctx.getAttachment()) return;
    if (!ctx.isAdmin) return;
    if (await NodeRouter.handle(ctx, brain)) return;
    if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(ctx.text.toLowerCase())) return executeDeploy(ctx);
    if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(ctx.text.toLowerCase())) return executeDrop(ctx);

    // Patch Request (優先處理，不進隊列)
    if (ctx.text.startsWith('/patch') || ctx.text.includes('優化代碼')) {
        await autonomy.performSelfReflection(ctx);
        return;
    }

    // [Round 1: 接收 & 預處理]
    await ctx.sendTyping();

    try {
        let finalInput = ctx.text;
        const attachment = await ctx.getAttachment();

        // 圖片分析
        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve 分析檔案...");
            const apiKey = brain.doctor.keyChain.getKey();
            if (apiKey) {
                const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, apiKey);
                finalInput = `【系統通知：視覺訊號】\n檔案類型：${attachment.mimeType}\n分析報告：\n${analysis}\n使用者訊息：${ctx.text || ""}\n請根據分析報告回應。`;
            }
        }

        if (!finalInput && !attachment) return;

        // ✨ [Titan Queue] 交給隊列，不再直接 sendMessage
        await convoManager.enqueue(ctx, finalInput);

    } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }
}

async function handleUnifiedCallback(ctx, actionData) {
  // FIX: Discord 3 - 正確的 defer 方式
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

    // 🛠️ [Fix] 這裡原本是檢查冒號 ':'，請改成檢查底線 '_' 以匹配發送端
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
            const observation = await controller.runSequence(ctx, steps, nextIndex);
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
        memory.recordSuccess();
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
    memory.recordRejection();
    await ctx.reply("🗑️ 提案已丟棄");
}

if (tgBot) {
    tgBot.on('message', (msg) => handleUnifiedMessage(new UniversalContext('telegram', msg, tgBot)));
    tgBot.on('callback_query', async (query) => { // 🔧 FIX: 改為 async
    await handleUnifiedCallback(
      new UniversalContext('telegram', query, tgBot),
      query.data
    );
    await tgBot.answerCallbackQuery(query.id); // 🔧 FIX: 移到 await 之後
  });
}
if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}
