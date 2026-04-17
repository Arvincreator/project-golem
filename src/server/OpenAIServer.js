// ============================================================
// 🌐 OpenAI-Compatible API Server (Herems ACP Adapter Inspired)
//
// 提供標準的 OpenAI API 介面 (POST /v1/chat/completions)
// 讓第三方工具（如 Claude Code、Cursor、VS Code 擴充）
// 能無縫連接並使用 Golem 的智能體網路與記憶。
// ============================================================

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const GolemBrain = require('../core/GolemBrain');

class OpenAIServer {
    /**
     * @param {object} options
     * @param {number} options.port - 監聽的 port
     * @param {string} options.modelAlias - 暴露給外部的模型名稱，預設 'golem-v9'
     * @param {Function} options.onRequest - (req) => void 外部監聽 Log
     */
    constructor(options = {}) {
        this.port = options.port || process.env.OPENAI_API_PORT || 3000;
        this.modelAlias = options.modelAlias || 'golem-v9';
        this.onRequest = options.onRequest || (() => {});
        this.app = express();
        
        // 為了避免與主 Golem 衝突，並且支援多個並發請求，
        // 我們維護一個自己的 GolemBrain Pool 或者簡單地每次請求實例化 / 鎖定一個實例。
        // 在此實作我們先使用單一獨立的 GolemBrain 實例專供 API 服務。
        this.apiBrain = new GolemBrain({ golemId: 'api_server' });

        this._setupMiddleware();
        this._setupRoutes();
    }

    _setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '10mb' }));
        
        // Authorization check (簡易防護)
        this.app.use((req, res, next) => {
            const authHeader = req.headers.authorization || '';
            const expectedToken = process.env.OPENAI_API_KEY;
            
            if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
                return res.status(401).json({ error: { message: 'Unauthorized. Invalid API Key.', type: 'invalid_request_error', code: 'invalid_api_key' } });
            }
            next();
        });
    }

    _setupRoutes() {
        // --- Models Endpoint ---
        this.app.get('/v1/models', (req, res) => {
            res.json({
                object: 'list',
                data: [
                    {
                        id: this.modelAlias,
                        object: 'model',
                        created: Date.now(),
                        owned_by: 'project-golem',
                    }
                ]
            });
        });

        // --- Chat Completions Endpoint ---
        this.app.post('/v1/chat/completions', async (req, res) => {
            try {
                this.onRequest(`[OAI Server] 收到請求: ${req.body.model}`);
                
                const { messages, stream, model } = req.body;
                
                if (!messages || !Array.isArray(messages)) {
                    return res.status(400).json({ error: { message: 'messages is required and must be an array' } });
                }

                // 確保 apiBrain 已初始化
                if (!this.apiBrain.isInitialized) {
                    await this.apiBrain.init();
                }

                // 將 OpenAI messages 轉換為 Golem 可讀的字串
                const promptString = this._convertMessagesToPrompt(messages);

                // 呼叫 GolemBrain
                // TODO: 這裡如果是 streaming，需要實作 GolemBrain 的 stdout hook，目前先實作 Blocking 非流式
                this.onRequest(`[OAI Server] 正在呼叫大腦... (${promptString.length} chars)`);
                const rawResponse = await this.apiBrain.sendMessage(promptString);
                
                // Titan Protocol 解析：如果有 JSON 或包裹，我們只取回覆文字給予外部？
                // OpenAI 客戶端通常只期望純文字助手回覆。
                const replyText = typeof rawResponse === 'string' ? rawResponse : (rawResponse.text || '');

                if (stream) {
                    // 模擬 Streaming (一次性吐出)
                    this._sendSSE(res, [replyText]);
                } else {
                    res.json({
                        id: `chatcmpl-${uuidv4()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: model || this.modelAlias,
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: replyText,
                            },
                            finish_reason: 'stop'
                        }],
                        usage: {
                            prompt_tokens: promptString.length / 4, // 概算
                            completion_tokens: replyText.length / 4,
                            total_tokens: (promptString.length + replyText.length) / 4
                        }
                    });
                }

                this.onRequest(`[OAI Server] 請求完成 ✅`);
            } catch (error) {
                console.error('[OpenAIServer] 處理錯誤:', error);
                this.onRequest(`[OAI Server] ❌ 錯誤: ${error.message}`);
                
                if (!res.headersSent) {
                    res.status(500).json({
                        error: {
                            message: `Golem Backend Error: ${error.message}`,
                            type: 'server_error'
                        }
                    });
                }
            }
        });
    }

    _convertMessagesToPrompt(messages) {
        let prompt = `【系統：以下是從外部 API 客戶端傳來的對話紀錄】\n`;
        for (const msg of messages) {
            const role = msg.role.toUpperCase();
            prompt += `[${role}]:\n${msg.content}\n\n`;
        }
        prompt += `請基於以上對話給予回覆 (不需要加上 [ASSISTANT] 等前綴字，直接回覆內容)：`;
        return prompt;
    }

    _sendSSE(res, chunks) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const cmplId = `chatcmpl-${uuidv4()}`;
        const created = Math.floor(Date.now() / 1000);

        for (const chunk of chunks) {
            const data = {
                id: cmplId,
                object: 'chat.completion.chunk',
                created: created,
                model: this.modelAlias,
                choices: [{
                    index: 0,
                    delta: { content: chunk },
                    finish_reason: null
                }]
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }

        const doneData = {
            id: cmplId,
            object: 'chat.completion.chunk',
            created: created,
            model: this.modelAlias,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        };
        res.write(`data: ${JSON.stringify(doneData)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }

    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                const url = `http://localhost:${this.port}/v1`;
                console.log(`🔌 [OpenAIServer] API 伺服器啟動於 ${url}`);
                console.log(`🔌 [OpenAIServer] 支援模型名稱: ${this.modelAlias}`);
                resolve(url);
            });
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log(`🔌 [OpenAIServer] Server Stopped.`);
        }
    }
}

module.exports = OpenAIServer;
