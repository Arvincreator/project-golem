// ============================================================
// 🔍 ResponseExtractor - 回應信封擷取與清理
// ============================================================
const { TIMINGS, LIMITS } = require('./constants');

class ResponseExtractor {
    /**
     * 在瀏覽器內等待 AI 回應信封完成
     * (此函式會傳入 page.evaluate 在瀏覽器上下文中執行)
     *
     * @param {import('playwright').Page} page - Playwright 頁面實例
     * @param {string} selector - 回應氣泡的 CSS Selector
     * @param {string} startTag - 信封開始標籤
     * @param {string} endTag - 信封結束標籤
     * @param {string} baseline - 發送前的基準文字 (用於排除舊回應)
     * @returns {Promise<{status: string, text: string}>}
     */
    static async waitForResponse(page, selector, startTag, endTag, baseline) {
        const stableComplete = LIMITS.STABLE_THRESHOLD_COMPLETE;
        const stableThinking = LIMITS.STABLE_THRESHOLD_THINKING;
        const pollInterval = TIMINGS.POLL_INTERVAL;
        const timeout = TIMINGS.TIMEOUT;

        return page.evaluate(
            async ({ sel, sTag, eTag, oldText, _stableComplete, _stableThinking, _pollInterval, _timeout }) => {
                return new Promise((resolve) => {
                    const startTime = Date.now();
                    let stableCount = 0;
                    let lastCheckText = "";

                    const check = () => {
                        const bubbles = document.querySelectorAll(sel);
                        if (bubbles.length === 0) { setTimeout(check, _pollInterval); return; }

                        let currentLastBubble = bubbles[bubbles.length - 1];
                        let container = currentLastBubble.closest('model-response') ||
                            currentLastBubble.closest('.markdown') ||
                            currentLastBubble.closest('.model-response-text') ||
                            currentLastBubble.parentElement ||
                            currentLastBubble;

                        const rawText = container.innerText || "";
                        const startIndex = rawText.indexOf(sTag);
                        const endIndex = rawText.indexOf(eTag);

                        // ✨ [條件 1：完美信封] 看到 END 標籤，瞬間打包回傳
                        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                            const content = rawText.substring(startIndex + sTag.length, endIndex).trim();
                            resolve({ status: 'ENVELOPE_COMPLETE', text: content });
                            return;
                        }

                        // 計算文字穩定度
                        if (rawText === lastCheckText) {
                            stableCount++;
                        } else {
                            stableCount = 0;
                        }
                        lastCheckText = rawText;

                        if (startIndex !== -1) {
                            // ✨ [條件 2：已經開始回答] 看到 BEGIN，但遲遲沒看到 END (AI 忘記寫)
                            // 只要畫面停頓超過 5 秒 (10 次檢查) 沒動靜，就強制截斷回傳，不等 30 秒！
                            if (stableCount > _stableComplete) {
                                const content = rawText.substring(startIndex + sTag.length).trim();
                                resolve({ status: 'ENVELOPE_TRUNCATED', text: content });
                                return;
                            }
                        } else if (rawText !== oldText && !rawText.includes('SYSTEM: Please WRAP')) {
                            // ✨ [條件 3：Thinking Mode] 還沒看到 BEGIN，可能在深思
                            // 給予最高 30 秒 (60 次檢查) 的容忍度，等它想完
                            if (stableCount > _stableThinking) {
                                resolve({ status: 'FALLBACK_DIFF', text: rawText });
                                return;
                            }
                        }

                        // 總超時時間上限 5 分鐘 (300,000 ms)
                        if (Date.now() - startTime > _timeout) {
                            resolve({ status: 'TIMEOUT', text: '' });
                            return;
                        }
                        setTimeout(check, _pollInterval);
                    };
                    check();
                });
            },
            {
                sel: selector,
                sTag: startTag,
                eTag: endTag,
                oldText: baseline,
                _stableComplete: stableComplete,
                _stableThinking: stableThinking,
                _pollInterval: pollInterval,
                _timeout: timeout
            }
        );
    }

    /**
     * 清理回應文字中的信封標籤和系統雜訊
     * @param {string} rawText - 原始回應文字
     * @param {string} startTag - 信封開始標籤
     * @param {string} endTag - 信封結束標籤
     * @returns {string} 清理後的文字
     */
    static cleanResponse(rawText, startTag, endTag) {
        return rawText
            .replace(startTag, '')
            .replace(endTag, '')
            .replace(/\[SYSTEM: Please WRAP.*?\]/, '')
            .trim();
    }
}

module.exports = ResponseExtractor;
