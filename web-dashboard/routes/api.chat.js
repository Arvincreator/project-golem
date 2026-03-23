const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = function(server) {
    const router = express.Router();
    const resolveConvoManager = (instance) => {
        // Backward/forward compatibility:
        // - newer core uses "convoManager"
        // - legacy code might still expose "conversationManager"
        return instance?.convoManager || instance?.conversationManager || null;
    };

    router.post('/api/chat', async (req, res) => {
        try {
            const { golemId, message, attachment: attachmentData } = req.body;
            if (!golemId || (!message && !attachmentData)) {
                return res.status(400).json({ error: 'Missing golemId, message or attachment' });
            }

            const index = require('../../index.js');
            const dashboardMessageHandler =
                (typeof index.handleDashboardMessage === 'function' && index.handleDashboardMessage) ||
                (typeof index.handleUnifiedMessage === 'function' && index.handleUnifiedMessage) ||
                (typeof global.handleDashboardMessage === 'function' && global.handleDashboardMessage) ||
                null;

            if (!dashboardMessageHandler) {
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

            const mockContext = {
                platform: 'web',
                isAdmin: true,
                text: message,
                messageTime: Date.now(),
                senderName: 'User',
                replyToName: '',
                chatId: 'web-dashboard',
                reply: async (text, options) => {
                    let payloadType = 'agent';
                    let actionData = null;

                    if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
                        payloadType = 'approval';
                        actionData = options.reply_markup.inline_keyboard[0];
                    }

                    server.broadcastLog({
                        time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                        msg: `[${golemId}] ${text}`,
                        type: payloadType,
                        raw: text,
                        actionData,
                        golemId
                    });
                },
                sendTyping: async () => { },
                getAttachment: async () => attachment,
                instance: { username: golemId }
            };

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

            dashboardMessageHandler(mockContext, golemId).catch(exp => {
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

            const index = require('../../index.js');

            const mockContext = {
                platform: 'web',
                isAdmin: true,
                data: callback_data,
                messageTime: Date.now(),
                senderName: 'User',
                replyToName: '',
                chatId: 'web-dashboard',
                reply: async (text, options) => {
                    let payloadType = 'agent';
                    let actionData = null;

                    if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
                        payloadType = 'approval';
                        actionData = options.reply_markup.inline_keyboard[0];
                    }

                    server.broadcastLog({
                        time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                        msg: `[${golemId}] ${text}`,
                        type: payloadType,
                        raw: text,
                        actionData,
                        golemId
                    });
                },
                answerCallbackQuery: async () => { },
                sendTyping: async () => { },
                instance: { username: golemId }
            };

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
                        const instance = index.getOrCreateGolem ? index.getOrCreateGolem(golemId) : null;
                        if (instance && instance.controller && instance.controller.pendingTasks) {
                            const task = instance.controller.pendingTasks.get(taskId);
                            if (task && task.steps && task.steps[task.nextIndex]) {
                                const step = task.steps[task.nextIndex];
                                const cmd = step.cmd || step.parameter || step.command || "";
                                if (cmd) {
                                    translatedMsg += `: \`${cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd}\``;
                                }
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

            setTimeout(() => {
                const callbackHandler =
                    (typeof index.handleUnifiedCallback === 'function' && index.handleUnifiedCallback) ||
                    (typeof global.handleUnifiedCallback === 'function' && global.handleUnifiedCallback) ||
                    null;

                if (callbackHandler) {
                    callbackHandler(mockContext, callback_data, golemId).catch(console.error);
                } else {
                    console.error('[WebServer] handleUnifiedCallback not found in index.js exports or global');
                }
            }, 100);

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
            
            const index = require('../../index.js');
            const instance = index.getOrCreateGolem ? index.getOrCreateGolem(golemId) : null;
            const convoManager = resolveConvoManager(instance);
            if (!convoManager || !convoManager.confidenceTracker) {
                return res.status(404).json({ error: 'ConfidenceTracker not found for this golem instance' });
            }

            const stats = await convoManager.confidenceTracker.getStats();
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

            const index = require('../../index.js');
            const instance = index.getOrCreateGolem ? index.getOrCreateGolem(golemId) : null;
            const convoManager = resolveConvoManager(instance);
            if (!convoManager || !convoManager.confidenceTracker) {
                return res.status(404).json({ error: 'ConfidenceTracker not found for this golem instance' });
            }

            const rawLimit = limit ? parseInt(limit, 10) : 20;
            const parsedLimit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 20;
            const history = await convoManager.confidenceTracker.getHistory(parsedLimit);
            return res.json({ success: true, history });
        } catch (e) {
            console.error('Failed to fetch metacognition history:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
