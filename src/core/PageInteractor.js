// ============================================================
// 🎯 PageInteractor - Gemini 頁面 DOM 互動引擎 (抗 UI 改版強化版 v9.0.5)
// ============================================================
const { TIMINGS, LIMITS } = require('./constants');
const ResponseExtractor = require('./ResponseExtractor');

class PageInteractor {
    /**
     * @param {import('puppeteer').Page} page - Puppeteer 頁面實例
     * @param {import('../services/DOMDoctor')} doctor - DOM 修復服務
     */
    constructor(page, doctor) {
        this.page = page;
        this.doctor = doctor;
    }

    /**
     * 清洗 DOMDoctor 回傳的 Selector 字串
     * @param {string} rawSelector
     * @returns {string}
     */
    static cleanSelector(rawSelector) {
        if (!rawSelector) return "";
        let cleaned = rawSelector
            .replace(/```[a-zA-Z]*\s*/gi, '')
            .replace(/`/g, '')
            .trim();

        if (cleaned.toLowerCase().startsWith('css ')) {
            cleaned = cleaned.substring(4).trim();
        }
        return cleaned;
    }

    /**
     * 主互動流程：輸入文字 → 點擊發送 → 等待回應
     */
    async interact(payload, selectors, isSystem, startTag, endTag, retryCount = 0) {
        if (retryCount > LIMITS.MAX_INTERACT_RETRY) {
            throw new Error("🔥 DOM Doctor 修復失敗，請檢查網路或 HTML 結構大幅變更。");
        }

        try {
            // 1. 捕獲基準文字
            const baseline = await this._captureBaseline(selectors.response);

            // 2. 輸入文字 (使用無敵定位法 + 斜線指令標籤召喚術)
            await this._typeInput(selectors.input, payload);

            // 3. 等待輸入穩定
            await new Promise(r => setTimeout(r, TIMINGS.INPUT_DELAY));

            // 4. 發送訊息 (使用物理 Enter 爆破法)
            await this._clickSend(selectors.send);

            // 5. 若為系統訊息，延遲後直接返回
            if (isSystem) {
                await new Promise(r => setTimeout(r, TIMINGS.SYSTEM_DELAY));
                return "";
            }

            // 6. 等待信封回應
            console.log(`⚡ [Brain] 等待信封完整性 (${startTag} ... ${endTag})...`);
            const finalResponse = await ResponseExtractor.waitForResponse(
                this.page, selectors.response, startTag, endTag, baseline
            );

            if (finalResponse.status === 'TIMEOUT') throw new Error("等待回應超時");

            console.log(`🏁 [Brain] 捕獲: ${finalResponse.status} | 長度: ${finalResponse.text.length}`);
            return ResponseExtractor.cleanResponse(finalResponse.text, startTag, endTag);

        } catch (e) {
            console.warn(`⚠️ [Brain] 互動失敗: ${e.message}`);

            if (retryCount === 0) {
                console.log('🩺 [Brain] 啟動 DOM Doctor 進行 Response 診斷...');
                const healed = await this._healSelector('response', selectors);
                if (healed) {
                    return this.interact(payload, selectors, isSystem, startTag, endTag, retryCount + 1);
                }
            }
            throw e;
        }
    }

    // ─── Private Methods ─────────────────────────────────────

    async _captureBaseline(responseSelector) {
        if (!responseSelector || responseSelector.trim() === "") {
            console.log("⚠️ Response Selector 為空，等待觸發修復。");
            throw new Error("空的 Response Selector");
        }

        return this.page.evaluate((s) => {
            const bubbles = document.querySelectorAll(s);
            if (bubbles.length === 0) return "";
            let target = bubbles[bubbles.length - 1];
            let container = target.closest('model-response') ||
                target.closest('.markdown') ||
                target.closest('.model-response-text') ||
                target.parentElement || target;
            return container.innerText || "";
        }, responseSelector).catch(() => "");
    }

