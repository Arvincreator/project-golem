// ============================================================
// ClaudeGateway — REST API for Claude → Golem bidirectional integration
// v10.5: Allows external Claude instances to call Golem brains
// Routes mounted under /api/claude/
// ============================================================

const crypto = require('crypto');

class ClaudeGateway {
    constructor(brain, options = {}) {
        this._brain = brain;
        this._brains = options.brains || {}; // name → brain instance map
        this._ragProvider = options.ragProvider || null;
        this._token = null;
        this._rateLimitRpm = 60;
        this._requestCounts = new Map(); // clientId → timestamp[]

        // Load config
        try {
            const { getConfig } = require('../config/xml-config-loader');
            const cfg = getConfig();
            const gwCfg = cfg.getClaudeGatewayConfig();
            if (gwCfg) {
                this._token = process.env[gwCfg.tokenEnv] || process.env.CLAUDE_GATEWAY_TOKEN || null;
                this._rateLimitRpm = gwCfg.rateLimitRpm || 60;
            }
        } catch (e) {
            this._token = process.env.CLAUDE_GATEWAY_TOKEN || null;
        }
    }

    /**
     * Set brain context (called after brain init)
     */
    setContext(brain, brains, ragProvider) {
        this._brain = brain;
        if (brains) this._brains = brains;
        if (ragProvider) this._ragProvider = ragProvider;
    }

    /**
     * Mount all gateway routes on an Express app
     */
    mountRoutes(app) {
        const prefix = '/api/claude';

        // Auth + rate limit middleware
        app.use(prefix, (req, res, next) => {
            if (!this._authenticate(req)) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const clientId = req.headers['x-client-id'] || 'default';
            if (!this._checkRateLimit(clientId)) {
                return res.status(429).json({ error: 'Rate limit exceeded' });
            }
            next();
        });

        // POST /api/claude/chat — Send message to default brain
        app.post(`${prefix}/chat`, async (req, res) => {
            try {
                const { message, brain: brainName } = req.body;
                if (!message) return res.status(400).json({ error: 'message required' });
                if (typeof message !== 'string') return res.status(400).json({ error: 'message must be a string' });
                if (message.length > 100000) return res.status(413).json({ error: 'message too large' });

                const targetBrain = brainName ? this._brains[brainName] : this._brain;
                if (!targetBrain) return res.status(404).json({ error: `Brain '${brainName || 'default'}' not found` });

                const response = await targetBrain.sendMessage(message);
                res.json({ response, brain: brainName || 'default' });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // POST /api/claude/recall — Query RAG
        app.post(`${prefix}/recall`, async (req, res) => {
            try {
                const { query, limit } = req.body;
                if (!query) return res.status(400).json({ error: 'query required' });
                if (typeof query !== 'string') return res.status(400).json({ error: 'query must be a string' });
                if (query.length > 100000) return res.status(413).json({ error: 'query too large' });

                if (this._ragProvider) {
                    const result = await this._ragProvider.augmentedRecall(query, { limit: limit || 5 });
                    return res.json(result);
                }

                // Fallback to brain recall
                if (this._brain) {
                    const results = await this._brain.recall(query);
                    return res.json({ merged: results, contextString: '' });
                }

                res.json({ merged: [], contextString: '' });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // POST /api/claude/memorize — Store in RAG
        app.post(`${prefix}/memorize`, async (req, res) => {
            try {
                const { content, metadata } = req.body;
                if (!content) return res.status(400).json({ error: 'content required' });
                if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
                if (content.length > 100000) return res.status(413).json({ error: 'content too large' });

                if (this._ragProvider) {
                    await this._ragProvider.ingest(content, metadata || {});
                } else if (this._brain) {
                    await this._brain.memorize(content, metadata || {});
                }

                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // GET /api/claude/brains — List available brains
        app.get(`${prefix}/brains`, (req, res) => {
            const brains = Object.keys(this._brains);
            if (this._brain && !brains.includes('default')) brains.unshift('default');
            res.json({ brains });
        });

        // POST /api/claude/brain/:name — Call specific brain
        app.post(`${prefix}/brain/:name`, async (req, res) => {
            try {
                const brain = this._brains[req.params.name];
                if (!brain) return res.status(404).json({ error: `Brain '${req.params.name}' not found` });

                const { message } = req.body;
                if (!message) return res.status(400).json({ error: 'message required' });
                if (typeof message !== 'string') return res.status(400).json({ error: 'message must be a string' });
                if (message.length > 100000) return res.status(413).json({ error: 'message too large' });

                const response = await brain.sendMessage(message);
                res.json({ response, brain: req.params.name });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // GET /api/claude/health — Health check
        app.get(`${prefix}/health`, (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                brains: Object.keys(this._brains).length + (this._brain ? 1 : 0),
                ragAvailable: !!this._ragProvider,
            });
        });

        console.log(`[ClaudeGateway] Routes mounted at ${prefix}/*`);
    }

    /**
     * Authenticate request via Bearer token
     */
    _authenticate(req) {
        if (!this._token) return true; // No token configured = open (dev mode)
        const auth = req.headers.authorization;
        if (!auth) return false;
        const [scheme, token] = auth.split(' ');
        if (scheme !== 'Bearer' || !token) return false;
        // HMAC comparison: constant-time regardless of input length
        const hmac = (s) => crypto.createHmac('sha256', 'gateway-auth').update(s).digest();
        try {
            return crypto.timingSafeEqual(hmac(token), hmac(this._token));
        } catch {
            return false;
        }
    }

    /**
     * Sliding window rate limiter
     */
    _checkRateLimit(clientId) {
        const now = Date.now();
        let timestamps = this._requestCounts.get(clientId) || [];
        timestamps = timestamps.filter(t => t > now - 60000); // Remove expired

        // Cleanup stale entries to prevent unbounded memory growth
        if (this._requestCounts.size > 1000) {
            for (const [id, ts] of this._requestCounts) {
                if (ts.length === 0 || ts[ts.length - 1] < now - 60000) {
                    this._requestCounts.delete(id);
                }
            }
        }

        if (timestamps.length >= this._rateLimitRpm) {
            this._requestCounts.set(clientId, timestamps);
            return false;
        }
        timestamps.push(now);
        this._requestCounts.set(clientId, timestamps);
        return true;
    }
}

module.exports = ClaudeGateway;
