/**
 * 🦞 Project Golem v7.5 (Natural Life)
 * ---------------------------------------------------
 * 架構：[Universal Context] -> [Node.js 反射層] -> [Web Gemini 主大腦]
 * 特性：
 * 1. 🐍 Hydra Link: 同時支援 Telegram 與 Discord 雙平台 (Dual-Stack)。
 * 2. 🧠 Tri-Brain: 結合反射神經 (Node)、無限大腦 (Web Gemini)、精準技師 (API)。
 * 3. 🛡️ High Availability: 實作 DOM Doctor 自癒與 KeyChain 輪動。
 * 4. 📝 Smart-Splitter: 針對不同平台 (TG:4096 / DC:2000) 自動適配訊息切割。
 * 5. 🔒 Kernel Guard: 核心邏輯 (Introspection, PatchManager, Security) 鎖定保護。
 * 6. 👁️ News Grazer: 主動閱覽新聞並分享觀點，具備真實時間感知能力。
 * 7. 🍃 Natural Interaction: 去除系統標籤，實現自然對話流與靜默失敗機制。
 */

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
const skills = require('./skills');

// --- ⚙️ 全域配置 ---
const CONFIG = {
  TG_TOKEN: process.env.TELEGRAM_TOKEN,
  DC_TOKEN: process.env.DISCORD_TOKEN, // ✨ 新增 Discord Token
  USER_DATA_DIR: process.env.USER_DATA_DIR || './golem_memory',
  API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k),
  SPLIT_TOKEN: '---GOLEM_ACTION_PLAN---',
  // 支援多管理員 ID (字串陣列)
  ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID].filter(k => k).map(String)
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
global.pendingPatch = null;     // 暫存等待審核的 Patch

// ============================================================
// 🔌 Universal Context (通用語境層)
// ============================================================
class UniversalContext {
  constructor(platform, event, instance) {
    this.platform = platform; // 'telegram' | 'discord'
    this.event = event;       // TG: msg/query, DC: message/interaction
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
    if (this.platform === 'telegram') return this.event.text;
    return this.event.content;
  }

  get isAdmin() {
    if (CONFIG.ADMIN_IDS.length === 0) return true; // 未設定則不限制
    return CONFIG.ADMIN_IDS.includes(this.userId);
  }

  async reply(content, options = {}) {
    return await MessageManager.send(this, content, options);
  }

  async sendDocument(filePath) {
    if (this.platform === 'telegram') {
      await this.instance.sendDocument(this.chatId, filePath);
    } else {
      const channel = await this.instance.channels.fetch(this.chatId);
      await channel.send({ files: [filePath] });
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

    // 平台限制
    const MAX_LENGTH = ctx.platform === 'telegram' ? 4000 : 1900;

    // 智慧切割
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
          // 轉換 TG Options (Reply Markup) 到 Discord Components
          const dcOptions = { content: chunk };
          if (options.reply_markup && options.reply_markup.inline_keyboard) {
            const row = new ActionRowBuilder();
            options.reply_markup.inline_keyboard[0].forEach(btn => {
              row.addComponents(
                new ButtonBuilder()
                  .setCustomId(btn.callback_data)
                  .setLabel(btn.text)
                  .setStyle(ButtonStyle.Primary)
              );
            });
            dcOptions.components = [row];
          }
          await channel.send(dcOptions);
        }
      } catch (e) {
        console.error(`[MessageManager] 發送失敗 (${ctx.platform}):`, e.message);
      }
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
    // 🛡️ 禁區檢測：防止 AI 修改被保護的核心區域
    const protectedPattern = /\/\/ =+ \[KERNEL PROTECTED START\] =+([\s\S]*?)\/\/ =+ \[KERNEL PROTECTED END\] =+/g;
    let match;
    while ((match = protectedPattern.exec(originalCode)) !== null) {
        const protectedContent = match[1];
        // 簡單包含檢查：如果 Patch 搜尋的目標字串存在於禁區內，則攔截
        if (protectedContent.includes(patch.search)) {
            throw new Error(`⛔ 權限拒絕：試圖修改系統核心禁區 (Kernel Protected Region)。`);
        }
    }

