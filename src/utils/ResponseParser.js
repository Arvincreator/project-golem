// ============================================================
// ⚡ ResponseParser (JSON 解析器 - 寬鬆版 + 集中化 + 終極矯正 + 穿透思考模式)
// ============================================================
class ResponseParser {
    static _extractProtocolBlock(raw, tagName) {
        if (!raw || !tagName) return "";
        const text = String(raw);
        const escaped = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 只接受「行首」協議標頭，避免正文提到 [GOLEM_REPLY]/[GOLEM_ACTION] 被誤判
        const startRe = new RegExp(`(?:^|\\n)\\[${escaped}\\]\\s*`, 'i');
        const start = startRe.exec(text);
        if (!start) return "";
        const from = start.index + start[0].length;
        const rest = text.slice(from);
        const endRe = /\n\[(?:\/?GOLEM_(?:MEMORY|ACTION|REPLY))\]|\n\[\[?\s*END\s*:[^\]\n\r]+?\]?\]?/i;
        const end = endRe.exec(rest);
        return (end ? rest.slice(0, end.index) : rest).trim();
    }

    static sanitizeProtocolTags(text) {
        if (!text) return "";
        return String(text)
            // Envelope tags are internal routing markers. Strip both correct and commonly malformed variants.
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
            .replace(/(?:^|\n)\s*\[\/?GOLEM_(?:MEMORY|ACTION|REPLY)\]\s*(?=\n|$)/gi, '\n')
            .replace(/^\s*null\s*$/i, '')
            .trim();
    }

    static parse(raw) {
        const parsed = { memory: null, actions: [], reply: "" };

        if (!raw) return parsed;

        // ✨ [升級：穿透 Thinking Mode] 
        // 許多時候 AI 的回覆會混雜 "Assessing My Capabilities" 等系統提示音。
        // 我們改用更具彈性的獨立擷取方式，無視前面的廢話。

        // 1. 獨立擷取 MEMORY
        const memoryBlock = ResponseParser._extractProtocolBlock(raw, 'GOLEM_MEMORY');
        if (memoryBlock) {
            const content = ResponseParser.sanitizeProtocolTags(memoryBlock);
            if (content && content !== 'null' && content !== '(無)') {
                parsed.memory = content;
            }
        }

        // 2. 獨立擷取 ACTION，並執行終極矯正
        const actionBlock = ResponseParser._extractProtocolBlock(raw, 'GOLEM_ACTION');
        if (actionBlock) {
            // 暴力脫去所有 Markdown 外衣
            let jsonCandidate = actionBlock.replace(/```[a-zA-Z]*\s*/gi, '').replace(/```/g, '').trim();

            if (jsonCandidate && jsonCandidate !== 'null') {
                try {
                    const jsonObj = JSON.parse(jsonCandidate);
                    // 如果 AI 忘記寫陣列 []，自動幫它包起來
                    let steps = Array.isArray(jsonObj) ? jsonObj : (jsonObj.steps || [jsonObj]);

                    // ✨ [核心修復：Schema 幻覺矯正器]
                    steps = steps.map(act => {
                        if (!act) return act;

                        if (!act.action && act.parameters && act.parameters.command) {
                            act.action = 'command';
                            act.parameter = act.parameters.command;
                            console.log(`🔧 [Parser] 自動補齊缺漏 action: parameters.command -> command`);
                        }

                        // 矯正 action 名稱 (AI 常犯錯寫成 run_command)
                        if (act.action === 'run_command' || act.action === 'execute') {
                            act.action = 'command';
                        }

                        // 矯正 parameter 欄位 (AI 常犯錯把它藏在 params 裡面)
                        if (act.action === 'command' && !act.parameter && !act.cmd && !act.command) {
                            if (act.params && act.params.command) {
                                act.parameter = act.params.command;
                                console.log(`🔧 [Parser] 自動矯正幻覺欄位: params.command -> parameter`);
                            }
                        }
                        return act;
                    });

                    parsed.actions.push(...steps);
                } catch (e) {
                    // 如果 JSON 嚴重破裂，啟動絕地救援，嘗試用正則硬挖
                    const fallbackMatch = jsonCandidate.match(/\[\s*\{[\s\S]*\}\s*\]/) || jsonCandidate.match(/\{[\s\S]*\}/);
                    if (fallbackMatch) {
                        try {
                            const fixed = JSON.parse(fallbackMatch[0]);
                            let steps = Array.isArray(fixed) ? fixed : [fixed];

                            steps = steps.map(act => {
                                if (!act) return act;
                                if (!act.action && act.parameters && act.parameters.command) {
                                    act.action = 'command';
                                    act.parameter = act.parameters.command;
                                }
                                if (act.action === 'run_command' || act.action === 'execute') act.action = 'command';
                                if (act.action === 'command' && !act.parameter && !act.cmd && !act.command) {
                                    if (act.params && act.params.command) act.parameter = act.params.command;
                                }
                                return act;
                            });

                            parsed.actions.push(...steps);
                        } catch (err) {
                            console.error("Fallback 解析失敗:", err.message);
                        }
                    }

                    // ✨ [終極防線：正則暴力解析] 如果上面的標準與寬鬆 JSON 解析都失敗，
                    // 代表 AI 可能在 parameter 裡塞了未轉義的雙引號或換行符 (例如 echo "..." \n > file)
                    if (parsed.actions.length === 0) {
                        try {
                            const actionTypeMatch = jsonCandidate.match(/"action"\s*:\s*"([^"]+)"/i);
                            // 匹配 parameter 的內容，直到遇到 closing brace 為止
                            const parameterMatch = jsonCandidate.match(/"(?:parameter|cmd|command)"\s*:\s*"([\s\S]*?)"(?=\s*\n?\s*\}\s*(?:,|\]|$))/i);

                            if (actionTypeMatch && parameterMatch) {
                                let cleanParam = parameterMatch[1]
                                    .replace(/\\"/g, '"') // 先還原已被轉義的
                                    .replace(/"/g, '\\"'); // 再全部重新安全轉義
                                // 處理換行
                                cleanParam = cleanParam.replace(/\n/g, '\\n').replace(/\r/g, '');

                                const reconstructedJson = `[{"action": "${actionTypeMatch[1]}", "parameter": "${cleanParam}"}]`;
                                const fixed = JSON.parse(reconstructedJson);
                                parsed.actions.push(...fixed);
                                console.log('🔧 [Parser] 終極正則暴力解析成功！已挽救破碎的 JSON 行動指令。');
                            }
                        } catch (err) {
                            console.error("🔧 [Parser] 終極解析失敗:", err.message);
                        }
                    }
                }
            }
        }

        // 3. 獨立擷取 REPLY (✅ Fix: 遇到其他標籤或結尾時即停止，避免抓到 GOLEM_ACTION)
        const replyBlock = ResponseParser._extractProtocolBlock(raw, 'GOLEM_REPLY');
        if (replyBlock) {
            parsed.reply = ResponseParser.sanitizeProtocolTags(replyBlock);
        }

        // ✨ [防呆機制] 如果完全沒有抓到任何結構化標籤，就把整段文字 (過濾掉雜訊) 當作 Reply
        if (!parsed.memory && parsed.actions.length === 0 && !parsed.reply) {
            // 濾掉 Thinking Mode 常見的雜訊字眼
            let cleanRaw = raw
                .replace(/Assessing My Capabilities/gi, '')
                .replace(/Answer now/gi, '')
                .replace(/Gemini said/gi, '')
                .trim();
            cleanRaw = ResponseParser.sanitizeProtocolTags(cleanRaw);

            // 避免把空的字串傳給 Telegram 報錯
            if (cleanRaw) {
                parsed.reply = cleanRaw;
            } else {
                parsed.reply = "⚠️ 系統已接收回應，但內容為空或無法解析。";
            }
        }

        return parsed;
    }

    static extractJson(text) {
        if (!text) return [];
        try {
            const match = text.match(/```json([\s\S]*?)```/);
            if (match) return JSON.parse(match[1]).steps || JSON.parse(match[1]);
            const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) return JSON.parse(arrayMatch[0]);
        } catch (e) { console.error("解析 JSON 失敗:", e.message); }
        return [];
    }
}

module.exports = ResponseParser;
