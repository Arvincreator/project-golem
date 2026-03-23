const express = require('express');
const fs = require('fs');
const path = require('path');
const { MANDATORY_SKILLS, OPTIONAL_SKILLS: OPTIONAL_SKILL_LIST, resolveEnabledSkills } = require('../../src/skills/skillsConfig');
const { buildOperationGuard } = require('../server/security');

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
                        const data = await new Promise((resolve, reject) => {
                            const options = { headers: { 'User-Agent': 'Golem-Dashboard-Installer' } };
                            https.get(targetUrl, options, (response) => {
                                if (response.statusCode === 200) {
                                    let body = '';
                                    response.on('data', chunk => body += chunk);
                                    response.on('end', () => resolve(body));
                                } else {
                                    resolve(null);
                                }
                            }).on('error', (e) => resolve(null));
                        });
                        if (data) return data;
                    } catch (e) {
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
            const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
            const filePath = path.join(libPath, `${safeId}.md`);

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
            if (!fs.existsSync(libPath)) fs.mkdirSync(libPath, { recursive: true });
            fs.writeFileSync(filePath, finalContent, 'utf8');
            console.log(`✨ [WebServer] Marketplace skill installed: ${safeId}.md`);

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const { MEMORY_BASE_DIR } = require('../../src/config');
            const idx = new SkillIndexManager(MEMORY_BASE_DIR);
            idx.addSkill(safeId).catch(e => console.error(`[SkillIndex] MarketplaceInstall-Add Error for ${safeId}:`, e.message));

            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to install marketplace skill:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/skills', async (req, res) => {
        try {
            const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
            if (!fs.existsSync(libPath)) return res.json([]);

            const files = fs.readdirSync(libPath).filter(f => f.endsWith('.md'));
            const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);

            const skillsData = files.map(file => {
                const content = fs.readFileSync(path.join(libPath, file), 'utf8');
                const baseName = file.replace('.md', '').toLowerCase();
                const isOptional = !MANDATORY_SKILLS.includes(baseName);
                const isEnabled = enabledSkills.has(baseName);

                const firstLineMatch = content.match(/^#+ (.*)|^【(.*)】/m) || content.match(/^([^\n]+)/);
                let title = baseName;
                if (firstLineMatch) {
                    title = firstLineMatch[1] || firstLineMatch[2] || firstLineMatch[0];
                    title = title.replace(/^#+\s*|【|】/g, '').trim();
                }

                return {
                    id: baseName,
                    title: title || baseName,
                    isOptional,
                    isEnabled,
                    content: content
                };
            });

            skillsData.sort((a, b) => {
                if (a.isEnabled && !b.isEnabled) return -1;
                if (!a.isEnabled && b.isEnabled) return 1;
                return a.id.localeCompare(b.id);
            });

            return res.json(skillsData);
        } catch (e) {
            console.error("Failed to read skills:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/toggle', requireSkillAdmin, (req, res) => {
        try {
            const { id, enabled } = req.body;
            if (!id) return res.status(400).json({ error: "Missing skill ID" });

            const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
            if (!fs.existsSync(path.join(libPath, `${id}.md`))) {
                return res.status(400).json({ error: `Skill "${id}" not found in lib/` });
            }
            if (MANDATORY_SKILLS.includes(id)) {
                return res.status(400).json({ error: `"${id}" is a mandatory skill and cannot be toggled` });
            }

            let currentStr = process.env.OPTIONAL_SKILLS || '';
            let currentSkills = currentStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '');

            if (enabled && !currentSkills.includes(id)) {
                currentSkills.push(id);
            } else if (!enabled && currentSkills.includes(id)) {
                currentSkills = currentSkills.filter(s => s !== id);
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

            const ProtocolFormatter = require('../../src/services/ProtocolFormatter');
            ProtocolFormatter._lastScanTime = 0;

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const { MEMORY_BASE_DIR } = require('../../src/config');
            const idx = new SkillIndexManager(MEMORY_BASE_DIR);
            
            if (enabled) {
                idx.addSkill(id).catch(e => console.error(`[SkillIndex] Toggle-Add Error for ${id}:`, e.message));
            } else {
                idx.removeSkill(id).catch(e => console.error(`[SkillIndex] Toggle-Remove Error for ${id}:`, e.message));
            }

            return res.json({ success: true, enabled, skillsStr: newSkillsStr });
        } catch (e) {
            console.error("Failed to toggle skill:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/create', requireSkillAdmin, (req, res) => {
        try {
            const { id, content } = req.body;
            if (!id || !content) return res.status(400).json({ error: 'Missing id or content' });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            if (MANDATORY_SKILLS.includes(safeId)) {
                return res.status(400).json({ error: `Cannot overwrite mandatory skill '${safeId}'` });
            }

            const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
            const filePath = path.join(libPath, `${safeId}.md`);

            if (fs.existsSync(filePath)) {
                return res.status(409).json({ error: `Skill '${safeId}' already exists` });
            }

            if (!fs.existsSync(libPath)) fs.mkdirSync(libPath, { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✨ [WebServer] Custom skill created: ${safeId}.md`);

            const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
            if (MANDATORY_SKILLS.includes(safeId) || enabledSkills.has(safeId)) {
                const SkillIndexManager = require('../../src/managers/SkillIndexManager');
                const { MEMORY_BASE_DIR } = require('../../src/config');
                const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                idx.addSkill(safeId).catch(e => console.error(`[SkillIndex] Create-Add Error for ${safeId}:`, e.message));
            }

            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to create skill:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/update', requireSkillAdmin, (req, res) => {
        try {
            const { id, content } = req.body;
            if (!id || !content) return res.status(400).json({ error: 'Missing id or content' });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            if (MANDATORY_SKILLS.includes(safeId)) {
                return res.status(403).json({ error: `Cannot edit mandatory skill '${safeId}'` });
            }

            const libPath = path.join(process.cwd(), 'src', 'skills', 'lib');
            const filePath = path.join(libPath, `${safeId}.md`);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: `Skill '${safeId}' not found` });
            }

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`📝 [WebServer] Custom skill updated: ${safeId}.md`);

            const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
            if (MANDATORY_SKILLS.includes(safeId) || enabledSkills.has(safeId)) {
                const SkillIndexManager = require('../../src/managers/SkillIndexManager');
                const { MEMORY_BASE_DIR } = require('../../src/config');

                const idx = new SkillIndexManager(MEMORY_BASE_DIR);
                idx.addSkill(safeId).catch(e => console.error(`[SkillIndex] Update-Add Error for ${safeId}:`, e.message));
            }

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
            const filePath = path.join(libPath, `${safeId}.md`);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: `Skill '${safeId}' not found` });
            }

            fs.unlinkSync(filePath);
            console.log(`🗑️ [WebServer] Custom skill deleted: ${safeId}.md`);

            const SkillIndexManager = require('../../src/managers/SkillIndexManager');
            const { MEMORY_BASE_DIR } = require('../../src/config');
            const idx = new SkillIndexManager(MEMORY_BASE_DIR);
            await idx.removeSkill(safeId).catch(e => console.error(`[SkillIndex] Delete-Remove Error for ${safeId}:`, e.message));

            const ProtocolFormatter = require('../../src/services/ProtocolFormatter');
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
            const ProtocolFormatter = require('../../src/services/ProtocolFormatter');
            ProtocolFormatter._lastScanTime = 0;
            return res.json({ success: true, message: "Skills cache cleared" });
        } catch (e) {
            console.error("Failed to reload skills cache:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/skills/inject', requireSkillAdmin, async (req, res) => {
        try {
            const ProtocolFormatter = require('../../src/services/ProtocolFormatter');
            ProtocolFormatter._lastScanTime = 0;

            const results = [];
            for (const [id, context] of server.contexts.entries()) {
                if (context.brain && typeof context.brain.reloadSkills === 'function') {
                    try {
                        console.log(`🚀 [WebServer] 啟動 [${id}] 完整重啟程序...`);
                        await context.brain.reloadSkills();
                        results.push({ id, status: 'success' });

                        const tgBot = context.brain.tgBot;
                        if (tgBot) {
                            const enabledSkills = resolveEnabledSkills(process.env.OPTIONAL_SKILLS || '', []);
                            const enabledOptional = OPTIONAL_SKILL_LIST.filter(s => enabledSkills.has(s));
                            const disabledOptional = OPTIONAL_SKILL_LIST.filter(s => !enabledSkills.has(s));

                            const mandatoryList = MANDATORY_SKILLS.map(s => `• ${s}`).join('\n');
                            const optionalList = enabledOptional.length > 0 ? enabledOptional.map(s => `• ${s}`).join('\n') : '（無）';
                            const disabledList = disabledOptional.length > 0 ? disabledOptional.map(s => `• ${s}`).join('\n') : '（無）';

                            const msg = `⚡ *[${id}] 技能書已重新注入*\n\n🔒 *必要技能（永久啟用）:*\n${mandatoryList}\n\n✅ *已啟用選用技能:*\n${optionalList}\n\n⛔ *未啟用選用技能:*\n${disabledList}`;

                            const gCfg = tgBot.golemConfig || {};
                            const targetId = gCfg.adminId || gCfg.chatId;
                            if (targetId) {
                                tgBot.sendMessage(targetId, msg, { parse_mode: 'Markdown' })
                                    .catch(e => console.warn(`⚠️ [WebServer] TG skill notify failed [${id}]:`, e.message));
                                tgBot.sendMessage(targetId, `🔄 *[${id}] 技能書注入完成*\n已為您重新開啟全新的 Gemini 對話視窗並注入技能，人格設定與歷史記憶已完整保留，不需重新設定。`, { parse_mode: 'Markdown' })
                                    .catch(e => console.warn(`⚠️ [WebServer] TG inject notify failed [${id}]:`, e.message));
                            }
                        }
                    } catch (e) {
                        console.error(`❌ [WebServer] Failed to inject skills into Golem [${id}]:`, e.message);
                        results.push({ id, status: 'error', error: e.message });
                    }
                } else {
                    results.push({ id, status: 'skipped', error: 'Brain not ready or reloadSkills not available' });
                }
            }

            if (results.length === 0) {
                return res.status(503).json({ success: false, message: "No active Golem instances found" });
            }

            const allSuccess = results.every(r => r.status === 'success');
            return res.json({
                success: allSuccess,
                message: allSuccess ? `技能書已成功注入 ${results.length} 個 Golem 實體` : `部分注入失敗`,
                results
            });
        } catch (e) {
            console.error("Failed to inject skills:", e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
