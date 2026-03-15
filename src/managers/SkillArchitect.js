// File: lib/skill-architect.js
const fs = require('fs');
const path = require('path');

class SkillArchitect {
    constructor(skillsDir) {
        this.skillsDir = skillsDir || path.join(process.cwd(), 'src', 'skills', 'user');
    }

    /**
     * 使用 Web Gemini (Brain) 生成技能
     * @param {Object} brain - GolemBrain 實例 (必須包含 sendMessage 方法)
     * @param {string} intent - 使用者需求
     * @param {Array} existingSkills - 現有技能列表
     */
    async designSkill(brain, intent, existingSkills = []) {
        // 確保目錄在實際需要時才建立
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }

        console.log(`🏗️ Architect (Web): Designing skill for "${intent}"...`);

        // 1. 建構 System Prompt (針對 Web Gemini 的強指令)
        // 使用特殊的標籤 [SKILL_GEN_START] 來確保我們能從網頁的閒聊中提取出代碼
        const systemPrompt = `
        [SYSTEM: ACTIVATE SKILL ARCHITECT MODE]
        
        [SYSTEM: DEVELOPER MODE - Code Generation Only]
        You are now an expert Node.js Developer creating a plugin for the Golem System.
        
        USER REQUEST: "${intent}"
        
        ### CONTEXT
        - Environment: Node.js + Puppeteer
        - Input: 'run' function receives (ctx, args)
        - CTX: { page, browser, log, io, metadata }
        - Existing Skills: ${existingSkills.map(s => s.name).join(', ')}
        
        ### STRICT OUTPUT REQUIREMENT
        You MUST output the result inside a JSON block wrapped in specific tags.
        Do NOT wrap it in Markdown code blocks (like \`\`\`json). Just the raw tags.
        
        Format:
        [[SKILL_JSON_START]]
        {
            "filename": "skill-name.js",
            "name": "SKILL_NAME",
            "description": "Short description",
            "tags": ["#user-generated", "#v9"],
            "code": "module.exports = { ... full js code ... }"
        }
        [[SKILL_JSON_END]]

        ### CODE RULES
        1. Use 'ctx.log.info()' not console.log.
        2. Wrap logic in try/catch.
        3. If using puppeteer, assume 'ctx.page' is active.
        4. Return a string message at the end of execution.
        `;

        try {
            // 2. 透過 Web Gemini 發送訊息
            // 注意：我們假設 brain.sendMessage 會處理三明治協定，我們只需要內容
            const rawResponse = await brain.sendMessage(systemPrompt);

            console.log(`🏗️ Architect: Received response from Web Gemini (${rawResponse.length} chars)`);

            // 3. 解析回應 (尋找 [[SKILL_JSON_START]])
            const jsonMatch = rawResponse.match(/\[\[SKILL_JSON_START\]\]([\s\S]*?)\[\[SKILL_JSON_END\]\]/);

            let skillData;
            if (jsonMatch && jsonMatch[1]) {
                try {
                    skillData = JSON.parse(jsonMatch[1].trim());
                } catch (e) {
                    // 嘗試修復常見的 JSON 錯誤 (例如不必要的換行或註解)
                    console.warn("⚠️ JSON Parse Warning, trying fallback cleanup...");
                    const cleanJson = jsonMatch[1].trim().replace(/,\s*}/g, '}'); // 移除尾隨逗號
                    skillData = JSON.parse(cleanJson);
                }
            } else {
                // Fallback: 嘗試直接尋找 JSON 結構
                const fallbackMatch = rawResponse.match(/\{[\s\S]*"filename"[\s\S]*"code"[\s\S]*\}/);
                if (fallbackMatch) {
                    skillData = JSON.parse(fallbackMatch[0]);
                } else {
                    throw new Error("Could not extract JSON from Web Gemini response.");
                }
            }

            // 4. 安全掃描 + 驗證與存檔
            if (!skillData.filename || !skillData.code) {
                throw new Error("Invalid generation: Missing filename or code.");
            }

            // 修正檔名 (強制 .js)
            if (!skillData.filename.endsWith('.js')) skillData.filename += '.js';

            const filePath = path.join(this.skillsDir, skillData.filename);

            // 防止意外覆蓋
            if (fs.existsSync(filePath)) {
                skillData.filename = skillData.filename.replace('.js', `-${Date.now()}.js`);
            }

            const finalPath = path.join(this.skillsDir, skillData.filename);
            fs.writeFileSync(finalPath, skillData.code);

            return {
                success: true,
                path: finalPath,
                name: skillData.name,
                preview: skillData.description
            };

        } catch (error) {
            console.error("❌ Architect Error:", error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = SkillArchitect;
