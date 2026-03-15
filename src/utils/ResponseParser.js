// ============================================================
// ResponseParser v10.0 — XML-first + Legacy Bracket Fallback
// ============================================================
class ResponseParser {
    /**
     * Parse AI response — tries XML format first, falls back to legacy brackets
     * @param {string} raw - Raw AI response
     * @returns {{ memory, memoryConfidence, actions, actionLevel, reply, replyConfidence, replySources }}
     */
    static parse(raw) {
        const parsed = {
            memory: null,
            memoryConfidence: null,
            actions: [],
            actionLevel: 'L0',
            reply: '',
            replyConfidence: null,
            replySources: [],
        };

        if (!raw) return parsed;

        // ═══ Try XML parsing first ═══
        const hasXml = /<golem_turn[\s\S]*?>/.test(raw) || /<reply[\s\S]*?>/.test(raw);
        if (hasXml) {
            const xmlResult = ResponseParser._parseXml(raw);
            if (xmlResult.reply || xmlResult.memory || xmlResult.actions.length > 0) {
                return xmlResult;
            }
        }

        // ═══ Fall back to legacy bracket parsing ═══
        return ResponseParser._parseLegacyBrackets(raw);
    }

    /**
     * XML format parser
     */
    static _parseXml(raw) {
        const parsed = {
            memory: null,
            memoryConfidence: null,
            actions: [],
            actionLevel: 'L0',
            reply: '',
            replyConfidence: null,
            replySources: [],
        };

        // Extract content inside <golem_turn> if present
        const turnMatch = raw.match(/<golem_turn[^>]*>([\s\S]*?)<\/golem_turn>/i);
        const content = turnMatch ? turnMatch[1] : raw;

        // 1. Extract <memory>
        const memMatch = content.match(/<memory(?:\s+confidence="([^"]*)")?[^>]*>([\s\S]*?)<\/memory>/i);
        if (memMatch) {
            const memContent = memMatch[2].trim();
            if (memContent && memContent !== 'null' && memContent !== '(無)') {
                parsed.memory = memContent;
                parsed.memoryConfidence = memMatch[1] ? parseFloat(memMatch[1]) : null;
            }
        }

        // 2. Extract <action>
        const actMatch = content.match(/<action(?:\s+level="([^"]*)")?(?:\s+[^>]*)?>(([\s\S]*?))<\/action>/i);
        if (actMatch) {
            parsed.actionLevel = actMatch[1] || 'L0';
            const actionContent = actMatch[2];

            // Extract <step> elements
            const stepRegex = /<step\s+order="(\d+)"\s+type="([^"]*)"[^>]*>([\s\S]*?)<\/step>/gi;
            let stepMatch;
            while ((stepMatch = stepRegex.exec(actionContent)) !== null) {
                const stepType = stepMatch[2];
                const stepContent = stepMatch[3].trim();

                if (stepType === 'command') {
                    parsed.actions.push({ action: 'command', parameter: stepContent });
                } else if (stepType === 'skill' || stepType === 'multi_agent') {
                    try {
                        const obj = JSON.parse(stepContent);
                        parsed.actions.push(obj);
                    } catch {
                        parsed.actions.push({ action: stepType, parameter: stepContent });
                    }
                } else {
                    parsed.actions.push({ action: stepType, parameter: stepContent });
                }
            }

