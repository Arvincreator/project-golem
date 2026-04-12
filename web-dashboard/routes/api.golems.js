const express = require('express');
const { buildOperationGuard } = require('../server/security');

module.exports = function registerGolemRoutes(server) {
    const router = express.Router();
    const requireGolemOps = buildOperationGuard(server, 'golem_admin_operation');

    router.get('/api/golems', (req, res) => {
        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');
            const personaManager = require('../../src/skills/core/persona');
            const envVars = EnvManager.readEnv();
            const hasPersona = personaManager.exists(ConfigManager.MEMORY_BASE_DIR);
            const defaultStatus = hasPersona ? 'not_started' : 'pending_setup';

            const golemsData = [];
            const isSingleMode = envVars.GOLEM_MODE === 'SINGLE' || !envVars.GOLEM_MODE;
            const hasToken = envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN;

            if (hasToken || isSingleMode) {
                const id = 'golem_A';
                const context = server.contexts.get(id);
                let status = defaultStatus;

                if (context && context.brain) {
                    status = context.brain.status || 'running';
                }
                golemsData.push({ id, status });
            }

            server.contexts.forEach((ctx, id) => {
                if (!golemsData.find((g) => g.id === id)) {
                    golemsData.push({ id, status: (ctx.brain && ctx.brain.status) || 'running' });
                }
            });

            return res.json({ golems: golemsData });
        } catch (e) {
            console.error('[WebServer] Failed to fetch golems list:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/create', requireGolemOps, async (req, res) => {
        try {
            const {
                id,
                tgToken,
                tgAuthMode,
                tgAdminId,
                tgChatId,
                dcToken,
                dcAdminId
            } = req.body;

            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');
            const envVars = EnvManager.readEnv();
            const isSystemConfigured = envVars.SYSTEM_CONFIGURED === 'true';

            if (!isSystemConfigured) {
                return res.status(409).json({
                    error: 'system_setup_required',
                    message: 'Please complete /dashboard/system-setup before creating golem config.',
                });
            }

            if (!id) {
                return res.status(400).json({ error: 'Missing required fields: id' });
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                return res.status(400).json({ error: 'Invalid Golem ID: only alphanumeric, _ and - allowed' });
            }

            console.log('📝 [API] System in SINGLE mode. Writing Golem config to .env');
            const updates = {};
            if (tgToken) {
                updates.TELEGRAM_TOKEN = tgToken;
                updates.TG_AUTH_MODE = tgAuthMode || 'ADMIN';
                if (tgAuthMode === 'CHAT' && tgChatId) updates.TG_CHAT_ID = tgChatId;
                if ((!tgAuthMode || tgAuthMode === 'ADMIN') && tgAdminId) updates.ADMIN_ID = tgAdminId;
            }
            if (dcToken) {
                updates.DISCORD_TOKEN = dcToken;
                updates.DISCORD_ADMIN_ID = dcAdminId;
            }

            EnvManager.updateEnv(updates);
            console.log('✅ [WebServer] Single Mode config updated in .env. Triggering reload...');
            ConfigManager.reloadConfig();

            if (typeof server.golemFactory === 'function') {
                const { GOLEMS_CONFIG: freshGolemsConfig } = ConfigManager;
                const singleGolemConfig = freshGolemsConfig.find((g) => g.id === 'golem_A') || {
                    id: 'golem_A',
                    tgToken,
                    tgAuthMode: tgAuthMode || 'ADMIN',
                    adminId: tgAdminId,
                    chatId: tgChatId,
                    dcToken,
                    dcAdminId,
                };

                try {
                    await server.golemFactory(singleGolemConfig);
                } catch (factoryErr) {
                    console.error('❌ [WebServer] Single Mode golem_A factory failed:', factoryErr.message);
                }
            }

            return res.json({
                success: true,
                mode: 'SINGLE',
                id: 'golem_A',
                message: 'Single Mode configuration updated successfully.'
            });
        } catch (e) {
            console.error('[WebServer] Failed to create Golem:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/start', requireGolemOps, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing Golem ID' });
            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');
            const personaManager = require('../../src/skills/core/persona');
            const envVars = EnvManager.readEnv();
            const isSystemConfigured = envVars.SYSTEM_CONFIGURED === 'true';
            const hasPersona = personaManager.exists(ConfigManager.MEMORY_BASE_DIR);

            if (!isSystemConfigured) {
                return res.status(409).json({
                    error: 'system_setup_required',
                    message: 'System setup is required before starting Golem.',
                });
            }

            if (!hasPersona) {
                return res.status(409).json({
                    error: 'persona_setup_required',
                    message: 'Persona setup is required before starting Golem.',
                });
            }

            let instance = server.contexts.get(id);
            if (!instance) {
                if (typeof server.golemFactory === 'function') {
                    console.log(`🧬 [WebServer] Golem '${id}' not in memory. Triggering lazy gestation (Single Mode)...`);
                    const targetConfig = ConfigManager.GOLEMS_CONFIG.find((g) => g.id === id);
                    if (!targetConfig) return res.status(404).json({ error: `Config for '${id}' not found in internal config.` });

                    await server.golemFactory(targetConfig);
                    instance = server.contexts.get(id);
                }
                if (!instance) return res.status(404).json({ error: `Golem '${id}' failed to gestate.` });
            }

            if (instance.brain.status === 'running') {
                return res.json({ success: true, message: 'Golem is already running.' });
            }

            console.log(`🎬 [WebServer] Explicitly starting Golem: ${id}`);
            instance.brain.status = 'booting';
            server.isBooting = true;
            try {
                await instance.brain.init();
                instance.brain.status = 'running';
            } finally {
                server.isBooting = false;
            }

            if (instance.brain.tgBot && typeof instance.brain.tgBot.startPolling === 'function') {
                try {
                    await instance.brain.tgBot.startPolling();
                    console.log(`🤖 [Bot] ${id} Telegram polling started.`);
                } catch (botErr) {
                    console.warn(`⚠️ [Bot] ${id} Polling failed:`, botErr.message);
                }
            }

            if (instance.autonomy && typeof instance.autonomy.start === 'function') {
                instance.autonomy.start();
            }

            return res.json({ success: true, message: `Golem '${id}' started successfully.` });
        } catch (e) {
            console.error('[WebServer] Failed to start Golem:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/stop', requireGolemOps, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing Golem ID' });

            console.log(`🛑 [WebServer] Stopping Golem: ${id}`);

            if (typeof global.stopGolem === 'function') {
                await global.stopGolem(id);
                server.removeContext(id);
                return res.json({ success: true, message: `Golem ${id} stopped.` });
            }

            const instance = server.contexts.get(id);
            if (instance && instance.brain && instance.brain.browser) {
                await instance.brain.browser.close();
                instance.brain.status = 'not_started';
                return res.json({ success: true, message: `Golem ${id} browser closed (fallback).` });
            }
            return res.status(404).json({ error: 'Stop helper not found and Golem not in memory.' });
        } catch (e) {
            console.error('❌ [WebServer] Stop failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/setup', requireGolemOps, async (req, res) => {
        const { golemId, aiName, userName, currentRole, tone, skills } = req.body;
        if (!golemId) return res.status(400).json({ error: 'Missing golemId' });
        const EnvManager = require('../../src/utils/EnvManager');
        const envVars = EnvManager.readEnv();
        const isSystemConfigured = envVars.SYSTEM_CONFIGURED === 'true';
        if (!isSystemConfigured) {
            return res.status(409).json({
                error: 'system_setup_required',
                message: 'Please complete /dashboard/system-setup before persona setup.',
            });
        }

        let context = server.contexts.get(golemId);

        if (!context || !context.brain) {
            console.log(`🏗️ [WebServer] Golem context [${golemId}] not found for setup. Attempting on-demand initialization...`);
            const ConfigManager = require('../../src/config/index');
            const golemConfig = ConfigManager.GOLEMS_CONFIG.find((g) => g.id === golemId) || {
                id: golemId,
                tgToken: ConfigManager.CONFIG.TG_TOKEN,
                tgAuthMode: ConfigManager.CONFIG.TG_AUTH_MODE,
                adminId: ConfigManager.CONFIG.ADMIN_ID,
                chatId: ConfigManager.CONFIG.TG_CHAT_ID,
                dcToken: ConfigManager.CONFIG.DC_TOKEN,
                dcAdminId: ConfigManager.CONFIG.DISCORD_ADMIN_ID,
            };

            if (!server.golemFactory) return res.status(500).json({ error: 'golemFactory not available' });

            try {
                const newInstance = await server.golemFactory(golemConfig);
                server.contexts.set(golemId, newInstance);
                context = server.contexts.get(golemId);
                console.log(`✅ [WebServer] Full context created for [${golemId}] via factory.`);
            } catch (e) {
                console.error(`❌ [WebServer] Failed to create context for [${golemId}]:`, e);
                return res.status(500).json({ error: 'Failed to initialize golem context' });
            }
        }

        try {
            const personaManager = require('../../src/skills/core/persona');
            personaManager.save(context.brain.userDataDir, {
                aiName: aiName || 'Golem',
                userName: userName || 'Traveler',
                currentRole: currentRole || '一個擁有長期記憶與自主意識的 AI 助手',
                tone: tone || '預設口氣',
                skills: skills || [],
                isNew: false
            });

            context.brain.status = 'booting';
            server.isBooting = true;

            (async () => {
                try {
                    await context.brain.init();
                    context.brain.status = 'running';

                    if (context.brain.tgBot && typeof context.brain.tgBot.startPolling === 'function') {
                        await context.brain.tgBot.startPolling();
                        console.log(`🤖 [Bot] ${golemId} started polling after setup.`);
                    }

                    if (context.autonomy && typeof context.autonomy.start === 'function') {
                        context.autonomy.start();
                    }
                } catch (err) {
                    console.error(`Failed to initialize Golem [${golemId}] after setup:`, err);
                    context.brain.status = 'error';
                } finally {
                    server.isBooting = false;
                    console.log(`✅ [WebServer] Setup complete for ${golemId}. Dashboard is ready.`);
                }
            })();

            return res.json({ success: true, message: 'Golem setup initiated and starting...' });
        } catch (e) {
            console.error('Setup error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
