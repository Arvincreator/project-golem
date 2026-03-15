// ============================================================
// RouterBrain — Intelligent multi-model router
// Fallback chain: Monica Web → Monica API → Gemini SDK → Ollama
// 6-dim classification + cost-aware + token-aware + sticky routing
// ============================================================
const path = require('path');
const ConfigManager = require('../config');
const ProtocolFormatter = require('../services/ProtocolFormatter');
const ChatLogManager = require('../managers/ChatLogManager');
const SkillIndexManager = require('../managers/SkillIndexManager');
const NodeRouter = require('./NodeRouter');
const SystemNativeDriver = require('../memory/SystemNativeDriver');
const circuitBreaker = require('./circuit_breaker');
const { MODEL_SPECS, MODEL_REGISTRY, CROSS_BRAIN_FALLBACKS, resolveForBrain, getModelSpec, estimateTokens, ROUTING_RULES } = require('./monica-constants');

const DEFAULT_MODEL = 'gpt-4o';

class RouterBrain {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this.userDataDir = options.userDataDir || path.resolve(ConfigManager.CONFIG.USER_DATA_DIR || './golem_memory');
        this.skillIndex = new SkillIndexManager(this.userDataDir);

        this.browser = null;
        this.page = null;

        this.memoryDriver = new SystemNativeDriver();
        this.chatLogManager = new ChatLogManager({
            golemId: this.golemId,
            logDir: options.logDir || ConfigManager.LOG_BASE_DIR,
            isSingleMode: options.isSingleMode !== undefined ? options.isSingleMode : (ConfigManager.GOLEM_MODE === 'SINGLE')
        });

        this._options = options;
        this._brains = {};
        this._fallbackChain = ['monica-web', 'monica', 'sdk', 'ollama'];
        this._forceOverride = null;
        this._routingHistory = [];
        this._lastBrainUsed = null;
        this._lastRoute = null;
        this._modelFailCounts = {};

