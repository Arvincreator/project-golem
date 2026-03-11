// ============================================================
// ⚡ Circuit Breaker — 多 Worker 熔斷器 (Per-Service Tracking)
// States: CLOSED → OPEN → HALF_OPEN → CLOSED
// ============================================================
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'golem_circuit_state.json');
const DEFAULTS = {
    failureThreshold: 3,      // 連續失敗幾次觸發 OPEN
    resetTimeoutMs: 60000,    // OPEN 多久後自動進入 HALF_OPEN (60s)
    halfOpenMaxAttempts: 2,   // HALF_OPEN 允許幾次嘗試
    successThreshold: 2,      // HALF_OPEN 連續成功幾次恢復 CLOSED
};

class CircuitBreaker {
    constructor() {
        this.circuits = new Map(); // key: serviceId → state object
        this._load();
    }

    _getDefault(serviceId) {
        return {
            serviceId,
            state: 'CLOSED',
            failures: 0,
            successes: 0,
            lastFailureTime: 0,
            lastError: null,
            totalTrips: 0,
        };
    }

    _load() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
                for (const [k, v] of Object.entries(data)) {
                    this.circuits.set(k, v);
                }
            }
        } catch (e) { /* fresh start */ }
    }

    _save() {
        try {
            const obj = Object.fromEntries(this.circuits);
            fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
        } catch (e) { /* non-critical */ }
    }

    _get(serviceId) {
        if (!this.circuits.has(serviceId)) {
            this.circuits.set(serviceId, this._getDefault(serviceId));
        }
        return this.circuits.get(serviceId);
    }

    /**
     * 檢查是否允許呼叫
     * @returns {boolean} true = 允許, false = 熔斷中
     */
    canExecute(serviceId) {
        const c = this._get(serviceId);

        if (c.state === 'CLOSED') return true;

        if (c.state === 'OPEN') {
            // 超過冷卻時間 → 自動進入 HALF_OPEN
            if (Date.now() - c.lastFailureTime > DEFAULTS.resetTimeoutMs) {
                c.state = 'HALF_OPEN';
                c.successes = 0;
                console.log(`🟡 [CircuitBreaker] ${serviceId}: OPEN → HALF_OPEN (cooldown expired)`);
                return true;
            }
            return false;
        }

        // HALF_OPEN: 限制嘗試次數
        if (c.state === 'HALF_OPEN') {
            return c.successes + c.failures < DEFAULTS.halfOpenMaxAttempts + DEFAULTS.successThreshold;
        }

        return true;
    }

    /**
     * 記錄成功
     */
    recordSuccess(serviceId) {
        const c = this._get(serviceId);
        c.failures = 0;
        c.lastError = null;

        if (c.state === 'HALF_OPEN') {
            c.successes++;
            if (c.successes >= DEFAULTS.successThreshold) {
                c.state = 'CLOSED';
                console.log(`🟢 [CircuitBreaker] ${serviceId}: HALF_OPEN → CLOSED (recovered)`);
            }
        }
        this._save();
    }

    /**
     * 記錄失敗
     */
    recordFailure(serviceId, error) {
        const c = this._get(serviceId);
        c.failures++;
        c.lastFailureTime = Date.now();
        c.lastError = error ? error.substring(0, 200) : 'unknown';

        if (c.state === 'HALF_OPEN') {
            // HALF_OPEN 失敗 → 直接回 OPEN
            c.state = 'OPEN';
            c.totalTrips++;
            console.log(`🔴 [CircuitBreaker] ${serviceId}: HALF_OPEN → OPEN (probe failed)`);
        } else if (c.state === 'CLOSED' && c.failures >= DEFAULTS.failureThreshold) {
            c.state = 'OPEN';
            c.totalTrips++;
            console.log(`🔴 [CircuitBreaker] ${serviceId}: CLOSED → OPEN (threshold ${DEFAULTS.failureThreshold} reached)`);
        }
        this._save();
    }

    /**
     * 手動重置
     */
    reset(serviceId) {
        this.circuits.set(serviceId, this._getDefault(serviceId));
        this._save();
    }

    /**
     * 取得所有 circuit 狀態 (給 dashboard/診斷用)
     */
    getStatus() {
        const result = {};
        for (const [k, v] of this.circuits) {
            result[k] = { state: v.state, failures: v.failures, totalTrips: v.totalTrips, lastError: v.lastError };
        }
        return result;
    }

    /**
     * 包裝執行 — 自動判斷熔斷 + 記錄結果
     * @param {string} serviceId
     * @param {Function} fn - async 函數
     * @returns {Promise<any>}
     */
    async execute(serviceId, fn) {
        if (!this.canExecute(serviceId)) {
            const c = this._get(serviceId);
            const remaining = Math.max(0, DEFAULTS.resetTimeoutMs - (Date.now() - c.lastFailureTime));
            throw new Error(`[CircuitBreaker] ${serviceId} 熔斷中 (${Math.ceil(remaining / 1000)}s 後重試). 最後錯誤: ${c.lastError || '?'}`);
        }

        try {
            const result = await fn();
            this.recordSuccess(serviceId);
            return result;
        } catch (e) {
            this.recordFailure(serviceId, e.message);
            throw e;
        }
    }
}

// [OpossumBridge] Auto-upgrade to Opossum if available, otherwise use built-in
let _instance;
try {
    _instance = require('../bridges/OpossumBridge');
    console.log('[CircuitBreaker] Using Opossum 9.0 engine');
} catch (e) {
    _instance = new CircuitBreaker();
    console.log('[CircuitBreaker] Using built-in engine');
}
module.exports = _instance;
