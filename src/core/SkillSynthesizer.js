// ============================================================
// SkillSynthesizer — Voyager-style Auto Skill Creation
// Detects repeated patterns from SelfEvolution → generates skills
// Safety: DANGEROUS_PATTERNS check + dry-run + rollback
// ============================================================
const fs = require('fs');
const path = require('path');

const DANGEROUS_PATTERNS = [
    /process\.exit/i,
    /require\s*\(\s*['"]child_process/i,
    /exec\s*\(/i,
    /spawn\s*\(/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /rm\s+-rf/i,
    /unlink.*\//i,
    /writeFile.*\/(etc|usr|bin|sys)/i,
    /\.env/i,
    /password|secret|token|api.?key/i,
];

const SYNTHESIS_COOLDOWN_MS = 3600000; // 1 hour
const MAX_SKILL_CODE_LENGTH = 2000;

class SkillSynthesizer {
    constructor(options = {}) {
        this.brain = options.brain || null;
        this.golemId = options.golemId || 'default';
        this.skillIndex = options.skillIndex || null;
        this.experienceReplay = options.experienceReplay || null;
        this._lastSynthesisTime = 0;
        this._synthesizedSkills = [];
        this._skillDir = path.join(process.cwd(), 'golem_memory', 'synthesized_skills');
    }

    /**
     * Synthesize a new skill from a detected repeated pattern
     * @param {{ pattern, occurrences, steps }} patternInfo - From SelfEvolution.trackSequence
     * @returns {{ success, skillName, error }}
     */
    async synthesize(patternInfo) {
        // Cooldown check
        const now = Date.now();
        if (now - this._lastSynthesisTime < SYNTHESIS_COOLDOWN_MS) {
            const remaining = Math.round((SYNTHESIS_COOLDOWN_MS - (now - this._lastSynthesisTime)) / 60000);
            return { success: false, error: `Cooldown active (${remaining}min remaining)` };
        }

        if (!this.brain) {
            return { success: false, error: 'No brain available for synthesis' };
        }

        const { pattern, occurrences, steps } = patternInfo;
        if (!steps || steps.length < 2) {
            return { success: false, error: 'Insufficient steps for synthesis' };
        }

        console.log(`[SkillSynthesizer] Synthesizing skill from pattern (${occurrences} occurrences): ${pattern.substring(0, 80)}`);

        try {
            // 1. Ask brain to generate skill code
            const skillCode = await this._generateSkillCode(pattern, steps);
            if (!skillCode) {
                return { success: false, error: 'Brain failed to generate skill code' };
            }

            // 2. Safety validation
            const safetyResult = this._validateSafety(skillCode);
            if (!safetyResult.safe) {
                console.warn(`[SkillSynthesizer] Skill rejected: ${safetyResult.reason}`);
                return { success: false, error: `Safety check failed: ${safetyResult.reason}` };
            }

            // 3. Extract skill name
            const skillName = this._extractSkillName(skillCode, pattern);

            // 4. Dry-run validation
            const dryRun = this._dryRunValidate(skillCode);
            if (!dryRun.valid) {
                return { success: false, error: `Dry-run failed: ${dryRun.error}` };
            }

            // 5. Save skill
            const saved = this._saveSkill(skillName, skillCode, patternInfo);
            if (!saved) {
                return { success: false, error: 'Failed to save skill' };
            }

            // 6. Record success
            this._lastSynthesisTime = now;
            this._synthesizedSkills.push({
                name: skillName,
                pattern: pattern.substring(0, 100),
                timestamp: now,
            });

            if (this.experienceReplay) {
                this.experienceReplay.recordTrace({
                    goal: `Synthesize skill: ${skillName}`,
                    action: 'skill_synthesis',
                    result: 'success',
                    success: true,
                    reward: 1.0,
                });
            }

            console.log(`[SkillSynthesizer] Successfully synthesized skill: ${skillName}`);
            return { success: true, skillName };

        } catch (e) {
            console.error(`[SkillSynthesizer] Synthesis failed:`, e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Generate skill code via brain (1 LLM call)
     */
    async _generateSkillCode(pattern, steps) {
        const stepsDesc = steps.map((s, i) => `${i + 1}. ${s.action || s.description || s}`).join('\n');

        const prompt = `【系統指令: 技能合成】
你是一個技能合成引擎。以下是一個被重複執行的操作模式：

模式: ${pattern.substring(0, 200)}
步驟:
${stepsDesc}

請將此模式封裝為一個可重用的 Node.js 技能模組。

規則:
- 使用 module.exports 匯出
- 匯出物件必須包含: name, description, execute(ctx, args)
- execute 必須是 async function
- 禁止使用 child_process, eval, exec, spawn
- 禁止存取環境變數或檔案系統中的敏感路徑
- 程式碼不超過 50 行

回覆純 JavaScript 程式碼（不要 markdown 包裹）：`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            // Extract code (strip markdown fences if present)
            let code = raw;
            const codeMatch = raw.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
            if (codeMatch) {
                code = codeMatch[1];
            }
            code = code.trim();

            if (code.length > MAX_SKILL_CODE_LENGTH) {
                console.warn('[SkillSynthesizer] Generated code too long, truncating');
                return null;
            }

            if (!code.includes('module.exports') && !code.includes('exports.')) {
                return null;
            }

            return code;
        } catch (e) {
            console.warn('[SkillSynthesizer] Code generation failed:', e.message);
            return null;
        }
    }

    /**
     * Validate skill code for dangerous patterns
     * v9.5 VULN-1: Uses CodeSafetyValidator (acorn AST) instead of regex
     */
    _validateSafety(code) {
        // Code length check first (fast path)
        if (code.length > MAX_SKILL_CODE_LENGTH) {
            return { safe: false, reason: 'Code too long' };
        }

        // Check for network access (still regex — not an AST concern)
        if (/fetch\s*\(|http\.request|https\.request|axios|got\(/i.test(code)) {
            return { safe: false, reason: 'Network access not allowed in synthesized skills' };
        }

        // AST-based validation
        try {
            const CodeSafetyValidator = require('../utils/CodeSafetyValidator');
            return CodeSafetyValidator.validate(code);
        } catch (e) {
            // Fallback to legacy regex if CodeSafetyValidator not available
            for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(code)) {
                    return { safe: false, reason: `Matched dangerous pattern: ${pattern.source}` };
                }
            }
            return { safe: true };
        }
    }

    /**
     * Dry-run: syntax check without execution
     * v9.5 VULN-1: Uses acorn.parse instead of new Function()
     */
    _dryRunValidate(code) {
        try {
            const CodeSafetyValidator = require('../utils/CodeSafetyValidator');
            return CodeSafetyValidator.syntaxCheck(code);
        } catch (e) {
            // Fallback: use acorn directly if CodeSafetyValidator wrapper not available
            try {
                const acorn = require('acorn');
                acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
                return { valid: true };
            } catch (err) {
                return { valid: false, error: err.message };
            }
        }
    }

    /**
     * Extract a skill name from code or pattern
     */
    _extractSkillName(code, pattern) {
        // Try to extract from code
        const nameMatch = code.match(/name:\s*['"]([^'"]+)['"]/);
        if (nameMatch) return nameMatch[1].replace(/\s+/g, '_').toLowerCase();

        // Derive from pattern
        const words = pattern.split(/[→\s:]+/).filter(w => w.length > 2).slice(0, 3);
        return `auto_${words.join('_').toLowerCase()}_${Date.now() % 10000}`;
    }

    /**
     * Save skill to disk
     */
    _saveSkill(skillName, code, patternInfo) {
        try {
            if (!fs.existsSync(this._skillDir)) {
                fs.mkdirSync(this._skillDir, { recursive: true });
            }

            const filename = `${skillName}.js`;
            const filepath = path.join(this._skillDir, filename);

            const header = `// Auto-synthesized skill by SkillSynthesizer
// Pattern: ${patternInfo.pattern.substring(0, 80)}
// Occurrences: ${patternInfo.occurrences}
// Created: ${new Date().toISOString()}
`;
            fs.writeFileSync(filepath, header + code);

            // D4: Register in skill index
            if (this.skillIndex && typeof this.skillIndex.addSkill === 'function') {
                try { this.skillIndex.addSkill(skillName); } catch (e) { /* non-critical */ }
            }

            console.log(`[SkillSynthesizer] Saved skill to ${filepath}`);
            return true;
        } catch (e) {
            console.warn('[SkillSynthesizer] Save failed:', e.message);
            return false;
        }
    }

    /**
     * Rollback: remove a synthesized skill
     */
    rollback(skillName) {
        try {
            const filepath = path.join(this._skillDir, `${skillName}.js`);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
                this._synthesizedSkills = this._synthesizedSkills.filter(s => s.name !== skillName);
                console.log(`[SkillSynthesizer] Rolled back skill: ${skillName}`);
                return true;
            }
        } catch (e) {
            console.warn('[SkillSynthesizer] Rollback failed:', e.message);
        }
        return false;
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            synthesizedCount: this._synthesizedSkills.length,
            lastSynthesis: this._lastSynthesisTime > 0 ? new Date(this._lastSynthesisTime).toISOString() : null,
            cooldownActive: Date.now() - this._lastSynthesisTime < SYNTHESIS_COOLDOWN_MS,
            skills: this._synthesizedSkills.map(s => s.name),
        };
    }
}

module.exports = SkillSynthesizer;
