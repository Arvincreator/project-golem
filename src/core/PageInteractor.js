// ============================================================
// 🎯 PageInteractor - Gemini 頁面 DOM 互動引擎 (抗 UI 改版強化版 v9.0.5)
// ============================================================
const { TIMINGS, LIMITS } = require('./constants');
const ResponseExtractor = require('./ResponseExtractor');

class PageInteractor {
    /**
     * @param {import('puppeteer').Page} page - Puppeteer 頁面實例
     * @param {import('../services/DOMDoctor')} doctor - DOM 修復服務
     * @param {Object} [options] - Optional config
     */
    constructor(page, doctor, options = {}) {
        this.page = page;
        this.doctor = doctor;
        // Phase 2B: Optional PageStateTracker integration
        this.pageStateTracker = options.pageStateTracker || null;
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
     * 主互動流程：輸入文字 → 點擊發送 → 等待回應 → 🌟自動點擊按鈕 (智慧判斷)
     */
    async interact(payload, selectors, isSystem, startTag, endTag, retryCount = 0) {
        if (retryCount > LIMITS.MAX_INTERACT_RETRY) {
            throw new Error("🔥 DOM Doctor 修復失敗，請檢查網路或 HTML 結構大幅變更。");
        }

        try {
            // Phase 2B: Capture pre-interaction page state
            if (this.pageStateTracker) {
                await this.pageStateTracker.capture(this.page).catch(e => console.warn('[PageInteractor] pre-capture failed:', e.message));
            }

            // 0. 確保頁面處於空閒狀態 (避免前一則訊息還在發送中)
            await this._waitForReady(selectors.send);

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

            // 💡 效能優化：判斷這回合有沒有使用 /@ 擴充功能指令
            const hasExtensionCommand = /\/@(Gmail|Google Calendar|Google Keep|Google Tasks|Google 文件|Google 雲端硬碟|Workspace|YouTube Music|YouTube|Google Maps|Google 航班|Google 飯店|Spotify|Google Home|SynthID)/i.test(payload);

            if (hasExtensionCommand) {
                // 只有呼叫了擴充功能，才需要花 1.5 秒去巡邏有沒有儲存按鈕
                await this._autoClickWorkspaceButtons();
            } else {
                console.log("⏩ [PageInteractor] 此次對話無擴充功能，跳過幽靈掃描，極速返回！");
            }

            // Phase 2B: Capture post-interaction page state + detect unexpected changes
            if (this.pageStateTracker) {
                await this.pageStateTracker.capture(this.page).catch(e => console.warn('[PageInteractor] post-capture failed:', e.message));
                const diff = this.pageStateTracker.getLatestDiff();
                if (diff && diff.hasChanges) {
                    const unexpected = diff.changes.filter(c => c.type === 'modal_change' || c.type === 'navigation');
                    if (unexpected.length > 0) {
                        console.warn(`[PageInteractor] Unexpected page changes detected: ${unexpected.map(u => u.type).join(', ')}`);
                    }
                }
            }

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

        if (!targetSelector || targetSelector.trim() === "") {
            targetSelector = fallbackSelectors.join(', ');
        }

        let inputEl = await this.page.$(targetSelector);

        if (!inputEl) {
            targetSelector = fallbackSelectors.join(', ');
            inputEl = await this.page.$(targetSelector);
        }

        if (!inputEl) {
            // Phase 2B: Try PageStateTracker element finder before DOM Doctor
            if (this.pageStateTracker) {
                const found = this.pageStateTracker.findElement('input');
                if (found && found.id) {
                    inputEl = await this.page.$(`#${found.id}`);
                    if (inputEl) {
                        console.log(`[PageInteractor] Found input via PageStateTracker: #${found.id}`);
                    }
                }
            }
        }

        if (!inputEl) {
            console.log("🚑 連通用特徵都找不到輸入框，呼叫 DOM Doctor...");
            const html = await this.page.content();
            const newSel = await this.doctor.diagnose(html, 'input');
            if (newSel) {
                const cleaned = PageInteractor.cleanSelector(newSel);
                throw new Error(`SELECTOR_HEALED:input:${cleaned}`);
            }
            throw new Error("無法修復輸入框 Selector");
        }

        const extRegex = /\/@(Gmail|Google Calendar|Google Keep|Google Tasks|Google 文件|Google 雲端硬碟|Workspace|YouTube Music|YouTube|Google Maps|Google 航班|Google 飯店|Spotify|Google Home|SynthID)/i;
        const extMatch = text.match(extRegex);

        let textToPaste = text;

        if (extMatch) {
            const originalSlashCommand = extMatch[0];
            const extensionName = extMatch[1];
            const summonWord = '@' + extensionName;

            console.log(`🪄 [PageInteractor] 偵測到明確指令 [${originalSlashCommand}]，轉換為 [${summonWord}] 啟動召喚儀式...`);

            textToPaste = text.replace(originalSlashCommand, '').trim();

            await inputEl.focus();

            await this.page.keyboard.type(summonWord, { delay: 100 });
            await new Promise(r => setTimeout(r, 1500));
            await this.page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 500));

            console.log(`✅ [PageInteractor] [${summonWord}] 標籤召喚完成！準備貼上主指令...`);
        }

        const payloadLength = textToPaste.length;
        console.log(`📝 [PageInteractor] 準備植入文字 (長度: ${payloadLength})...`);

        await this.page.evaluate((s, t) => {
            const el = document.querySelector(s);
            if (!el) return;
            el.focus();

            // ✨ [進化版清空與植入] 確保完整性並觸發應用程式監聽
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = t;
            } else {
                // 針對 contenteditable 使用更強大的模擬植入
                el.innerText = t;
            }

            // ⚡ 強制觸發事件，讓 React/Angular/ProseMirror 知道內容變了
            const events = ['input', 'change', 'keyup'];
            events.forEach(name => {
                el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
            });

            // 嘗試使用 execCommand 作為補充 (有些編輯器只認這個)
            if (el.innerText !== t && el.value !== t) {
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, t);
            }
        }, targetSelector, textToPaste);
    }

    async _clickSend(sendSelector) {
        console.log("🚀 [PageInteractor] 發送訊號中 (Enter 爆破 + 實體按鈕補送)...");

        // 1. Enter 爆破
        await this.page.keyboard.press('Enter');

        // 2. 實體按鈕補強 (有些 UI 只有點擊按鈕才能觸發正確的 state)
        await this.page.evaluate((s) => {
            const btn = document.querySelector(s) ||
                document.querySelector('button[aria-label*="發送"], button[aria-label*="Send"], button[disabled="false"]');
            if (btn && btn.offsetHeight > 0) btn.click();
        }, sendSelector);

        await new Promise(r => setTimeout(r, 200));
    }

    /**
     * 🌟 幽靈按鈕點擊術：加裝防禦機制的升級版
     */
    async _autoClickWorkspaceButtons() {
        try {
            console.log("🕵️ [PageInteractor] 啟動幽靈掃描，尋找是否需要點擊【儲存/建立】按鈕...");

            await new Promise(r => setTimeout(r, 1500));

            const clickedButtonText = await this.page.evaluate(() => {
                const targetKeywords = ['儲存活動', '儲存', '建立', '建立活動', 'Save event', 'Save', 'Create'];
                const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.btn'));

                for (let i = buttons.length - 1; i >= 0; i--) {
                    const btn = buttons[i];

                    // 🛡️ 防禦 1：禁止觸摸側邊欄 (避開歷史紀錄)
                    if (btn.closest('nav') || btn.closest('aside') || btn.closest('sidenav')) {
                        continue;
                    }

                    const text = (btn.innerText || btn.textContent || "").trim();

                    // 🛡️ 防禦 2：長度限制 (按鈕文字通常很短，超過 15 字必定是標題)
                    if (text.length > 15 || text.length === 0) {
                        continue;
                    }

                    if (targetKeywords.some(kw => text === kw || text.includes(kw))) {
                        btn.click();
                        return text;
                    }
                }
                return null;
            });

            if (clickedButtonText) {
                console.log(`🎯 [PageInteractor] 幽靈突刺成功！已自動幫忙點擊：【${clickedButtonText}】`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.log("👻 [PageInteractor] 掃描完畢，沒有發現需要自動點擊的卡片按鈕。");
            }

        } catch (e) {
            console.warn(`⚠️ [PageInteractor] 幽靈掃描發生異常: ${e.message}`);
        }
    }

    /**
     * 🛡️ 頁面空閒檢查術：確保沒有正在生成的訊息或遮罩
     */
    async _waitForReady(sendSelector) {
        // Phase 2B: Use PageStateTracker.isReady() as primary check
        if (this.pageStateTracker) {
            await this.pageStateTracker.capture(this.page).catch(e => console.warn('[PageInteractor] ready-check capture failed:', e.message));
            if (this.pageStateTracker.isReady()) {
                console.log("✅ [PageInteractor] PageStateTracker confirms page ready.");
                return;
            }
        }

        console.log("🔍 [PageInteractor] 正在檢查頁面空閒狀態...");
        const maxWait = 15000; // 最多等 15 秒
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            const isBusy = await this.page.evaluate(() => {
                // 尋找「停止」按鈕或特定的正在處理標記
                const stopButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
                    .filter(b => {
                        const txt = (b.innerText || b.textContent || "").trim();
                        return ['停止', 'Stop', '中斷'].includes(txt);
                    });

                // 如果有停止按鈕，代表還在跑
                if (stopButtons.length > 0 && stopButtons.some(b => b.offsetHeight > 0)) {
                    return true;
                }

                // 檢查是否正在進行流式輸出 (可能會有一個正在閃爍的游標或類別)
                const isStreaming = document.querySelector('.generating, .is-generating, [aria-busy="true"]');
                if (isStreaming) return true;

                return false;
            });

            if (!isBusy) {
                console.log("✅ [PageInteractor] 頁面已空閒，準備發送。");
                return;
            }

            await new Promise(r => setTimeout(r, 1000));
        }
        console.warn("⚠️ [PageInteractor] 頁面忙碌檢查超時，將嘗試直接發送。");
    }

    async _healSelector(type, selectors) {
        try {
            const htmlDump = await this.page.content();
            const newSelector = await this.doctor.diagnose(htmlDump, type);
            if (newSelector) {
                selectors[type] = PageInteractor.cleanSelector(newSelector);
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
