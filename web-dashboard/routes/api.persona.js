const express = require('express');
const fs = require('fs');
const path = require('path');
const { resolveActiveContext } = require('./utils/context');

module.exports = function registerPersonaRoutes(server) {
    const router = express.Router();

    router.get('/api/golems/templates', (req, res) => {
        const personasDir = path.resolve(process.cwd(), 'personas');
        if (!fs.existsSync(personasDir)) {
            return res.json({ templates: [] });
        }

        try {
            const files = fs.readdirSync(personasDir).filter((f) => f.endsWith('.md'));
            const templates = files.map((file) => {
                const content = fs.readFileSync(path.join(personasDir, file), 'utf8');
                const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
                if (!frontmatterMatch) return null;

                const yamlStr = frontmatterMatch[1];
                const body = frontmatterMatch[2].trim();
                const metadata = {};

                yamlStr.split('\n').forEach((line) => {
                    const [key, ...valParts] = line.split(':');
                    if (!key || valParts.length === 0) return;

                    let val = valParts.join(':').trim();
                    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                    if (val.startsWith('[') && val.endsWith(']')) {
                        val = val
                            .slice(1, -1)
                            .split(',')
                            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
                            .filter((s) => s !== '');
                    }
                    metadata[key.trim()] = val;
                });

                return {
                    id: file.replace('.md', ''),
                    name: metadata.name || file,
                    description: metadata.description || '',
                    icon: metadata.icon || 'BrainCircuit',
                    aiName: metadata.aiName || 'Golem',
                    userName: metadata.userName || 'Traveler',
                    role: body || metadata.role || '',
                    tone: metadata.tone || '',
                    tags: metadata.tags || [],
                    skills: metadata.skills || []
                };
            }).filter((t) => t !== null);

            return res.json({ templates });
        } catch (e) {
            console.error('Failed to load persona templates:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/persona/market', (req, res) => {
        try {
            const { search, category, page = 1, limit = 20 } = req.query;
            const personasDir = path.resolve(process.cwd(), 'data', 'marketplace', 'personas');

            if (!fs.existsSync(personasDir)) {
                return res.json({ personas: [], total: 0 });
            }

            let allPersonas = [];
            const files = fs.readdirSync(personasDir).filter((f) => f.endsWith('.json'));

            if (category && category !== 'all') {
                const catFile = path.join(personasDir, `${category}.json`);
                if (fs.existsSync(catFile)) {
                    allPersonas = JSON.parse(fs.readFileSync(catFile, 'utf8'));
                }
            } else {
                for (const file of files) {
                    const data = fs.readFileSync(path.join(personasDir, file), 'utf8');
                    allPersonas = allPersonas.concat(JSON.parse(data));
                }
            }

            if (search) {
                const term = String(search).toLowerCase();
                allPersonas = allPersonas.filter((p) =>
                    (p.name && p.name.toLowerCase().includes(term)) ||
                    (p.name_zh && p.name_zh.toLowerCase().includes(term)) ||
                    (p.description && p.description.toLowerCase().includes(term)) ||
                    (p.description_zh && p.description_zh.toLowerCase().includes(term)) ||
                    (p.role && p.role.toLowerCase().includes(term)) ||
                    (p.role_zh && p.role_zh.toLowerCase().includes(term))
                );
            }

            const seenIds = new Set();
            allPersonas = allPersonas.filter((p) => {
                if (!p.id || seenIds.has(p.id)) return false;
                seenIds.add(p.id);
                return true;
            });

            const total = allPersonas.length;
            const startIndex = (Number(page) - 1) * Number(limit);
            const personas = allPersonas.slice(startIndex, startIndex + Number(limit));

            return res.json({ personas, total });
        } catch (e) {
            console.error('Failed to load market personas:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/persona', (req, res) => {
        try {
            const personaManager = require('../../src/skills/core/persona');
            const ConfigManager = require('../../src/config/index');
            const { context } = resolveActiveContext(server, req.query.golemId);

            const userDataDir = (context && context.brain && context.brain.userDataDir)
                ? context.brain.userDataDir
                : ConfigManager.MEMORY_BASE_DIR;

            const persona = personaManager.get(userDataDir);
            return res.json(persona);
        } catch (e) {
            console.error('Failed to read persona:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/persona/inject', async (req, res) => {
        try {
            const { golemId: reqGolemId, aiName, userName, currentRole, tone, skills } = req.body;
            const personaManager = require('../../src/skills/core/persona');
            const ConfigManager = require('../../src/config/index');
            const { golemId, context } = resolveActiveContext(server, reqGolemId);

            const userDataDir = (context && context.brain && context.brain.userDataDir)
                ? context.brain.userDataDir
                : ConfigManager.MEMORY_BASE_DIR;

            personaManager.save(userDataDir, {
                aiName: aiName || 'Golem',
                userName: userName || 'Traveler',
                currentRole: currentRole || '一個擁有長期記憶與自主意識的 AI 助手',
                tone: tone || '預設口氣',
                skills: skills || [],
                isNew: false
            });

            if (context && context.brain) {
                try {
                    console.log(`🤖 [WebServer] Triggering hot-reload for persona via new Gemini window... (Golem: ${golemId})`);
                    await context.brain.reloadSkills();

                    const targetId = context.brain.config?.chatId || ConfigManager.CONFIG.TG_CHAT_ID;
                    if (context.brain.tgBot && targetId) {
                        const bot = context.brain.tgBot;
                        bot.sendMessage(
                            targetId,
                            `🔄 *[${golemId}] 人格設定已更新*\n已重新開啟全新的對話視窗並載入最新人格「${aiName || 'Golem'}」，歷史記憶完整保留。`,
                            { parse_mode: 'Markdown' }
                        ).catch((e) => console.warn(`⚠️ [WebServer] TG persona notify failed [${golemId}]:`, e.message));
                    }
                } catch (e) {
                    console.error('⚠️ [WebServer] Failed to hot-reload persona:', e);
                }
            } else {
                try {
                    const ProtocolFormatter = require('../../src/services/ProtocolFormatter');
                    ProtocolFormatter._lastScanTime = 0;
                } catch (e) { }
            }

            console.log(`🎭 [WebServer] Persona saved & injection requested for Golem [${golemId}]`);
            return res.json({ success: true, message: '人格已更新並重新開啟對話視窗' });
        } catch (e) {
            console.error('Failed to inject persona:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/api/persona/create', (req, res) => {
        try {
            const { id, name, description, icon, aiName, userName, role, tone, tags } = req.body;
            if (!id || !name) return res.status(400).json({ success: false, error: 'Missing id or name' });

            const personasDir = path.resolve(process.cwd(), 'personas');
            if (!fs.existsSync(personasDir)) fs.mkdirSync(personasDir, { recursive: true });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            const filePath = path.join(personasDir, `${safeId}.md`);
            if (fs.existsSync(filePath)) {
                return res.status(409).json({ success: false, error: `檔案 ${safeId}.md 已存在` });
            }

            const tagsArray = Array.isArray(tags) ? tags : String(tags || '').split(',').map((s) => s.trim()).filter(Boolean);
            const tagsYaml = tagsArray.length > 0 ? `[${tagsArray.map((t) => `"${t}"`).join(', ')}]` : '[]';

            const content = `---\nname: "${name}"\ndescription: "${description || ''}"\nicon: "${icon || 'BrainCircuit'}"\naiName: "${aiName || 'Golem'}"\nuserName: "${userName || 'Traveler'}"\ntone: "${tone || '預設口氣'}"\ntags: ${tagsYaml}\nskills: []\n---\n${role || ''}\n`;

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`🎭 [WebServer] New persona created: ${safeId}.md`);
            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to create persona:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/api/persona/delete', async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ success: false, error: 'Missing persona ID' });

            const safeId = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            const BUILTIN_PERSONAS = ['standard', 'expert', 'analyst', 'coach', 'creative', 'storyteller', 'translator'];
            if (BUILTIN_PERSONAS.includes(safeId)) {
                return res.status(403).json({ success: false, error: `無法刪除內建人格樣板 '${safeId}'` });
            }

            const personasDir = path.resolve(process.cwd(), 'personas');
            const filePath = path.join(personasDir, `${safeId}.md`);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ success: false, error: `樣板檔案 '${safeId}.md' 不存在` });
            }

            fs.unlinkSync(filePath);
            console.log(`🗑️ [WebServer] Persona template deleted: ${safeId}.md`);
            return res.json({ success: true, id: safeId });
        } catch (e) {
            console.error('Failed to delete persona:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    return router;
};