        this.status = 'idle';
    }

    async init(forceReload = false) {
        if (this.status === 'running' && !forceReload) return;

        try { await this.memoryDriver.init(); } catch (e) {
            console.warn('[Router] Memory init failed:', e.message);
        }
        await this.chatLogManager.init();

        const sharedOpts = {
            ...this._options,
            golemId: this.golemId,
            userDataDir: this.userDataDir,
            memoryDriver: this.memoryDriver,
            chatLogManager: this.chatLogManager,
            skillIndex: this.skillIndex,
        };

        // Init brains: monica-web, monica, sdk, ollama
        const brainDefs = [
            { name: 'monica-web', path: './MonicaWebBrain', label: 'Monica Web' },
            { name: 'monica',     path: './MonicaBrain',    label: 'Monica API' },
            { name: 'sdk',        path: './SdkBrain',       label: 'Gemini SDK' },
            { name: 'ollama',     path: './OllamaBrain',    label: 'Ollama' },
        ];

        for (const def of brainDefs) {
            try {
                const BrainClass = require(def.path);
                this._brains[def.name] = new BrainClass(sharedOpts);
                await this._brains[def.name].init(forceReload);
                console.log(`[Router] ${def.label} initialized`);
            } catch (e) {
                console.warn(`[Router] ${def.label} init failed:`, e.message);
            }
        }

        // Load persisted model override
        try {
            const fs = require('fs');
            const overridePath = require('path').resolve(process.cwd(), 'model_override.json');
            if (fs.existsSync(overridePath)) {
                const override = JSON.parse(fs.readFileSync(overridePath, 'utf-8'));
                if (override.model) {
                    this._forceOverride = { brain: 'monica-web', model: override.model };
                    console.log(`[Router] Restored model override: ${override.model}`);
                }
            }
        } catch (e) { /* ignore */ }

        this.status = 'running';
        console.log(`[Router:${this.golemId}] Brains: [${Object.keys(this._brains).join(', ')}]`);
    }

    async sendMessage(text, isSystem = false, options = {}) {
        if (this.status !== 'running') await this.init();

        // Command interception
        if (text.startsWith('/') || text.startsWith('GOLEM_SKILL::')) {
            if (text.startsWith('/router')) return this._handleRouterCommand(text);
            const result = await NodeRouter.handle({ text, isAdmin: true }, this);
            if (result) return result;
        }

        const route = this._forceOverride || this._classifyAndRoute(text);
        const targetChain = this._buildFallbackChain(route);

        for (const brainName of targetChain) {
            const brain = this._brains[brainName];
            if (!brain) continue;

            if (!circuitBreaker.canExecute(brainName)) {
                console.warn(`[Router] ${brainName} circuit OPEN, skipping`);
                continue;
            }

            try {
                // Switch model for Monica brains — resolve per brain type
                if (brainName === 'monica-web' && route.model) {
                    const resolved = resolveForBrain(route.model, 'web');
                    if (resolved) await brain.switchModel(resolved.model);
                } else if (brainName === 'monica' && route.model) {
                    const resolved = resolveForBrain(route.model, 'api');
                    if (resolved) await brain.switchModel(resolved.model);
                }

                const result = await brain.sendMessage(text, isSystem, options);
                this._lastBrainUsed = brainName;
                this._lastRoute = route;
                const resLen = typeof result === 'string' ? result.length : 0;
                this._recordRouting(text, brainName, route.model, true, null, resLen);
                if (route.model) this._modelFailCounts[route.model] = 0;
                return result;
            } catch (e) {
                console.warn(`[Router] ${brainName} failed: ${e.message}`);
                this._recordRouting(text, brainName, route.model || '', false, e.message, 0);
                if (route.model) this._modelFailCounts[route.model] = (this._modelFailCounts[route.model] || 0) + 1;
            }
        }

        throw new Error('[Router] All brain engines exhausted');
    }

    async recall(queryText) {
        if (!queryText) return [];
        try { return await this.memoryDriver.recall(queryText); } catch (e) { return []; }
    }

    async memorize(text, metadata = {}) {
        try { await this.memoryDriver.memorize(text, metadata); } catch (e) {
            console.warn('[Router] memorize failed:', e.message);
        }
    }

    async switchModel(model) {
        // Try web brain first, then API
        if (this._brains['monica-web']) {
            const resolved = resolveForBrain(model, 'web');
            if (resolved) {
                const result = await this._brains['monica-web'].switchModel(model);
                this._forceOverride = { brain: 'monica-web', model };
                return result;
            }
        }
        if (this._brains.monica) {
            const resolved = resolveForBrain(model, 'api');
            if (resolved) {
                const result = await this._brains.monica.switchModel(resolved.model);
                this._forceOverride = { brain: 'monica', model: resolved.model };
                return result;
            }
        }
        if (this._brains.sdk) return this._brains.sdk.switchModel(model);
        return 'No brain available for model switch';
    }

    async reloadSkills() {
        for (const [name, brain] of Object.entries(this._brains)) {
            try { await brain.reloadSkills(); } catch (e) {
                console.warn(`[Router] ${name} skill reload failed:`, e.message);
            }
        }
    }

    _appendChatLog(entry) {
        this.chatLogManager.init().then(() => this.chatLogManager.append(entry));
    }

    _linkDashboard() {
        if (!process.argv.includes('dashboard')) return;
        try {
            const dashboard = require('../../dashboard');
            dashboard.setContext(this.golemId, this, this.memoryDriver);
        } catch (e) { /* optional */ }
    }

    // --- Routing Logic ---

    _classifyAndRoute(text) {
        const tokens = estimateTokens(text);

        // 1. Keyword classification
        let matched = null;
        for (const rule of ROUTING_RULES) {
            if (rule.patterns.test(text)) {
                matched = { brain: 'monica-web', model: rule.model, classification: rule.name };
                break;
            }
        }

        // 2. Length/token-based fallback
        if (!matched) {
            if (text.length < 50) {
                matched = { brain: 'monica-web', model: 'gpt-4.1-nano', classification: 'short' };
            } else if (text.length > 1000) {
                matched = { brain: 'monica-web', model: 'gpt-4o', classification: 'deep' };
            } else {
                matched = { brain: 'monica-web', model: DEFAULT_MODEL, classification: 'default' };
            }
        }

        // 3. Token overflow check: if input exceeds model context, switch to larger context model
        const spec = getModelSpec(matched.model);
        if (tokens > spec.context * 0.8) {
            // Gemini has 1M context — best for huge inputs
            matched.model = 'gemini-2.5-pro';
            console.log(`[Router] Input ~${tokens} tokens exceeds ${spec.context} context, switching to gemini-2.5-pro`);
        }

        // 4. Sticky routing: same classification → keep last successful model
        if (this._lastRoute && this._lastRoute.classification === matched.classification) {
            matched.model = this._lastRoute.model;
        }

        // 5. Per-model circuit breaker
        if ((this._modelFailCounts[matched.model] || 0) >= 3 && matched.model !== DEFAULT_MODEL) {
            console.warn(`[Router] ${matched.model} failed ${this._modelFailCounts[matched.model]}x, falling back`);
            matched.model = DEFAULT_MODEL;
        }

        return matched;
    }

    _buildFallbackChain(route) {
        // Primary brain first, then rest of fallback chain
        return [route.brain, ...this._fallbackChain.filter(b => b !== route.brain)];
    }

    _recordRouting(text, brain, model, success, error = null, responseLen = 0) {
        const tokens = estimateTokens(text);
        const spec = getModelSpec(model);
        const cost = success ? (tokens * spec.costIn + estimateTokens(String(responseLen)) * spec.costOut) / 1000000 : 0;

        this._routingHistory.push({
            time: new Date().toISOString(),
            brain, model, success,
            inputLen: text.length,
            inputTokens: tokens,
            responseLen,
            cost,
            error: error ? error.substring(0, 100) : null,
        });
        if (this._routingHistory.length > 200) this._routingHistory.shift();

        // Quality flag: too short or too long responses
        if (success && (responseLen < 20 || responseLen > 10000)) {
            this._modelFailCounts[model] = (this._modelFailCounts[model] || 0) + 1;
            console.warn(`[Router] Quality: ${model} ${responseLen}ch (${responseLen < 20 ? 'short' : 'long'})`);
        }
    }

    // --- /router Command Handler ---

    _handleRouterCommand(text) {
        const parts = text.trim().split(/\s+/);
        const sub = parts[1] || 'status';

        if (sub === 'status') {
            return this._routerStatus();
        }

        if (sub === 'use') {
            const targetBrain = parts[2];
            const targetModel = parts[3];
            if (!targetBrain) return '用法: /router use <brain> [model]\n可用: monica-web, monica, sdk, ollama';
            this._forceOverride = { brain: targetBrain, model: targetModel || null };
            return `已手動切換至 ${targetBrain}${targetModel ? ' / ' + targetModel : ''}\n/router auto 恢復自動路由`;
        }

        if (sub === 'auto') {
            this._forceOverride = null;
            return '已恢復自動智能路由';
        }

        if (sub === 'history') {
            const recent = this._routingHistory.slice(-10);
            if (recent.length === 0) return '尚無路由紀錄';
            return '[路由紀錄]\n' + recent.map(r =>
                `${r.success ? '✅' : '❌'} ${r.brain}/${r.model} (${r.inputTokens}tk→${r.responseLen}ch${r.cost > 0 ? ' $' + r.cost.toFixed(4) : ''}) ${r.error || ''}`
            ).join('\n');
        }

        if (sub === 'models') {
            return this._modelCatalog();
        }

        if (sub === 'cost') {
            return this._costReport();
        }

        return '指令: /router status | use <brain> [model] | auto | history | models | cost';
    }

    _routerStatus() {
        const lines = ['[Router Status]'];
        lines.push(`Active: ${this._lastBrainUsed || 'none'} / ${this._lastRoute ? this._lastRoute.model : 'none'}`);
        lines.push(`Override: ${this._forceOverride ? `${this._forceOverride.brain}/${this._forceOverride.model}` : 'AUTO'}`);
        lines.push('');

        const cbStatus = typeof circuitBreaker.getStatus === 'function' ? circuitBreaker.getStatus() : {};
        for (const [name] of Object.entries(this._brains)) {
            const cb = cbStatus[name] || null;
            const state = cb ? cb.state : 'UNKNOWN';
            const icon = state === 'CLOSED' ? '🟢' : state === 'OPEN' ? '🔴' : '🟡';
            lines.push(`  ${icon} ${name}: ${state}`);
        }

        // Routing rules summary
        lines.push('');
        lines.push('Rules: code→claude-4.6-sonnet | reasoning→gpt-5.4 | creative→gpt-5.4');
        lines.push('       fast→gpt-4.1-mini | analysis→gemini-3.1-pro | flex→gpt-4o');
        lines.push('       <50ch→gpt-4.1-nano | >1000ch→gpt-4o | >ctx→gemini-2.5-pro');

        const failModels = Object.entries(this._modelFailCounts).filter(([, c]) => c > 0);
        if (failModels.length > 0) {
            lines.push('');
            lines.push('Flags: ' + failModels.map(([m, c]) => `${m}(${c})`).join(', '));
        }

        return lines.join('\n');
    }

    _modelCatalog() {
        const lines = ['[Model Catalog — 16 Models]', ''];
        const tierIcons = { advanced: '🔥', basic: '⚡' };

        lines.push('🔥 Advanced (Web only):');
        for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
            if (entry.tier !== 'advanced') continue;
            const api = entry.api ? `API: ${entry.api.id}` : `fallback: ${CROSS_BRAIN_FALLBACKS[name] || 'none'}`;
            lines.push(`  ${name.padEnd(18)} web:${(entry.web.keywords[0] || '').padEnd(20)} ${api}`);
        }

        lines.push('');
        lines.push('⚡ Basic (Web + API):');
        for (const [name, entry] of Object.entries(MODEL_REGISTRY)) {
            if (entry.tier !== 'basic') continue;
            const api = entry.api ? `API: ${entry.api.id}` : `fallback: ${CROSS_BRAIN_FALLBACKS[name] || 'web-only'}`;
            const ctx = entry.context ? ` ctx:${entry.context >= 1000000 ? entry.context / 1000000 + 'M' : entry.context / 1000 + 'K'}` : '';
            lines.push(`  ${name.padEnd(18)} web:${(entry.web.keywords[0] || '').padEnd(20)} ${api}${ctx}`);
        }

        return lines.join('\n');
    }

    _costReport() {
        const recent = this._routingHistory.filter(r => r.success && r.cost > 0);
        if (recent.length === 0) return '尚無成本記錄';
        const total = recent.reduce((s, r) => s + r.cost, 0);
        const byModel = {};
        for (const r of recent) {
            byModel[r.model] = (byModel[r.model] || 0) + r.cost;
        }
        const lines = [`[成本報告] 總計: $${total.toFixed(4)} (${recent.length} 次呼叫)`, ''];
        for (const [m, c] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
            lines.push(`  ${m}: $${c.toFixed(4)}`);
        }

        // Monica API stats if available
        const monica = this._brains.monica;
        if (monica && typeof monica.getStats === 'function') {
            const stats = monica.getStats();
            lines.push('');
            lines.push(`[Monica API] keys:${stats.keyCount} rpm:${stats.recentRPM}/${stats.rpm} total:$${stats.totalCost.toFixed(4)}`);
        }

        return lines.join('\n');
    }
}

module.exports = RouterBrain;
