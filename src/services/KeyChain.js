const { CONFIG } = require('../config');

// ============================================================
// 🗝️ KeyChain & 🚑 DOM Doctor (已修復 AI 廢話導致崩潰問題)
// ============================================================
class KeyChain {
    constructor() {
        this.keys = CONFIG.API_KEYS;
        this.currentIndex = 0;
        // 🔥 [v8.7 保留] API 節流與冷卻機制
        this._lastCallTime = 0;
        this._minInterval = 2500;
        this._cooldownUntil = new Map();
        this._stats = new Map();
        this.keys.forEach(k => this._stats.set(k, { calls: 0, errors: 0, lastUsed: 0 }));
        console.log(`🗝️ [KeyChain v2] 已載入 ${this.keys.length} 把 API Key (節流: ${this._minInterval}ms)`);
    }

    markCooldown(key, durationMs = 15 * 60 * 1000) {
        this._cooldownUntil.set(key, Date.now() + durationMs);
        console.log(`🧊 [KeyChain] Key #${this.keys.indexOf(key)} 冷卻 ${Math.round(durationMs / 60000)} 分鐘`);
    }

    _isCooling(key, idx = null) {
        const until = this._cooldownUntil.get(key);
        if (!until) return false;
        if (Date.now() >= until) {
            this._cooldownUntil.delete(key);
            if (idx === null) idx = this.keys.indexOf(key);
            console.log(`✅ [KeyChain] Key #${idx} 冷卻解除`);
            return false;
        }
        return true;
    }

    async _throttle() {
        const now = Date.now();
        const timeSinceLast = now - this._lastCallTime;
        if (timeSinceLast < this._minInterval) {
            await new Promise(r => setTimeout(r, this._minInterval - timeSinceLast));
        }
        this._lastCallTime = Date.now();
    }

    async getKey() {
        if (this.keys.length === 0) return null;
        await this._throttle();
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            const key = this.keys[idx];
            if (!this._isCooling(key, idx)) {
                this.currentIndex = (idx + 1) % this.keys.length;
                const stat = this._stats.get(key);
                if (stat) { stat.calls++; stat.lastUsed = Date.now(); }
                return key;
            }
        }
        console.warn('⚠️ [KeyChain] 所有 Key 都在冷卻中 (暫停服務)');
        return null;
    }

    recordError(key, error) {
        const stat = this._stats.get(key);
        if (stat) stat.errors++;
        if (error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
            const isDaily = error.message.includes('per day');
            this.markCooldown(key, isDaily ? 15 * 60 * 1000 : 90 * 1000);
        }
    }

    getStatus() {
        const cooling = [];
        for (const [k, t] of this._cooldownUntil) {
            const remain = Math.max(0, Math.round((t - Date.now()) / 1000));
            if (remain > 0) cooling.push(`#${this.keys.indexOf(k)}(${remain}s)`);
        }
        return cooling.length > 0 ? cooling.join(', ') : '全部可用';
    }
}

module.exports = KeyChain;
