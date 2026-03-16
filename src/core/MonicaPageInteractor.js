// ============================================================
// MonicaPageInteractor — DOM interaction for Monica.im chat
// Mirrors PageInteractor.js pattern, adapted for Monica's Ant Design UI
// ============================================================
const fs = require('fs');
const path = require('path');
const { TIMINGS, LIMITS, SELECTOR_HINTS } = require('./monica-constants');
const ResponseExtractor = require('./ResponseExtractor');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ✨ [v9.0.8] Timeout wrapper for page.evaluate — prevents CDP hang
function withTimeout(promise, ms = 30000) {
    let timer;
    return Promise.race([
        promise.then(v => { clearTimeout(timer); return v; }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`[MonicaInteractor] page.evaluate timeout after ${ms}ms`)), ms); })
    ]);
}

class MonicaPageInteractor {
    constructor(page, doctor) {
        this.page = page;
        this.doctor = doctor;
    }

    async interact(payload, selectors, isSystem, startTag, endTag, retryCount = 0) {
        if (retryCount > LIMITS.MAX_INTERACT_RETRY) {
            throw new Error('[MonicaInteractor] Max retries exceeded');
        }

        try {
            // 1. Wait for page ready (no active generation)
            await this._waitForReady();

            // 2. Capture baseline text
            const baseline = await this._captureBaseline(selectors.response);

            // 3. Type input
            await this._typeInput(selectors.input, payload);
            await delay(TIMINGS.INPUT_DELAY);

            // 4. Send (Enter key — Monica has no visible send button)
            await this._send();

            // 5. System message: return early
            if (isSystem) {
                await delay(TIMINGS.SYSTEM_DELAY);
                return '';
            }

            // 6. Wait for response using ResponseExtractor (shared with GolemBrain)
            const result = await ResponseExtractor.waitForResponse(
                this.page, selectors.response, startTag, endTag, baseline
            );

            // 7. Clean response
            return ResponseExtractor.cleanResponse(result.text || '', startTag, endTag);
        } catch (e) {
            // ✨ [v9.0.8] Timeout → auto-reload page instead of crash
            if (e.message.includes('timeout') && this.page) {
                console.warn('[MonicaInteractor] Timeout detected, reloading page...');
                try { await this.page.reload({ waitUntil: 'networkidle2', timeout: 15000 }); } catch (reloadErr) {
                    console.error('[MonicaInteractor] Page reload failed:', reloadErr.message);
                }
            }

            // DOM Doctor: try to heal selector and retry
            if (retryCount === 0 && this.doctor) {
                console.warn(`[MonicaInteractor] Error: ${e.message}, attempting DOM Doctor heal...`);
                try {
                    const htmlSnippet = await withTimeout(this.page.evaluate(() => document.body.innerHTML.substring(0, 60000)));
                    const targetType = e.message.includes('input') ? 'input' : 'response';
                    const healed = await this.doctor.diagnose(htmlSnippet, targetType, SELECTOR_HINTS[targetType]);
                    if (healed) {
                        selectors[targetType] = healed;
                        console.log(`[MonicaInteractor] DOMDoctor healed ${targetType}: ${healed}`);
                        // 持久化治癒結果
                        try {
                            const selFile = path.resolve(__dirname, '../../monica_selectors.json');
                            const current = fs.existsSync(selFile) ? JSON.parse(fs.readFileSync(selFile, 'utf-8')) : {};
                            current[targetType] = healed;
                            current._healed = new Date().toISOString();
                            fs.writeFileSync(selFile, JSON.stringify(current, null, 2));
                        } catch (persistErr) { /* non-critical */ }
                        return this.interact(payload, selectors, isSystem, startTag, endTag, retryCount + 1);
                    }
                } catch (healErr) {
                    console.warn('[MonicaInteractor] DOMDoctor heal failed:', healErr.message);
                }
            }
            throw e;
        }
    }

    async _waitForReady() {
        const maxWait = TIMINGS.WAIT_FOR_READY || 15000;
        const start = Date.now();

        while (Date.now() - start < maxWait) {
            const isBusy = await withTimeout(this.page.evaluate(() => {
                // Check for loading/streaming indicators
                const loadingEl = document.querySelector(
                    '[class*="loading"], [class*="generating"], [class*="typing"], [aria-busy="true"]'
                );
                if (loadingEl && loadingEl.offsetHeight > 0) return true;

                // Check for stop button
                const buttons = document.querySelectorAll('button, [role="button"]');
                for (const btn of buttons) {
                    const text = (btn.innerText || '').toLowerCase();
                    if ((text.includes('stop') || text.includes('停止')) && btn.offsetHeight > 0) return true;
                }
                return false;
            })).catch(() => false);

            if (!isBusy) return;
            await delay(1000);
        }
        console.warn('[MonicaInteractor] Page still busy after 15s, proceeding anyway');
    }

    async _captureBaseline(responseSelector) {
        try {
            return await withTimeout(this.page.evaluate((sel) => {
                // Try multiple selector patterns
                const selectors = sel.split(',').map(s => s.trim());
                for (const s of selectors) {
                    const elements = document.querySelectorAll(s);
                    if (elements.length > 0) {
                        const last = elements[elements.length - 1];
                        return (last.innerText || '').substring(0, 5000);
                    }
                }
                return '';
            }, responseSelector));
        } catch (e) {
            return '';
        }
    }

    async _typeInput(inputSelector, text) {
        // Try direct selector first
        const typed = await withTimeout(this.page.evaluate((sel, txt) => {
            // Fallback chain for finding input
            const selectors = [
                sel,
                'textarea.ant-input',
                'textarea[placeholder="Ask me anything"]',
                'textarea',
                '[contenteditable="true"]',
                '[role="textbox"]',
            ];

            for (const s of selectors) {
                try {
                    const el = document.querySelector(s);
                    if (!el || el.offsetHeight === 0) continue;

                    el.focus();

                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        // For textarea: set value + dispatch events
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                            window.HTMLTextAreaElement.prototype, 'value'
                        )?.set || Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype, 'value'
                        )?.set;

                        if (nativeInputValueSetter) {
                            nativeInputValueSetter.call(el, txt);
                        } else {
                            el.value = txt;
                        }
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        // ContentEditable
                        el.innerText = txt;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    return true;
                } catch (e) { console.warn('[MonicaPageInteractor] Input typing failed:', e.message); }
            }
            return false;
        }, inputSelector, text));

        if (!typed) {
            throw new Error(`[MonicaInteractor] Could not type into input: ${inputSelector}`);
        }
    }

    async _send() {
        // 先偵測是否有可見的 send button
        const sendBtn = await withTimeout(this.page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="button"]');
            for (const btn of btns) {
                const t = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
                if ((t.includes('send') || t.includes('傳送') || t.includes('submit')) && btn.offsetHeight > 0) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }), 2000).catch(() => false);

        if (!sendBtn) {
            // 無 button → 用 Enter 送出
            await this.page.keyboard.press('Enter');
        }
        await delay(200);
    }
}

module.exports = MonicaPageInteractor;