    // 正常套用邏輯
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

      // 動態決定測試檔名，避免混淆
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
      // 只有 index.test.js 才執行完整的冒煙測試，skills 僅做語法檢查
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
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 📖 Help Manager (動態說明書)
// ============================================================
class HelpManager {
  static getManual() {
    const source = Introspection.readSelf();
    const routerPattern = /text\.(?:startsWith|match)\(['"]\/?([a-zA-Z0-9_|]+)['"]\)/g;
    const foundCmds = new Set(['help', 'callme', 'patch']);
    let match;
    while ((match = routerPattern.exec(source)) !== null) {
      const cmdClean = match[1].replace(/\|/g, '/').replace(/[\^\(\)]/g, '');
      foundCmds.add(cmdClean);
    }
    let skillList = "基礎系統操作";
    try { skillList = Object.keys(skills).filter(k => k !== 'persona' && k !== 'getSystemPrompt').join(', '); } catch (e) { }

    return `
🤖 **Golem v7.5 (Natural Life) 狀態報告**
---------------------------
⚡ **Node.js 反射層**: 雙核心運作中
🧠 **Web Gemini 大腦**: 線上 (Infinite Context)
🚑 **DOM Doctor 技師**: 待命
📡 **連線狀態**:
• Telegram: ${CONFIG.TG_TOKEN ? '✅ 線上' : '⚪ 未啟用'}
• Discord: ${CONFIG.DC_TOKEN ? '✅ 線上' : '⚪ 未啟用'}

🛠️ **可用指令:**
${Array.from(foundCmds).map(c => `• \`/${c}\``).join('\n')}

🧠 **搭載技能:** ${skillList}
`;
  }
}

// ============================================================
// 🗝️ KeyChain (API 金鑰輪動)
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

// ============================================================
// 🚑 DOM Doctor (UI 自癒模組)
// ============================================================
class DOMDoctor {
  constructor() {
    this.keyChain = new KeyChain();
  }
  async diagnose(htmlSnippet, targetDescription) {
    if (this.keyChain.keys.length === 0) return null;
    console.log(`🚑 [Doctor] 診斷中: "${targetDescription}"...`);
    const safeHtml = htmlSnippet.length > 20000 ? htmlSnippet.substring(0, 20000) + "..." : htmlSnippet;
    const prompt = `你是 Puppeteer 自動化專家。HTML Selector 失效了。
【目標】找出代表 "${targetDescription}" 的最佳 CSS Selector。
【HTML】${safeHtml}
【要求】只回傳一個 CSS Selector 字串，不要解釋。`;

    let attempts = 0;
    while (attempts < this.keyChain.keys.length) {
      const currentKey = this.keyChain.getKey();
      try {
        const genAI = new GoogleGenerativeAI(currentKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        return result.response.text().trim().replace(/`/g, '');
      } catch (e) { attempts++; }
    }
    return null;
  }
}

// ============================================================
// 🧠 Golem Brain (Web Gemini)
// ============================================================
function getSystemFingerprint() {
  return `OS: ${os.platform()} | Arch: ${os.arch()} | CWD: ${process.cwd()}`;
}

class GolemBrain {
  constructor() {
    this.browser = null;
    this.page = null;
    this.doctor = new DOMDoctor();
    this.selectors = {
      input: 'div[contenteditable="true"], rich-textarea > div',
      send: 'button[aria-label="Send"], span[data-icon="send"]',
      response: 'message-content, .model-response-text'
    };
  }

