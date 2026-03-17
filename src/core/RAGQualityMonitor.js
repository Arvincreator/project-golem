// ============================================================
// RAGQualityMonitor — RAG 品質監控
// v11.5: 向量搜尋品質, 增長率, 陳舊向量, Tip 效能
// ============================================================

const path = require('path');
const fs = require('fs');
const DebouncedWriter = require('../utils/DebouncedWriter');

const DATA_FILE = 'rag_quality_metrics.json';

// Standard test queries with expected topic matches
const TEST_QUERIES = [
    { query: 'AGI research breakthroughs', expectedTopics: ['agi', 'research', 'model'] },
    { query: 'AI safety alignment', expectedTopics: ['safety', 'alignment', 'risk'] },
    { query: 'Claude Anthropic updates', expectedTopics: ['claude', 'anthropic'] },
    { query: 'LLM benchmark results', expectedTopics: ['benchmark', 'mmlu', 'leaderboard'] },
    { query: 'autonomous AI agents', expectedTopics: ['agent', 'autonomous', 'framework'] },
    { query: 'DeepSeek Chinese AI', expectedTopics: ['deepseek', 'chinese', 'qwen'] },
    { query: 'code generation tools', expectedTopics: ['code', 'generation', 'github'] },
    { query: 'transformer architecture', expectedTopics: ['transformer', 'architecture', 'model'] },
    { query: 'AI governance regulation', expectedTopics: ['governance', 'regulation', 'policy'] },
    { query: 'open source LLM frameworks', expectedTopics: ['open', 'source', 'framework'] },
];

class RAGQualityMonitor {
    constructor(options = {}) {
        this._dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
        this._filePath = path.join(this._dataDir, DATA_FILE);
        this._vectorStore = options.vectorStore || null;
        this._tipMemory = options.tipMemory || null;
        this._ragProvider = options.ragProvider || null;
        this._writer = new DebouncedWriter(this._filePath, 3000);
    }

    /**
     * Measure search quality using test queries
     * @param {Array} testQueries - Override default test queries
     * @returns {Object} { avgRelevance, avgLatencyMs, recall, queryResults }
     */
    async measureSearchQuality(testQueries) {
        const queries = testQueries || TEST_QUERIES;
        const results = [];

        if (!this._ragProvider) {
            return { avgRelevance: 0, avgLatencyMs: 0, recall: 0, queryResults: [], error: 'No RAGProvider' };
        }

        for (const tq of queries) {
            const start = Date.now();
            try {
                const searchResult = await this._ragProvider.augmentedRecall(tq.query, { limit: 5 });
                const latencyMs = Date.now() - start;

                // Measure relevance: check if results contain expected topics
                const merged = searchResult.merged || searchResult.vectorResults || [];
                let topicHits = 0;
                const expected = tq.expectedTopics || [];
                for (const topic of expected) {
                    const found = merged.some(r =>
                        (r.content || '').toLowerCase().includes(topic)
                    );
                    if (found) topicHits++;
                }

                const relevance = expected.length > 0 ? topicHits / expected.length : 0;
                results.push({
                    query: tq.query,
                    resultCount: merged.length,
                    relevance,
                    latencyMs,
                });
            } catch (e) {
                results.push({
                    query: tq.query,
                    resultCount: 0,
                    relevance: 0,
                    latencyMs: Date.now() - start,
                    error: e.message,
                });
            }
        }

        const withResults = results.filter(r => r.resultCount > 0);
        return {
            avgRelevance: results.length > 0
                ? results.reduce((sum, r) => sum + r.relevance, 0) / results.length
                : 0,
            avgLatencyMs: results.length > 0
                ? Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length)
                : 0,
            recall: results.length > 0 ? withResults.length / results.length : 0,
            queryResults: results,
        };
    }

    /**
     * Measure vector store growth
     * @returns {Object} { totalVectors, dbPath, growth }
     */
    measureVectorGrowth() {
        if (!this._vectorStore) {
            return { totalVectors: 0, error: 'No VectorStore' };
        }

        try {
            const stats = this._vectorStore.getStats();
            return {
                totalVectors: stats.totalVectors || 0,
                dbPath: stats.dbPath || '',
            };
        } catch (e) {
            return { totalVectors: 0, error: e.message };
        }
    }

    /**
     * Measure TipMemory effectiveness
     * @returns {Object} { totalTips, successRate, avgConfidence, byType }
     */
    measureTipEffectiveness() {
        if (!this._tipMemory) {
            return { totalTips: 0, error: 'No TipMemory' };
        }

        try {
            const stats = this._tipMemory.getStats();
            let effectiveness = {};

            if (this._tipMemory.getEffectivenessStats) {
                effectiveness = this._tipMemory.getEffectivenessStats();
            } else {
                // Calculate from available data
                const tips = this._tipMemory.getTopTips(200);
                let totalSuccess = 0;
                let totalFailure = 0;
                let totalConfidence = 0;

                for (const tip of tips) {
                    totalSuccess += tip.outcomes?.success || 0;
                    totalFailure += tip.outcomes?.failure || 0;
                    totalConfidence += tip.confidence || 0;
                }

                const totalOutcomes = totalSuccess + totalFailure;
                effectiveness = {
                    successRate: totalOutcomes > 0 ? totalSuccess / totalOutcomes : 0,
                    avgConfidence: tips.length > 0 ? totalConfidence / tips.length : 0,
                };
            }

            return {
                totalTips: stats.totalTips || 0,
                byType: stats.byType || {},
                ...effectiveness,
            };
        } catch (e) {
            return { totalTips: 0, error: e.message };
        }
    }

    /**
     * Generate comprehensive quality report
     * @returns {Object} Full quality metrics
     */
    async generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            vectorGrowth: this.measureVectorGrowth(),
            tipEffectiveness: this.measureTipEffectiveness(),
            searchQuality: null,
        };

        // Search quality is async
        try {
            report.searchQuality = await this.measureSearchQuality();
        } catch (e) {
            report.searchQuality = { error: e.message };
        }

        // Save
        this._saveReport(report);

        return report;
    }

    // --- Internal ---

    _saveReport(report) {
        try {
            this._writer.markDirty(JSON.stringify(report, null, 2));
        } catch (e) {
            console.warn('[RAGQualityMonitor] Save failed:', e.message);
        }
    }
}

module.exports = RAGQualityMonitor;
