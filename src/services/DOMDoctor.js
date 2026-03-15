const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const KeyChain = require('./KeyChain');

// ============================================================
// 🚑 DOM Doctor (已修復 AI 廢話導致崩潰問題)
// ============================================================
class DOMDoctor {
    constructor() {
        this.keyChain = new KeyChain();
        this.cacheFile = path.join(process.cwd(), 'golem_selectors.json');
        this.defaults = {
            input: 'div[contenteditable="true"], rich-textarea > div, p[data-placeholder]',
            send: 'button[aria-label*="Send"], button[aria-label*="傳送"], span[data-icon="send"]',
            response: '.model-response-text, .message-content, .markdown, div[data-test-id="message-content"]'
        };
        // ✨ [v9.0.8] 診斷結果快取 (5 分鐘 TTL)
        this._cache = new Map();
        this._cacheTTL = 5 * 60 * 1000;
    }
    loadSelectors() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
                return { ...this.defaults, ...cached };
            }
        } catch (e) { console.warn('[DOMDoctor]', e.message); }
        return { ...this.defaults };
    }
    saveSelectors(newSelectors) {
        try {
            const current = this.loadSelectors();
            const updated = { ...current, ...newSelectors };
            fs.writeFileSync(this.cacheFile, JSON.stringify(updated, null, 2));
            console.log("💾 [Doctor] Selector 已更新並存檔！");
        } catch (e) { console.warn('[DOMDoctor]', e.message); }
    }
    async diagnose(htmlSnippet, targetType) {
        if (this.keyChain.keys.length === 0) return null;

        // ✨ [v9.0.8] 快取檢查
        const cacheKey = `${targetType}:${htmlSnippet.length}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.time < this._cacheTTL) {
            console.log(`📋 [Doctor] 使用快取結果 (${targetType})`);
            return cached.selector;
        }

        const hints = {
            'input': '目標是輸入框。⚠️ 注意：請忽略內層的 <p>, <span> 或 text node。請往上尋找最近的一個「容器 div」，它通常具備 contenteditable="true"、role="textbox" 或 class="ql-editor" 屬性。',
            'send': '目標是發送按鈕。⚠️ 注意：請找出外層的 <button> 或具備互動功能的 <mat-icon>，不要只選取裡面的 <svg> 或 <path>。特徵：aria-label="Send" 或 data-mat-icon-name="send"。',
            'response': '找尋 AI 回覆的文字氣泡。'
        };
        const targetDescription = hints[targetType] || targetType;
        console.log(`🚑 [Doctor] 啟動深層診斷: 目標 [${targetType}]...`);

        let safeHtml = htmlSnippet;
        if (htmlSnippet.length > 60000) {
            const head = htmlSnippet.substring(0, 5000);
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
            let apiKey = null;
            try {
                apiKey = await this.keyChain.getKey();
                if (!apiKey) {
                    console.warn("⚠️ [Doctor] 無可用 API Key，跳過診斷。");
                    return null;
                }
                const genAI = new GoogleGenerativeAI(apiKey);
                // ✨ [v9.0.8] 改用 gemini-2.0-flash（配額更高，lite 配額極低容易 429）
                const model = genAI.getGenerativeModel({ model: process.env.GEMINI_DOM_MODEL || "gemini-2.0-flash" });
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
                    // ✨ [v9.0.8] 快取結果
                    this._cache.set(cacheKey, { selector, time: Date.now() });
                    return selector;
                } else {
                    console.warn(`⚠️ [Doctor] AI 提供的 Selector 無效或包含雜訊: ${selector}`);
                }
            } catch (e) {
                console.error(`❌ [Doctor] 診斷 API 錯誤: ${e.message}`);
                // ✨ [v9.0.8] 標記耗盡的 key，避免重複使用
                if (apiKey) this.keyChain.recordError(apiKey, e);
                attempts++;
                // ✨ [v9.0.8] 指數退避：2s, 4s, 8s...
                if (attempts < this.keyChain.keys.length) {
                    const backoff = Math.min(2000 * Math.pow(2, attempts - 1), 16000);
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
        }
        return null;
    }
}

module.exports = DOMDoctor;
