// File: lib/skill-architect.js
const fs = require('fs');
const path = require('path');
const SkillPackageRegistry = require('./SkillPackageRegistry');
const REFERENCE_FETCH_TIMEOUT_MS = 8000;
const REFERENCE_FETCH_MAX_CHARS = 6000;

class SkillArchitect {
    constructor(skillsDir) {
        this.skillsDir = skillsDir || null;
    }

    /**
     * 使用 Web Gemini (Brain) 生成技能
     * @param {Object} brain - GolemBrain 實例 (必須包含 sendMessage 方法)
     * @param {string} intent - 使用者需求
     * @param {Array} existingSkills - 現有技能列表
     */
    async designSkill(brain, intent, existingSkills = [], options = {}) {
        console.log(`🏗️ Architect (Web): Designing skill for "${intent}"...`);
        const normalizedIntent = this._normalizeIntent(String(intent || ''));
        const referenceDigests = await this._fetchReferenceDigests(normalizedIntent.references);
        const repairFeedback = String(options.repairFeedback || '').trim();

        // 1. 建構 System Prompt
        // 使用「雙標籤分離格式」：metadata 用 JSON，code 獨立用 [[SKILL_CODE_*]] 包住。
        // 這樣無論 JS 內含任何特殊字元，都永遠不會破壞 JSON 解析。
        const systemPrompt = `
        [SYSTEM: ACTIVATE SKILL ARCHITECT MODE - Code Generation Only]
        You are an expert Node.js Developer creating a plugin for the Golem System.

        USER REQUEST: "${normalizedIntent.coreIntent}"
        REFERENCE LINKS (for analysis only, do not copy external platform format):
        ${normalizedIntent.references.length > 0 ? normalizedIntent.references.map((u, i) => `${i + 1}. ${u}`).join('\n') : '(none)'}
        REFERENCE DIGESTS:
        ${this._buildReferenceDigestText(referenceDigests)}
        ${repairFeedback ? `\nPREVIOUS ATTEMPT ISSUES (must fix all):\n${repairFeedback}\n` : ''}

        ### CONTEXT
        - Environment: Node.js (no browser needed unless stated)
        - The skill exports: module.exports = { name, description, tags, run }
        - Runtime call signature is run(ctx), and args are provided at ctx.args
        - Existing Skills: ${existingSkills.map(s => s.name).join(', ')}

        ### STRICT OUTPUT FORMAT (follow exactly, no markdown fences)

        [[SKILL_JSON_START]]
        {
            "filename": "skill-name.js",
            "name": "SKILL_NAME",
            "description": "Short description"
        }
        [[SKILL_JSON_END]]
        [[SKILL_CODE_START]]
        module.exports = {
            name: 'SKILL_NAME',
            description: 'Short description',
            tags: ['#user-generated'],
            async run(ctx = {}) {
                const args = (ctx && ctx.args) || {};
                // your implementation here
                return 'result message';
            }
        };
        [[SKILL_CODE_END]]

        ### CODE RULES
        1. Use ctx.log.info() not console.log.
        2. Wrap async logic in try/catch.
        3. Return a clear string message.
        4. Do NOT use child_process, eval, or new Function.
        5. Never output markdown link syntax inside JS code. URL must be plain string/template string.
        6. If task needs external API, ensure URL is valid JavaScript template literal.
        `;

        try {
            // 2. 透過 Brain 發送訊息
            // brain.sendMessage 回傳 { text, attachments }，需解構出 .text
            const brainResult = await brain.sendMessage(systemPrompt);
            const rawResponse = (brainResult && typeof brainResult === 'object')
                ? (brainResult.text || '')
                : String(brainResult || '');

            console.log(`🏗️ Architect: Received response from Web Gemini (${rawResponse.length} chars)`);

            if (!rawResponse) {
                throw new Error('Brain returned an empty response.');
            }

            // 3. 解析回應
            // 優先使用新格式 (雙標籤分離)，fallback 舊格式 (code 嵌在 JSON 內)
            let skillData;

            const jsonMatch = rawResponse.match(/\[\[SKILL_JSON_START\]\]([\s\S]*?)\[\[SKILL_JSON_END\]\]/);
            const codeBlockMatch = rawResponse.match(/\[\[SKILL_CODE_START\]\]([\s\S]*?)\[\[SKILL_CODE_END\]\]/);

            if (jsonMatch && jsonMatch[1] && codeBlockMatch && codeBlockMatch[1]) {
                // ✅ 新格式：JSON metadata + 獨立 code 區塊 (永不爆炸的解析方式)
                try {
                    const metaBlock = this._extractFirstJsonObject(jsonMatch[1].trim());
                    const meta = JSON.parse(metaBlock);
                    skillData = {
                        filename: meta.filename,
                        name: meta.name,
                        description: meta.description,
                        tags: meta.tags || ['#user-generated'],
                        code: codeBlockMatch[1].trim(),
                    };
                } catch (e) {
                    throw new Error(`Failed to parse skill metadata JSON: ${e.message}`);
                }
            } else if (jsonMatch && jsonMatch[1]) {
                // ⚠️ Fallback：舊格式（code 嵌在 JSON 內），嘗試三層容錯解析
                console.warn('⚠️ Architect: Gemini used legacy format (code inside JSON), attempting fallback parse...');
                const rawBlock = jsonMatch[1].trim();

                // 【第一層】直接 parse
                let parsed = false;
                try {
                    const safeBlock = this._extractFirstJsonObject(rawBlock);
                    skillData = JSON.parse(safeBlock);
                    parsed = true;
                } catch (_) {}

                // 【第二層】修復尾隨逗號
                if (!parsed) {
                    try {
                        const safeBlock = this._extractFirstJsonObject(rawBlock).replace(/,(\s*[}\]])/g, '$1');
                        skillData = JSON.parse(safeBlock);
                        parsed = true;
                    } catch (_) {}
                }

                // 【第三層】逐欄位 regex 提取
                if (!parsed) {
                    const ex = (key) => {
                        const m = rawBlock.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`));
                        return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;
                    };
                    const exArr = (key) => {
                        const m = rawBlock.match(new RegExp(`"${key}"\\s*:\\s*(\\[[^\\]]*\\])`));
                        try { return m ? JSON.parse(m[1]) : []; } catch { return []; }
                    };
                    const cm = rawBlock.match(/"code"\s*:\s*"([\s\S]*)"\s*\}?\s*$/);
                    skillData = {
                        filename: ex('filename'),
                        name: ex('name'),
                        description: ex('description'),
                        tags: exArr('tags'),
                        code: cm ? cm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null,
                    };
                    if (!skillData.filename || !skillData.code) {
                        throw new Error('Could not extract skill data from Gemini response after all fallback attempts.');
                    }
                }
            } else {
                throw new Error('Could not find [[SKILL_JSON_START]] marker in Gemini response.');
            }


            // 4. 正規化程式碼 + 安全掃描 + 驗證與存檔
            if (!skillData.filename || !skillData.code) {
                throw new Error("Invalid generation: Missing filename or code.");
            }
            skillData.code = this._normalizeGeneratedCode(skillData.code);
            this._assertCodeQuality(skillData.code);

            // ✅ [H-4 Fix] 寫入磁碟前進行安全掃描，防止惡意 AI 注入危險代碼
            // 注意：使用精確詞彙邊界比對，避免 regex.exec()、str.exec() 等合法呼叫被誤判
            const DANGEROUS_PATTERNS = [
                // require('child_process') — 字串比對即可，無歧義
                /require\s*\(\s*['"]child_process['"]\s*\)/,
                // execSync / spawnSync — 整詞比對
                /\bexecSync\s*\(/,
                /\bspawnSync\s*\(/,
                // exec( / spawn( — 只攔截「非方法呼叫」形式 (前面不能是 . 或識別字)
                // 正確：exec('ls')   錯誤誤判：regex.exec('...')
                /(?<![.\w])exec\s*\(/,
                /(?<![.\w])spawn\s*\(/,
                // eval( / new Function( — 整詞比對
                /\beval\s*\(/,
                /\bnew\s+Function\s*\(/,
            ];
            if (DANGEROUS_PATTERNS.some(pattern => pattern.test(skillData.code))) {
                throw new Error("⚠️ Security: Generated skill contains restricted calls. Deployment blocked.");
            }

            // 修正檔名 (限制為安全字元 + 強制 .js)
            const safeBase = path.basename(String(skillData.filename))
                .replace(/[^a-z0-9._-]/gi, '_')
                .replace(/^\.+/, '');
            skillData.filename = safeBase.endsWith('.js') ? safeBase : `${safeBase}.js`;
            if (!skillData.filename || skillData.filename === '.js') {
                skillData.filename = `learned-skill-${Date.now()}.js`;
            }

            const skillId = SkillPackageRegistry.safeSkillId(
                path.basename(skillData.filename, '.js') || skillData.name,
                `learned-skill-${Date.now()}`
            );
            const packageRoot = this.skillsDir || SkillPackageRegistry.getUserSkillPackageDir(brain && brain.userDataDir);
            if (!fs.existsSync(packageRoot)) {
                fs.mkdirSync(packageRoot, { recursive: true });
            }
            let packageDir = path.join(packageRoot, skillId);

            // 防止意外覆蓋
            if (fs.existsSync(packageDir)) {
                packageDir = path.join(packageRoot, `${skillId}-${Date.now()}`);
            }

            fs.mkdirSync(packageDir, { recursive: true });
            const finalPath = path.join(packageDir, 'index.js');
            const promptPath = path.join(packageDir, 'skill.md');
            const manifestPath = path.join(packageDir, 'manifest.json');
            const runtimeDescription = skillData.description || '由 /learn 動態生成的使用者技能';

            fs.writeFileSync(finalPath, skillData.code);
            fs.writeFileSync(promptPath, [
                `# ${skillData.name || skillId}`,
                '',
                runtimeDescription,
                '',
                '## Runtime Action',
                `- action: \`${skillId}\``,
                '',
                '## Examples',
                '```json',
                JSON.stringify({ action: skillId, args: { asset: 'bitcoin' } }),
                '```',
                '',
                '## Usage Guidance',
                `當使用者需求符合「${normalizedIntent.coreIntent}」時，優先使用此技能。`
            ].join('\n'), 'utf8');
            fs.writeFileSync(manifestPath, JSON.stringify({
                id: path.basename(packageDir).toLowerCase(),
                name: skillData.name || skillId,
                description: runtimeDescription,
                type: 'user_generated',
                enabled: true,
                action: path.basename(packageDir).toLowerCase(),
                entry: 'index.js',
                prompt: 'skill.md',
                toolsets: ['assistant'],
                triggers: [normalizedIntent.coreIntent],
                createdBy: 'skill-architect',
                createdAt: new Date().toISOString(),
                version: '1.0.0'
            }, null, 2) + '\n', 'utf8');

