// ============================================================
// Three-Layer Memory (Letta-inspired)
// Working (in-memory) -> Episodic (file) -> Semantic (MAGMA)
// ============================================================
const fs = require('fs');
const path = require('path');

const WORKING_CAP = 50;
const EPISODIC_CAP = 500;

class ThreeLayerMemory {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this._workingMemory = []; // Current conversation context
        this._episodicFile = path.join(process.cwd(), 'golem_episodes.json');
        this._episodes = this._loadEpisodes();
        this._ragProvider = null; // v10.5: optional RAG provider
    }

    /**
     * v10.5: Inject RAG provider for vector-augmented queries
     */
    setRAGProvider(provider) {
        this._ragProvider = provider;
    }

    // --- Working Memory (Layer 1) ---
    addToWorking(entry) {
        this._workingMemory.push({
            ...entry,
            timestamp: Date.now()
        });
        if (this._workingMemory.length > WORKING_CAP) {
            const evicted = this._workingMemory.shift();
            // Promote evicted working memory to episodic if significant
            if (evicted.content && evicted.content.length > 50) {
                this.recordEpisode(evicted.content, [], 'evicted_from_working', 0.5);
            }
        }
    }

    getWorkingContext(limit = 10) {
        return this._workingMemory.slice(-limit);
    }

    clearWorking() {
        this._workingMemory = [];
    }

    // --- Letta-style Autonomous Memory Management ---

    rethinkWorking(newContent) {
        if (!newContent || typeof newContent !== 'string') return;
        // Replace the most recent working memory entry with rethought content
        if (this._workingMemory.length > 0) {
            this._workingMemory[this._workingMemory.length - 1] = {
                content: newContent,
                sender: 'system',
                type: 'rethink',
                timestamp: Date.now()
            };
        } else {
            this.addToWorking({ content: newContent, sender: 'system', type: 'rethink' });
        }
    }

    promoteToEpisodic(workingIndex, reward = 1) {
        if (workingIndex < 0 || workingIndex >= this._workingMemory.length) return null;
        const item = this._workingMemory[workingIndex];
        return this.recordEpisode(
            item.content || JSON.stringify(item),
            [],
            'promoted_from_working',
            reward
        );
    }

    forgetEpisode(episodeId) {
        const idx = this._episodes.findIndex(e => e.id === episodeId);
        if (idx === -1) return false;
        this._episodes.splice(idx, 1);
        this._saveEpisodes();
        return true;
    }

    deprecateStaleEpisodes(maxDaysUnqueried = 90) {
        const cutoff = Date.now() - maxDaysUnqueried * 86400000;
        let deprecated = 0;
        for (const ep of this._episodes) {
            if (!ep._lastQueried && ep.timestamp < cutoff && !ep.invalid_at) {
                ep.invalid_at = new Date().toISOString();
                deprecated++;
            }
        }
        if (deprecated > 0) this._saveEpisodes();
        return deprecated;
    }

    // --- Episodic Memory (Layer 2) ---
    recordEpisode(situation, actions, outcome, reward = 0) {
        const episode = {
            id: `ep_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            situation: String(situation).substring(0, 500),
            actions: Array.isArray(actions) ? actions : [String(actions)],
            outcome: String(outcome).substring(0, 500),
            reward: Number(reward) || 0,
            timestamp: Date.now()
        };
        // Zep-style temporal awareness
        episode.valid_at = new Date().toISOString();
        episode.invalid_at = null; // null = never expires unless manually set
        this._episodes.push(episode);

        // Enforce cap
        if (this._episodes.length > EPISODIC_CAP) {
            this._summarizeOld();
        }

        this._saveEpisodes();
        return episode;
    }

    /**
     * Synchronous keyword-only episode query (no RAG)
     * For callers that cannot await (TreePlanner._scoreNode, WorldModel.valueFunction)
     */
    /**
     * Shared keyword matching logic for queryEpisodes and queryEpisodesSync
     */
    _matchByKeyword(situation, validEpisodes, limit) {
        if (!situation) return validEpisodes.slice(-limit);
        const keywords = String(situation).toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (keywords.length === 0) return validEpisodes.slice(-limit);

        return validEpisodes
            .map(ep => {
                const text = `${ep.situation} ${ep.outcome}`.toLowerCase();
                const score = keywords.filter(kw => text.includes(kw)).length;
                return { ...ep, _score: score };
            })
            .filter(ep => ep._score > 0)
            .sort((a, b) => b._score - a._score || b.timestamp - a.timestamp)
            .slice(0, limit)
            .map(({ _score, ...ep }) => ep);
    }

    _getValidEpisodes() {
        const now = new Date().toISOString();
        return this._episodes.filter(ep => !ep.invalid_at || ep.invalid_at > now);
    }

    queryEpisodesSync(situation, limit = 5) {
        return this._matchByKeyword(situation, this._getValidEpisodes(), limit);
    }

    async queryEpisodes(situation, limit = 5) {
        // v10.5: Try vector-augmented search first
        if (this._ragProvider && situation) {
            try {
                const ragResult = await this._ragProvider.augmentedRecall(situation, { limit });
                if (ragResult.merged.length > 0) {
                    return ragResult.merged.map(r => ({
                        id: r.id,
                        situation: r.content,
                        actions: [],
                        outcome: '',
                        reward: r.score || 0,
                        timestamp: Date.now(),
                        _source: 'rag',
                    }));
                }
            } catch (e) { /* fallback to keyword */ }
        }

        const result = this._matchByKeyword(situation, this._getValidEpisodes(), limit);

        // Mark queried episodes with _lastQueried
        result.forEach(ep => {
            const original = this._episodes.find(e => e.id === ep.id);
            if (original) original._lastQueried = Date.now();
        });

        return result;
    }

    _summarizeOld() {
        // Keep newest 400, summarize oldest 100+
        const excess = this._episodes.length - 400;
        if (excess <= 0) return;
        const oldEpisodes = this._episodes.splice(0, excess);

        // Create summary episode
        const successRate = oldEpisodes.filter(e => e.reward > 0.5).length / oldEpisodes.length;
        this._episodes.unshift({
            id: `summary_${Date.now()}`,
            situation: `Summary of ${oldEpisodes.length} episodes`,
            actions: ['auto_summary'],
            outcome: `${oldEpisodes.length} episodes summarized. Success rate: ${(successRate * 100).toFixed(1)}%. Period: ${new Date(oldEpisodes[0]?.timestamp).toISOString()} to ${new Date(oldEpisodes[oldEpisodes.length - 1]?.timestamp).toISOString()}`,
            reward: successRate,
            timestamp: Date.now()
        });

        // Write to MAGMA if available
        try {
            const magma = require('./graph/ma_gma');
            magma.addNode(`episode_summary_${Date.now()}`, {
                type: 'episode_summary',
                count: oldEpisodes.length,
                success_rate: successRate,
                created_at: new Date().toISOString()
            });
        } catch (e) { /* MAGMA optional */ }

        // v10.5: Embed summary into vector store
        if (this._ragProvider) {
            try {
                const summaryText = `Episode summary: ${oldEpisodes.length} episodes, success rate ${(successRate * 100).toFixed(1)}%`;
                this._ragProvider.ingest(summaryText, { type: 'episode_summary', source: 'three_layer' }).catch(e => console.warn('[ThreeLayerMemory] episode summary ingest failed:', e.message));
            } catch (e) { /* non-blocking */ }
        }
    }

    // --- Semantic Memory (Layer 3 -- delegates to MAGMA) ---
    querySemanticMemory(query) {
        try {
            const magma = require('./graph/ma_gma');
            return magma.query ? magma.query(query) : [];
        } catch (e) { return []; }
    }

    // --- Persistence ---
    _loadEpisodes() {
        try {
            if (fs.existsSync(this._episodicFile)) {
                const raw = fs.readFileSync(this._episodicFile, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (e) {
            console.warn('[ThreeLayerMemory] Failed to load episodes:', e.message);
            // v11.3: Auto-repair corrupted JSON (e.g. concatenated arrays from concurrent writes)
            const repaired = this._tryRepairJSON(this._episodicFile);
            if (repaired !== null) return repaired;
        }
        return [];
    }

    /**
     * v11.3: Attempt to repair corrupted JSON file
     * Handles concatenated arrays (e.g. ][) from concurrent writes
     * @returns {Array|null} Recovered array or null if unrecoverable
     */
    _tryRepairJSON(filePath) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8').trim();
            if (!raw.startsWith('[')) return null;

            // Strategy 1: Find first complete JSON array (ignore trailing garbage)
            let depth = 0;
            let end = 0;
            for (let i = 0; i < raw.length; i++) {
                if (raw[i] === '[') depth++;
                else if (raw[i] === ']') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            if (end > 0) {
                const data = JSON.parse(raw.substring(0, end));
                if (Array.isArray(data)) {
                    // Write back clean version
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                    console.log(`[ThreeLayerMemory] Auto-repaired ${filePath}: recovered ${data.length} episodes`);
                    return data;
                }
            }

            // Strategy 2: Split on ][ boundary, parse each, merge
            const parts = raw.split(/\]\s*\[/).map((part, i, arr) => {
                if (i === 0) part = part + ']';
                else if (i === arr.length - 1) part = '[' + part;
                else part = '[' + part + ']';
                try { return JSON.parse(part); } catch { return []; }
            });
            const merged = parts.flat().filter(e => e && e.id);
            if (merged.length > 0) {
                fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
                console.log(`[ThreeLayerMemory] Auto-repaired (merge strategy) ${filePath}: recovered ${merged.length} episodes`);
                return merged;
            }
        } catch (e2) {
            console.warn('[ThreeLayerMemory] Auto-repair failed:', e2.message);
        }
        // Last resort: backup corrupted file, start fresh
        try {
            const backup = filePath + '.corrupted.' + Date.now();
            fs.copyFileSync(filePath, backup);
            fs.writeFileSync(filePath, '[]');
            console.warn(`[ThreeLayerMemory] Unrecoverable — backed up to ${backup}, starting fresh`);
        } catch { /* nothing left to try */ }
        return [];
    }

    _saveEpisodes() {
        try {
            const data = JSON.stringify(this._episodes, null, 2);
            if (this._writer) {
                this._writer.markDirty(data);
            } else {
                try {
                    const DebouncedWriter = require('../utils/DebouncedWriter');
                    this._writer = new DebouncedWriter(this._episodicFile, 2000);
                    this._writer.markDirty(data);
                } catch (e) {
                    fs.writeFileSync(this._episodicFile, data);
                }
            }
        } catch (e) { console.warn('[ThreeLayerMemory] Failed to save episodes:', e.message); }
    }

    /**
     * Estimate token count for a text string
     * @param {string} text
     * @returns {number}
     */
    estimateTokens(text) {
        if (!text) return 0;
        const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
        const latinCount = text.length - cjkCount;
        return Math.ceil(cjkCount / 1.5 + latinCount / 4);
    }

    /**
     * Page out items from working memory to episodic (archival)
     * @param {number[]} indices - Working memory indices to page out
     * @returns {number} Number of items paged out
     */
    pageOut(indices) {
        if (!Array.isArray(indices) || indices.length === 0) return 0;
        let paged = 0;
        // Sort descending to avoid index shifting
        const sorted = [...indices].sort((a, b) => b - a);
        for (const idx of sorted) {
            if (idx >= 0 && idx < this._workingMemory.length) {
                const item = this._workingMemory.splice(idx, 1)[0];
                if (item && item.content) {
                    this.recordEpisode(item.content, [], 'paged_out_from_working', 0.3);
                    paged++;
                }
            }
        }
        return paged;
    }

    /**
     * v12.0: Ingest operational memory (audit summaries) into episodic layer
     * @param {string} type - 'security-audit' | 'worker-health' | 'error-patterns'
     * @param {object} data - Audit/operational data to ingest
     * @returns {object} Created episode
     */
    ingestOperationalMemory(type, data) {
        if (!type || !data) return null;

        const summary = typeof data === 'string' ? data : JSON.stringify(data).substring(0, 500);
        const episode = this.recordEpisode(
            `[${type}] ${summary}`,
            ['operational_ingest'],
            `Operational memory: ${type}`,
            0.7
        );

        // Also ingest into RAG if available
        if (this._ragProvider) {
            try {
                this._ragProvider.ingest(
                    `[${type}] ${summary}`,
                    { type, source: type, operational: true }
                ).catch(() => {});
            } catch (e) { /* non-blocking */ }
        }

        return episode;
    }

    getStats() {
        let semanticNodes = 0, semanticEdges = 0;
        try {
            const magma = require('./graph/ma_gma');
            const s = magma.stats();
            semanticNodes = s.nodes;
            semanticEdges = s.edges;
        } catch (e) { /* optional */ }
        return {
            working: this._workingMemory.length,
            workingCap: WORKING_CAP,
            episodic: this._episodes.length,
            episodicCap: EPISODIC_CAP,
            semantic: { nodes: semanticNodes, edges: semanticEdges }
        };
    }
}

module.exports = ThreeLayerMemory;
