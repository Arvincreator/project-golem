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

    static getLargePayloadThreshold() {
        const raw = Number(process.env.GOLEM_COMPOSER_CHUNK_THRESHOLD || 12000);
        return Number.isFinite(raw) && raw > 0 ? raw : 12000;
    }

    static getComposerInsertChunkSize() {
        const raw = Number(process.env.GOLEM_COMPOSER_CHUNK_SIZE || 3500);
        return Number.isFinite(raw) && raw > 0 ? raw : 3500;
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

    static getComposerSelectors() {
        return [
            '.ProseMirror',
            '.ql-editor',
            'rich-textarea .ProseMirror',
            'rich-textarea .ql-editor',
            'rich-textarea div[contenteditable="true"]',
            'div[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"]',
            'textarea'
        ];
    }

    /**
     * 主互動流程：輸入文字 → 點擊發送 → 等待回應 → 🌟自動點擊按鈕 (智慧判斷)
     */
    async interact(payload, selectors, isSystem, startTag, endTag, retryCount = 0, attachment = null, options = {}) {
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
            await this._waitForReady(selectors.send, options);

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
            await this._clickSend(selectors.send, {
                responseSelector: selectors.response,
                baseline,
                startTag,
                payloadLength: String(payload || '').length
            });

            // 5. 若為系統訊息，延遲後直接返回
            if (isSystem) {
                await new Promise(r => setTimeout(r, TIMINGS.SYSTEM_DELAY));
                return "";
            }

            // 6. 等待信封回應
            console.log(`⚡ [Brain] 等待信封完整性 (${startTag} ... ${endTag})...`);
            const finalResponse = await ResponseExtractor.waitForResponse(
                this.page,
                selectors.response,
                startTag,
                endTag,
                baseline,
                { timeoutMs: options.responseTimeoutMs || options.timeoutMs }
            );

            if (finalResponse.status === 'TIMEOUT') {
                const timedOutText = String(finalResponse.text || '').trim();
                const hasStartedEnvelope = timedOutText.includes(startTag) || /\[\[?BEGIN\s*:/i.test(timedOutText);
                if (!hasStartedEnvelope && !options.allowPartialOnTimeout) {
                    throw new Error("等待回應超時");
                }
                finalResponse.status = 'ENVELOPE_TIMEOUT_PARTIAL';
                console.warn(`⏳ [PageInteractor] 回應逾時但已捕獲部分內容，將交由上層解析 (${timedOutText.length} chars)。`);
            }

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
                    return this.interact(payload, selectors, isSystem, startTag, endTag, retryCount + 1, attachment, options);
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
        const fallbackSelectors = PageInteractor.getComposerSelectors();

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
            const focusedComposer = await this._focusBestComposer(targetSelector);
            if (focusedComposer && focusedComposer.ok && Number.isFinite(focusedComposer.x) && Number.isFinite(focusedComposer.y) && this.page.mouse) {
                await this.page.mouse.click(focusedComposer.x, focusedComposer.y);
            } else {
                if (typeof this.page.focus === 'function') {
                    await this.page.focus(targetSelector);
                }
                await inputEl.scrollIntoViewIfNeeded(); // [Playwright 強化] 確保在可視區域
                await inputEl.click({ delay: 50 });    // [強化] 點擊一下以確保真實 Focus
                await inputEl.focus();
            }
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

        let insertState = null;
        const minimumExpectedLength = Math.min(10, textToPaste.trim().length);
        const shouldChunkInsert = payloadLength > PageInteractor.getLargePayloadThreshold();

        // 2. 優先使用 Playwright fill() 對 contenteditable 寫入。這會走瀏覽器原生
        // input/change 事件，比單純把文字塞進 DOM 更容易讓 Gemini 啟用送出鈕。
        try {
            if (!shouldChunkInsert && this.page.locator && textToPaste.length > 0) {
                const activeComposer = this.page.locator('[data-golem-active-composer="true"]').last();
                await activeComposer.fill(textToPaste, { timeout: 15000 });
                const fillState = await this._readComposerState('[data-golem-active-composer="true"]');
                if (fillState && fillState.ok && fillState.length >= minimumExpectedLength) {
                    insertState = {
                        ...fillState,
                        method: 'locator-fill'
                    };
                } else {
                    console.warn(`⚠️ [PageInteractor] locator.fill 後 composer 狀態不完整，改用鍵盤輸入補強。`);
                }
            }
        } catch (e) {
            console.warn(`⚠️ [PageInteractor] locator.fill 失敗: ${e.message}`);
        }

        // 3. 使用 Playwright 的真實文字輸入通道。這比 DOM 改字更能啟用
        // Gemini/ProseMirror 的 send button，尤其是 RPG/股市分析這種長 prompt。
        try {
            if (this.page.keyboard && typeof this.page.keyboard.insertText === 'function') {
                if (!insertState) {
                    if (shouldChunkInsert) {
                        const chunkSize = PageInteractor.getComposerInsertChunkSize();
                        const totalChunks = Math.max(1, Math.ceil(textToPaste.length / chunkSize));
                        const startedAt = Date.now();
                        const progressInterval = Math.max(1, Math.floor(totalChunks / 8));
                        console.log(`⏳ [PageInteractor] AI 正在讀取長文本 ${textToPaste.length} 字，共分 ${totalChunks} 段。`);
                        for (let idx = 0; idx < totalChunks; idx += 1) {
                            const start = idx * chunkSize;
                            const end = Math.min(textToPaste.length, start + chunkSize);
                            const chunk = textToPaste.slice(start, end);
                            await this.page.keyboard.insertText(chunk);
                            if (idx === 0 || idx === totalChunks - 1 || (idx + 1) % progressInterval === 0) {
                                const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
                                console.log(`⏳ [PageInteractor] AI 正在讀取長文本 ${textToPaste.length} 字，共分 ${totalChunks} 段，目前第 ${idx + 1} 段 (${elapsed}s)。`);
                            }
                            if (idx < totalChunks - 1) {
                                await new Promise(r => setTimeout(r, 20));
                            }
                        }
                        console.log(`✅ [PageInteractor] 長文本讀取完成，共 ${textToPaste.length} 字 / ${totalChunks} 段。`);
                    } else {
                        await this.page.keyboard.insertText(textToPaste);
                    }
                }
                const keyboardState = await this._readComposerState(targetSelector);
                if (!insertState && keyboardState && keyboardState.ok && keyboardState.length >= minimumExpectedLength) {
                    insertState = {
                        ...keyboardState,
                        method: 'keyboard-insertText'
                    };
                } else if (!insertState) {
                    console.warn(`⚠️ [PageInteractor] keyboard.insertText 後 composer 狀態不完整，改用 DOM 貼上補強。`);
                }
            }
        } catch (e) {
            console.warn(`⚠️ [PageInteractor] keyboard.insertText 失敗: ${e.message}`);
        }

        // 4. Fallback：模擬真實貼上，而不是只改 innerText。Gemini 的 rich-textarea/ProseMirror
        // 需要 paste/input 事件更新內部狀態，否則畫面有草稿但送出鈕不會啟用。
        if (!insertState) {
            insertState = await this.page.evaluate(({ s, t, fallbacks }) => {
            const visible = (node) => {
                if (!node || !(node instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };

            const isEditable = (node) => {
                if (!node || !(node instanceof HTMLElement)) return false;
                const tag = node.tagName;
                return tag === 'TEXTAREA' ||
                    tag === 'INPUT' ||
                    node.isContentEditable ||
                    node.getAttribute('role') === 'textbox' ||
                    node.classList.contains('ProseMirror') ||
                    node.classList.contains('ql-editor');
            };

            const collect = (selector) => {
                if (!selector) return [];
                try {
                    return Array.from(document.querySelectorAll(selector));
                } catch (_) {
                    return [];
                }
            };

            const roots = [
                ...collect(s),
                ...fallbacks.flatMap(collect)
            ];
            const candidates = [];
            const addCandidate = (node) => {
                if (!node || !(node instanceof HTMLElement)) return;
                if (isEditable(node)) candidates.push(node);
                if (node.querySelectorAll) {
                    candidates.push(...Array.from(node.querySelectorAll(fallbacks.join(', '))).filter(isEditable));
                }
            };
            roots.forEach(addCandidate);

            const unique = Array.from(new Set(candidates)).filter(visible);
            unique.sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.top - ar.top) || (br.left - ar.left);
            });

            const el = unique[0];
            if (!el) return { ok: false, reason: 'editable-not-found' };

            const tagName = el.tagName;
            const isTextInput = tagName === 'TEXTAREA' || tagName === 'INPUT';
            el.focus();

            const dispatchInput = (inputType, data = null) => {
                try {
                    el.dispatchEvent(new InputEvent('beforeinput', {
                        bubbles: true,
                        cancelable: true,
                        inputType,
                        data
                    }));
                } catch (_) { }
                try {
                    el.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        inputType,
                        data
                    }));
                } catch (_) {
                    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                }
                el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Unidentified' }));
            };

            const selectAllEditable = () => {
                if (isTextInput) {
                    el.setSelectionRange(0, el.value.length);
                    return;
                }
                const range = document.createRange();
                range.selectNodeContents(el);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            };

            if (isTextInput) {
                const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
                if (setter) setter.call(el, '');
                else el.value = '';
                dispatchInput('deleteContentBackward');
                if (setter) setter.call(el, t);
                else el.value = t;
                dispatchInput('insertFromPaste', t);
                return {
                    ok: true,
                    method: 'native-value',
                    tagName,
                    length: el.value.length
                };
            }

            try {
                selectAllEditable();
                document.execCommand('delete', false);
            } catch (_) { }

            let pasteHandled = false;
            try {
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/plain', t);
                const pasteEvent = new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true
                });
                pasteHandled = !el.dispatchEvent(pasteEvent) || pasteEvent.defaultPrevented;
            } catch (_) { }

            const currentTextAfterPaste = (el.innerText || el.textContent || '').trim();
            if (!currentTextAfterPaste || currentTextAfterPaste.length < Math.min(10, t.trim().length)) {
                try {
                    selectAllEditable();
                    const inserted = document.execCommand('insertText', false, t);
                    if (!inserted) {
                        el.textContent = t;
                    }
                } catch (_) {
                    el.textContent = t;
                }
                dispatchInput('insertFromPaste', t);
            } else {
                dispatchInput('insertFromPaste', t);
            }

            try {
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(el);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (_) { }

            return {
                ok: true,
                method: pasteHandled ? 'paste-event' : 'exec-command',
                tagName,
                role: el.getAttribute('role') || '',
                className: el.className || '',
                length: (el.innerText || el.textContent || '').length
            };
            }, { s: targetSelector, t: textToPaste, fallbacks: fallbackSelectors });
        }

        if (!insertState || !insertState.ok) {
            throw new Error(`無法植入文字到 Gemini 輸入框: ${insertState?.reason || 'unknown'}`);
        }
        console.log(`✅ [PageInteractor] 文字已植入 Gemini composer (${insertState.method}, ${insertState.tagName}, length=${insertState.length}).`);

        // 3. 額外觸發一個小的鍵盤事件，確保某些框架監聽的 focus/input 狀態被啟動
        await this.page.keyboard.type(' ', { delay: 1 });
        await this.page.keyboard.press('Backspace');
    }

    async _focusBestComposer(inputSelector) {
        return this.page.evaluate(({ s, fallbacks }) => {
            const visible = (node) => {
                if (!node || !(node instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const isEditable = (node) => {
                if (!node || !(node instanceof HTMLElement)) return false;
                const tag = node.tagName;
                return tag === 'TEXTAREA' ||
                    tag === 'INPUT' ||
                    node.isContentEditable ||
                    node.getAttribute('role') === 'textbox' ||
                    node.classList.contains('ProseMirror') ||
                    node.classList.contains('ql-editor');
            };
            const collect = (selector) => {
                if (!selector) return [];
                try {
                    return Array.from(document.querySelectorAll(selector));
                } catch (_) {
                    return [];
                }
            };
            const roots = [
                ...collect(s),
                ...fallbacks.flatMap(collect)
            ];
            const candidates = [];
            const addCandidate = (node) => {
                if (!node || !(node instanceof HTMLElement)) return;
                if (isEditable(node)) candidates.push(node);
                if (node.querySelectorAll) {
                    candidates.push(...Array.from(node.querySelectorAll(fallbacks.join(', '))).filter(isEditable));
                }
            };
            roots.forEach(addCandidate);
            const unique = Array.from(new Set(candidates)).filter(visible);
            unique.sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.top - ar.top) || (br.left - ar.left);
            });
            const el = unique[0];
            if (!el) return { ok: false, reason: 'editable-not-found' };
            document.querySelectorAll('[data-golem-active-composer="true"]').forEach((node) => {
                node.removeAttribute('data-golem-active-composer');
            });
            el.setAttribute('data-golem-active-composer', 'true');
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.focus();
            const rect = el.getBoundingClientRect();
            return {
                ok: true,
                tagName: el.tagName,
                className: el.className || '',
                role: el.getAttribute('role') || '',
                x: rect.left + Math.min(rect.width / 2, 24),
                y: rect.top + rect.height / 2
            };
        }, { s: inputSelector, fallbacks: PageInteractor.getComposerSelectors() }).catch((error) => ({
            ok: false,
            reason: error.message
        }));
    }

    async _readComposerState(inputSelector) {
        return this.page.evaluate(({ s, fallbacks }) => {
            const visible = (node) => {
                if (!node || !(node instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const isEditable = (node) => {
                if (!node || !(node instanceof HTMLElement)) return false;
                const tag = node.tagName;
                return tag === 'TEXTAREA' ||
                    tag === 'INPUT' ||
                    node.isContentEditable ||
                    node.getAttribute('role') === 'textbox' ||
                    node.classList.contains('ProseMirror') ||
                    node.classList.contains('ql-editor');
            };
            const textOf = (node) => {
                if (!node) return '';
                if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') return node.value || '';
                return node.innerText || node.textContent || '';
            };
            const collect = (selector) => {
                if (!selector) return [];
                try {
                    return Array.from(document.querySelectorAll(selector));
                } catch (_) {
                    return [];
                }
            };
            const roots = [
                ...collect(s),
                ...fallbacks.flatMap(collect)
            ];
            const candidates = [];
            const addCandidate = (node) => {
                if (!node || !(node instanceof HTMLElement)) return;
                if (isEditable(node)) candidates.push(node);
                if (node.querySelectorAll) {
                    candidates.push(...Array.from(node.querySelectorAll(fallbacks.join(', '))).filter(isEditable));
                }
            };
            roots.forEach(addCandidate);
            const unique = Array.from(new Set(candidates)).filter(visible);
            unique.sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.top - ar.top) || (br.left - ar.left);
            });
            const el = unique[0];
            if (!el) return { ok: false, reason: 'editable-not-found', length: 0 };
            return {
                ok: true,
                tagName: el.tagName,
                className: el.className || '',
                role: el.getAttribute('role') || '',
                length: textOf(el).length
            };
        }, { s: inputSelector, fallbacks: PageInteractor.getComposerSelectors() }).catch((error) => ({
            ok: false,
            reason: error.message,
            length: 0
        }));
    }

    async _waitForSendButtonEnabled(timeoutMs = 5000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const ready = await this.page.evaluate(() => {
                const visible = (node) => {
                    if (!node || !(node instanceof HTMLElement)) return false;
                    const style = window.getComputedStyle(node);
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                };
                const editorSelector = [
                    '.ProseMirror',
                    '.ql-editor',
                    'rich-textarea .ProseMirror',
                    'rich-textarea .ql-editor',
                    'rich-textarea div[contenteditable="true"]',
                    'div[role="textbox"][contenteditable="true"]',
                    'div[contenteditable="true"]',
                    'textarea'
                ].join(', ');
                const editors = Array.from(document.querySelectorAll(editorSelector)).filter(visible);
                editors.sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    return (br.bottom - ar.bottom) || (br.left - ar.left);
                });
                const composer = editors[0] || null;
                if (!composer) return false;
                const inputRect = composer.getBoundingClientRect();
                const buttons = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]')).filter(visible);
                return buttons.some((button) => {
                    const label = [
                        button.getAttribute('aria-label'),
                        button.getAttribute('title'),
                        button.getAttribute('data-tooltip'),
                        button.innerText,
                        button.textContent
                    ].filter(Boolean).join(' ').toLowerCase();
                    const explicitSend = label.includes('傳送訊息') ||
                        label.includes('送出訊息') ||
                        label.includes('發送訊息') ||
                        label.includes('send message') ||
                        label.includes('submit message');
                    if (!explicitSend) return false;
                    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
                    const rect = button.getBoundingClientRect();
                    const centerY = rect.top + rect.height / 2;
                    return centerY >= inputRect.top - 120 && centerY <= inputRect.bottom + 160;
                });
            }).catch(() => false);
            if (ready) return true;
            await new Promise(r => setTimeout(r, 250));
        }
        return false;
    }

    async _clickSend(sendSelector, options = {}) {
        // 1. 確保焦點回到底部 Gemini composer，而不是頁面上的舊 editable。
        try {
            const focusedComposer = await this._focusBestComposer(PageInteractor.getComposerSelectors().join(', '));
            if (focusedComposer && focusedComposer.ok && Number.isFinite(focusedComposer.x) && Number.isFinite(focusedComposer.y) && this.page.mouse) {
                await this.page.mouse.click(focusedComposer.x, focusedComposer.y);
            }
            await new Promise(r => setTimeout(r, 100));
        } catch (e) { }

        // 防止 Enter 太快，給予輸入框更新時間
        await new Promise(r => setTimeout(r, 500));
        const dynamicTimeout = this._computeSendAcceptTimeout(options.payloadLength, options.sendAcceptTimeoutMs);
        const sendOptions = {
            ...options,
            sendAcceptTimeoutMs: dynamicTimeout
        };
        const sendTarget = await this._tryClickSendButton(sendSelector);

        if (!sendTarget || !sendTarget.clicked) {
            await this._pressSubmitKeys();
            console.warn(`⚠️ [PageInteractor] 找不到可點擊的送出按鈕，已嘗試鍵盤送出。${sendTarget?.diagnostics ? ` 候選: ${sendTarget.diagnostics}` : ''}`);
        } else {
            console.log(`🎯 [PageInteractor] 找到送出候選按鈕 score=${sendTarget.score || 0} label="${sendTarget.label || ''}"`);
            await this._performSendClick(sendTarget);
        }

        const accepted = await this._waitForSendAccepted(sendOptions);
        if (!accepted) {
            console.warn("⚠️ [PageInteractor] Gemini 草稿尚未送出，進行第二次送出補強。");
            const retryTarget = await this._tryClickSendButton(sendSelector);
            if (!retryTarget || !retryTarget.clicked) {
                await this._pressSubmitKeys();
            } else {
                console.log(`🎯 [PageInteractor] 第二次送出候選按鈕 score=${retryTarget.score || 0} label="${retryTarget.label || ''}"`);
                await this._performSendClick(retryTarget);
                await this._focusBestComposer(PageInteractor.getComposerSelectors().join(', ')).catch(() => null);
            }
            const retryAccepted = await this._waitForSendAccepted(sendOptions);
            if (!retryAccepted) {
                throw new Error("Gemini 草稿未送出：已植入文字，但送出按鈕沒有啟用或訊息沒有離開輸入框。");
            }
        }
        let draftState = await this._inspectComposerDraftState(options.startTag || '').catch(() => ({ hasDraft: false, length: 0, hasStartTag: false }));
        if (draftState.hasDraft) {
            console.warn(`⚠️ [PageInteractor] 偵測到草稿仍在輸入框（len=${draftState.length}, startTag=${draftState.hasStartTag}），執行第三次送出補強。`);
            const thirdTarget = await this._tryClickSendButton(sendSelector);
            if (!thirdTarget || !thirdTarget.clicked) {
                await this._pressSubmitKeys();
            } else {
                console.log(`🎯 [PageInteractor] 第三次送出候選按鈕 score=${thirdTarget.score || 0} label="${thirdTarget.label || ''}"`);
                await this._performSendClick(thirdTarget);
            }
            await new Promise(r => setTimeout(r, 300));
            draftState = await this._inspectComposerDraftState(options.startTag || '').catch(() => ({ hasDraft: false, length: 0, hasStartTag: false }));
            if (draftState.hasDraft) {
                throw new Error(`Gemini 草稿未送出：輸入框仍殘留內容（len=${draftState.length}, startTag=${draftState.hasStartTag}）。`);
            }
        }

        // 3. 自動置底 (最小化干擾)
        await this._moveWindowToBottom();

        await new Promise(r => setTimeout(r, 200));
    }

    async _inspectComposerDraftState(startTag = '') {
        return this.page.evaluate(({ sTag }) => {
            const editorSelector = [
                '.ProseMirror',
                '.ql-editor',
                'rich-textarea .ProseMirror',
                'rich-textarea .ql-editor',
                'rich-textarea div[contenteditable="true"]',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
                'textarea'
            ].join(', ');
            const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const textOf = (el) => {
                if (!el) return '';
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
                return el.innerText || el.textContent || '';
            };
            const editors = Array.from(document.querySelectorAll(editorSelector)).filter(visible);
            editors.sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.bottom - ar.bottom) || (br.left - ar.left);
            });
            const text = textOf(editors[0] || null).trim();
            const hasStartTag = Boolean(sTag && text.includes(sTag));
            const hasAnyBegin = /\[\[?BEGIN\s*:/i.test(text);
            const hasDraft = hasStartTag || hasAnyBegin || text.length > 80;
            return {
                hasDraft,
                hasStartTag,
                length: text.length
            };
        }, { sTag: startTag || '' });
    }

    async _pressSubmitKeys() {
        try {
            const focusedComposer = await this._focusBestComposer(PageInteractor.getComposerSelectors().join(', '));
            if (focusedComposer && focusedComposer.ok && Number.isFinite(focusedComposer.x) && Number.isFinite(focusedComposer.y) && this.page.mouse) {
                await this.page.mouse.click(focusedComposer.x, focusedComposer.y);
                await new Promise(r => setTimeout(r, 80));
            }
        } catch (_) { }

        const submitCombos = process.platform === 'darwin'
            ? ['Enter', 'Meta+Enter', 'Control+Enter']
            : ['Enter', 'Control+Enter'];
        for (const combo of submitCombos) {
            await this.page.keyboard.press(combo).catch(() => {});
            await new Promise(r => setTimeout(r, 180));
        }
    }

    async _performSendClick(sendTarget) {
        if (!sendTarget || !Number.isFinite(sendTarget.x) || !Number.isFinite(sendTarget.y)) return;
        try {
            if (this.page.mouse && typeof this.page.mouse.click === 'function') {
                await this.page.mouse.click(sendTarget.x, sendTarget.y);
            } else {
                await this.page.evaluate(({ x, y }) => {
                    const target = document.elementFromPoint(x, y);
                    if (target && typeof target.click === 'function') target.click();
                }, { x: sendTarget.x, y: sendTarget.y });
            }
        } catch (e) {
            console.warn(`⚠️ [PageInteractor] 點擊送出按鈕失敗: ${e.message}`);
        }
    }

    async _tryClickSendButton(sendSelector) {
        return this.page.evaluate((s) => {
            const stopWords = ['停止', 'Stop', '中斷', 'キャンセル', '停止生成', 'stop generating'];
            const sendWords = ['發送', '傳送', '送出', '提交', 'Send', 'Submit', '送信', '送る', 'send message'];
            const editorSelector = [
                '.ProseMirror',
                '.ql-editor',
                'rich-textarea .ProseMirror',
                'rich-textarea .ql-editor',
                'rich-textarea div[contenteditable="true"]',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
                'textarea'
            ].join(', ');
            const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const labelFor = (btn) => [
                btn.getAttribute('aria-label'),
                btn.getAttribute('title'),
                btn.getAttribute('data-tooltip'),
                btn.getAttribute('data-test-id'),
                btn.innerText,
                btn.textContent
            ].filter(Boolean).join(' ').trim();
            const findComposer = () => Array.from(document.querySelectorAll(editorSelector))
                .filter(visible)
                .sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    return (br.bottom - ar.bottom) || (br.left - ar.left);
                })[0] || null;
            const isNavigationButton = (btn, lowerLabel) => {
                const navRoot = btn.closest('nav, aside, mat-sidenav, [role="navigation"], .side-nav, .sidenav, .mat-drawer, .mat-sidenav, .navigation');
                if (navRoot) return true;
                return lowerLabel.includes('主選單') ||
                    lowerLabel.includes('main menu') ||
                    lowerLabel.includes('side-nav') ||
                    lowerLabel.includes('side nav') ||
                    lowerLabel.includes('sidenav') ||
                    lowerLabel.includes('menu button') ||
                    lowerLabel.includes('選單');
            };
            const nearComposer = (btn, composer) => {
                if (!composer) return false;
                const rect = btn.getBoundingClientRect();
                const inputRect = composer.getBoundingClientRect();
                const buttonCenterY = rect.top + rect.height / 2;
                const inputCenterY = inputRect.top + inputRect.height / 2;
                const yTolerance = Math.max(140, inputRect.height + 80);
                return Math.abs(buttonCenterY - inputCenterY) <= yTolerance &&
                    rect.left >= inputRect.left - 24 &&
                    rect.top <= inputRect.bottom + 120 &&
                    rect.bottom >= inputRect.top - 120;
            };
            const utilityWords = [
                '工具', 'tool', 'tools', 'mic', 'microphone', 'voice', '語音', '麥克風',
                'attach', 'attachment', 'upload', '上傳', '附件', '新增', 'add',
                '更多', 'more', 'menu', '選單', 'image', '圖片', '檔案'
            ];
            const describeIcon = (btn) => [
                btn.getAttribute('data-icon'),
                btn.getAttribute('data-mat-icon-name'),
                btn.getAttribute('fonticon'),
                btn.getAttribute('icon'),
                btn.className,
                btn.querySelector && btn.querySelector('mat-icon') ? btn.querySelector('mat-icon').textContent : '',
                btn.querySelector && btn.querySelector('[data-icon]') ? btn.querySelector('[data-icon]').getAttribute('data-icon') : '',
                btn.innerHTML
            ].filter(Boolean).join(' ');
            const scoreButton = (btn) => {
                if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true' || !visible(btn)) return -1;
                const label = labelFor(btn);
                const lowerLabel = label.toLowerCase();
                if (stopWords.some(word => lowerLabel.includes(word.toLowerCase()))) return -1;
                const rect = btn.getBoundingClientRect();
                const composer = findComposer();
                const nearInput = nearComposer(btn, composer);
                if (isNavigationButton(btn, lowerLabel)) return -1;
                if (utilityWords.some(word => lowerLabel.includes(word.toLowerCase()))) return -1;

                const explicitSend = lowerLabel.includes('send message') ||
                    lowerLabel.includes('傳送訊息') ||
                    lowerLabel.includes('送出訊息') ||
                    lowerLabel.includes('發送訊息') ||
                    lowerLabel.includes('submit message');
                const genericSend = sendWords.some(word => lowerLabel.includes(word.toLowerCase()));
                const iconDescription = describeIcon(btn);
                const iconLooksLikeSend = /paper-plane|arrow[_-]?upward|send|send[_-]?button|sendicon|send-icon/i.test(iconDescription) ||
                    /<mat-icon[^>]*>\s*(send|arrow_upward)\s*<\/mat-icon>/i.test(iconDescription);
                const iconOnly = label.length <= 48 && rect.width <= 88 && rect.height <= 88;
                let rightEdgeCandidate = false;
                if (composer) {
                    const inputRect = composer.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    rightEdgeCandidate = centerX >= inputRect.right - 160 &&
                        centerX <= inputRect.right + 220 &&
                        centerY >= inputRect.top - 80 &&
                        centerY <= inputRect.bottom + 120;
                }

                if (explicitSend && nearInput) return 150;
                if (explicitSend) return 100;
                if (genericSend && nearInput) return 120;
                if (nearInput && iconOnly && iconLooksLikeSend) return 90;
                if (nearInput && rightEdgeCandidate && iconOnly && !label) return 60;

                return -1;
            };

            let explicit = null;
            try {
                explicit = (s ? document.querySelector(s) : null);
            } catch (_) { }
            const candidates = [
                explicit,
                ...Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title], [data-tooltip], [data-test-id], span[data-icon]'))
            ].filter(Boolean).map((node) => {
                if (!(node instanceof HTMLElement)) return null;
                return node.closest('button, [role="button"], [aria-label], [title], [data-tooltip], [data-test-id]') || node;
            }).filter(Boolean);
            const uniqueCandidates = Array.from(new Set(candidates));

            let best = null;
            let bestScore = -1;
            let bestLabel = '';
            const diagnostics = [];
            for (const btn of uniqueCandidates) {
                const score = scoreButton(btn);
                if (diagnostics.length < 8) {
                    const label = labelFor(btn).slice(0, 40);
                    const rect = btn.getBoundingClientRect();
                    if (visible(btn)) diagnostics.push(`${score}:${label || describeIcon(btn).slice(0, 40)}@${Math.round(rect.left)},${Math.round(rect.top)}`);
                }
                if (score > bestScore) {
                    best = btn;
                    bestScore = score;
                    bestLabel = labelFor(btn);
                }
            }

            if (!best || bestScore < 0) return {
                clicked: false,
                reason: 'send-button-not-found',
                diagnostics: diagnostics.join(' | ')
            };
            best.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = best.getBoundingClientRect();
            best.focus();
            return {
                clicked: true,
                score: bestScore,
                label: bestLabel.slice(0, 80),
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
        }, sendSelector).catch((error) => ({ clicked: false, reason: error.message }));
    }

    async _waitForSendAccepted(options = {}) {
        const timeoutMs = options.sendAcceptTimeoutMs || 5000;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const state = await this.page.evaluate(({ responseSelector, baseline, startTag }) => {
                const editorSelector = [
                    '.ProseMirror',
                    '.ql-editor',
                    'rich-textarea .ProseMirror',
                    'rich-textarea .ql-editor',
                    'rich-textarea div[contenteditable="true"]',
                    'div[role="textbox"][contenteditable="true"]',
                    'div[contenteditable="true"]',
                    'textarea'
                ].join(', ');
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                };
                const textOf = (el) => {
                    if (!el) return '';
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
                    return el.innerText || el.textContent || '';
                };
                const editors = Array.from(document.querySelectorAll(editorSelector)).filter(visible);
                editors.sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    return (br.bottom - ar.bottom) || (br.left - ar.left);
                });
                const composerTexts = editors
                    .map((editor) => textOf(editor).trim())
                    .filter(Boolean);
                const composerTextLength = composerTexts.reduce((max, text) => Math.max(max, text.length), 0);
                const buttons = Array.from(document.querySelectorAll('button, [role="button"], [aria-label]')).filter(visible);
                const hasStop = buttons.some((button) => {
                    const label = [
                        button.getAttribute('aria-label'),
                        button.getAttribute('title'),
                        button.innerText,
                        button.textContent
                    ].filter(Boolean).join(' ').toLowerCase();
                    return label.includes('stop') || label.includes('停止') || label.includes('中斷') || label.includes('停止生成');
                });
                const hasDisabledSend = buttons.some((button) => {
                    const label = [
                        button.getAttribute('aria-label'),
                        button.getAttribute('title'),
                        button.innerText,
                        button.textContent
                    ].filter(Boolean).join(' ').toLowerCase();
                    const looksLikeSend = label.includes('send message') ||
                        label.includes('傳送訊息') ||
                        label.includes('送出訊息') ||
                        label.includes('發送訊息') ||
                        label.includes('submit message') ||
                        label.includes('send') ||
                        label.includes('傳送') ||
                        label.includes('送出');
                    if (!looksLikeSend) return false;
                    return button.disabled || button.getAttribute('aria-disabled') === 'true';
                });

                const isEditableNode = (el) => {
                    if (!el) return false;
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return true;
                    if (el.isContentEditable) return true;
                    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
                    return false;
                };
                const isResponseNode = (el) => {
                    if (!el) return false;
                    if (isEditableNode(el)) return false;
                    return Boolean(
                        el.closest('model-response') ||
                        el.closest('.model-response-text') ||
                        el.closest('.message-content') ||
                        el.closest('[data-message-id]') ||
                        el.closest('.conversation-turn')
                    );
                };

                let responseChanged = false;
                let responseFromNonEditable = false;
                if (responseSelector) {
                    try {
                        const responses = Array.from(document.querySelectorAll(responseSelector));
                        const semanticCandidates = responses.filter((node) => isResponseNode(node));
                        const latest = (semanticCandidates.length ? semanticCandidates : responses).slice(-1)[0] || null;
                        const latestText = textOf(latest);
                        responseFromNonEditable = Boolean(latest && !isEditableNode(latest));
                        responseChanged = Boolean(
                            latestText &&
                            latestText !== baseline &&
                            responseFromNonEditable &&
                            (!startTag || latestText.includes(startTag) || latestText.length > String(baseline || '').length + 20)
                        );
                    } catch (_) { }
                }

                const composerLikelyCleared = composerTextLength === 0;
                const responseSignal = responseChanged && responseFromNonEditable;
                const matchedSignals =
                    (hasStop ? 1 : 0) +
                    (hasDisabledSend ? 1 : 0) +
                    (responseSignal ? 1 : 0) +
                    (composerLikelyCleared ? 1 : 0);

                return {
                    composerTextLength,
                    hasStop,
                    hasDisabledSend,
                    responseChanged,
                    responseFromNonEditable,
                    responseSignal,
                    composerLikelyCleared,
                    matchedSignals
                };
            }, {
                responseSelector: options.responseSelector || '',
                baseline: options.baseline || '',
                startTag: options.startTag || ''
            }).catch(() => ({
                composerTextLength: 1,
                hasStop: false,
                hasDisabledSend: false,
                responseChanged: false,
                responseFromNonEditable: false,
                responseSignal: false,
                composerLikelyCleared: false,
                matchedSignals: 0
            }));

            const safeState = state || {
                composerTextLength: 1,
                hasStop: false,
                hasDisabledSend: false,
                responseChanged: false,
                responseFromNonEditable: false,
                responseSignal: false,
                composerLikelyCleared: false,
                matchedSignals: 0
            };
            if (safeState.hasStop) {
                return true;
            }
            if (safeState.hasDisabledSend && safeState.composerTextLength < 40) {
                return true;
            }
            if (safeState.matchedSignals >= 2) {
                return true;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        return false;
    }

    _computeSendAcceptTimeout(payloadLength = 0, explicitTimeoutMs = null) {
        if (Number.isFinite(Number(explicitTimeoutMs)) && Number(explicitTimeoutMs) > 0) {
            return Number(explicitTimeoutMs);
        }
        const len = Number(payloadLength) || 0;
        if (len >= 50000) return 12000;
        if (len >= 25000) return 9000;
        if (len >= 12000) return 7500;
        if (len >= 5000) return 6500;
        return 5000;
    }

    async clearComposerDraft() {
        const editorSelector = PageInteractor.getComposerSelectors().join(', ');
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const focusedComposer = await this._focusBestComposer(editorSelector);
                if (focusedComposer && focusedComposer.ok && Number.isFinite(focusedComposer.x) && Number.isFinite(focusedComposer.y) && this.page.mouse) {
                    await this.page.mouse.click(focusedComposer.x, focusedComposer.y);
                }
                const isMac = process.platform === 'darwin';
                await this.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A').catch(() => {});
                await new Promise(r => setTimeout(r, 70));
                await this.page.keyboard.press('Backspace').catch(() => {});
                await this.page.keyboard.press('Delete').catch(() => {});
                await new Promise(r => setTimeout(r, 180));
                const state = await this._inspectComposerDraftState('').catch(() => ({ hasDraft: true, length: 9999 }));
                if (!state.hasDraft || state.length === 0) {
                    console.log('🧹 [PageInteractor] 已清空 Gemini 草稿框。');
                    return true;
                }
            } catch (_) { }
        }
        console.warn('⚠️ [PageInteractor] 草稿框清空失敗，可能需要使用者手動清除。');
        return false;
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
    async _waitForReady(sendSelector, options = {}) {
        console.log("🔍 [PageInteractor] 正在檢查頁面空閒狀態...");
        const configuredWait = Number(options.readyTimeoutMs);
        const maxWait = Number.isFinite(configuredWait) && configuredWait > 0
            ? configuredWait
            : 15000;
        const startTime = Date.now();
        let lastBusyLogAt = 0;

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

                return false;
            });

            if (!isBusy) {
                console.log("✅ [PageInteractor] 頁面已空閒，準備發送。");
                return;
            }

            if (Date.now() - lastBusyLogAt > 10000) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(`⏳ [PageInteractor] Gemini 仍在生成/停止狀態，先不塞新草稿 (${elapsed}s/${Math.round(maxWait / 1000)}s)...`);
                lastBusyLogAt = Date.now();
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        console.warn("⚠️ [PageInteractor] Gemini 忙碌檢查超時；DOM 狀態可能殘留，改交由實際 composer/send button 狀態判斷。");
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