            // 寫檔後強驗證：檔案存在 + 可 require + 必須有 run()
            if (!fs.existsSync(finalPath)) {
                throw new Error(`Skill script not found after write: ${finalPath}`);
            }
            const stat = fs.statSync(finalPath);
            if (!stat.isFile() || stat.size <= 0) {
                throw new Error(`Skill script is empty or invalid: ${finalPath}`);
            }
            delete require.cache[require.resolve(finalPath)];
            const loadedModule = require(finalPath);
            if (!loadedModule || typeof loadedModule.run !== 'function') {
                throw new Error('Generated skill script is not executable: missing run() export.');
            }

            return {
                success: true,
                path: finalPath,
                packagePath: packageDir,
                id: path.basename(packageDir).toLowerCase(),
                name: skillData.name,
                preview: skillData.description,
                code: skillData.code
            };

        } catch (error) {
            console.error("❌ Architect Error:", error);
            return { success: false, error: error.message };
        }
    }

    _normalizeGeneratedCode(rawCode) {
        let code = String(rawCode || '').trim();
        code = code
            .replace(/^```(?:javascript|js)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();

        if (!code.includes('module.exports')) {
            throw new Error('Generated code missing module.exports.');
        }

        // 修復常見 markdown link 汙染：
        // [https://api.xxx/$](https://api.xxx/$){symbol} -> https://api.xxx/${symbol}
        code = code.replace(
            /\[(https?:\/\/[^\]\s]+)\]\(\1\)\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
            (_m, url, varName) => `${url}\${${varName}}`
        );
        // [text](https://api.xxx/path) -> https://api.xxx/path
        code = code.replace(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g, '$1');

        // 相容舊輸出：run(ctx, args) -> run(ctx = {})，並保留 args 可用性
        code = code.replace(/async\s+run\s*\(\s*ctx\s*,\s*args\s*\)\s*\{/g, 'async run(ctx = {}) {');
        code = code.replace(/run\s*:\s*async\s*\(\s*ctx\s*,\s*args\s*\)\s*=>\s*\{/g, 'run: async (ctx = {}) => {');

        // 若 run 已改成只吃 ctx，且函式內沒建立 args，補上一行避免 ctx.args 遺漏
        const runHeadRe = /async\s+run\s*\(\s*ctx(?:\s*=\s*\{\s*\})?\s*\)\s*\{/;
        if (runHeadRe.test(code) && !/\bconst\s+args\s*=/.test(code) && !/\blet\s+args\s*=/.test(code)) {
            code = code.replace(runHeadRe, (match) => `${match}\n        const args = (ctx && ctx.args) || {};`);
        }

        return code;
    }

    _assertCodeQuality(code) {
        const src = String(code || '');
        const issues = [];

        if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(src)) {
            issues.push('markdown_link_notation_detected_in_code');
        }
        if (/https?:\/\/[^\s"'`]*\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(src) && !/\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(src)) {
            issues.push('non_template_variable_placeholder_in_url');
        }
        if (!/async\s+run\s*\(/.test(src) && !/run\s*:\s*async\s*\(/.test(src)) {
            issues.push('missing_async_run_handler');
        }
        if (!/try\s*\{[\s\S]*\}\s*catch\s*\(/.test(src)) {
            issues.push('missing_try_catch');
        }
        if (!/return\s+['"`]/.test(src) && !/return\s+\w+/.test(src)) {
            issues.push('missing_return_statement');
        }

        if (issues.length > 0) {
            throw new Error(`Generated code quality check failed: ${issues.join(', ')}`);
        }
    }

    _normalizeIntent(rawIntent) {
        const raw = String(rawIntent || '').trim();
        if (!raw) return { coreIntent: '建立一個可用技能', references: [] };

        const refs = Array.from(new Set((raw.match(/https?:\/\/[^\s)]+/g) || []).map((s) => s.trim())));
        const core = raw
            .replace(/參考連結[\s\S]*$/i, '')
            .replace(/https?:\/\/[^\s)]+/g, '')
            .replace(/\n{2,}/g, '\n')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return {
            coreIntent: core || '建立一個可用技能',
            references: refs
        };
    }

    async _fetchReferenceDigests(urls = []) {
        const list = Array.isArray(urls) ? urls : [];
        const results = [];
        for (const url of list.slice(0, 3)) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), REFERENCE_FETCH_TIMEOUT_MS);
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'user-agent': 'Project-Golem SkillArchitect/1.0' },
                    signal: controller.signal
                });
                clearTimeout(timer);
                const text = await res.text();
                const body = String(text || '').slice(0, REFERENCE_FETCH_MAX_CHARS);
                results.push({
                    url,
                    ok: res.ok,
                    status: res.status,
                    snippet: body
                        .replace(/\r/g, '')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim()
                });
            } catch (error) {
                results.push({
                    url,
                    ok: false,
                    status: 0,
                    snippet: `fetch_failed: ${error && error.message ? error.message : String(error)}`
                });
            }
        }
        return results;
    }

    _buildReferenceDigestText(items = []) {
        if (!Array.isArray(items) || items.length === 0) return '(none)';
        return items.map((item, idx) => {
            const head = `${idx + 1}. ${item.url} (ok=${item.ok ? 'yes' : 'no'}, status=${item.status})`;
            const snippet = String(item.snippet || '').slice(0, 1200);
            return `${head}\n${snippet}\n`;
        }).join('\n');
    }

    _extractFirstJsonObject(text) {
        const raw = String(text || '').trim();
        if (!raw) throw new Error('Empty JSON block');
        const start = raw.indexOf('{');
        if (start < 0) throw new Error('No JSON object start found');

        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < raw.length; i += 1) {
            const ch = raw[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }

            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') {
                depth += 1;
                continue;
            }
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return raw.slice(start, i + 1);
                }
            }
        }
        throw new Error('Unclosed JSON object block');
    }
}

module.exports = SkillArchitect;