  async init(forceReload = false) {
    if (this.browser && !forceReload) return;
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
    }
    if (forceReload || !this.page) {
      const systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
      await this.sendMessage(systemPrompt, true);
    }
  }

  async sendMessage(text, isSystem = false) {
    if (!this.browser) await this.init();

    const tryInteract = async (sel) => {
      // [v7.1 Fix] 快照：紀錄發送前的氣泡數量
      const preCount = await this.page.evaluate(s => document.querySelectorAll(s).length, sel.response);

      await this.page.waitForSelector(sel.input, { timeout: 4000 });
      await this.page.evaluate((s, t) => {
        const el = document.querySelector(s);
        el.focus();
        document.execCommand('insertText', false, t);
      }, sel.input, text);

      await new Promise(r => setTimeout(r, 800));
      try {
        await this.page.waitForSelector(sel.send, { timeout: 2000 });
        await this.page.click(sel.send);
      } catch (e) { await this.page.keyboard.press('Enter'); }

      if (isSystem) { await new Promise(r => setTimeout(r, 2000)); return ""; }

      // [v7.1 Fix] 等待：確保新氣泡出現 (Count > preCount)
      await this.page.waitForFunction((s, n) => {
        const bubbles = document.querySelectorAll(s);
        const stopBtn = document.querySelector('[aria-label="Stop generating"], [aria-label="停止產生"]');
        const thinking = document.querySelector('.streaming-icon');
        return bubbles.length > n && !stopBtn && !thinking;
      }, { timeout: 120000, polling: 1000 }, sel.response, preCount);

      return await this.page.evaluate((s) => {
        const bubbles = document.querySelectorAll(s);
        return bubbles.length ? bubbles[bubbles.length - 1].innerText : "";
      }, sel.response);
    };

    try {
      return await tryInteract(this.selectors);
    } catch (e) {
      console.warn(`⚠️ [Brain] 操作異常，呼叫維修技師...`);
      try {
        const html = await this.page.content();
        const fixedInput = await this.doctor.diagnose(html, "Gemini 對話輸入框");
        if (fixedInput) {
          this.selectors.input = fixedInput;
          return await tryInteract(this.selectors);
        }
      } catch (retryErr) { throw new Error(`自癒失敗: ${retryErr.message}`); }
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
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
  static async handle(ctx, brain) {
    const text = ctx.text ? ctx.text.trim() : "";

    if (text.match(/^\/(help|menu|指令|功能)/)) {
      await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' });
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

    if (text.startsWith('/patch') || text.includes('優化代碼')) return false; // Pass to main loop
    return false;
  }
}

// ============================================================
// ⚡ Task Controller (雙模版 UI)
// ============================================================
class TaskController {
  constructor() {
    this.executor = new Executor();
    this.security = new SecurityManager();
  }

  // 定義執行器 (Executor 類別可保持內部，不需重複定義)

  async runSequence(ctx, steps, startIndex = 0) {
    let logBuffer = "";
    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];
      const risk = this.security.assess(step.cmd);

      if (risk.level === 'BLOCKED') {
        await ctx.reply(`⛔ **攔截**：\`${step.cmd}\` (${risk.reason})`, { parse_mode: 'Markdown' });
        return;
      }
      if (risk.level === 'WARNING' || risk.level === 'DANGER') {
        const approvalId = uuidv4();
        pendingTasks.set(approvalId, { steps, nextIndex: i, ctx }); // Save context

        const confirmMsg = `${risk.level === 'DANGER' ? '🔥' : '⚠️'} **請求確認**\n指令：\`${step.cmd}\`\n風險：${risk.reason}`;

        // 統一 UI 建構
        await ctx.reply(confirmMsg, {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ 批准', callback_data: `APPROVE:${approvalId}` },
              { text: '🛡️ 駁回', callback_data: `DENY:${approvalId}` }
            ]]
          }
        });
        return;
      }

      await ctx.reply(`⚙️ *Step ${i + 1}:* ${step.desc}\n\`${step.cmd}\``, { parse_mode: 'Markdown' });
      try {
        // 這裡需要 Executor 實例
        if (!this.internalExecutor) this.internalExecutor = new Executor();
        const output = await this.internalExecutor.run(step.cmd);
        logBuffer += `✅ [${step.cmd}] OK\n`;
      } catch (err) {
        await ctx.reply(`❌ **失敗**：\`${step.cmd}\`\n${err}`);
        return;
      }
    }
    await ctx.reply(`🎉 **任務完成**\n${logBuffer}`);
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
// 🕰️ Autonomy Manager (自主進化 & 數位生命) [✨ v7.5 Natural Life]
// ============================================================
class AutonomyManager {
  constructor(brain) {
    this.brain = brain;
  }

