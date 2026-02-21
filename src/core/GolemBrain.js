const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { CONFIG, cleanEnv } = require('../config');
const { getSystemFingerprint } = require('../utils/system');
const DOMDoctor = require('../services/DOMDoctor');
const BrowserMemoryDriver = require('../memory/BrowserMemoryDriver');
const SystemQmdDriver = require('../memory/SystemQmdDriver');
const SystemNativeDriver = require('../memory/SystemNativeDriver');
const skills = require('../skills');
const skillManager = require('../skills/lib/skill-manager');

puppeteer.use(StealthPlugin());

// ============================================================
// 🧠 Golem Brain (Web Gemini) - Dual-Engine + Titan Protocol
// ============================================================
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

        this.chatLogFile = path.join(process.cwd(), 'logs', 'agent_chat.jsonl');
        // Ensure directory exists
        if (!fs.existsSync(path.dirname(this.chatLogFile))) {
            fs.mkdirSync(path.dirname(this.chatLogFile), { recursive: true });
        }

        // Retention: Clean logs older than 1 day
        this._cleanupLogs(24 * 60 * 60 * 1000);
    }

    _cleanupLogs(maxAgeMs) {
        if (!fs.existsSync(this.chatLogFile)) return;
        try {
            const now = Date.now();
            const content = fs.readFileSync(this.chatLogFile, 'utf8');
            const lines = content.trim().split('\n');
            const keptLines = lines.filter(line => {
                try {
                    const entry = JSON.parse(line);
                    return (now - entry.timestamp) < maxAgeMs;
                } catch (e) { return false; }
            });

            if (keptLines.length < lines.length) {
                fs.writeFileSync(this.chatLogFile, keptLines.join('\n') + '\n');
                console.log(`🧹 [System] 已清理過期對話日誌 (${lines.length - keptLines.length} 條)`);
            }
        } catch (e) {
            console.error("Cleanup logs failed:", e);
        }
    }

    _appendChatLog(entry) {
        try {
            fs.appendFileSync(this.chatLogFile, JSON.stringify(entry) + '\n');
        } catch (e) {
            console.error("Failed to write chat log:", e);
        }
    }

    async init(forceReload = false) {
        if (this.browser && !forceReload) return;
        let isNewSession = false;
        if (!this.browser) {
            const userDataDir = path.resolve(CONFIG.USER_DATA_DIR);
            console.log(`📂 [System] Browser User Data Dir: ${userDataDir}`);

            const isDocker = fs.existsSync('/.dockerenv');
            const remoteDebugPort = process.env.PUPPETEER_REMOTE_DEBUGGING_PORT;
            if (isDocker && remoteDebugPort) {
                const host = 'host.docker.internal';
                const browserURL = `http://${host}:${remoteDebugPort}`;
                console.log(`🔌 [System] Connecting to Remote Chrome at ${browserURL}...`);
                try {
                    const http = require('http');
                    const wsEndpoint = await new Promise((resolve, reject) => {
                        const req = http.get(
                            `http://${host}:${remoteDebugPort}/json/version`,
                            { headers: { 'Host': 'localhost' } },
                            (res) => {
                                let data = '';
                                res.on('data', chunk => data += chunk);
                                res.on('end', () => {
                                    try {
                                        const json = JSON.parse(data);
                                        const rawWsUrl = new URL(json.webSocketDebuggerUrl);
                                        rawWsUrl.hostname = host;
                                        rawWsUrl.port = remoteDebugPort;
                                        resolve(rawWsUrl.toString());
                                    } catch (e) { reject(new Error(`Failed to parse /json/version: ${data}`)); }
                                });
                            }
                        );
                        req.on('error', reject);
                        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout fetching /json/version')); });
                    });
                    console.log(`🔗 [System] WebSocket Endpoint: ${wsEndpoint}`);
                    this.browser = await puppeteer.connect({
                        browserWSEndpoint: wsEndpoint,
                        defaultViewport: null
                    });
                    console.log(`✅ [System] Connected to Remote Chrome!`);
                } catch (e) {
                    console.error(`❌ [System] Failed to connect to Remote Chrome: ${e.message}`);
                    throw e;
                }
            } else {
                const cleanLocks = () => {
                    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
                    let cleaned = 0;
                    lockFiles.forEach(file => {
                        const p = path.join(userDataDir, file);
                        try {
                            fs.lstatSync(p);
                            fs.rmSync(p, { force: true, recursive: true });
                            console.log(`🔓 [System] Removed Stale Lock: ${file}`);
                            cleaned++;
                        } catch (e) {
                            if (e.code !== 'ENOENT') {
                                console.warn(`⚠️ [System] Failed to remove ${file}: ${e.message}`);
                            }
                        }
                    });
                    return cleaned;
                };

                cleanLocks();

                const launchBrowser = async (retries = 3) => {
                    try {
                        return await puppeteer.launch({
                            headless: process.env.PUPPETEER_HEADLESS === 'true' ? true : (process.env.PUPPETEER_HEADLESS === 'new' ? 'new' : false),
                            userDataDir: userDataDir,
                            args: [
                                '--no-sandbox',
                                '--disable-dev-shm-usage', 
                                '--disable-setuid-sandbox',
                                '--window-size=1280,900',
                                '--disable-gpu' 
                            ]
                        });
                    } catch (err) {
                        if (retries > 0 && err.message.includes('profile appears to be in use')) {
                            console.warn(`⚠️ [System] Profile locked. Retrying launch (${retries} left)...`);
                            cleanLocks(); 
                            await new Promise(r => setTimeout(r, 1000)); 
                            return launchBrowser(retries - 1);
                        }
                        throw err;
                    }
                };

                this.browser = await launchBrowser();
            }
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

        if (process.argv.includes('dashboard')) {
            try {
                const dashboard = require('../../dashboard'); 
                dashboard.setContext(this, this.memoryDriver);
            } catch (e) {
                try {
                    const dashboard = require('../../dashboard.js');
                    dashboard.setContext(this, this.memoryDriver);
                } catch (err) {
                    console.error("Failed to link dashboard context:", err);
                }
            }
        }

        if (forceReload || isNewSession) {
            let systemPrompt = skills.getSystemPrompt(getSystemFingerprint());

            try {
                const activeSkills = skillManager.listSkills();
                if (activeSkills.length > 0) {
                    systemPrompt += `\n\n### 🛠️ DYNAMIC SKILLS AVAILABLE (Output {"action": "skill_name", ...}):\n`;
                    
                    let skillMemoryText = "【系統技能庫初始化】我目前已掛載並精通以下可用技能：\n";
                    activeSkills.forEach(s => {
                        systemPrompt += `- Action: "${s.name}" | Desc: ${s.description}\n`;
                        skillMemoryText += `- 技能 "${s.name}"：${s.description}\n`;
                    });
                    systemPrompt += `(Use these skills via [GOLEM_ACTION] when requested by user.)\n`;

                    await this.memorize(skillMemoryText, { type: 'system_skills', source: 'boot_init' });
                    console.log(`🧠 [Memory] 已成功將 ${activeSkills.length} 項技能載入長期記憶中！`);
                }
            } catch (e) { console.warn("Skills injection failed:", e); }

            const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.0.2 - TITAN CHRONOS + MULTIAGENT + SKILLS】
You act as a middleware OS. You MUST strictly follow this output format.
DO NOT use emojis in tags. DO NOT output raw text outside of these blocks.

1. **Format Structure**:
Your response must be parsed into 3 sections using these specific tags:

[GOLEM_MEMORY]
(Write long-term memories here. If none, leave empty or write "null")

[GOLEM_ACTION]
(Write JSON execution plan here. MUST be perfectly valid JSON Array or Object.)
\`\`\`json
[
{"action": "command", "parameter": "ls -la"}
]
\`\`\`

[GOLEM_REPLY]
(Write the actual response to the user here. Pure text.)

2. **CRITICAL RULES FOR JSON (MUST OBEY)**:
- 🚨 JSON ESCAPING: If your action values contain double quotes ("), you MUST escape them (\\"). Unescaped quotes will crash the JSON parser!
- 🛠️ SKILL USAGE: For complex skills requiring long text, DO NOT write raw CLI commands. Output a structured JSON object. (e.g., {"action": "reincarnate", "summary": "..."})

3. **🧠 ReAct PROTOCOL (WAIT FOR OBSERVATION - EXTREMELY IMPORTANT)**:
- If your task requires executing a [GOLEM_ACTION] to gather information (e.g., reading a file, checking a folder, fetching an API), **YOU MUST NOT GUESS OR HALLUCINATE THE RESULT IN [GOLEM_REPLY]!**
- Instead, output the [GOLEM_ACTION], and set [GOLEM_REPLY] to a simple acknowledgment like: "正在為您執行指令查詢，請稍候..." or "我正在查看資料夾，請批准操作...".
- The system will pause, execute your action, and send the actual result back to you as a "[System Observation]".
- ONLY AFTER you receive the "[System Observation]" in the NEXT turn, you can analyze it and output the final answer in a new [GOLEM_REPLY].
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

    // ✨ [新增] 動態視覺腳本：針對新版 UI 切換模型 (支援中英文介面與防呆)
    async switchModel(targetMode) {
        if (!this.page) throw new Error("大腦尚未啟動。");
        try {
            const result = await this.page.evaluate(async (mode) => {
                const delay = (ms) => new Promise(r => setTimeout(r, ms));
                
                // 定義支援的模式及其可能的中英文關鍵字
                const modeKeywords = {
                    'fast': ['fast', '快捷'],
                    'thinking': ['thinking', '思考型', '思考'], // 增加容錯率
                    'pro': ['pro'] // Pro 通常中英文都叫 Pro
                };

                // 取得目標模式的所有關鍵字
                const targetKeywords = modeKeywords[mode] || [mode];

                // 1. 尋找畫面底部含有目標關鍵字的按鈕 (這可能是展開選單的按鈕)
                // 我們先尋找任何可能代表模型切換的按鈕
                const allKnownKeywords = [...modeKeywords.fast, ...modeKeywords.thinking, ...modeKeywords.pro];
                const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
                let pickerBtn = null;

                for (const btn of buttons) {
                    const txt = (btn.innerText || "").toLowerCase().trim();
                    // 按鈕文字包含任何已知模式的關鍵字，且高度合理
                    if (allKnownKeywords.some(k => txt.includes(k.toLowerCase())) && btn.offsetHeight > 10 && btn.offsetHeight < 60) {
                        const rect = btn.getBoundingClientRect();
                        // 根據截圖，該按鈕位於畫面下半部
                        if (rect.top > window.innerHeight / 2) { 
                            pickerBtn = btn;
                            break;
                        }
                    }
                }

                if (!pickerBtn) return "⚠️ 找不到畫面底部的模型切換按鈕。UI 可能已變更，或您停留在登入畫面。";
                
                // ✨ [核心防呆] 檢查按鈕是否為「灰色不可點擊」狀態
                const isDisabled = pickerBtn.disabled || 
                                   pickerBtn.getAttribute('aria-disabled') === 'true' || 
                                   pickerBtn.classList.contains('disabled');
                                   
                if (isDisabled) {
                    return "⚠️ 模型切換按鈕目前呈現「灰色不可點擊」狀態！這通常是因為您尚未登入 Google 帳號，或該帳號目前沒有權限切換模型。";
                }

                // 點擊展開選單
                pickerBtn.click();
                await delay(1000); // 等待選單彈出動畫

                // 2. 尋找選單中對應的目標模式 (比對中英文關鍵字)
                const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [role="radio"], li, .menu-item, div'));
                let targetElement = null;

                for (const el of items) {
                    const txt = (el.innerText || "").toLowerCase();
                    // 檢查元素的文字是否包含目標模式的*任何一個*關鍵字
                    if (targetKeywords.some(keyword => txt.includes(keyword.toLowerCase()))) {
                        // 確保它是個合理的可點擊選項層級
                        if (el.getAttribute('role') || el.tagName.toLowerCase() === 'li' || (el.tagName.toLowerCase() === 'div' && el.children.length > 0)) {
                            targetElement = el;
                            break;
                        }
                    }
                }

                if (!targetElement) {
                    // 若找不到，點擊背景關閉選單避免畫面卡死
                    document.body.click(); 
                    return `⚠️ 選單已展開，但找不到對應「${mode}」的選項 (已搜尋關鍵字: ${targetKeywords.join(', ')})。您可能目前無法使用該模型。`;
                }

                // 點擊目標選項
                targetElement.click();
                await delay(800);
                return `✅ 成功為您點擊並切換至 [${mode}] 模式！`;
            }, targetMode.toLowerCase());

            return result;
        } catch (error) {
            return `❌ 視覺腳本執行失敗: ${error.message}`;
        }
    }

    async sendMessage(text, isSystem = false) {
        if (!this.browser) await this.init();
        try { await this.page.bringToFront(); } catch (e) { }
        await this.setupCDP();

        const reqId = Date.now().toString(36).slice(-4);
        const TAG_START = `[[BEGIN:${reqId}]]`;
        const TAG_END = `[[END:${reqId}]]`;

        const payload = `[SYSTEM: CRITICAL PROTOCOL REMINDER FOR THIS TURN]
1. ENVELOPE: Wrap your ENTIRE response between ${TAG_START} and ${TAG_END}.
2. TAGS: Use [GOLEM_MEMORY], [GOLEM_ACTION], and [GOLEM_REPLY]. Do not output raw text outside tags.
3. STRICT JSON: [GOLEM_ACTION] must be perfectly valid JSON. ESCAPE ALL DOUBLE QUOTES (\\") inside string values!
4. ReAct (NO HALLUCINATION): If you use [GOLEM_ACTION], DO NOT guess the command result in [GOLEM_REPLY]. Wait for the upcoming [System Observation] before answering.

[USER INPUT / SYSTEM MESSAGE]
${text}`;

        console.log(`📡 [Brain] 發送訊號: ${reqId} (含每回合強制洗腦引擎)`);

        const tryInteract = async (sel, retryCount = 0) => {
            if (retryCount > 3) throw new Error("🔥 DOM Doctor 修復失敗，請檢查網路或 HTML 結構大幅變更。");

            const cleanSelector = (rawSelector) => {
                if (!rawSelector) return "";
                let cleaned = rawSelector
                    .replace(/```[a-zA-Z]*\s*/gi, '') 
                    .replace(/`/g, '')                 
                    .trim();
                
                if (cleaned.toLowerCase().startsWith('css ')) {
                   cleaned = cleaned.substring(4).trim();
                }
                return cleaned;
            };

            try {
                let baseline = "";
                if (sel.response && sel.response.trim() !== "") {
                     baseline = await this.page.evaluate((s) => {
                        const bubbles = document.querySelectorAll(s);
                        if (bubbles.length === 0) return "";
                        let target = bubbles[bubbles.length - 1];
                        let container = target.closest('model-response') || target.closest('.markdown') || target.closest('.model-response-text') || target.parentElement || target;
                        return container.innerText || "";
                    }, sel.response).catch(() => "");
                } else {
                     console.log("⚠️ Response Selector 為空，等待觸發修復。");
                     throw new Error(`空的 Response Selector`);
                }

                if (!sel.input || sel.input.trim() === "") {
                     throw new Error(`空的 Input Selector`);
                }

                let inputEl = await this.page.$(sel.input);
                if (!inputEl) {
                    console.log("🚑 找不到輸入框，呼叫 DOM Doctor...");
                    const html = await this.page.content();
                    let newSel = await this.doctor.diagnose(html, 'input');
                    if (newSel) {
                        this.selectors.input = cleanSelector(newSel);
                        console.log(`🧼 [Doctor] 清洗後的 Input Selector: ${this.selectors.input}`);
                        this.doctor.saveSelectors(this.selectors);
                        return tryInteract(this.selectors, retryCount + 1);
                    }
                    throw new Error(`無法修復輸入框 Selector`);
                }

                await this.page.evaluate((s, t) => {
                    const el = document.querySelector(s);
                    el.focus();
                    document.execCommand('insertText', false, t);
                }, sel.input, payload);

                await new Promise(r => setTimeout(r, 800));

                if (!sel.send || sel.send.trim() === "") {
                    console.log("⚠️ 發送按鈕的 Selector 為空，直接降級使用 Enter 鍵發送...");
                    await this.page.keyboard.press('Enter');
                } else {
                    let sendEl = await this.page.$(sel.send);
                    if (!sendEl) {
                        console.log("🚑 找不到發送按鈕，呼叫 DOM Doctor...");
                        const html = await this.page.content();
                        let newSel = await this.doctor.diagnose(html, 'send');
                        if (newSel) {
                            this.selectors.send = cleanSelector(newSel);
                            console.log(`🧼 [Doctor] 清洗後的 Send Selector: ${this.selectors.send}`);
                            this.doctor.saveSelectors(this.selectors);
                            return tryInteract(this.selectors, retryCount + 1);
                        }
                        console.log("⚠️ 無法修復按鈕，嘗試使用 Enter 鍵發送...");
                        await this.page.keyboard.press('Enter');
                    } else {
                        try {
                            await this.page.waitForSelector(sel.send, { timeout: 2000 });
                            await this.page.click(sel.send);
                        } catch (e) { 
                            await this.page.keyboard.press('Enter'); 
                        }
                    }
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

                            let currentLastBubble = bubbles[bubbles.length - 1];
                            let container = currentLastBubble.closest('model-response') || 
                                            currentLastBubble.closest('.markdown') || 
                                            currentLastBubble.closest('.model-response-text') || 
                                            currentLastBubble.parentElement || 
                                            currentLastBubble;

                            const rawText = container.innerText || "";
                            const startIndex = rawText.indexOf(startTag);
                            const endIndex = rawText.indexOf(endTag);

                            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                                const content = rawText.substring(startIndex + startTag.length, endIndex).trim();
                                resolve({ status: 'ENVELOPE_COMPLETE', text: content });
                                return;
                            }

                            if (rawText === lastCheckText) {
                                stableCount++;
                            } else {
                                stableCount = 0;
                            }
                            lastCheckText = rawText;

                            if (startIndex !== -1) {
                                if (stableCount > 10) {
                                    const content = rawText.substring(startIndex + startTag.length).trim();
                                    resolve({ status: 'ENVELOPE_TRUNCATED', text: content });
                                    return;
                                }
                            } else if (rawText !== oldText && !rawText.includes('SYSTEM: Please WRAP')) {
                                if (stableCount > 60) {
                                    resolve({ status: 'FALLBACK_DIFF', text: rawText });
                                    return;
                                }
                            }

                            if (Date.now() - startTime > 300000) { 
                                resolve({ status: 'TIMEOUT', text: '' }); 
                                return; 
                            } 
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
                console.warn(`⚠️ [Brain] 互動失敗: ${e.message}`);
                if (retryCount === 0) {
                    console.log('🩺 [Brain] 啟動 DOM Doctor 進行 Response 診斷...');
                    const htmlDump = await this.page.content();
                    let newSelector = await this.doctor.diagnose(htmlDump, 'response');
                    if (newSelector) {
                        this.selectors.response = cleanSelector(newSelector);
                        console.log(`🧼 [Doctor] 清洗後的 Response Selector: ${this.selectors.response}`);
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

module.exports = GolemBrain;
