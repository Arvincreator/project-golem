// ============================================================
// ExperienceReplay — Reflexion (Shinn et al.) + AGENTS pattern
// v9.5: + reflect→coreMemory (A4), EMA value learning (D2),
//        autoReflectIfNeeded (D1), DebouncedWriter (B1)
// ============================================================
const fs = require('fs');
const path = require('path');

const MAX_TRACES = 200;
const MAX_REFLECTIONS = 50;
const REPLAY_FILE = 'golem_experience_replay.json';

// D2: EMA bucket defaults
const DEFAULT_EMA = { L0: 0.5, L1: 0.5, L2: 0.5, L3: 0.5, plan_step: 0.5, reflection: 0.5 };
const EMA_ALPHA = 0.1;

class ExperienceReplay {
    constructor(options = {}) {
        this.golemId = (options.golemId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
        this.brain = options.brain || null;
        this.threeLayerMemory = options.threeLayerMemory || null;
        this.coreMemory = options.coreMemory || null; // A4: CoreMemory link
        this._file = path.join(process.cwd(), REPLAY_FILE);
        this._traces = [];
        this._reflections = [];
        this._ema = { ...DEFAULT_EMA }; // D2: EMA values
        this._writer = null;
        this._lastAutoReflect = 0; // D1: cooldown tracking
        this._autoReflectCount = 0; // D1: rate limit per 10 min
        this._autoReflectWindowStart = Date.now();
        this._load();
    }

    /**
     * Record an execution trace (full action→result pair)
     */
    recordTrace(trace) {
        const entry = {
            id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            goal: trace.goal || '',
            action: trace.action || '',
            result: trace.result || '',
            success: !!trace.success,
            reward: typeof trace.reward === 'number' ? trace.reward : (trace.success ? 1.0 : 0.0),
            context: trace.context || {},
            duration: trace.duration || 0,
            timestamp: Date.now(),
        };

        this._traces.push(entry);
        if (this._traces.length > MAX_TRACES) this._traces.shift();

        // Also record in episodic memory if available
        if (this.threeLayerMemory) {
            this.threeLayerMemory.recordEpisode(
                entry.goal,
                [entry.action],
                entry.result,
                entry.reward
            );
        }

        // D2: Update EMA for the relevant bucket
        const bucket = this._classifyBucket(entry);
        if (this._ema[bucket] !== undefined) {
            this._ema[bucket] = EMA_ALPHA * entry.reward + (1 - EMA_ALPHA) * this._ema[bucket];
        }

        this._save();
        return entry;
    }

    /**
     * D2: Classify trace into EMA bucket
     */
    _classifyBucket(trace) {
        if (trace.action === 'reflection') return 'reflection';
        if (trace.action?.startsWith('plan_step') || trace.context?.isPlanStep) return 'plan_step';
        // Check for level in context
        const level = trace.context?.level || trace.action?.match?.(/L([0-3])/)?.[0];
        if (level && this._ema[level] !== undefined) return level;
        return 'L1'; // default bucket
    }

    /**
     * D2: Get EMA values (for WorldModel value function)
     */
    getEmaValues() {
        return { ...this._ema };
    }

    /**
     * Reflexion: analyze recent failures and generate improvement insights
     * A4: Also writes to CoreMemory.learned_rules
     */
    async reflect(recentFailures = null) {
        const failures = recentFailures || this._traces
            .filter(t => !t.success)
            .slice(-5);

        if (failures.length === 0) return null;

        // Self-reflection without LLM (pattern-based)
        const patterns = this._analyzeFailurePatterns(failures);

        let llmReflection = null;
        if (this.brain && failures.length >= 2) {
            llmReflection = await this._llmReflect(failures);
        }

        const reflection = {
            id: `ref_${Date.now()}`,
            failureCount: failures.length,
            patterns,
            llmInsight: llmReflection,
            actionItems: this._generateActionItems(patterns, llmReflection),
            timestamp: Date.now(),
        };

        this._reflections.push(reflection);
        if (this._reflections.length > MAX_REFLECTIONS) this._reflections.shift();
        this._save();

        // A4: Write to CoreMemory.learned_rules
        if (this.coreMemory && reflection.actionItems.length > 0) {
            const ruleText = reflection.actionItems.join('; ');
            this.coreMemory.append('learned_rules', ruleText, { system: true });
        }

        console.log(`[ExperienceReplay] Reflection generated: ${reflection.actionItems.length} action items from ${failures.length} failures`);
        return reflection;
    }

    /**
     * D1: Auto-reflect if conditions are met (tiered)
     * Tier 1 (free): consecutive ≥3 failures → heuristic → coreMemory
     * Tier 2 (1 brain call): success rate < 0.4 + cooldown 2min → LLM reflect
     */
    async autoReflectIfNeeded() {
        const now = Date.now();

        // Rate limit: max 3 per 10 minutes
        if (now - this._autoReflectWindowStart > 600000) {
            this._autoReflectCount = 0;
            this._autoReflectWindowStart = now;
        }
        if (this._autoReflectCount >= 3) return null;

        // Check consecutive failures for Tier 1
        let consecutive = 0;
        for (let i = this._traces.length - 1; i >= 0 && !this._traces[i].success; i--) {
            consecutive++;
        }

        if (consecutive >= 3) {
            // Tier 1: heuristic only (no brain call)
            const failures = this._traces.slice(-consecutive);
            const patterns = this._analyzeFailurePatterns(failures);
            const items = this._generateActionItems(patterns, null);

            if (items.length > 0 && this.coreMemory) {
                this.coreMemory.append('learned_rules', items.join('; '), { system: true });
                this._autoReflectCount++;
                console.log(`[ExperienceReplay] Tier 1 auto-reflect: ${items.length} items from ${consecutive} consecutive failures`);
                return { tier: 1, items };
            }
        }

        // Tier 2: success rate < 0.4 + cooldown 2min
        const rate = this.getSuccessRate(20);
        if (rate && rate.rate < 0.4 && now - this._lastAutoReflect > 120000) {
            this._lastAutoReflect = now;
            this._autoReflectCount++;
            const result = await this.reflect();
            if (result) {
                console.log(`[ExperienceReplay] Tier 2 auto-reflect (success rate: ${rate.rate})`);
                return { tier: 2, result };
            }
        }

        return null;
    }

    /**
     * Get reflection context for injection into prompts (Reflexion paper pattern)
     */
    getReflectionContext(limit = 3) {
        if (this._reflections.length === 0) return '';

        const recent = this._reflections.slice(-limit);
        const lines = ['【Experience Replay: Recent Reflections】'];
        for (const ref of recent) {
            if (ref.actionItems.length > 0) {
                lines.push(`- ${ref.actionItems.join('; ')}`);
            }
            if (ref.llmInsight) {
                lines.push(`  Insight: ${ref.llmInsight.substring(0, 200)}`);
            }
        }
        return lines.join('\n');
    }

    /**
     * Sample from replay buffer (prioritized by reward and recency)
     */
    sample(count = 5, filter = null) {
        let pool = this._traces;
        if (filter) {
            if (filter.success !== undefined) pool = pool.filter(t => t.success === filter.success);
            if (filter.goal) pool = pool.filter(t => t.goal.includes(filter.goal));
        }

        const scored = pool.map(t => ({
            ...t,
            _priority: t.reward * 0.6 + (t.timestamp / Date.now()) * 0.4,
        }));
        scored.sort((a, b) => b._priority - a._priority);
        return scored.slice(0, count).map(({ _priority, ...t }) => t);
    }

    /**
     * Get success rate over last N traces
     */
    getSuccessRate(n = 50) {
        const recent = this._traces.slice(-n);
        if (recent.length === 0) return null;
        const successes = recent.filter(t => t.success).length;
        return {
            rate: Math.round(successes / recent.length * 1000) / 1000,
            successes,
            total: recent.length,
        };
    }

    /**
     * Analyze failure patterns (heuristic)
     */
    _analyzeFailurePatterns(failures) {
        const patterns = [];

        const actionCounts = {};
        for (const f of failures) {
            const key = f.action?.substring(0, 50) || 'unknown';
            actionCounts[key] = (actionCounts[key] || 0) + 1;
        }
        for (const [action, count] of Object.entries(actionCounts)) {
            if (count >= 2) {
                patterns.push({ type: 'repeated_failure', action, count });
            }
        }

        const timeouts = failures.filter(f =>
            f.result?.includes('timeout') || f.result?.includes('Timeout')
        );
        if (timeouts.length >= 2) {
            patterns.push({ type: 'timeout_pattern', count: timeouts.length });
        }

        let consecutive = 0;
        for (let i = this._traces.length - 1; i >= 0 && !this._traces[i].success; i--) {
            consecutive++;
        }
        if (consecutive >= 3) {
            patterns.push({ type: 'consecutive_failures', count: consecutive });
        }

        return patterns;
    }

    /**
     * LLM-assisted reflection
     */
    async _llmReflect(failures) {
        const failureSummary = failures.map(f =>
            `Goal: ${f.goal?.substring(0, 80)} | Action: ${f.action?.substring(0, 80)} | Result: ${f.result?.substring(0, 80)}`
        ).join('\n');

        const prompt = `Analyze these recent failures and provide ONE concise improvement insight (max 2 sentences):
${failureSummary}`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            return typeof raw === 'string' ? raw.substring(0, 300) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Generate actionable items from patterns and reflection
     */
    _generateActionItems(patterns, llmInsight) {
        const items = [];

        for (const p of patterns) {
            switch (p.type) {
                case 'repeated_failure':
                    items.push(`Avoid action "${p.action.substring(0, 40)}" (failed ${p.count}x)`);
                    break;
                case 'timeout_pattern':
                    items.push(`Reduce timeout-prone operations (${p.count} recent timeouts)`);
                    break;
                case 'consecutive_failures':
                    items.push(`${p.count} consecutive failures — consider changing approach`);
                    break;
            }
        }

        if (llmInsight) {
            items.push(llmInsight.split('.')[0].trim());
        }

        return items;
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            traces: this._traces.length,
            reflections: this._reflections.length,
            successRate: this.getSuccessRate(),
            recentFailures: this._traces.filter(t => !t.success).slice(-3).length,
            ema: { ...this._ema },
        };
    }

    // --- Persistence (B1: DebouncedWriter) ---
    _load() {
        try {
            if (fs.existsSync(this._file)) {
                const data = JSON.parse(fs.readFileSync(this._file, 'utf-8'));
                this._traces = data.traces || [];
                this._reflections = data.reflections || [];
                if (data.ema) {
                    this._ema = { ...DEFAULT_EMA, ...data.ema };
                }
            }
        } catch (e) { /* fresh start */ }
    }

    _save() {
        try {
            const data = JSON.stringify({
                traces: this._traces,
                reflections: this._reflections,
                ema: this._ema,
            }, null, 2);

            if (this._writer) {
                this._writer.markDirty(data);
            } else {
                try {
                    const DebouncedWriter = require('../utils/DebouncedWriter');
                    this._writer = new DebouncedWriter(this._file, 2000);
                    this._writer.markDirty(data);
                } catch (e) {
                    // Fallback to sync
                    fs.writeFileSync(this._file, data);
                }
            }
        } catch (e) { console.warn('[ExperienceReplay] Save failed:', e.message); }
    }
}

module.exports = ExperienceReplay;