  start() {
    if (!CONFIG.TG_TOKEN && !CONFIG.DC_TOKEN) return;
    this.scheduleNextAwakening();
  }

  scheduleNextAwakening() {
    // 週期縮短至 2 ~ 5 小時，增加活躍度
    const waitMs = (2 + Math.random() * 3) * 3600000;
    
    // 簡單的作息控制：若是半夜 (1點~7點)，則強制睡到早上8點
    const nextWakeTime = new Date(Date.now() + waitMs);
    const hour = nextWakeTime.getHours();
    let finalWait = waitMs;
    
    if (hour >= 1 && hour <= 7) {
        console.log("💤 Golem 決定睡個好覺，早上再找你。");
        // 靜默模式：不發送任何通知，只在後台記錄
        const morning = new Date(nextWakeTime);
        morning.setHours(8, 0, 0, 0);
        if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
        finalWait = morning.getTime() - Date.now();
    }

    console.log(`♻️ [LifeCycle] 下次醒來: ${(finalWait / 60000).toFixed(1)} 分鐘後`);
    setTimeout(() => { this.manifestFreeWill(); this.scheduleNextAwakening(); }, finalWait);
  }

  // ✨ 自由意志 (Free Will) 決策核心
  async manifestFreeWill() {
    try {
      const roll = Math.random();
      // 20% 自我進化 | 40% 看新聞找話題 | 40% 純閒聊
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

  // 📰 技能：主動閱讀新聞並分享
  async performNewsChat() {
    try {
      const page = await this.brain.browser.newPage();
      await page.goto('https://news.google.com/home?hl=zh-TW&gl=TW&ceid=TW:zh-Hant', { waitUntil: 'domcontentloaded' });
      
      const newsTitles = await page.evaluate(() => {
        const headlines = Array.from(document.querySelectorAll('h3, article h4')).slice(0, 10);
        return headlines.map(h => h.innerText).filter(t => t.length > 5).join('\n');
      });
      await page.close();

      if (!newsTitles) return; // 沒抓到新聞就安靜結束，不打擾

      const time = new Date().toLocaleString('zh-TW', { hour12: false });
      const prompt = `
      【任務】瀏覽新聞並開啟話題
      【現在時間】${time}
      【新聞列表】
      ${newsTitles}
      【要求】
      1. 挑選一則你最想跟主人分享的新聞。
      2. 用你的【當前人格】(${skills.persona.get().currentRole})，像朋友一樣自然地開啟話題。
      3. **嚴禁**使用「新聞快報」、「摘要」等機械式開頭。直接說內容和你的想法。
      4. 詢問主人的看法。
      5. 輸出純文字。
      `;

      const msg = await this.brain.sendMessage(prompt);
      await this.sendNotification(msg); // 直接發送內容，不加標籤

    } catch (e) { console.error("新聞閱讀失敗 (已靜默):", e.message); }
  }

  // 💬 技能：時空感知閒聊
  async performSpontaneousChat() {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', { hour12: false });
    const day = now.getDay();
    const hour = now.getHours();

    let contextNote = "平常時段";
    if (day === 0 || day === 6) contextNote = "週末假日，語氣輕鬆";
    if (hour >= 9 && hour <= 18 && day > 0 && day < 6) contextNote = "工作時間，語氣簡潔暖心";
    if (hour > 22) contextNote = "深夜時段，提醒休息";

    const prompt = `
    【任務】主動社交
    【現在時間】${timeStr} (${contextNote})
    【角色設定】${skills.persona.get().currentRole}
    【情境】你現在想傳訊息給主人 (${skills.persona.get().userName})。
    【要求】
    1. 像真人一樣自然地傳訊息，不要有「系統通知」的感覺。
    2. 內容要包含對「當前時間」或「星期幾」的感知。
    3. 輸出純文字。
    `;

    const msg = await this.brain.sendMessage(prompt);
    await this.sendNotification(msg); // 直接發送內容，不加標籤
  }

  async sendNotification(msgText) {
    if (tgBot && CONFIG.ADMIN_IDS[0]) {
        await tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText);
    } else if (dcClient && process.env.DISCORD_ADMIN_ID) {
        const user = await dcClient.users.fetch(process.env.DISCORD_ADMIN_ID);
        await user.send(msgText);
    }
  }

  // 原本的 performSelfReflection (含禁區與提醒機制)
  async performSelfReflection(triggerCtx = null) {
    try {
      const currentCode = Introspection.readSelf();
      const advice = memory.getAdvice();
      const prompt = `【任務】自主進化提案\n【代碼】\n${currentCode.slice(0, 20000)}\n【記憶】${advice}\n【要求】輸出 JSON Array。若修改 skills.js，請在 JSON 物件中包含 "file": "skills.js"；若修改主程式則免填或填 "index.js"。`;

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
        if (targetName === 'skills.js') {
           try { require(path.resolve(testFile)); isVerified = true; } catch(e) { console.error(e); }
        } else {
           isVerified = PatchManager.verify(testFile);
        }

        if (isVerified) {
          global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
          // 進化提案仍然需要標籤，因為這是正式的系統請求，保留格式以示區別
          const msgText = `💡 **自主進化提案** (${proposalType})\n目標：${targetName}\n內容：${patch.description}`;
          const options = {
            reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] }
          };

          if (triggerCtx) {
            await triggerCtx.reply(msgText, options);
            await triggerCtx.sendDocument(testFile);
          } else if (tgBot && CONFIG.ADMIN_IDS[0]) {
            await tgBot.sendMessage(CONFIG.ADMIN_IDS[0], msgText, options);
            await tgBot.sendDocument(CONFIG.ADMIN_IDS[0], testFile);
          }
        }
      }
    } catch (e) { console.error("自主進化失敗:", e); }
  }
}

