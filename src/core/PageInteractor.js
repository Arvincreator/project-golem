// ============================================================
// 🎯 PageInteractor - Gemini 頁面 DOM 互動引擎
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
     *
     * @param {string} payload - 要發送的完整 payload
     * @param {Object} selectors - CSS Selector 集合 { input, send, response }
     * @param {boolean} isSystem - 是否為系統訊息 (不等待回應)
     * @param {string} startTag - 信封開始標籤
     * @param {string} endTag - 信封結束標籤
     * @param {number} [retryCount=0] - 當前重試次數
     * @returns {Promise<string>} AI 回應文字
     */
    async interact(payload, selectors, isSystem, startTag, endTag, retryCount = 0) {
        if (retryCount > LIMITS.MAX_INTERACT_RETRY) {
            throw new Error("🔥 DOM Doctor 修復失敗，請檢查網路或 HTML 結構大幅變更。");
        }

        try {
            // 1. 捕獲基準文字
            const baseline = await this._captureBaseline(selectors.response);

            // 2. 輸入文字
            await this._typeInput(selectors.input, payload);

            // 3. 等待輸入穩定
            await new Promise(r => setTimeout(r, TIMINGS.INPUT_DELAY));

            // 4. 發送訊息
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

    /**
     * 捕獲發送前最後一個回應氣泡的文字 (作為基準)
     * @param {string} responseSelector
     * @returns {Promise<string>}
     */
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
     * 在輸入框中填入文字
     * @param {string} inputSelector
     * @param {string} text
     */
    async _typeInput(inputSelector, text) {
        if (!inputSelector || inputSelector.trim() === "") {
            throw new Error("空的 Input Selector");
        }

        let inputEl = await this.page.$(inputSelector);
        if (!inputEl) {
            console.log("🚑 找不到輸入框，呼叫 DOM Doctor...");
            const html = await this.page.content();
            const newSel = await this.doctor.diagnose(html, 'input');
            if (newSel) {
                const cleaned = PageInteractor.cleanSelector(newSel);
                console.log(`🧼 [Doctor] 清洗後的 Input Selector: ${cleaned}`);
                throw new Error(`SELECTOR_HEALED:input:${cleaned}`);
            }
            throw new Error("無法修復輸入框 Selector");
        }

        await this.page.evaluate((s, t) => {
            const el = document.querySelector(s);
            el.focus();
            document.execCommand('insertText', false, t);
        }, inputSelector, text);
    }

    /**
     * 點擊發送按鈕 (含降級為 Enter 鍵策略)
     * @param {string} sendSelector
     */
    async _clickSend(sendSelector) {
        if (!sendSelector || sendSelector.trim() === "") {
            console.log("⚠️ 發送按鈕的 Selector 為空，直接降級使用 Enter 鍵發送...");
            await this.page.keyboard.press('Enter');
            return;
        }

        let sendEl = await this.page.$(sendSelector);
        if (!sendEl) {
            console.log("🚑 找不到發送按鈕，呼叫 DOM Doctor...");
            const html = await this.page.content();
            const newSel = await this.doctor.diagnose(html, 'send');
            if (newSel) {
                const cleaned = PageInteractor.cleanSelector(newSel);
                console.log(`🧼 [Doctor] 清洗後的 Send Selector: ${cleaned}`);
                throw new Error(`SELECTOR_HEALED:send:${cleaned}`);
            }
            console.log("⚠️ 無法修復按鈕，嘗試使用 Enter 鍵發送...");
            await this.page.keyboard.press('Enter');
            return;
        }

        try {
            await this.page.waitForSelector(sendSelector, { timeout: TIMINGS.SYSTEM_DELAY });
            await this.page.click(sendSelector);
        } catch (e) {
            await this.page.keyboard.press('Enter');
        }
    }

    /**
     * 嘗試使用 DOM Doctor 修復指定類型的 Selector
     * @param {string} type - Selector 類型 ('input' | 'send' | 'response')
     * @param {Object} selectors - 可變的 selectors 物件
     * @returns {Promise<boolean>} 是否成功修復
     */
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
