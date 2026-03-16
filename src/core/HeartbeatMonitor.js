// ============================================================
// HeartbeatMonitor — MemGPT-style periodic self-check
// v9.5 D3: memory pressure, success rate, CoreMemory capacity
// Brain call budget: max 0.1 calls/min (1 per 10 min)
// ============================================================

class HeartbeatMonitor {
    constructor(options = {}) {
        this.experienceReplay = options.experienceReplay || null;
        this.coreMemory = options.coreMemory || null;
        this.threeLayerMemory = options.threeLayerMemory || null;
        this.brain = options.brain || null;

        this._messageCount = 0;
        this._lastHeartbeat = Date.now();
        this._interval = options.intervalMs || 600000; // 10 min
        this._messageThreshold = options.messageThreshold || 20;

        // Brain call budget: max 1 call per 10 min
        this._lastBrainCall = 0;
        this._brainCallCooldown = 600000;
    }

    /**
     * Called on every incoming message. Checks if heartbeat should trigger.
     */
    tick() {
        this._messageCount++;

        const elapsed = Date.now() - this._lastHeartbeat;
        const thresholdReached = this._messageCount >= this._messageThreshold;
        const intervalReached = elapsed >= this._interval;

        if (thresholdReached || intervalReached) {
            this._runHeartbeat().catch(e => {
                console.warn('[HeartbeatMonitor] heartbeat error:', e.message);
            });
        }
    }

    /**
     * Execute the heartbeat self-check sequence.
     */
    async _runHeartbeat() {
        // 1. Check memory pressure
        if (this.threeLayerMemory) {
            try {
                const stats = this.threeLayerMemory.getStats();
                if (stats && stats.working > 40) {
                    // Page out oldest working memory items
                    const indices = [];
                    for (let i = 0; i < stats.working - 35; i++) indices.push(i);
                    if (this.threeLayerMemory.pageOut) {
                        this.threeLayerMemory.pageOut(indices);
                        console.log(`[HeartbeatMonitor] Paged out ${indices.length} working memory items`);
                    }
                }
            } catch (e) {
                console.warn('[HeartbeatMonitor] memory pressure check failed:', e.message);
            }
        }

        // 2. Check success rate — trigger reflect if low
        if (this.experienceReplay) {
            try {
                const rateObj = this.experienceReplay.getSuccessRate(20);
                if (rateObj && rateObj.rate < 0.4 && this._canCallBrain()) {
                    this._recordBrainCall();
                    // Use ExperienceReplay.reflect (costs 1 brain call)
                    await this.experienceReplay.reflect();
                    console.log(`[HeartbeatMonitor] Triggered reflection (success rate: ${rateObj.rate})`);
                }
            } catch (e) {
                console.warn('[HeartbeatMonitor] success rate check failed:', e.message);
            }
        }

        // 3. Check CoreMemory learned_rules capacity
        if (this.coreMemory) {
            try {
                const coreStats = this.coreMemory.getStats();
                if (coreStats && coreStats.learned_rules && coreStats.learned_rules.usagePercent > 80) {
                    // Trim oldest lines from learned_rules
                    const content = this.coreMemory.read('learned_rules');
                    if (content) {
                        const lines = content.split('\n');
                        if (lines.length > 2) {
                            // Remove oldest 30%
                            const removeCount = Math.ceil(lines.length * 0.3);
                            const trimmed = lines.slice(removeCount).join('\n');
                            this.coreMemory.set('learned_rules', trimmed, { system: true });
                            console.log(`[HeartbeatMonitor] Trimmed ${removeCount} oldest learned_rules lines`);
                        }
                    }
                }
            } catch (e) {
                console.warn('[HeartbeatMonitor] core memory check failed:', e.message);
            }
        }

        // 4. Reset counters
        this._messageCount = 0;
        this._lastHeartbeat = Date.now();
    }

    _canCallBrain() {
        return Date.now() - this._lastBrainCall >= this._brainCallCooldown;
    }

    _recordBrainCall() {
        this._lastBrainCall = Date.now();
    }

    getStats() {
        const now = Date.now();
        const elapsed = now - this._lastHeartbeat;
        return {
            messageCount: this._messageCount,
            lastHeartbeat: this._lastHeartbeat,
            nextHeartbeatIn: {
                byInterval: Math.max(0, this._interval - elapsed),
                byMessages: Math.max(0, this._messageThreshold - this._messageCount),
            },
        };
    }
}

module.exports = HeartbeatMonitor;