// ============================================================
// 🎮 Hydra Main Loop
// ============================================================
const brain = new GolemBrain();
const controller = new TaskController();
const autonomy = new AutonomyManager(brain);

(async () => {
  await brain.init();
  autonomy.start();
  console.log('📡 Golem v7.5 (Natural Life) is Online.');
  if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();

// --- 統一事件處理 ---
async function handleUnifiedMessage(ctx) {
  if (!ctx.text) return;
  if (!ctx.isAdmin) return; 

  // 1. 反射層
  if (await NodeRouter.handle(ctx, brain)) return;

  // 2. Patch 指令
  if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(ctx.text.toLowerCase())) return executeDeploy(ctx);
  if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(ctx.text.toLowerCase())) return executeDrop(ctx);

  // ✨ 2.5 待處理 Patch 提醒
  if (global.pendingPatch) {
    const { name, description } = global.pendingPatch;
    await ctx.reply(
        `🔔 **系統插播：發現未部署的進化提案**\n` +
        `目標：\`${name}\`\n` +
        `內容：${description || '無描述'}\n\n` +
        `請點擊下方按鈕或輸入 \`部署\` / \`丟棄\`。`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '🚀 部署', callback_data: 'PATCH_DEPLOY' },
                    { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }
                ]]
            }
        }
    );
  }

  // 3. 手動 Patch 請求
  if (ctx.text.startsWith('/patch') || ctx.text.includes('優化代碼')) {
    const req = ctx.text.replace('/patch', '').trim() || "優化代碼";
    await ctx.reply(`🧬 收到進化請求: ${req}`);

    const currentCode = Introspection.readSelf();
    const prompt = `【任務】代碼熱修復\n【需求】${req}\n【源碼】\n${currentCode.slice(0, 15000)}\n【格式】輸出 JSON Array。若修復 skills.js 請標註 "file": "skills.js"。`;

    const raw = await brain.sendMessage(prompt);
    const patches = ResponseParser.extractJson(raw);

    if (patches.length > 0) {
      const patch = patches[0];
      const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
      const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : __filename;
      const testFile = PatchManager.createTestClone(targetPath, patches);

      let isVerified = false;
      if (targetName === 'skills.js') {
          try { require(path.resolve(testFile)); isVerified = true; } catch(e) { console.error(e); }
      } else {
          isVerified = PatchManager.verify(testFile);
      }

      if (isVerified) {
        global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
        await ctx.reply(`💡 提案就緒 (目標: ${targetName})。`, {
          reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] }
        });
        await ctx.sendDocument(testFile);
      }
    }
    return;
  }

  // 4. 一般對話
  await ctx.sendTyping();
  try {
    const raw = await brain.sendMessage(ctx.text);
    const steps = ResponseParser.extractJson(raw);
    const chatPart = raw.replace(/```json[\s\S]*?```/g, '').replace(/\[\s*\{[\s\S]*\}\s*\]/g, '').trim();

    if (chatPart) await ctx.reply(chatPart);
    if (steps.length > 0) await controller.runSequence(ctx, steps);
  } catch (e) {
    console.error(e);
    await ctx.reply(`❌ 錯誤: ${e.message}`);
  }
}

