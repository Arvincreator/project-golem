const express = require('express');
const fs = require('fs');
const path = require('path');
const { MANDATORY_SKILLS, OPTIONAL_SKILLS: OPTIONAL_SKILL_LIST, resolveEnabledSkills } = require('../../src/skills/skillsConfig');
const { ProtocolFormatter } = require('../../packages/protocol');
const { buildOperationGuard } = require('../server/security');
const { resolveActiveContext } = require('./utils/context');
const SkillPackageRegistry = require('../../src/managers/SkillPackageRegistry');
const REMOVED_SKILL_IDS = new Set(['schedule', 'list-schedules']);

function extractSkillTitle(record) {
    const content = String(record.content || '');
    if (!content) return '';

    const headingMatch = content.match(/^#+\s+(.+)$/m);
    if (headingMatch && headingMatch[1]) {
        return headingMatch[1].trim();
    }

    const bracketMatch = content.match(/^【(.+)】/m);
    if (bracketMatch && bracketMatch[1]) {
        return bracketMatch[1].replace(/^已載入技能：/, '').trim();
    }

    const firstLineMatch = content.match(/^([^\n]+)/);
    return firstLineMatch && firstLineMatch[1] ? firstLineMatch[1].trim() : '';
}

function normalizeSkillRecord(record, enabledSkills) {
    const id = String(record.id || '').trim().toLowerCase();
    if (!id) return null;
    if (REMOVED_SKILL_IDS.has(id)) return null;

    const category = String(record.category || 'lib').trim().toLowerCase();
    const isDynamic = category === 'user_dynamic' || category === 'runtime' || category === 'runtime_user';
    const isMandatory = MANDATORY_SKILLS.includes(id);

    let title = String(record.name || '').trim();
    if (!title) title = extractSkillTitle(record);
    if (!title) title = id;

    return {
        id,
        title,
        isOptional: isDynamic ? false : !isMandatory,
        isDeletable: !isMandatory,
        isEnabled: isDynamic ? true : (isMandatory || enabledSkills.has(id)),
        content: String(record.content || ''),
        category
    };
}

function safeExportToken(value, fallback = 'default') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function safeSkillId(value, fallback = 'imported_skill') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function parseBooleanLike(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return fallback;
}

function normalizeImportedSkill(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw;
    const title = String(record.title || record.name || `Imported Skill ${index + 1}`).trim();
    const idSeed = String(record.id || title || '').trim();
    const id = safeSkillId(idSeed, `imported_skill_${index + 1}`);
    const content = String(record.content || '').trim();
    if (!content) return null;

    return {
        id,
        title: title || id,
        content,
        category: String(record.category || 'lib').trim().toLowerCase() || 'lib',
        isEnabled: parseBooleanLike(record.isEnabled, false),
        isOptional: parseBooleanLike(record.isOptional, true)
    };
}

function parseImportedSkillsFromJsonPayload(payload) {
    let parsed = payload;
    if (typeof payload === 'string') {
        parsed = JSON.parse(payload);
    }

    const list = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray(parsed.skills) ? parsed.skills : null);

    if (!list) {
        throw new Error('Invalid JSON skill backup format');
    }

    const normalized = [];
    for (let i = 0; i < list.length; i += 1) {
        const item = normalizeImportedSkill(list[i], i);
        if (item) normalized.push(item);
    }
    return normalized;
}

