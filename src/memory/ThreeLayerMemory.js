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

    queryEpisodes(situation, limit = 5) {
        // Filter out expired episodes (Zep-style temporal filtering)
        const now = new Date().toISOString();
        const validEpisodes = this._episodes.filter(ep =>
            !ep.invalid_at || ep.invalid_at > now
        );

        if (!situation) return validEpisodes.slice(-limit);
        const keywords = String(situation).toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (keywords.length === 0) return validEpisodes.slice(-limit);

        const result = validEpisodes
            .map(ep => {
                const text = `${ep.situation} ${ep.outcome}`.toLowerCase();
                const score = keywords.filter(kw => text.includes(kw)).length;
                return { ...ep, _score: score };
            })
            .filter(ep => ep._score > 0)
            .sort((a, b) => b._score - a._score || b.timestamp - a.timestamp)
            .slice(0, limit)
            .map(({ _score, ...ep }) => ep);

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
                return JSON.parse(fs.readFileSync(this._episodicFile, 'utf-8'));
            }
        } catch (e) { console.warn('[ThreeLayerMemory] Failed to load episodes:', e.message); }
        return [];
    }

    _saveEpisodes() {
        try {
            fs.writeFileSync(this._episodicFile, JSON.stringify(this._episodes, null, 2));
        } catch (e) { console.warn('[ThreeLayerMemory] Failed to save episodes:', e.message); }
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