            // Fallback: try JSON inside action block if no steps found
            if (parsed.actions.length === 0) {
                let jsonCandidate = actionContent.replace(/```[a-zA-Z]*\s*/gi, '').replace(/```/g, '').trim();
                try {
                    const obj = JSON.parse(jsonCandidate);
                    const steps = Array.isArray(obj) ? obj : [obj];
                    parsed.actions.push(...ResponseParser._correctActions(steps));
                } catch { }
            }
        }

        // 3. Extract <reply>
        const replyMatch = content.match(/<reply(?:\s+[^>]*)?>(([\s\S]*?))<\/reply>/i);
        if (replyMatch) {
            parsed.reply = replyMatch[1].trim();

            // Extract attributes
            const confMatch = content.match(/<reply[^>]*\bconfidence="([^"]*)"/i);
            const srcMatch = content.match(/<reply[^>]*\bsources="([^"]*)"/i);
            parsed.replyConfidence = confMatch ? parseFloat(confMatch[1]) : null;
            if (srcMatch) {
                try {
                    parsed.replySources = JSON.parse(srcMatch[1]);
                } catch {
                    parsed.replySources = srcMatch[1].split(',').map(s => s.trim());
                }
            }
        }

        // Handle [INTERVENE] token
        if (raw.includes('[INTERVENE]') && parsed.reply) {
            parsed.reply = parsed.reply.replace(/\[INTERVENE\]/g, '').trim();
        }

        return parsed;
    }

    /**
     * Legacy bracket format parser (backward compatibility)
     */
    static _parseLegacyBrackets(raw) {
        const parsed = {
            memory: null,
            memoryConfidence: null,
            actions: [],
            actionLevel: 'L0',
            reply: '',
            replyConfidence: null,
            replySources: [],
        };

        // 1. Extract MEMORY
        const memoryMatch = raw.match(/\[GOLEM_MEMORY\]([\s\S]*?)(?:\[GOLEM_ACTION\]|\[GOLEM_REPLY\]|$)/i);
        if (memoryMatch && memoryMatch[1]) {
            const content = memoryMatch[1].trim();
            if (content && content !== 'null' && content !== '(無)') {
                parsed.memory = content;
            }
        }

        // 2. Extract ACTION with correction
        const actionMatch = raw.match(/\[GOLEM_ACTION\]([\s\S]*?)(?:\[GOLEM_REPLY\]|$)/i);
        if (actionMatch && actionMatch[1]) {
            let jsonCandidate = actionMatch[1].replace(/```[a-zA-Z]*\s*/gi, '').replace(/```/g, '').trim();

            if (jsonCandidate && jsonCandidate !== 'null') {
                try {
                    const jsonObj = JSON.parse(jsonCandidate);
                    let steps = Array.isArray(jsonObj) ? jsonObj : (jsonObj.steps || [jsonObj]);
                    parsed.actions.push(...ResponseParser._correctActions(steps));
                } catch (e) {
                    // Fallback: regex extraction
                    const fallbackMatch = jsonCandidate.match(/\[\s*\{[\s\S]*\}\s*\]/) || jsonCandidate.match(/\{[\s\S]*\}/);
                    if (fallbackMatch) {
                        try {
                            const fixed = JSON.parse(fallbackMatch[0]);
                            let steps = Array.isArray(fixed) ? fixed : [fixed];
                            parsed.actions.push(...ResponseParser._correctActions(steps));
                        } catch { }
                    }

                    // Ultimate fallback: regex field extraction
                    if (parsed.actions.length === 0) {
                        try {
                            const actionTypeMatch = jsonCandidate.match(/"action"\s*:\s*"([^"]+)"/i);
                            const parameterMatch = jsonCandidate.match(/"(?:parameter|cmd|command)"\s*:\s*"([\s\S]*?)"(?=\s*\n?\s*\}\s*(?:,|\]|$))/i);
                            if (actionTypeMatch && parameterMatch) {
                                let cleanParam = parameterMatch[1]
                                    .replace(/\\"/g, '"')
                                    .replace(/"/g, '\\"')
                                    .replace(/\n/g, '\\n')
                                    .replace(/\r/g, '');
                                const reconstructed = `[{"action": "${actionTypeMatch[1]}", "parameter": "${cleanParam}"}]`;
                                parsed.actions.push(...JSON.parse(reconstructed));
                            }
                        } catch { }
                    }
                }
            }
        }

        // 3. Extract REPLY
        const replyMatch = raw.match(/\[GOLEM_REPLY\]([\s\S]*?)(?:\[\/?GOLEM_[A-Z]+\]|$)/i);
        if (replyMatch && replyMatch[1]) {
            parsed.reply = replyMatch[1].trim();
        }

        // Handle [INTERVENE]
        if (raw.includes('[INTERVENE]') && parsed.reply) {
            parsed.reply = parsed.reply.replace(/\[INTERVENE\]/g, '').trim();
        }

        // Fallback: if no structured tags found, treat entire text as reply
        if (!parsed.memory && parsed.actions.length === 0 && !parsed.reply) {
            let cleanRaw = raw
                .replace(/Assessing My Capabilities/gi, '')
                .replace(/Answer now/gi, '')
                .replace(/Gemini said/gi, '')
                .replace(/\[\[BEGIN:[^\]]*\]\]/g, '')
                .replace(/\[\[END:[^\]]*\]\]/g, '')
                .trim();

            parsed.reply = cleanRaw || '';
        }

        return parsed;
    }

    /**
     * Correct common AI hallucinations in action schemas
     */
    static _correctActions(steps) {
        return steps.map(act => {
            if (!act) return act;
            // Correct action name
            if (act.action === 'run_command' || act.action === 'execute') {
                act.action = 'command';
            }
            // Correct parameter field
            if (act.action === 'command' && !act.parameter && !act.cmd && !act.command) {
                if (act.params && act.params.command) {
                    act.parameter = act.params.command;
                }
            }
            return act;
        }).filter(Boolean);
    }

    static extractJson(text) {
        if (!text) return [];
        try {
            const match = text.match(/```json([\s\S]*?)```/);
            if (match) return JSON.parse(match[1]).steps || JSON.parse(match[1]);
            const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) return JSON.parse(arrayMatch[0]);
        } catch (e) { }
        return [];
    }
}

module.exports = ResponseParser;
