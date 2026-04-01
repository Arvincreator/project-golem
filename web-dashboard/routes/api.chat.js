const express = require('express');
const fs = require('fs');
const path = require('path');
const { buildOperationGuard } = require('../server/security');

module.exports = function(server) {
    const router = express.Router();
    const requirePlanningModeUpdate = buildOperationGuard(server, 'chat_planning_mode_update');

    router.get('/api/chat/planning-mode', async (req, res) => {
        try {
            const golemId = String(req.query && req.query.golemId || 'golem_A').trim() || 'golem_A';
            if (!server.runtimeController || typeof server.runtimeController.getChatPlanningMode !== 'function') {
                return res.status(503).json({ error: 'Planning mode service unavailable' });
            }

            const result = await server.runtimeController.getChatPlanningMode(golemId);
            return res.json({
                success: true,
                golemId,
                planningMode: result && result.planningMode ? result.planningMode : { enabled: false, updatedAt: Date.now() },
            });
        } catch (e) {
            console.error('Failed to get planning mode:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/chat/planning-mode', requirePlanningModeUpdate, async (req, res) => {
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const golemId = String(body.golemId || 'golem_A').trim() || 'golem_A';
            if (typeof body.enabled !== 'boolean') {
                return res.status(400).json({ error: 'enabled must be boolean' });
            }

            if (!server.runtimeController || typeof server.runtimeController.setChatPlanningMode !== 'function') {
                return res.status(503).json({ error: 'Planning mode service unavailable' });
            }

            const persist = body.persist !== false;
            const result = await server.runtimeController.setChatPlanningMode(golemId, body.enabled, {
                persist,
                source: 'dashboard_api',
            });
            return res.json({
                success: true,
                golemId,
                planningMode: result && result.planningMode ? result.planningMode : { enabled: body.enabled, updatedAt: Date.now() },
            });
        } catch (e) {
            console.error('Failed to update planning mode:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/chat', async (req, res) => {
        try {
            const { golemId, message, attachment: attachmentData } = req.body;
            if (!golemId || (!message && !attachmentData)) {
                return res.status(400).json({ error: 'Missing golemId, message or attachment' });
            }

            if (!server.runtimeController) {
                return res.status(503).json({ error: 'Dashboard message handler not ready' });
            }

            let finalMimeType = attachmentData ? attachmentData.mimeType : null;
            if (attachmentData && !finalMimeType && attachmentData.url) {
                const ext = attachmentData.url.split('.').pop().toLowerCase();
                const mimeMap = {
                    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp',
                    'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown', 'sh': 'text/x-sh', 'js': 'text/javascript'
                };
                finalMimeType = mimeMap[ext] || 'application/octet-stream';
            }

            const attachment = attachmentData ? {
                isNative: true,
                path: attachmentData.path,
                url: attachmentData.url,
                mimeType: finalMimeType || 'application/octet-stream'
            } : null;

            if (attachment && attachment.path) {
                const uploadRoot = path.resolve(process.cwd(), 'data', 'temp_uploads');
                const resolvedPath = path.resolve(String(attachment.path));
                const isInsideUploadDir = resolvedPath === uploadRoot || resolvedPath.startsWith(`${uploadRoot}${path.sep}`);

                if (!isInsideUploadDir || !fs.existsSync(resolvedPath)) {
                    return res.status(400).json({ error: 'Invalid attachment path' });
                }
                attachment.path = resolvedPath;
            }

            server.broadcastLog({
                time: new Date().toLocaleTimeString(),
                msg: `[User] ${message || (attachment ? '[圖片]' : '')}`,
                type: 'agent',
                raw: `[User] ${message || '[圖片]'}`,
                golemId,
                attachment: attachment ? { url: attachment.url, mimeType: attachment.mimeType } : null
            });

            server.broadcastLog({
                time: new Date().toLocaleTimeString(),
                msg: `[${golemId}] ...`,
                type: 'thinking',
                raw: '...',
                golemId
            });

            server.runtimeController.sendDashboardChat({
                golemId,
                message,
                attachment,
                meta: {
                    platform: 'web',
                    chatId: 'web-dashboard',
                    senderName: 'User',
                },
            }).catch(exp => {
                console.error('[WebServer] Direct chat error:', exp);
            });

            return res.json({ success: true });
        } catch (e) {
            console.error('Failed to send chat message:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/chat/callback', async (req, res) => {
        try {
            const { golemId, callback_data } = req.body;
            if (!golemId || !callback_data) {
                return res.status(400).json({ error: 'Missing golemId or callback_data' });
            }

            let translatedMsg = callback_data;
            let displayType = 'agent';

            if (callback_data.includes('_')) {
                const [action, taskId] = callback_data.split('_');
                const isApprove = action === 'APPROVE';
                const isDeny = action === 'DENY';

                if (isApprove || isDeny) {
                    translatedMsg = isApprove ? '✅ 批准執行' : '❌ 拒絕執行';
                    displayType = 'agent';

                    try {
                        if (server.runtimeController) {
                            const task = await server.runtimeController.getPendingTaskSummary(golemId, taskId);
                            if (task && task.cmd) {
                                translatedMsg += `: \`${task.cmd.length > 50 ? task.cmd.substring(0, 47) + '...' : task.cmd}\``;
                            }
                        }
                    } catch (err) {
                        console.warn('[WebServer] 無法取得任務上下文:', err.message);
                    }
                }
            }

            server.broadcastLog({
                time: new Date().toLocaleTimeString(),
                msg: `[WebUser] ${translatedMsg}`,
                type: displayType,
                raw: `[User] ${translatedMsg}`,
                golemId
            });

            server.broadcastLog({
                time: new Date().toLocaleTimeString(),
                msg: `[${golemId}] ...`,
                type: 'thinking',
                raw: '...',
                golemId
            });

            if (server.runtimeController) {
                setTimeout(() => {
                    server.runtimeController.sendDashboardCallback({
                        golemId,
                        callbackData: callback_data,
                        meta: {
                            platform: 'web',
                            chatId: 'web-dashboard',
                        },
                    }).catch(console.error);
                }, 100);
            }

            return res.json({ success: true });
        } catch (e) {
            console.error('Failed to send callback query:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/chat/history', (req, res) => {
        try {
            const { golemId } = req.query;
            if (!golemId) return res.status(400).json({ error: 'golemId required' });

            const history = server.chatHistory ? (server.chatHistory.get(golemId) || []) : [];
            return res.json({ success: true, history });
        } catch (e) {
            console.error('Failed to fetch chat history:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/commands', (req, res) => {
        try {
            const commands = require('../../src/config/commands.js');
            return res.json({ success: true, commands });
        } catch (e) {
            console.error('Failed to fetch commands:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/metacognition/stats', async (req, res) => {
        try {
            const { golemId } = req.query;
            if (!golemId) return res.status(400).json({ error: 'golemId required' });
            
            if (!server.runtimeController) {
                return res.status(503).json({ error: 'Runtime controller not ready' });
            }

            const stats = await server.runtimeController.getMetacognitionStats(golemId);
            return res.json({ success: true, stats });
        } catch (e) {
            console.error('Failed to fetch metacognition stats:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/metacognition/history', async (req, res) => {
        try {
            const { golemId, limit } = req.query;
            if (!golemId) return res.status(400).json({ error: 'golemId required' });

            if (!server.runtimeController) {
                return res.status(503).json({ error: 'Runtime controller not ready' });
            }

            const rawLimit = limit ? parseInt(limit, 10) : 20;
            const parsedLimit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 20;
            const history = await server.runtimeController.getMetacognitionHistory(golemId, parsedLimit);
            return res.json({ success: true, history });
        } catch (e) {
            console.error('Failed to fetch metacognition history:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
