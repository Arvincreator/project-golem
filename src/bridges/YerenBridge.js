// ============================================================
// YerenBridge — Rensin (WSL2) ↔ Yeren (Windows) 雙向通訊
// v11.5: 透過 WSL2 檔案系統橋同步記憶 + 掃描結果
// ============================================================

const path = require('path');
const fs = require('fs');

const YEREN_WSL_PATH = '/mnt/c/Users/yagam/Desktop/golem-workspace/project-golem';
const BRIDGE_DIR = 'data/bridge';

class YerenBridge {
    constructor(options = {}) {
        this._yerenPath = options.yerenPath || YEREN_WSL_PATH;
        this._bridgeDir = path.join(this._yerenPath, BRIDGE_DIR);
        this._localDataDir = options.localDataDir || path.resolve(process.cwd(), 'data');
        this._available = null; // lazy check
    }

    /**
     * Check if Yeren path is accessible
     * @returns {boolean}
     */
    isAvailable() {
        if (this._available !== null) return this._available;
        try {
            this._available = fs.existsSync(this._yerenPath);
        } catch (e) {
            this._available = false;
        }
        return this._available;
    }

    /**
     * Ensure bridge directory exists
     * @returns {boolean}
     */
    ensureBridgeDir() {
        if (!this.isAvailable()) return false;
        try {
            if (!fs.existsSync(this._bridgeDir)) {
                fs.mkdirSync(this._bridgeDir, { recursive: true });
            }
            return true;
        } catch (e) {
            console.warn('[YerenBridge] Cannot create bridge dir:', e.message);
            return false;
        }
    }

    /**
     * Sync golem_episodes.json and golem_tip_memory.json
     * @returns {Object} { synced, errors }
     */
    syncMemory() {
        if (!this.isAvailable()) return { synced: [], errors: ['Yeren path not accessible'] };

        const filesToSync = ['golem_episodes.json', 'golem_tip_memory.json'];
        const synced = [];
        const errors = [];

        for (const file of filesToSync) {
            try {
                const localPath = path.join(process.cwd(), file);
                const yerenPath = path.join(this._yerenPath, file);

                if (!fs.existsSync(localPath)) {
                    errors.push(`Local ${file} not found`);
                    continue;
                }

                // Compare timestamps: newer wins
                const localStat = fs.statSync(localPath);
                let yerenExists = false;
                let yerenStat = null;
                try {
                    yerenStat = fs.statSync(yerenPath);
                    yerenExists = true;
                } catch { /* doesn't exist */ }

                if (!yerenExists || localStat.mtimeMs > yerenStat.mtimeMs) {
                    // Local is newer → push to Yeren
                    fs.copyFileSync(localPath, yerenPath);
                    synced.push({ file, direction: 'rensin→yeren' });
                } else if (yerenStat.mtimeMs > localStat.mtimeMs) {
                    // Yeren is newer → pull from Yeren
                    fs.copyFileSync(yerenPath, localPath);
                    synced.push({ file, direction: 'yeren→rensin' });
                } else {
                    synced.push({ file, direction: 'in-sync' });
                }
            } catch (e) {
                errors.push(`${file}: ${e.message}`);
            }
        }

        return { synced, errors };
    }

    /**
     * Sync scan results to Yeren
     * @returns {Object} { synced, errors }
     */
    syncScanResults() {
        if (!this.isAvailable()) return { synced: 0, errors: ['Yeren path not accessible'] };
        if (!this.ensureBridgeDir()) return { synced: 0, errors: ['Cannot create bridge dir'] };

        let synced = 0;
        const errors = [];

        try {
            const localDataDir = this._localDataDir;
            if (!fs.existsSync(localDataDir)) return { synced: 0, errors: [] };

            const scanFiles = fs.readdirSync(localDataDir)
                .filter(f => f.startsWith('v114_') && f.endsWith('.json'));

            for (const file of scanFiles) {
                try {
                    const srcPath = path.join(localDataDir, file);
                    const dstPath = path.join(this._bridgeDir, file);
                    if (!fs.existsSync(dstPath)) {
                        fs.copyFileSync(srcPath, dstPath);
                        synced++;
                    }
                } catch (e) {
                    errors.push(`${file}: ${e.message}`);
                }
            }
        } catch (e) {
            errors.push(e.message);
        }

        return { synced, errors };
    }

    /**
     * Get Yeren's status (if it writes one)
     * @returns {Object|null}
     */
    getYerenStatus() {
        if (!this.isAvailable()) return null;

        try {
            const statusPath = path.join(this._bridgeDir, 'yeren_status.json');
            if (fs.existsSync(statusPath)) {
                return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
            }
        } catch (e) {
            console.warn('[YerenBridge] Cannot read Yeren status:', e.message);
        }
        return null;
    }

    /**
     * Push an update for Yeren to read
     * @param {Object} data - Data to share
     * @returns {boolean}
     */
    pushUpdate(data) {
        if (!this.isAvailable()) return false;
        if (!this.ensureBridgeDir()) return false;

        try {
            const updatePath = path.join(this._bridgeDir, 'rensin_update.json');
            fs.writeFileSync(updatePath, JSON.stringify({
                ...data,
                timestamp: new Date().toISOString(),
                source: 'rensin',
            }, null, 2));
            return true;
        } catch (e) {
            console.warn('[YerenBridge] pushUpdate failed:', e.message);
            return false;
        }
    }

    /**
     * Get bridge status summary
     */
    getStatus() {
        return {
            available: this.isAvailable(),
            yerenPath: this._yerenPath,
            bridgeDir: this._bridgeDir,
            yerenStatus: this.getYerenStatus(),
        };
    }
}

module.exports = YerenBridge;
