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

            // Check if we should connect to Remote Chrome (Docker only)
            const isDocker = fs.existsSync('/.dockerenv');
            const remoteDebugPort = process.env.PUPPETEER_REMOTE_DEBUGGING_PORT;
            if (isDocker && remoteDebugPort) {
                const host = 'host.docker.internal';
                const browserURL = `http://${host}:${remoteDebugPort}`;
                console.log(`🔌 [System] Connecting to Remote Chrome at ${browserURL}...`);
                try {
                    // Chrome 111+ rejects HTTP requests with non-localhost Host header.
                    // We manually fetch /json/version with Host:localhost to bypass this,
                    // then connect directly via the WebSocket endpoint.
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
                                        // Rebuild wsURL with correct host:port for Docker connectivity.
                                        // Chrome may return ws://localhost/devtools/... (no port),
                                        // so we use URL constructor to ensure port is included.
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
                    console.error(`   Make sure you ran './scripts/start-host-chrome.sh' on the host and 'host.docker.internal' is reachable.`);
                    throw e;
                }
            } else {
                // 🧹 [Docker Fix] Advanced Lock Cleanup
                const cleanLocks = () => {
                    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
                    let cleaned = 0;
                    lockFiles.forEach(file => {
                        const p = path.join(userDataDir, file);
                        try {
                            // Use lstatSync instead of existsSync because existsSync returns false for broken symlinks
                            // lstatSync throws ENOENT if file doesn't exist, which is what we want to catch
                            fs.lstatSync(p);

                            // If we are here, something exists (file, dir, or broken symlink). Kill it.
                            fs.rmSync(p, { force: true, recursive: true });
                            console.log(`🔓 [System] Removed Stale Lock: ${file}`);
                            cleaned++;
                        } catch (e) {
                            // Ignore ENOENT (file not found), warn on other errors
                            if (e.code !== 'ENOENT') {
                                console.warn(`⚠️ [System] Failed to remove ${file}: ${e.message}`);
                            }
                        }
                    });
                    return cleaned;
                };

                // Initial cleanup
                cleanLocks();

                const launchBrowser = async (retries = 3) => {
                    try {
                        return await puppeteer.launch({
                            headless: process.env.PUPPETEER_HEADLESS === 'true' ? true : (process.env.PUPPETEER_HEADLESS === 'new' ? 'new' : false),
                            userDataDir: userDataDir,
                            args: [
                                '--no-sandbox',
                                '--disable-dev-shm-usage', // Critical for Docker
                                '--disable-setuid-sandbox',
                                '--window-size=1280,900',
                                '--disable-gpu' // Often helps in containerized environments
                            ]
                        });
                    } catch (err) {
                        if (retries > 0 && err.message.includes('profile appears to be in use')) {
                            console.warn(`⚠️ [System] Profile locked. Retrying launch (${retries} left)...`);
                            cleanLocks(); // Force clean again
                            await new Promise(r => setTimeout(r, 1000)); // Wait a bit
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

        // Link Dashboard Context if active
        if (process.argv.includes('dashboard')) {
            try {
                const dashboard = require('../../dashboard'); // Path might need check
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

            // ✨ [v9.0 Injection] 注入動態技能列表
            try {
                const activeSkills = skillManager.listSkills();
                if (activeSkills.length > 0) {
                    systemPrompt += `\n\n### 🛠️ DYNAMIC SKILLS AVAILABLE (Output {"action": "skill_name", ...}):\n`;
                    activeSkills.forEach(s => {
                        systemPrompt += `- Action: "${s.name}" | Desc: ${s.description}\n`;
                    });
                    systemPrompt += `(Use these skills via [GOLEM_ACTION] when requested by user.)\n`;
                }
            } catch (e) { console.warn("Skills injection failed:", e); }

            const superProtocol = `
\n\n【⚠️ GOLEM PROTOCOL v9.0 - TITAN CHRONOS + MULTIAGENT + SKILLS】
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
- If user asks for multi-agent collaboration, use: {"action": "multi_agent", "preset": "TECH_TEAM", "task": "..."}
- If user asks for a dynamic skill, use: {"action": "SKILL_NAME", "args": {...}}
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

    // ✨ [Neuro-Link] 三明治信封版 (Sandwich Protocol)
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

                await this.page.evaluate((s, t) => {
                    const el = document.querySelector(s);
                    el.focus();
                    document.execCommand('insertText', false, t);
                }, sel.input, payload);

                await new Promise(r => setTimeout(r, 800));

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
                                if (stableCount > 5) { // 等待時間
                                    const content = rawText.substring(startIndex + startTag.length).trim();
                                    resolve({ status: 'ENVELOPE_TRUNCATED', text: content });
                                    return;
                                }
                            } else if (rawText !== oldText && !rawText.includes('SYSTEM: Please WRAP')) {
                                if (rawText === lastCheckText && rawText.length > 5) stableCount++;
                                else stableCount = 0;
                                lastCheckText = rawText;
                                if (stableCount > 5) { resolve({ status: 'FALLBACK_DIFF', text: rawText }); return; }
                            }

                            if (Date.now() - startTime > 120000) { resolve({ status: 'TIMEOUT', text: '' }); return; } // Web Skill 生成可能需要較長時間
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

module.exports = GolemBrain;