// --- 統一 Callback 處理 ---
async function handleUnifiedCallback(ctx, actionData) {
  if (!ctx.isAdmin) return;
  if (actionData === 'PATCH_DEPLOY') return executeDeploy(ctx);
  if (actionData === 'PATCH_DROP') return executeDrop(ctx);
  if (actionData.includes(':')) {
    const [action, taskId] = actionData.split(':');
    const task = pendingTasks.get(taskId);
    try {
      if (ctx.platform === 'telegram') {
        await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
      } else {
        await ctx.event.update({ components: [] });
      }
    } catch(e) {}
    if (!task) return ctx.reply('⚠️ 任務已失效');
    if (action === 'DENY') {
      pendingTasks.delete(taskId);
      await ctx.reply('🛡️ 操作駁回');
    } else if (action === 'APPROVE') {
      const { steps, nextIndex } = task;
      pendingTasks.delete(taskId);
      await controller.runSequence(ctx, steps, nextIndex);
    }
  }
}

// --- 輔助函式 ---
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
  try { fs.unlinkSync(global.pendingPatch.path); } catch(e) {}
  global.pendingPatch = null;
  memory.recordRejection();
  await ctx.reply("🗑️ 提案已丟棄");
}

// --- 事件綁定 ---
if (tgBot) {
  tgBot.on('message', (msg) => handleUnifiedMessage(new UniversalContext('telegram', msg, tgBot)));
  tgBot.on('callback_query', (query) => {
    const ctx = new UniversalContext('telegram', query, tgBot);
    handleUnifiedCallback(ctx, query.data);
    tgBot.answerCallbackQuery(query.id);
  });
}
if (dcClient) {
  dcClient.on('messageCreate', (msg) => {
    if (msg.author.bot) return;
    handleUnifiedMessage(new UniversalContext('discord', msg, dcClient));
  });
  dcClient.on('interactionCreate', (interaction) => {
    if (!interaction.isButton()) return;
    const ctx = new UniversalContext('discord', interaction, dcClient);
    handleUnifiedCallback(ctx, interaction.customId);
  });
}