    /**
     * 在輸入框中填入文字 (無敵屬性定位法 + 斜線標籤召喚)
     */
    async _typeInput(inputSelector, text) {
        // 🚀 定義網頁原生文字編輯器的通用特徵 (無視 class 改變)
        const fallbackSelectors = [
            '.ProseMirror',
            'rich-textarea',
            'div[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"]',
            'textarea'
        ];
        
        let targetSelector = inputSelector;

        // 若原本的 selector 空了，直接切換到無敵陣列
        if (!targetSelector || targetSelector.trim() === "") {
            console.log("⚠️ 原 Input Selector 為空，啟動無敵屬性定位法...");
            targetSelector = fallbackSelectors.join(', ');
        }

        let inputEl = await this.page.$(targetSelector);

        // 若原本的 selector 失效，切換到無敵陣列
        if (!inputEl) {
            console.log("⚠️ 原輸入框定位失效，改用通用富文本特徵定位...");
            targetSelector = fallbackSelectors.join(', ');
            inputEl = await this.page.$(targetSelector);
        }

        if (!inputEl) {
            console.log("🚑 連通用特徵都找不到輸入框，呼叫 DOM Doctor...");
            const html = await this.page.content();
            const newSel = await this.doctor.diagnose(html, 'input');
            if (newSel) {
                const cleaned = PageInteractor.cleanSelector(newSel);
                console.log(`🧼 [Doctor] 清洗後的 Input Selector: ${cleaned}`);
                throw new Error(`SELECTOR_HEALED:input:${cleaned}`);
            }
            throw new Error("無法修復輸入框 Selector");
        }

        // 🪄 擴充功能召喚儀式 (斜線指令明確觸發版: /@擴充功能)
        // 嚴格配對以 /@ 開頭的擴充功能字眼
        const extRegex = /\/@(Gmail|Google Calendar|Google Keep|Google Tasks|Google 文件|Google 雲端硬碟|Workspace|YouTube Music|YouTube|Google Maps|Google 航班|Google 飯店|Spotify|Google Home|SynthID)/i;
        const extMatch = text.match(extRegex);

        let textToPaste = text;

        if (extMatch) {
            const originalSlashCommand = extMatch[0]; // 例如: "/@Gmail" 或 "/@Google 雲端硬碟"
            const extensionName = extMatch[1];        // 例如: "Gmail"
            const summonWord = '@' + extensionName;   // 轉換為網頁需要的實際召喚詞: "@Gmail"
            
            console.log(`🪄 [PageInteractor] 偵測到明確指令 [${originalSlashCommand}]，轉換為 [${summonWord}] 啟動召喚儀式...`);
            
            // 從主指令中移除 "/@Gmail"，避免等等重複貼上
            textToPaste = text.replace(originalSlashCommand, '').trim();

            // 確保焦點
            await inputEl.focus();

            // 慢慢打出真正的召喚詞 (@Gmail)，讓 Google 前端有時間跳出選單
            await this.page.keyboard.type(summonWord, { delay: 100 });
            
            // 等待下拉選單動畫浮現
            await new Promise(r => setTimeout(r, 1500));
            
            // 按下 Enter 鍵，強制選取下拉選單的第一個項目 (鎖定標籤)
            await this.page.keyboard.press('Enter');
            
            // 稍作停頓，讓 DOM 更新標籤為藍色氣泡
            await new Promise(r => setTimeout(r, 500));
            
            console.log(`✅ [PageInteractor] [${summonWord}] 標籤召喚完成！準備貼上主指令...`);
        }

        // 執行輸入 (極速貼上剩餘指令)
        await this.page.evaluate((s, t) => {
            const el = document.querySelector(s);
            el.focus();
            // 補一個空白將標籤與後續文字隔開 (如果有文字的話)
            document.execCommand('insertText', false, (t ? ' ' + t : ''));
        }, targetSelector, textToPaste);
    }

    /**
     * 發送按鈕 (物理 Enter 爆破法)
     */
    async _clickSend(sendSelector) {
        console.log("🚀 [PageInteractor] 啟動物理 Enter 爆破法，無視所有發送按鈕變更！");
        // 確保焦點在輸入框內後，直接敲擊實體 Enter 鍵
        await this.page.keyboard.press('Enter');
        
        // 稍微等待 0.2 秒讓前端 React/Angular 框架反應過來
        await new Promise(r => setTimeout(r, 200));
    }

    async _healSelector(type, selectors) {
        try {
            const htmlDump = await this.page.content();
            const newSelector = await this.doctor.diagnose(htmlDump, type);
            if (newSelector) {
                selectors[type] = PageInteractor.cleanSelector(newSelector);
                console.log(`🧼 [Doctor] 清洗後的 ${type} Selector: ${selectors[type]}`);
                this.doctor.saveSelectors(selectors);
                return true;
            }
        } catch (e) {
            console.warn(`⚠️ [Doctor] ${type} 修復失敗: ${e.message}`);
        }
        return false;
    }
}

module.exports = PageInteractor;
