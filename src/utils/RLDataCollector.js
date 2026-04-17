// ============================================================
// 📊 RL Data Collector (Hermes Tinker-Atropos Inspired)
//
// 收集高價值會話軌跡供未來的 Reinforcement Learning 或
// LoRA 模型微調使用。
// 預設輸出為 JSONL 格式，存儲於 data/rl/ 目錄。
// ============================================================

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');

class RLDataCollector {
    constructor() {
        this.rlDir = path.join(process.cwd(), 'data', 'rl');
        this.positiveLog = path.join(this.rlDir, 'positive_trajectories.jsonl');
        this.negativeLog = path.join(this.rlDir, 'negative_trajectories.jsonl');
        
        // 確保目錄存在
        if (!fs.existsSync(this.rlDir)) {
            fs.mkdirSync(this.rlDir, { recursive: true });
        }
    }

    /**
     * 讀取近期會話，用作訓練樣本
     * @param {object} brain 
     * @returns {Promise<Array>}
     */
    async _getRecentTrajectory(brain) {
        if (!brain.chatLogManager || !brain.chatLogManager._isInitialized) {
            return [];
        }
        // 取得最近 20 則訊息
        const logs = await brain.chatLogManager.allAsync(
            `SELECT sender, role, content FROM messages ORDER BY timestamp DESC LIMIT 20`
        );
        return logs.reverse().map(l => ({
            role: l.role === 'system' ? 'system' : (l.role === 'User' ? 'user' : 'assistant'),
            content: l.content
        }));
    }

    /**
     * 儲存正向（高質量）的對話軌跡
     * @param {object} brain
     */
    async recordPositive(brain) {
        try {
            const trajectory = await this._getRecentTrajectory(brain);
            if (trajectory.length === 0) return false;
            
            const entry = {
                timestamp: new Date().toISOString(),
                label: 'positive',
                messages: trajectory
            };
            
            fs.appendFileSync(this.positiveLog, JSON.stringify(entry) + '\n', 'utf8');
            console.log(`📈 [RL Collector] 記錄了一筆 Positive 訓練樣本`);
            return true;
        } catch (e) {
            console.error('❌ [RL Collector] 儲存 Positive 樣本失敗:', e.message);
            return false;
        }
    }

    /**
     * 儲存失敗（需修正）的對話軌跡
     * @param {object} brain
     */
    async recordNegative(brain) {
        try {
            const trajectory = await this._getRecentTrajectory(brain);
            if (trajectory.length === 0) return false;
            
            const entry = {
                timestamp: new Date().toISOString(),
                label: 'negative',
                messages: trajectory
            };
            
            fs.appendFileSync(this.negativeLog, JSON.stringify(entry) + '\n', 'utf8');
            console.log(`📉 [RL Collector] 記錄了一筆 Negative 訓練樣本`);
            return true;
        } catch (e) {
            console.error('❌ [RL Collector] 儲存 Negative 樣本失敗:', e.message);
            return false;
        }
    }
}

module.exports = new RLDataCollector();
