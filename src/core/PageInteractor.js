// ============================================================
// 🎯 PageInteractor - Gemini 頁面 DOM 互動引擎 (抗 UI 改版強化版 v9.1.5)
// ============================================================
const { TIMINGS, LIMITS } = require('./constants');
const { ResponseExtractor } = require('../../packages/protocol');

// 共用的按鈕偵測關鍵字 (供 autoClick 快速點擊使用)
const WORKSPACE_SAVE_KEYWORDS = ['儲存活動', '儲存', '建立', '建立活動', 'Save event', 'Save', 'Create'];

class PageInteractor {
    /**
     * @param {import('playwright').Page} page - Playwright 頁面實例
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
     * 主互動流程：輸入文字 → 點擊發送 → 等待回應 → 🌟自動點擊按鈕 (智慧判斷)
     */
    async interact(payload, selectors, isSystem, startTag, endTag, retryCount = 0, attachment = null) {
        if (retryCount > LIMITS.MAX_INTERACT_RETRY) {
            throw new Error("🔥 DOM Doctor 修復失敗，請檢查網路或 HTML 結構大幅變更。");
        }

        try {
            // 🚀 利用 macOS AppleScript 將 Chrome 隱藏至背景，避免接下來的 focus() 搶走終端機焦點
            if (process.platform === 'darwin') {
                const { exec } = require('child_process');
                exec(`osascript -e 'tell application "System Events" to set visible of process "Google Chrome for Testing" to false' >/dev/null 2>&1`);
                exec(`osascript -e 'tell application "System Events" to set visible of process "Google Chrome" to false' >/dev/null 2>&1`);
            }

            // 0. 確保頁面處於空閒狀態 (避免前一則訊息還在發送中)
            await this._waitForReady(selectors.send);

            // 1. 捕獲基準文字
            const baseline = await this._captureBaseline(selectors.response);

            // 1.5 處理附件貼入 (如果有的話) - 模擬人類 Ctrl+V / Cmd+V
            if (attachment && attachment.path) {
                await this._attachFile(selectors.input, attachment.path, attachment.mimeType);
            }

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

            console.log(`🏁 [Brain] 捕獲: ${finalResponse.status} | 長度: ${finalResponse.text.length} | 附件: ${finalResponse.attachments?.length || 0}`);
            
            // 🧹 [Memory Optimization] 實體修剪老舊 DOM 節點
            await this._pruneDOM();

            return {
                text: ResponseExtractor.cleanResponse(finalResponse.text, startTag, endTag),
                attachments: finalResponse.attachments || [],
                status: finalResponse.status
            };

        } catch (e) {
            console.warn(`⚠️ [Brain] 互動失敗: ${e.message}`);

            if (retryCount === 0) {
                console.log('🩺 [Brain] 啟動 DOM Doctor 進行 Response 診斷...');
                const healed = await this._healSelector('response', selectors);
                if (healed) {
                    return this.interact(payload, selectors, isSystem, startTag, endTag, retryCount + 1, attachment);
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

        // 🚀 [Playwright] 增加 waitForSelector 確保頁面渲染完成
        try {
            await this.page.waitForSelector(targetSelector, { state: 'attached', timeout: 5000 });
        } catch (e) {
            // 如果超時，嘗試使用通用特徵再次等待
            if (targetSelector !== fallbackSelectors.join(', ')) {
                try {
                    targetSelector = fallbackSelectors.join(', ');
                    await this.page.waitForSelector(targetSelector, { state: 'attached', timeout: 3000 });
                } catch (e2) { }
            }
        }

        let inputEl = await this.page.$(targetSelector);

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

        // 1. 先使用 page.focus 確保焦點在輸入框上
        try {
            if (typeof this.page.focus === 'function') {
                await this.page.focus(targetSelector);
            }
            await inputEl.scrollIntoViewIfNeeded(); // [Playwright 強化] 確保在可視區域
            await inputEl.click({ delay: 50 });    // [強化] 點擊一下以確保真實 Focus
            await inputEl.focus();
            await new Promise(r => setTimeout(r, 300)); // 給予瀏覽器反應時間
            
            // 🧹 清除可能殘留的舊內容
            const isMac = process.platform === 'darwin';
            await this.page.keyboard.down(isMac ? 'Meta' : 'Control');
            await this.page.keyboard.press('a');
            await this.page.keyboard.up(isMac ? 'Meta' : 'Control');
            await this.page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            console.warn(`⚠️ [PageInteractor] focus 失敗: ${e.message}`);
        }

        // 2. 模擬真實鍵盤輸入 (對於 ProseMirror 這種複雜編輯器，這比單純塞 value 更好)
        // 為了效能與穩定平衡，我們先用 evaluate 注入大塊內容，再模擬鍵盤觸發事件
        await this.page.evaluate(({ s, t }) => {
            const el = document.querySelector(s);
            if (!el) return;

            // 針對 contenteditable 使用更強大的模擬植入
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = t;
            } else {
                el.innerText = t;
            }

            // ⚡ 強制觸發事件，讓 React/Angular/ProseMirror 知道內容變了
            const events = ['input', 'change', 'keyup'];
            events.forEach(name => {
                const event = new Event(name, { bubbles: true, cancelable: true });
                el.dispatchEvent(event);
            });

            // 確保游標在最後
            try {
                if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(el);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } catch (e) { }
        }, { s: targetSelector, t: textToPaste });

        // 3. 額外觸發一個小的鍵盤事件，確保某些框架監聽的 focus/input 狀態被啟動
        await this.page.keyboard.type(' ', { delay: 1 });
        await this.page.keyboard.press('Backspace');
    }

    async _clickSend(sendSelector) {
        // 1. Enter 爆破 (確保焦點在輸入框，而非按鈕)
        try {
            const fallbackSelectors = [
                '.ProseMirror',
                'rich-textarea',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
                'textarea'
            ];
            const inputEl = await this.page.$(fallbackSelectors.join(', '));
            if (inputEl) {
                await inputEl.focus();
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (e) { }

        // 防止 Enter 太快，給予輸入框更新時間
        await new Promise(r => setTimeout(r, 500));
        await this.page.keyboard.press('Enter');

        // 2. 實體按鈕補強 (優先使用 ARIA Label 狙擊)
        await this.page.evaluate((s) => {
            const btn = document.querySelector('button[aria-label*="發送"], button[aria-label*="Send"], button[aria-label*="傳送"]') ||
                document.querySelector(s);
            
            if (btn) {
                // [強化] 檢查是否真的可見
                const style = window.getComputedStyle(btn);
                const isVisible = btn.offsetHeight > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                
                // 🛡️ 防禦：避免點到「停止」按鈕 (如果是忙碌中，直接退出)
                const txt = (btn.innerText || btn.textContent || "").trim();
                if (['停止', 'Stop', '中斷'].includes(txt)) return;

                if (isVisible) {
                    btn.scrollIntoView({ block: "center" });
                    btn.focus();
                    btn.click();
                }
            }
        }, sendSelector);

        // 3. 自動置底 (最小化干擾)
        await this._moveWindowToBottom();

        await new Promise(r => setTimeout(r, 200));
    }

    /**
     * 🚀 自動將 Chrome 視窗移動到螢幕最底部 (不影響使用者日常操作) - Playwright 版
     */
    async _moveWindowToBottom() {
        // ✨ [Headless 優化] 若為無頭模式，不需要移動視窗
        if (process.env.PLAYWRIGHT_HEADLESS === 'true') return;

        try {
            console.log("⚓ [PageInteractor] 正在將 Chrome 視窗自動移動至隱藏位置...");
            
            // 複用 CDPSession 以提升效能
            if (!this._persistedCdpSession) {
                this._persistedCdpSession = await this.page.context().newCDPSession(this.page);
            }
            const session = this._persistedCdpSession;

            // Playwright 中 getWindowForTarget 標籤可能略有不同，但協議本身一致
            const { windowId } = await session.send('Browser.getWindowForTarget');

            const screen = await this.page.evaluate(() => ({
                width: window.screen.availWidth,
                height: window.screen.availHeight
            }));

            // 將視窗移動到螢幕垂直座標之外 (隱身術)
            await session.send('Browser.setWindowBounds', {
                windowId,
                bounds: {
                    left: 0,
                    top: screen.height + 1000,
                    width: 50,
                    height: 50,
                    windowState: 'normal'
                }
            });
            // 註: 不再呼叫 await session.detach()，保留給下次視窗移動時使用
            console.log("✅ [PageInteractor] 視窗已成功移動。");
        } catch (e) {
            console.warn(`⚠️ [PageInteractor] 視窗移動失敗: ${e.message}`);
        }
    }

    /**
     * 🌟 幽靈按鈕點擊術：加裝防禦機制的升級版
     */
    async _autoClickWorkspaceButtons() {
        try {
            console.log("🕵️ [PageInteractor] 啟動幽靈掃描，尋找是否需要點擊【儲存/建立】按鈕...");

            await new Promise(r => setTimeout(r, 1500));

            const clickedButtonText = await this.page.evaluate((keywords) => {
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

                    if (keywords.some(kw => text === kw || text.includes(kw))) {
                        btn.click();
                        return text;
                    }
                }
                return null;
            }, WORKSPACE_SAVE_KEYWORDS);

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
     * 📋 模擬人類貼上附件 (Clipboard Paste Technique)
     * @param {string} targetSelector - 貼上的目標輸入框
     * @param {string} filePath - 本地檔案路徑
     * @param {string} mimeType - 檔案類型
     */
    async _attachFile(targetSelector, filePath, mimeType) {
        console.log(`📋 [PageInteractor] 正在讀取並模擬貼上附件: ${filePath} (${mimeType || 'unknown'})`);
        
        try {
            const fs = require('fs');
            const path = require('path');
            if (!fs.existsSync(filePath)) {
                throw new Error(`找不到檔案: ${filePath}`);
            }

            const buffer = fs.readFileSync(filePath);
            const fileName = path.basename(filePath);
            
            // 如果沒帶 mimeType，則根據副檔名做最後保險 (Gemini 對文件的 mimetype 比較敏感)
            let resolvedMimeType = mimeType;
            if (!resolvedMimeType) {
                const ext = path.extname(fileName).toLowerCase();
                const mimeMap = {
                    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
                    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
                    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    '.js': 'text/javascript', '.py': 'text/x-python', '.json': 'application/json'
                };
                resolvedMimeType = mimeMap[ext] || 'application/octet-stream';
            }
            
            // 🚀 將 Buffer 轉換為 Base64 以便傳入 evaluate
            const base64 = buffer.toString('base64');

            await this.page.evaluate(async ({ s, b64, name, type }) => {
                const el = document.querySelector(s);
                if (!el) throw new Error("找不到貼上目標選取器");

                // 1. 將 Base64 轉回 Blob & File
                const byteCharacters = atob(b64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type });
                const file = new File([blob], name, { type });

                // 2. 建立 DataTransfer 並模擬貼上事件
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);

                const event = new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true
                });

                el.focus();
                el.dispatchEvent(event);
            }, { s: targetSelector, b64: base64, name: fileName, type: resolvedMimeType });

            console.log(`✅ [PageInteractor] 附件 [${fileName}] 已模擬貼入，等待 UI 反映...`);
            await new Promise(r => setTimeout(r, 1500)); // 等待預覽圖/檔案圖示出現
        } catch (e) {
            console.error(`❌ [PageInteractor] 附件貼上失敗: ${e.message}`);
        }
    }

    /**
     * 🛡️ 頁面空閒檢查術：確保沒有正在生成的訊息或遮罩
     */
    async _waitForReady(sendSelector) {
        console.log("🔍 [PageInteractor] 正在檢查頁面空閒狀態...");
        const maxWait = 15000; // 最多等 15 秒
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            const isBusy = await this.page.evaluate(() => {
                // 尋找「停止」按鈕或特定的正在處理標記
                const stopButtons = Array.from(document.querySelectorAll('button, [role="button"], [data-test-id*="stop"], .stop-button, [aria-label*="stop" i]'))
                    .filter(b => {
                        const txt = (b.innerText || b.textContent || "").trim();
                        const label = (b.getAttribute('aria-label') || "").trim();
                        const stopTexts = ['停止', 'Stop', '中斷', 'Stop generating'];
                        return stopTexts.includes(txt) || stopTexts.some(s => label.includes(s)) || (label && label.toLowerCase().includes('stop'));
                    });

                // 如果有停止按鈕，代表還在跑
                if (stopButtons.length > 0) {
                    const isAnyVisible = stopButtons.some(b => {
                        const style = window.getComputedStyle(b);
                        const rect = b.getBoundingClientRect();
                        return rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                    });
                    if (isAnyVisible) return true;
                }

                // 檢查是否正在進行流式輸出 (可能會有一個正在閃爍的游標或類別)
                const streamingElements = document.querySelectorAll('.generating, .is-generating, [aria-busy="true"], .loading, .spinner');
                for (const el of streamingElements) {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0) return true;
                }

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

    /**
     * 處理圖片上傳
     * @param {string} uploadSelector 
     * @param {string} filePath 
     */
    async _handleUpload(uploadSelector, filePath) {
        console.log(`📸 [PageInteractor] 正在嘗試上傳圖片: ${filePath}`);
        
        try {
            // 🚀 尋找隱藏的 file input
            let fileInput = await this.page.$('input[type="file"]');
            
            if (!fileInput) {
                console.log("🚑 找不到標準 input[type='file']，嘗試點擊上傳按鈕啟動元件...");
                const uploadBtn = await this.page.$(uploadSelector);
                if (uploadBtn) {
                    await uploadBtn.click();
                    await new Promise(r => setTimeout(r, 1000));
                    fileInput = await this.page.$('input[type="file"]');
                }
            }

            if (!fileInput) {
                throw new Error("找不到檔案上傳元件 (input[type='file'])");
            }

            // 📤 執行上傳
            await fileInput.setInputFiles(filePath);
            console.log("✅ [PageInteractor] 檔案已選擇，等待上傳預覽...");

            // ⏳ 等待預覽圖出現 (Gemini 通常會顯示一個縮圖或刪除按鈕)
            await this.page.waitForSelector('button[aria-label*="移除"], button[aria-label*="Remove"], .thumbnail, mat-chip', {
                state: 'attached',
                timeout: 10000
            }).catch(() => {
                console.warn("⚠️ [PageInteractor] 等待上傳預覽超時，將嘗試繼續流程。");
            });

            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`❌ [PageInteractor] 圖片上傳失敗: ${e.message}`);
            // 不要拋出錯誤，讓流程嘗試繼續 (可能有文字訊息)
        }
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

    /**
     * 🧹 物理修剪 DOM (DOM Pruning)
     * 移除畫面中過舊的對話泡泡，防止長時間對話導致 Chromium 渲染進程吃光記憶體
     */
    async _pruneDOM() {
        try {
            console.log("🧹 [PageInteractor] 正在物理修剪頁面 DOM 結構以釋放記憶體...");
            await this.page.evaluate(() => {
                // 涵蓋 Gemini 與主流大模型的前端對話節點特徵
                const chatNodes = document.querySelectorAll('message-content, model-response, user-message, .message-row, .conversation-turn');
                
                if (chatNodes.length <= 6) return; // 至少保留最後 6 個節點 (剛好是一兩組合法對話視窗)
                
                // 保留最後 6 個，其餘砍掉
                for (let i = 0; i < chatNodes.length - 6; i++) {
                    const node = chatNodes[i];
                    if (node && node.parentNode) {
                        // 往上找最高層級的包裝器
                        const wrapper = node.closest('.message-row') || node.closest('.conversation-turn') || node.closest('.chat-message-group') || node;
                        if (wrapper && wrapper.parentNode) {
                            wrapper.parentNode.removeChild(wrapper);
                        }
                    }
                }
            });
            console.log("✅ [PageInteractor] DOM 修剪完成，節點已釋放。");
        } catch (e) {
            console.warn(`⚠️ [PageInteractor] DOM 修剪失敗: ${e.message}`);
        }
    }
}

module.exports = PageInteractor;
