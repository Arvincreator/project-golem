// ============================================================
// 🔍 ResponseExtractor - 回應信封擷取與清理
// ============================================================
const { TIMINGS, LIMITS } = require('../../src/core/constants');

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
     * @param {{timeoutMs?: number}} [options]
     * @returns {Promise<{status: string, text: string, attachments?: Array}>}
     */
    static async waitForResponse(page, selector, startTag, endTag, baseline, options = {}) {
        const stableComplete = LIMITS.STABLE_THRESHOLD_COMPLETE;
        const stableThinking = LIMITS.STABLE_THRESHOLD_THINKING;
        const pollInterval = TIMINGS.POLL_INTERVAL;
        const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : TIMINGS.TIMEOUT;
        const graceMultiplier = Number.isFinite(Number(options.stableGraceMultiplier)) && Number(options.stableGraceMultiplier) > 0
            ? Number(options.stableGraceMultiplier)
            : 1.5;
        const stableThinkingThreshold = Math.max(stableThinking, Math.ceil(stableThinking * graceMultiplier));

        return page.evaluate(
            async ({ sel, sTag, eTag, oldText, _stableComplete, _stableThinking, _pollInterval, _timeout }) => {
                return new Promise((resolve) => {
                    const startTime = Date.now();
                    let stableCount = 0;
                    let lastCheckText = "";
                    let lastResponseText = "";
                    let lastAttachments = [];

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
                        lastResponseText = rawText;
                        const startIndex = rawText.indexOf(sTag);
                        const endIndex = rawText.indexOf(eTag);

                        // 📸 [v9.1.10] 提取容器內的圖片與其他附件
                        const attachments = [];
                        
                        // 1. 圖片偵測 (濾除天氣/UI 圖示等 svg 雜訊)
                        container.querySelectorAll('img').forEach(img => {
                            if (img.src && img.src.startsWith('http')) {
                                if (img.src.toLowerCase().includes('.svg')) return;
                                attachments.push({ url: img.src, mimeType: 'image/png' });
                            }
                        });

                        // 2. 連結/下載偵測 (例如生成的檔案、PDF 等)
                        container.querySelectorAll('a').forEach(a => {
                            // 排除常見導覽連結，僅抓取看起來像是下載或附件的內容
                            const href = a.href || "";
                            if (!href || !href.startsWith('http')) return;
                            
                            const isDownload = a.hasAttribute('download');
                            const hasFileExt = /\.(pdf|docx|xlsx|txt|zip|md|js|py)$/i.test(href);
                            const isGoogleContent = href.includes('googleusercontent.com') || href.includes('blob:');
                            
                            if (isDownload || hasFileExt || isGoogleContent) {
                                // 嘗試推斷 MIME Type
                                let mime = 'application/octet-stream';
                                if (href.endsWith('.pdf')) mime = 'application/pdf';
                                else if (href.endsWith('.md')) mime = 'text/markdown';
                                else if (href.endsWith('.txt')) mime = 'text/plain';
                                
                                attachments.push({ url: href, mimeType: mime });
                            }
                        });
                        lastAttachments = attachments;

                        // ✨ [條件 1：完美信封] 看到 END 標籤，瞬間打包回傳
                        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                            const content = rawText.substring(startIndex + sTag.length, endIndex).trim();
                            resolve({ 
                                status: 'ENVELOPE_COMPLETE', 
                                text: content,
                                attachments: attachments
                            });
                            return;
                        }

                        // 計算文字穩定度
                        if (rawText === lastCheckText) {
                            stableCount++;
                        } else {
                            stableCount = 0;
                        }
                        lastCheckText = rawText;

                        // 嘗試判斷目前是否仍在生成（避免慢回應被誤判截斷）
                        const pageText = document.body ? (document.body.innerText || '') : '';
                        const isLikelyGenerating =
                            /(?:thinking|generating|processing|停止|停止生成|Stop generating|Continue generating)/i.test(pageText) ||
                            !!document.querySelector('button[aria-label*=\"Stop\" i], button[aria-label*=\"停止\" i], [data-testid*=\"stop\" i]');

                        if (startIndex !== -1) {
                            // ✨ [條件 2：已經開始回答] 看到 BEGIN，但遲遲沒看到 END (AI 忘記寫)
                            // 只要畫面停頓超過 5 秒 (10 次檢查) 沒動靜，就強制截斷回傳，不等 30 秒！
                            if (stableCount > _stableComplete) {
                                const content = rawText.substring(startIndex + sTag.length).trim();
                                resolve({ 
                                    status: 'ENVELOPE_TRUNCATED', 
                                    text: content,
                                    attachments: attachments
                                });
                                return;
                            }
                        } else if (rawText !== oldText) {
                            // ✨ [條件 3：Thinking Mode] 還沒看到 BEGIN，可能在深思
                            // 若偵測仍在生成，延長容忍，避免慢回應被誤截斷
                            if (stableCount > _stableThinking && !isLikelyGenerating) {
                                resolve({ 
                                    status: 'FALLBACK_DIFF', 
                                    text: rawText,
                                    attachments: attachments
                                });
                                return;
                            }
                        }

                        // 總超時時間上限，預設 5 分鐘，可由特定呼叫延長。
                        if (Date.now() - startTime > _timeout) {
                            resolve({
                                status: 'TIMEOUT',
                                text: lastResponseText,
                                attachments: lastAttachments
                            });
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
                _stableThinking: stableThinkingThreshold,
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
            .replace(/\[{1,2}\s*(?:BEGIN|END)\s*:[^\]\n\r]+?\]{1,2}/gi, '')
            .replace(/\[\s*BEGIN\s*:[^\]\n\r]+?\]\]/gi, '')
            .replace(/\[\s*END\s*:[^\]\n\r]+?\]\]/gi, '')
            .replace(/\[\[\s*BEGIN\s*:[^\]\n\r]+?\]\]/gi, '')
            .replace(/\[\[\s*END\s*:[^\]\n\r]+?\]\]/gi, '')
            .replace(/\[\s*BEGIN\s*:[^\]\n\r]+?\]/gi, '')
            .replace(/\[\s*END\s*:[^\]\n\r]+?\]/gi, '')
            .replace(/\[\[\s*BEGIN\s*:[^\]\n\r]+?\]/gi, '')
            .replace(/\[\[\s*END\s*:[^\]\n\r]+?\]/gi, '')
            .replace(/\[\s*BEGIN\s*:[^\]\n\r]+?\]\]/gi, '')
            .replace(/\[\s*END\s*:[^\]\n\r]+?\]\]/gi, '')
            .replace(/\[SYSTEM: Please WRAP.*?\]/, '')
            .trim();
    }
}

module.exports = ResponseExtractor;