function parseImportedSkillsFromMarkdown(markdown) {
    const raw = String(markdown || '').replace(/^\uFEFF/, '').trim();
    if (!raw) return [];

    const sectionPattern = /(?:^|\n)---\n\n## ([^\n]+)\n\n- ID: ([^\n]+)\n- Category: ([^\n]+)\n- Enabled: (true|false)\n- Optional: (true|false)\n\n([\s\S]*?)(?=\n---\n\n## |\s*$)/g;
    const skills = [];
    let match;
    while ((match = sectionPattern.exec(raw)) !== null) {
        const normalized = normalizeImportedSkill({
            title: String(match[1] || '').trim(),
            id: String(match[2] || '').trim(),
            category: String(match[3] || '').trim().toLowerCase(),
            isEnabled: String(match[4] || '').trim().toLowerCase() === 'true',
            isOptional: String(match[5] || '').trim().toLowerCase() === 'true',
            content: String(match[6] || '').trim(),
        }, skills.length);
        if (normalized) skills.push(normalized);
    }

    if (skills.length > 0) return skills;

    const headingMatch = raw.match(/^#+\s+(.+)$/m);
    const bracketMatch = raw.match(/^【已載入技能：(.+?)】/m);
    const inferredTitle = (headingMatch && headingMatch[1])
        ? headingMatch[1].trim()
        : (bracketMatch && bracketMatch[1] ? bracketMatch[1].trim() : 'Imported Skill');
    const single = normalizeImportedSkill({
        id: inferredTitle,
        title: inferredTitle,
        content: raw,
        category: 'lib',
        isEnabled: false,
        isOptional: true,
    }, 0);
    return single ? [single] : [];
}

function buildLiveSkillInjectionText(skillEntries = []) {
    const rows = Array.isArray(skillEntries) ? skillEntries : [];
    const header = [
        '【系統技能熱注入】',
        `本次僅注入目前已啟用的選用技能，共 ${rows.length} 個。`,
        '請立即在本輪與後續回合使用這些技能規則。',
        '',
    ];
    const body = rows.map((item, index) => {
        const title = String(item.name || item.id || `skill_${index + 1}`).trim();
        const id = String(item.id || '').trim();
        const content = String(item.content || '').trim();
        return [
            `--- Skill ${index + 1}/${rows.length}: ${title} (${id}) ---`,
            content,
            '',
        ].join('\n');
    });
    return [...header, ...body].join('\n');
}

function buildLiveSkillDisableText(skillId) {
    const safeId = String(skillId || '').trim();
    return [
        '【系統技能停用同步】',
        `技能 "${safeId}" 已由使用者停用。`,
        '從現在起，請不要再呼叫或依賴此技能的規則與 action。',
        '若使用者要求此能力，請先告知技能已停用，並請使用者重新啟用後再執行。',
    ].join('\n');
}

function hasExampleSection(promptText) {
    const text = String(promptText || '');
    if (!text.trim()) return false;
    if (/Action 格式|Runtime Action|連續操作範例|範例/i.test(text)) return true;
    if (/\{\s*"action"\s*:\s*"/.test(text)) return true;
    return false;
}

async function resolveSkillUserDataDir(server, golemIdQuery) {
    const { context } = resolveActiveContext(server, golemIdQuery);
    const { MEMORY_BASE_DIR } = require('../../src/config');
    return (context && context.brain && context.brain.userDataDir)
        ? context.brain.userDataDir
        : MEMORY_BASE_DIR;
}

function buildSkillsMarkdownBook(skillsData, golemId) {
    const lines = [
        '# Golem Skills Book Export',
        '',
        `- Exported At: ${new Date().toISOString()}`,
        `- Golem ID: ${golemId || 'default'}`,
        `- Total Skills: ${skillsData.length}`,
        ''
    ];

    for (const skill of skillsData) {
        const rawContent = String(skill.content || '').trim();
        lines.push('---');
        lines.push('');
        lines.push(`## ${skill.title}`);
        lines.push('');
        lines.push(`- ID: ${skill.id}`);
        lines.push(`- Category: ${skill.category || 'lib'}`);
        lines.push(`- Enabled: ${skill.isEnabled ? 'true' : 'false'}`);
        lines.push(`- Optional: ${skill.isOptional ? 'true' : 'false'}`);
        lines.push('');
        lines.push(rawContent || '_No content_');
        lines.push('');
    }

    return lines.join('\n');
}

async function collectInstalledSkills(server, golemIdQuery) {
    const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
    const files = fs.existsSync(libPath)
        ? fs.readdirSync(libPath).filter(f => f.endsWith('.md'))
        : [];
    const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
    const skillsMap = new Map();

    try {
        const userDataDir = await resolveSkillUserDataDir(server, golemIdQuery);

        const SkillIndexManager = require('../../src/managers/SkillIndexManager');
        const idx = new SkillIndexManager(userDataDir);

        try {
            const records = await idx.listSkillEntries();
            for (const record of records) {
                const normalized = normalizeSkillRecord(record, enabledSkills);
                if (normalized) skillsMap.set(normalized.id, normalized);
            }
        } finally {
            await idx.close();
        }
    } catch (e) {
        console.warn('⚠️ [WebServer] Failed to load skills from SQLite, fallback to filesystem:', e.message);
    }

    if (fs.existsSync(libPath)) {
        for (const file of files) {
            const content = fs.readFileSync(path.join(libPath, file), 'utf8');
            const baseName = file.replace('.md', '').toLowerCase();

            const existing = skillsMap.get(baseName);
            if (existing) {
                if (!existing.content) {
                    existing.content = content;
                    skillsMap.set(baseName, existing);
                }
                continue;
            }

            const normalized = normalizeSkillRecord({
                id: baseName,
                name: '',
                content,
                category: 'lib'
            }, enabledSkills);
            if (normalized) skillsMap.set(baseName, normalized);
        }
    }

    const userDataDir = await resolveSkillUserDataDir(server, golemIdQuery);
    const userSkillPackageDir = SkillPackageRegistry.getUserSkillPackageDir(userDataDir);

    for (const pkg of SkillPackageRegistry.listSkillPackages({ userDataDir })) {
        if (skillsMap.has(pkg.id)) continue;
        const content = SkillPackageRegistry.buildPromptContent(pkg);
        const normalized = normalizeSkillRecord({
            id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            content,
            path: pkg.dir,
            category: pkg.type || 'core',
        }, enabledSkills);
        if (normalized) {
            // isEnabled 判斷優先序：
            // 1. MANDATORY_SKILLS → 永遠啟用
            // 2. manifest.enabled === false → 停用（使用者手動關閉）
            // 3. OPTIONAL_SKILLS env 有此 id → 啟用
            // 4. manifest.enabled === true 且不在 MANDATORY/OPTIONAL → 預設啟用（新安裝的技能）
            const isMandatory = MANDATORY_SKILLS.includes(pkg.id);
            const inOptionalEnv = enabledSkills.has(pkg.id);
            const manifestEnabled = pkg.enabled !== false; // manifest.json 的 enabled 欄位

            if (isMandatory) {
                normalized.isEnabled = true;
            } else if (!manifestEnabled) {
                normalized.isEnabled = false; // 使用者明確關閉
            } else if (inOptionalEnv) {
                normalized.isEnabled = true;
            } else {
                // 新安裝的 package 技能，manifest 預設 enabled=true，顯示為啟用
                normalized.isEnabled = manifestEnabled;
            }

            // 使用者安裝的技能（在 golem_memory/skills/ 下）可以刪除
            // 內建技能（src/skills/modules/ 等）不可刪除
            const isUserInstalled = pkg.dir && pkg.dir.startsWith(userSkillPackageDir);
            if (isUserInstalled) {
                normalized.isDeletable = true;
                normalized.isOptional = true;
            }
            skillsMap.set(pkg.id, normalized);
        }
    }

    const skillsData = Array.from(skillsMap.values())
        .filter((item) => !REMOVED_SKILL_IDS.has(String(item && item.id || '').toLowerCase()));
    skillsData.sort((a, b) => {
        if (a.isEnabled && !b.isEnabled) return -1;
        if (!a.isEnabled && b.isEnabled) return 1;
        return a.id.localeCompare(b.id);
    });

    return skillsData;
}

module.exports = function(server) {
    const router = express.Router();
    const requireSkillAdmin = buildOperationGuard(server, 'skills_admin_operation');

    router.get('/api/skills/marketplace', (req, res) => {
        try {
            const marketplaceDir = path.join(process.cwd(), 'data', 'marketplace', 'skills');
            let allSkills = [];

            const { search, category, page = 1, limit = 20 } = req.query;

            if (category && category !== 'all') {
                const catFile = path.join(marketplaceDir, `${category}.json`);
                if (fs.existsSync(catFile)) {
                    allSkills = JSON.parse(fs.readFileSync(catFile, 'utf8'));
                }
            } else {
                if (fs.existsSync(marketplaceDir)) {
                    const files = fs.readdirSync(marketplaceDir).filter(f => f.endsWith('.json'));
                    for (const file of files) {
                        const data = JSON.parse(fs.readFileSync(path.join(marketplaceDir, file), 'utf8'));
                        allSkills = allSkills.concat(data);
                    }
                }
            }

            if (category && category !== 'all') {
                allSkills = allSkills.filter(s => s.category === category);
            }
            if (search) {
                const term = search.toLowerCase();
                allSkills = allSkills.filter(s => s.title.toLowerCase().includes(term) || s.description.toLowerCase().includes(term));
            }

            const total = allSkills.length;
            const startIndex = (Number(page) - 1) * Number(limit);
            const endIndex = startIndex + Number(limit);
            const skills = allSkills.slice(startIndex, endIndex);

            const categoryCounts = {};
            let totalMarketSkills = 0;
            if (fs.existsSync(marketplaceDir)) {
                const files = fs.readdirSync(marketplaceDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const data = JSON.parse(fs.readFileSync(path.join(marketplaceDir, file), 'utf8'));
                    const categoryId = file.replace('.json', '');
                    categoryCounts[categoryId] = data.length;
                    totalMarketSkills += data.length;
                }
            }
            categoryCounts['all'] = totalMarketSkills;

            return res.json({ skills, total, categoryCounts });
        } catch (e) {
            console.error("Failed to read marketplace skills:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/marketplace/install', requireSkillAdmin, async (req, res) => {
        try {
            const { id, repoUrl } = req.body;
            if (!id || !repoUrl) return res.status(400).json({ error: 'Missing id or repoUrl' });

            // SSRF 防護：驗證 URL 來源是否安全
            const parsedUrl = new URL(repoUrl);
            const allowedHosts = ['github.com', 'raw.githubusercontent.com'];
            if (!allowedHosts.includes(parsedUrl.hostname)) {
                return res.status(400).json({ error: 'Invalid repository host. Only github.com is allowed.' });
            }

            let rawUrl = repoUrl
                .replace('github.com', 'raw.githubusercontent.com')
                .replace('/tree/', '/');

            if (!rawUrl.toLowerCase().endsWith('.md')) {
                if (rawUrl.endsWith('/')) rawUrl += 'SKILL.md';
                else rawUrl += '/SKILL.md';
            }

            const https = require('https');

            async function fetchWithFallback(url, id) {
                const tryUrls = [
                    url,
                    url.replace(/\/SKILL\.md$/i, `/${id}/SKILL.md`),
                    url.replace(/\/SKILL\.md$/i, `/${id}/skill.md`),
                    url.endsWith('SKILL.md') ? url.replace('SKILL.md', 'skill.md') : url + '/skill.md'
                ];
                const uniqueUrls = [...new Set(tryUrls)];

                for (const targetUrl of uniqueUrls) {
                    try {
                        const data = await new Promise((resolve) => {
                            const options = { headers: { 'User-Agent': 'Golem-Dashboard-Installer' } };
                            https.get(targetUrl, options, (response) => {
                                if (response.statusCode === 200) {
                                    let body = '';
                                    response.on('data', chunk => body += chunk);
                                    response.on('end', () => resolve(body));
                                } else {
                                    resolve(null);
                                }
                            }).on('error', () => resolve(null));
                        });
                        if (data) return data;
                    } catch {
                        continue;
                    }
                }
                return null;
            }

            const content = await fetchWithFallback(rawUrl, id);
            if (!content) {
                return res.status(404).json({ error: 'Skill markdown not found even after trying subdirectories' });
            }

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const packageRoot = SkillPackageRegistry.getUserSkillPackageDir(userDataDir);
            const packageDir = path.join(packageRoot, safeId);
            const filePath = path.join(packageDir, 'skill.md');

            let title = safeId;
            let parsedContent = content.toString().replace(/^\uFEFF/, '').trim();

            const fmMatch = parsedContent.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if (fmMatch) {
                const yaml = fmMatch[1];
                const nameMatch = yaml.match(/^name:\s*(.+)$/m);
                if (nameMatch) {
                    title = nameMatch[1].replace(/^["']|["']$/g, '').trim();
                }
                parsedContent = fmMatch[2].trim();
            } else {
                const hMatch = parsedContent.match(/^#+\s+(.+)$/m);
                if (hMatch) title = hMatch[1].trim();
            }

            const finalContent = `【已載入技能：${title}】\n\n${parsedContent}`;
            if (!fs.existsSync(packageDir)) fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(filePath, finalContent, 'utf8');
            fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify({
                id: safeId,
                name: title,
                description: '',
                type: 'user_prompt',
                enabled: true,
                action: safeId,
                entry: null,
                prompt: 'skill.md',
                toolsets: ['assistant'],
                triggers: [],
                createdBy: 'marketplace',
                createdAt: new Date().toISOString(),
                version: '1.0.0'
            }, null, 2) + '\n', 'utf8');
            console.log(`✨ [WebServer] Marketplace skill package installed: ${safeId}`);

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const idx = new SkillIndexManager(userDataDir);
            await idx.addSkillPackage(SkillPackageRegistry.loadPackage(packageDir)).catch(e => console.error(`[SkillIndex] MarketplaceInstall-Add Error for ${safeId}:`, e.message));
            await idx.close();

            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to install marketplace skill:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/skills', async (req, res) => {
        try {
            const skillsData = await collectInstalledSkills(server, req.query.golemId);
            return res.json(skillsData);
        } catch (e) {
            console.error("Failed to read skills:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/skills/check', requireSkillAdmin, async (req, res) => {
        try {
            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const packages = SkillPackageRegistry.listSkillPackages({ userDataDir });
            const packageMap = new Map(packages.map((pkg) => [pkg.id, pkg]));
            const mandatorySet = new Set(MANDATORY_SKILLS);

            const requested = String(req.query.ids || '')
                .split(',')
                .map((id) => safeSkillId(id, ''))
                .filter(Boolean);

            const idsToCheck = requested.length > 0
                ? [...new Set(requested)]
                : [...new Set([...MANDATORY_SKILLS, ...OPTIONAL_SKILL_LIST, ...packages.map((pkg) => pkg.id)])];

            const checks = idsToCheck.map((id) => {
                const pkg = packageMap.get(id) || null;
                const isRegistered = Boolean(pkg);
                const isCore = mandatorySet.has(id);
                const enabled = Boolean(pkg && pkg.enabled !== false);

                let isLoadable = false;
                let loadError = '';
                if (pkg && pkg.indexPath) {
                    try {
                        if (fs.existsSync(pkg.indexPath)) {
                            delete require.cache[require.resolve(pkg.indexPath)];
                            const mod = require(pkg.indexPath);
                            isLoadable = Boolean(mod && typeof mod.run === 'function');
                            if (!isLoadable) loadError = 'module loaded but missing run()';
                        } else {
                            loadError = 'index.js not found';
                        }
                    } catch (error) {
                        loadError = error && error.message ? error.message : String(error);
                    }
                } else if (pkg) {
                    loadError = 'missing indexPath';
                } else {
                    loadError = 'package not registered';
                }

                let hasExamples = false;
                if (pkg && pkg.promptPath && fs.existsSync(pkg.promptPath)) {
                    try {
                        const promptText = fs.readFileSync(pkg.promptPath, 'utf8');
                        hasExamples = hasExampleSection(promptText);
                    } catch (_) {
                        hasExamples = false;
                    }
                }

                return {
                    id,
                    isCore,
                    isRegistered,
                    enabled,
                    isLoadable,
                    hasExamples,
                    promptPath: pkg ? pkg.promptPath : '',
                    indexPath: pkg ? pkg.indexPath : '',
                    loadError: isLoadable ? '' : loadError,
                };
            });

            const summary = {
                total: checks.length,
                registered: checks.filter((item) => item.isRegistered).length,
                loadable: checks.filter((item) => item.isLoadable).length,
                withExamples: checks.filter((item) => item.hasExamples).length,
            };

            return res.json({
                success: true,
                checkedIds: idsToCheck,
                summary,
                checks,
            });
        } catch (e) {
            console.error('Failed to check skills:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    router.get('/api/skills/export', async (req, res) => {
        try {
            const requestedId = String(req.query.id || '').trim().toLowerCase();
            const requestedIdsRaw = Array.isArray(req.query.ids)
                ? req.query.ids.join(',')
                : String(req.query.ids || '');
            const requestedIds = [...new Set(
                requestedIdsRaw
                    .split(',')
                    .map((item) => String(item || '').trim().toLowerCase())
                    .filter(Boolean)
            )];
            const requestedFormat = String(req.query.format || '').trim().toLowerCase();
            const { golemId } = resolveActiveContext(server, req.query.golemId);
            const golemToken = safeExportToken(golemId, 'export');
            const now = Date.now();

            const skillsData = await collectInstalledSkills(server, req.query.golemId);

            if (requestedId) {
                const matched = skillsData.find(skill => skill.id === requestedId);
                if (!matched) {
                    return res.status(404).json({ error: `Skill '${requestedId}' not found` });
                }

                const fileName = `skill_${matched.id}_${golemToken}_${now}.md`;
                res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
                res.setHeader('Content-type', 'text/markdown; charset=utf-8');
                return res.send(String(matched.content || '').trim());
            }

            let exportSkills = skillsData;
            if (requestedIds.length > 0) {
                const requestedSet = new Set(requestedIds);
                exportSkills = skillsData.filter((skill) => requestedSet.has(skill.id));

                if (exportSkills.length === 0) {
                    return res.status(404).json({ error: 'Requested skills not found' });
                }
            }

            if (requestedFormat === 'json') {
                const exportPayload = {
                    exportedAt: new Date().toISOString(),
                    golemId: golemId || null,
                    total: exportSkills.length,
                    skills: exportSkills.map((skill) => ({
                        id: skill.id,
                        title: skill.title,
                        content: skill.content,
                        category: skill.category,
                        isEnabled: skill.isEnabled,
                        isOptional: skill.isOptional
                    }))
                };

                const fileName = requestedIds.length > 0
                    ? `skills_selected_${exportSkills.length}_${golemToken}_${now}.json`
                    : `skills_backup_${golemToken}_${now}.json`;
                res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
                res.setHeader('Content-type', 'application/json');
                return res.send(JSON.stringify(exportPayload, null, 2));
            }

            const markdownBook = buildSkillsMarkdownBook(exportSkills, golemId);
            const fileName = requestedIds.length > 0
                ? `skills_selected_${exportSkills.length}_${golemToken}_${now}.md`
                : `skills_book_${golemToken}_${now}.md`;
            res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
            res.setHeader('Content-type', 'text/markdown; charset=utf-8');
            return res.send(markdownBook);
        } catch (e) {
            console.error('Failed to export skills:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/import', requireSkillAdmin, async (req, res) => {
        try {
            const format = String(req.body?.format || 'auto').trim().toLowerCase();
            const payload = req.body?.payload;
            const restoreEnabled = parseBooleanLike(req.body?.restoreEnabled, true);
            const overwriteExisting = parseBooleanLike(req.body?.overwriteExisting, true);

            if (payload === undefined || payload === null) {
                return res.status(400).json({ error: 'Missing payload' });
            }

            let importedSkills;
            if (format === 'json') {
                importedSkills = parseImportedSkillsFromJsonPayload(payload);
            } else if (format === 'markdown' || format === 'md') {
                importedSkills = parseImportedSkillsFromMarkdown(payload);
            } else {
                if (typeof payload === 'string') {
                    try {
                        importedSkills = parseImportedSkillsFromJsonPayload(payload);
                    } catch {
                        importedSkills = parseImportedSkillsFromMarkdown(payload);
                    }
                } else {
                    importedSkills = parseImportedSkillsFromJsonPayload(payload);
                }
            }

            if (!Array.isArray(importedSkills) || importedSkills.length === 0) {
                return res.status(400).json({ error: 'No valid skills found in import payload' });
            }

            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const packageRoot = SkillPackageRegistry.getUserSkillPackageDir(userDataDir);
            if (!fs.existsSync(packageRoot)) fs.mkdirSync(packageRoot, { recursive: true });

            const currentOptionalRaw = process.env.OPTIONAL_SKILLS || '';
            const currentOptionalSkills = currentOptionalRaw
                .split(',')
                .map((item) => item.trim().toLowerCase())
                .filter(Boolean);
            const optionalSet = new Set(currentOptionalSkills);

            const importedIds = [];
            const skippedMandatory = [];
            const skippedInvalid = [];
            const skippedExisting = [];
            const seenIds = new Set();

            for (const item of importedSkills) {
                const skill = normalizeImportedSkill(item, importedIds.length + skippedInvalid.length);
                if (!skill) {
                    skippedInvalid.push('(invalid_record)');
                    continue;
                }

                const safeId = safeSkillId(skill.id);
                if (!safeId) {
                    skippedInvalid.push('(invalid_id)');
                    continue;
                }

                if (seenIds.has(safeId)) continue;
                seenIds.add(safeId);

                if (MANDATORY_SKILLS.includes(safeId)) {
                    skippedMandatory.push(safeId);
                    continue;
                }

                const packageDir = path.join(packageRoot, safeId);
                const filePath = path.join(packageDir, 'skill.md');
                if (!overwriteExisting && fs.existsSync(packageDir)) {
                    skippedExisting.push(safeId);
                    continue;
                }

                if (!fs.existsSync(packageDir)) fs.mkdirSync(packageDir, { recursive: true });
                fs.writeFileSync(filePath, String(skill.content || '').trim(), 'utf8');
                fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify({
                    id: safeId,
                    name: skill.title || safeId,
                    description: '',
                    type: skill.category === 'user_dynamic' ? 'user_generated' : 'user_prompt',
                    enabled: Boolean(skill.isEnabled),
                    action: safeId,
                    entry: null,
                    prompt: 'skill.md',
                    toolsets: ['assistant'],
                    triggers: [],
                    createdBy: 'import',
                    createdAt: new Date().toISOString(),
                    version: '1.0.0'
                }, null, 2) + '\n', 'utf8');
                importedIds.push(safeId);

                if (restoreEnabled && skill.isOptional && skill.isEnabled) {
                    optionalSet.add(safeId);
                }
            }

            let enabledAdded = 0;
            if (restoreEnabled) {
                const mergedOptional = [...currentOptionalSkills];
                for (const id of optionalSet) {
                    if (!mergedOptional.includes(id)) {
                        mergedOptional.push(id);
                        enabledAdded += 1;
                    }
                }
                const updatedOptional = mergedOptional.join(',');
                process.env.OPTIONAL_SKILLS = updatedOptional;

                const envPath = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(envPath)) {
                    let envContent = fs.readFileSync(envPath, 'utf8');
                    const regex = /^OPTIONAL_SKILLS=.*$/m;
                    if (regex.test(envContent)) {
                        envContent = envContent.replace(regex, `OPTIONAL_SKILLS=${updatedOptional}`);
                    } else {
                        envContent += `\nOPTIONAL_SKILLS=${updatedOptional}\n`;
                    }
                    fs.writeFileSync(envPath, envContent, 'utf8');
                }
            }

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const idx = new SkillIndexManager(userDataDir);
            try {
                for (const id of importedIds) {
                    const pkg = SkillPackageRegistry.listSkillPackages({ userDataDir }).find(item => item.id === id);
                    if (pkg) await idx.addSkillPackage(pkg);
                }
            } finally {
                await idx.close();
            }

            ProtocolFormatter._lastScanTime = 0;

            return res.json({
                success: true,
                totalReceived: importedSkills.length,
                importedCount: importedIds.length,
                enabledAdded,
                skippedMandatory,
                skippedExisting,
                skippedInvalid,
                message: `Imported ${importedIds.length} skills`
            });
        } catch (e) {
            console.error('Failed to import skills:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/toggle', requireSkillAdmin, async (req, res) => {
        try {
            const { id, enabled } = req.body;
            if (!id) return res.status(400).json({ error: "Missing skill ID" });

            const safeId = safeSkillId(id);
            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const pkg = SkillPackageRegistry.listSkillPackages({ userDataDir }).find(item => item.id === safeId);
            if (!pkg) {
                return res.status(400).json({ error: `Skill "${safeId}" not found` });
            }
            if (MANDATORY_SKILLS.includes(safeId)) {
                return res.status(400).json({ error: `"${safeId}" is a mandatory skill and cannot be toggled` });
            }

            let currentStr = process.env.OPTIONAL_SKILLS || '';
            let currentSkills = currentStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '');

            if (enabled && !currentSkills.includes(safeId)) {
                currentSkills.push(safeId);
            } else if (!enabled && currentSkills.includes(safeId)) {
                currentSkills = currentSkills.filter(s => s !== safeId);
            }

            const newSkillsStr = currentSkills.join(',');
            process.env.OPTIONAL_SKILLS = newSkillsStr;

            const envPath = path.resolve(process.cwd(), '.env');
            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf8');
                const regex = /^OPTIONAL_SKILLS=.*$/m;
                if (regex.test(envContent)) {
                    envContent = envContent.replace(regex, `OPTIONAL_SKILLS=${newSkillsStr}`);
                } else {
                    envContent += `\nOPTIONAL_SKILLS=${newSkillsStr}\n`;
                }
                fs.writeFileSync(envPath, envContent, 'utf8');
            }

            if (fs.existsSync(pkg.manifestPath)) {
                const manifest = JSON.parse(fs.readFileSync(pkg.manifestPath, 'utf8'));
                manifest.enabled = Boolean(enabled);
                fs.writeFileSync(pkg.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
            }

            ProtocolFormatter._lastScanTime = 0;

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const idx = new SkillIndexManager(userDataDir);
            
            if (enabled) {
                await idx.addSkillPackage(SkillPackageRegistry.loadPackage(pkg.dir)).catch(e => console.error(`[SkillIndex] Toggle-Add Error for ${safeId}:`, e.message));
            } else {
                await idx.removeSkill(safeId).catch(e => console.error(`[SkillIndex] Toggle-Remove Error for ${safeId}:`, e.message));
            }
            await idx.close();

            // 熱刷新 SkillManager，讓 runtime skill map 立即反映 manifest.enabled 變更
            try {
                const skillManager = require('../../src/managers/SkillManager');
                skillManager.refresh();
            } catch (refreshError) {
                console.warn(`⚠️ [WebServer] SkillManager refresh failed after toggle (${safeId}): ${refreshError.message}`);
            }

            let liveSessionRemoved = false;
            const liveSyncResults = [];
            if (!enabled) {
                const disableText = buildLiveSkillDisableText(safeId);
                for (const [ctxId, ctx] of server.contexts.entries()) {
                    const brain = ctx && ctx.brain;
                    if (!brain) {
                        liveSyncResults.push({ id: ctxId, status: 'skipped', error: 'Brain not ready' });
                        continue;
                    }
                    try {
                        if (brain.skillIndex && typeof brain.skillIndex.removeSkill === 'function') {
                            await brain.skillIndex.removeSkill(safeId).catch(() => {});
                        }
                        if (typeof brain.sendMessage === 'function') {
                            await brain.sendMessage(disableText, false, { disableToolRouting: true });
                        }
                        liveSyncResults.push({ id: ctxId, status: 'success' });
                        liveSessionRemoved = true;
                    } catch (syncError) {
                        liveSyncResults.push({ id: ctxId, status: 'error', error: syncError.message });
                    }
                }
            }

            return res.json({
                success: true,
                enabled,
                skillsStr: newSkillsStr,
                liveSessionRemoved,
                liveSyncResults,
            });
        } catch (e) {
            console.error("Failed to toggle skill:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/create', requireSkillAdmin, async (req, res) => {
        try {
            const { id, content } = req.body;
            if (!id || !content) return res.status(400).json({ error: 'Missing id or content' });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            if (MANDATORY_SKILLS.includes(safeId)) {
                return res.status(400).json({ error: `Cannot overwrite mandatory skill '${safeId}'` });
            }

            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const packageRoot = SkillPackageRegistry.getUserSkillPackageDir(userDataDir);
            const packageDir = path.join(packageRoot, safeId);
            const filePath = path.join(packageDir, 'skill.md');

            if (fs.existsSync(packageDir)) {
                return res.status(409).json({ error: `Skill '${safeId}' already exists` });
            }

            if (!fs.existsSync(packageDir)) fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
            fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify({
                id: safeId,
                name: extractSkillTitle({ content }) || safeId,
                description: '',
                type: 'user_prompt',
                enabled: true,
                action: safeId,
                entry: null,
                prompt: 'skill.md',
                toolsets: ['assistant'],
                triggers: [],
                createdBy: 'dashboard',
                createdAt: new Date().toISOString(),
                version: '1.0.0'
            }, null, 2) + '\n', 'utf8');
            console.log(`✨ [WebServer] Custom skill package created: ${safeId}`);

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const idx = new SkillIndexManager(userDataDir);
            const pkg = SkillPackageRegistry.loadPackage(packageDir);
            await idx.addSkillPackage(pkg).catch(e => console.error(`[SkillIndex] Create-Add Error for ${safeId}:`, e.message));
            await idx.close();

            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to create skill:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/update', requireSkillAdmin, async (req, res) => {
        try {
            const { id, content } = req.body;
            if (!id || !content) return res.status(400).json({ error: 'Missing id or content' });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            if (MANDATORY_SKILLS.includes(safeId)) {
                return res.status(403).json({ error: `Cannot edit mandatory skill '${safeId}'` });
            }

            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const pkg = SkillPackageRegistry.listSkillPackages({ userDataDir }).find(item => item.id === safeId);
            const filePath = pkg ? pkg.promptPath : '';

            if (!pkg || !filePath || !fs.existsSync(filePath)) {
                return res.status(404).json({ error: `Skill '${safeId}' not found` });
            }

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`📝 [WebServer] Custom skill package updated: ${safeId}`);

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const idx = new SkillIndexManager(userDataDir);
            await idx.addSkillPackage(pkg).catch(e => console.error(`[SkillIndex] Update-Add Error for ${safeId}:`, e.message));
            await idx.close();

            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to update skill:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/delete', requireSkillAdmin, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing skill ID' });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

            if (MANDATORY_SKILLS.includes(safeId)) {
                return res.status(403).json({ error: `Cannot delete mandatory skill '${safeId}'` });
            }

            const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
            const userPath = path.join(process.cwd(), 'src', 'skills', 'user');
            const userDataDir = await resolveSkillUserDataDir(server, req.query.golemId);
            const modulePath = path.join(process.cwd(), 'src', 'skills', 'modules');
            const generatedPath = path.join(process.cwd(), 'src', 'skills', 'generated');
            const packageUserPath = SkillPackageRegistry.getUserSkillPackageDir(userDataDir);
            const allowedRoots = [path.resolve(libPath), path.resolve(userPath), path.resolve(modulePath), path.resolve(generatedPath), path.resolve(packageUserPath)];
            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const idx = new SkillIndexManager(userDataDir);
            let deletedPath = '';
            try {
                let indexedRecord = null;
                try {
                    const records = await idx.listSkillEntries();
                    indexedRecord = records.find((record) => String(record.id || '').trim().toLowerCase() === safeId) || null;
                } catch (e) {
                    console.warn(`⚠️ [WebServer] Failed to load indexed skill before delete (${safeId}): ${e.message}`);
                }

                const candidatePaths = [];
                if (indexedRecord && indexedRecord.path) {
                    candidatePaths.push(String(indexedRecord.path));
                }
                const pkg = SkillPackageRegistry.listSkillPackages({ userDataDir }).find(item => item.id === safeId);
                if (pkg && pkg.dir) candidatePaths.push(pkg.dir);
                candidatePaths.push(path.join(libPath, `${safeId}.md`));
                candidatePaths.push(path.join(userPath, `${safeId}.js`));

                for (const candidate of candidatePaths) {
                    if (!candidate) continue;
                    const resolved = path.resolve(candidate);
                    const inAllowedRoot = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
                    if (!inAllowedRoot) continue;
                    if (!fs.existsSync(resolved)) continue;
                    if (fs.statSync(resolved).isDirectory()) {
                        fs.rmSync(resolved, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(resolved);
                    }
                    deletedPath = resolved;
                    break;
                }

                if (!deletedPath) {
                    return res.status(404).json({ error: `Skill '${safeId}' not found` });
                }

                await idx.removeSkill(safeId).catch(e => console.error(`[SkillIndex] Delete-Remove Error for ${safeId}:`, e.message));
            } finally {
                await idx.close().catch((closeErr) => {
                    console.warn(`⚠️ [WebServer] Skill index close warning after delete (${safeId}): ${closeErr.message}`);
                });
            }

            try {
                const skillManager = require('../../src/managers/SkillManager');
                skillManager.refresh();
            } catch (refreshError) {
                console.warn(`⚠️ [WebServer] SkillManager refresh failed after delete (${safeId}): ${refreshError.message}`);
            }

            console.log(`🗑️ [WebServer] Custom skill deleted: ${deletedPath}`);

            ProtocolFormatter._lastScanTime = 0;

            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to delete skill:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/reload', requireSkillAdmin, (req, res) => {
        try {
            console.log("🔄 [WebServer] Hot-reloading skills... Clearing ProtocolFormatter cache.");
            ProtocolFormatter._lastScanTime = 0;
            return res.json({ success: true, message: "Skills cache cleared" });
        } catch (e) {
            console.error("Failed to reload skills cache:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/inject', requireSkillAdmin, async (req, res) => {
        try {
            ProtocolFormatter._lastScanTime = 0;
            const incomingIds = Array.isArray(req.body?.enabledSkillIds) ? req.body.enabledSkillIds : [];
            const sanitizedEnabledIds = [...new Set(
                incomingIds.map((id) => safeSkillId(id, '')).filter(Boolean)
            )];

            const results = [];
            for (const [id, context] of server.contexts.entries()) {
                if (context.brain) {
                    try {
                        const brain = context.brain;
                        const skillIds = sanitizedEnabledIds.length > 0
                            ? sanitizedEnabledIds
                            : (() => {
                                const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                                return OPTIONAL_SKILL_LIST.filter((skillId) => enabledSkills.has(skillId));
                            })();

                        if (skillIds.length === 0) {
                            results.push({ id, status: 'skipped', error: 'No enabled optional skills to inject' });
                            continue;
                        }

                        const skillRows = await brain.skillIndex.getEnabledSkills(skillIds);
                        if (!Array.isArray(skillRows) || skillRows.length === 0) {
                            results.push({ id, status: 'skipped', error: 'Enabled skills not found in skill index' });
                            continue;
                        }

                        const injectionText = buildLiveSkillInjectionText(skillRows);
                        if (typeof brain.sendMessageSegmented === 'function' && injectionText.length > 12000) {
                            await brain.sendMessageSegmented(injectionText, false, {
                                disableToolRouting: true,
                                maxSegmentChars: 10000,
                            });
                        } else if (typeof brain.sendMessage === 'function') {
                            await brain.sendMessage(injectionText, false, { disableToolRouting: true });
                        } else {
                            throw new Error('Brain sendMessage API unavailable');
                        }

                        console.log(`⚡ [WebServer] Live skill injection complete [${id}] optional_count=${skillRows.length}`);
                        results.push({ id, status: 'success' });

                        const tgBot = brain.tgBot;
                        if (tgBot) {
                            const optionalList = skillRows.map((s) => `• ${s.id}`).join('\n');
                            const msg = `⚡ *[${id}] 技能已即時注入*\n\n✅ *本次注入選用技能:*\n${optionalList}`;

                            const gCfg = tgBot.golemConfig || {};
                            const targetId = gCfg.adminId || gCfg.chatId;
                            if (targetId) {
                                tgBot.sendMessage(targetId, msg, { parse_mode: 'Markdown' })
                                    .catch(e => console.warn(`⚠️ [WebServer] TG skill notify failed [${id}]:`, e.message));
                                tgBot.sendMessage(targetId, `✅ *[${id}] 技能即時注入完成*\n未重啟 Gemini 視窗，當前對話上下文已保留。`, { parse_mode: 'Markdown' })
                                    .catch(e => console.warn(`⚠️ [WebServer] TG inject notify failed [${id}]:`, e.message));
                            }
                        }
                    } catch (e) {
                        console.error(`❌ [WebServer] Failed to inject skills into Golem [${id}]:`, e.message);
                        results.push({ id, status: 'error', error: e.message });
                    }
                } else {
                    results.push({ id, status: 'skipped', error: 'Brain not ready' });
                }
            }

            if (results.length === 0) {
                return res.status(503).json({ success: false, message: "No active Golem instances found" });
            }

            const allSuccess = results.every(r => r.status === 'success');
            return res.json({
                success: allSuccess,
                message: allSuccess ? `已即時注入 ${results.length} 個 Golem 實體` : `部分注入失敗`,
                results
            });
        } catch (e) {
            console.error("Failed to inject skills:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
