// ============================================================
// AGIScanner — 全球 AGI 動態掃描器
// 用 WebResearcher (Gemini grounding) 掃描 8 大類 ~40 查詢 AGI 動態
// 結果全部灌入 RAG
// ============================================================

const SCAN_CATEGORIES = {
    research: {
        label: 'AGI Research',
        queries: [
            'latest AGI breakthroughs 2026',
            'transformer alternatives new architecture',
            'reasoning advances LLM chain-of-thought',
            'arXiv trending AI papers this week',
            'state space models SSM Mamba latest',
            'world models AI environment simulation 2026',
        ],
    },
    code: {
        label: 'AI Code & Frameworks',
        queries: [
            'trending AI repositories GitHub 2026',
            'open-source LLM frameworks latest',
            'AI agent frameworks autonomous',
            'AutoGen vs CrewAI vs LangGraph comparison 2026',
            'OpenAI Swarm multi-agent framework',
            'Claude Code MCP model context protocol',
        ],
    },
    safety: {
        label: 'AI Safety & Alignment',
        queries: [
            'AI alignment research latest',
            'AI governance regulation 2026',
            'LLM red teaming techniques',
            'ARC Evals AI safety evaluations 2026',
            'MIRI machine intelligence research latest',
            'Anthropic responsible scaling policy update',
            'AISI AI Safety Institute UK US updates',
        ],
    },
    benchmarks: {
        label: 'LLM Benchmarks',
        queries: [
            'MMLU ARC benchmark results 2026',
            'LLM comparison latest models',
            'code generation benchmark results',
            'SWE-bench coding agent leaderboard 2026',
            'GPQA graduate level question answering benchmark',
            'Chatbot Arena LLM ranking latest',
        ],
    },
    community: {
        label: 'AGI Community',
        queries: [
            'AGI timeline predictions experts',
            'AI trending discussions community',
            'Reddit r/MachineLearning trending posts',
            'Hacker News AI discussions trending',
            'Twitter X AI community trending topics',
        ],
    },
    chinese_ai: {
        label: 'Chinese AI Landscape',
        queries: [
            'DeepSeek latest model release 2026',
            'Qwen Alibaba AI model updates',
            'ByteDance AI research latest',
            'China AI competition landscape 2026',
            'Chinese open source LLM leaderboard',
        ],
    },
    claude_ecosystem: {
        label: 'Claude & Anthropic Ecosystem',
        queries: [
            'Anthropic Claude latest announcements 2026',
            'Claude Code CLI tool updates',
            'Claude vs GPT vs Gemini comparison 2026',
            'Anthropic funding partnerships latest',
            'Claude API new features capabilities',
        ],
    },
    agent_landscape: {
        label: 'AI Agent Landscape',
        queries: [
            'AI agent startups funding 2026',
            'desktop automation AI agents latest',
            'coding AI agents comparison 2026',
            'autonomous AI systems research progress',
            'AI agent orchestration frameworks',
        ],
    },
};

const DELAY_MS = 500;

class AGIScanner {
    constructor(options = {}) {
        this._webResearcher = options.webResearcher || null;
        this._ragProvider = options.ragProvider || null;
        this._scanQualityTracker = options.scanQualityTracker || null;
    }

    /**
     * Full scan across all 5 categories
     * @param {Object} options - { maxQueriesPerCategory, brain }
     * @returns {Object} ScanReport
     */
    async fullScan(options = {}) {
        const { maxQueriesPerCategory = 3, brain } = options;
        const report = {
            timestamp: new Date().toISOString(),
            categories: {},
            totalQueries: 0,
            totalResults: 0,
            errors: [],
        };

        // Ensure we have a WebResearcher
        const researcher = this._webResearcher || this._createDefaultResearcher();
        if (!researcher) {
            report.errors.push('No WebResearcher available');
            return report;
        }

        const categoryNames = Object.keys(SCAN_CATEGORIES);
        for (const catName of categoryNames) {
            const catResult = await this.scanCategory(catName, {
                researcher,
                maxQueries: maxQueriesPerCategory,
                brain,
            });
            report.categories[catName] = catResult;
            report.totalQueries += catResult.queriesRun;
            report.totalResults += catResult.results.length;
            if (catResult.errors.length > 0) {
                report.errors.push(...catResult.errors.map(e => `[${catName}] ${e}`));
            }
        }

        return report;
    }

    /**
     * Scan a single category
     * @param {string} category - Category name
     * @param {Object} options - { researcher, maxQueries, brain }
     * @returns {Object} CategoryResult
     */
    async scanCategory(category, options = {}) {
        const cat = SCAN_CATEGORIES[category];
        if (!cat) {
            return { category, label: 'Unknown', queriesRun: 0, results: [], errors: [`Unknown category: ${category}`] };
        }

        const researcher = options.researcher || this._webResearcher || this._createDefaultResearcher();
        const maxQueries = options.maxQueries || 3;
        const queries = cat.queries.slice(0, maxQueries);

        const result = {
            category,
            label: cat.label,
            queriesRun: 0,
            results: [],
            errors: [],
        };

        for (const query of queries) {
            // v11.5: Skip worthless queries if tracker enabled
            if (this._scanQualityTracker && process.env.SKIP_WORTHLESS_QUERIES !== 'false' && this._scanQualityTracker.isWorthless(query)) {
                continue;
            }

            try {
                const searchResult = await researcher.search(query);
                result.queriesRun++;
                const entry = {
                    query,
                    synthesis: searchResult.synthesis || '',
                    resultCount: (searchResult.results || []).length,
                    webSearchQueries: searchResult.webSearchQueries || [],
                    timestamp: searchResult.timestamp,
                };
                result.results.push(entry);

                // v11.5: Record scan quality
                if (this._scanQualityTracker) {
                    this._scanQualityTracker.recordScanResult(query, category, {
                        resultCount: entry.resultCount,
                        hasSynthesis: !!entry.synthesis,
                    });
                }
            } catch (e) {
                result.errors.push(`Query "${query}" failed: ${e.message}`);
                result.queriesRun++;
                // v11.5: Record failure
                if (this._scanQualityTracker) {
                    this._scanQualityTracker.recordScanResult(query, category, { resultCount: 0, hasSynthesis: false });
                }
            }

            // Rate limit protection
            if (queries.indexOf(query) < queries.length - 1) {
                await this._delay(DELAY_MS);
            }
        }

        return result;
    }

    /**
     * Ingest scan findings into RAG
     * @param {Object} scanReport - From fullScan()
     * @returns {{ ingested: number, failed: number }}
     */
    async ingestFindings(scanReport) {
        if (!this._ragProvider) return { ingested: 0, failed: 0 };
        if (!scanReport || !scanReport.categories) return { ingested: 0, failed: 0 };

        let ingested = 0;
        let failed = 0;

        for (const [catName, catResult] of Object.entries(scanReport.categories)) {
            for (const r of catResult.results || []) {
                if (!r.synthesis) continue;
                try {
                    await this._ragProvider.ingest(
                        `[AGI Scan: ${catName}] ${r.query}\n${r.synthesis}`,
                        {
                            type: 'agi_scan',
                            category: catName,
                            query: r.query,
                            scannedAt: scanReport.timestamp,
                        }
                    );
                    ingested++;
                } catch (e) {
                    failed++;
                }
            }
        }

        return { ingested, failed };
    }

    /**
     * Format report as readable string
     */
    formatReport(scanReport) {
        if (!scanReport) return '[AGI Scanner] No report available';

        const lines = [
            `=== AGI Scan Report ===`,
            `Time: ${scanReport.timestamp}`,
            `Total queries: ${scanReport.totalQueries}`,
            `Total results: ${scanReport.totalResults}`,
            `Errors: ${scanReport.errors.length}`,
            '',
        ];

        for (const [catName, catResult] of Object.entries(scanReport.categories || {})) {
            lines.push(`--- ${catResult.label} (${catResult.queriesRun} queries) ---`);
            for (const r of catResult.results || []) {
                const synth = (r.synthesis || '').substring(0, 200);
                lines.push(`  Q: ${r.query}`);
                lines.push(`  A: ${synth}${synth.length >= 200 ? '...' : ''}`);
            }
            if (catResult.errors.length > 0) {
                lines.push(`  Errors: ${catResult.errors.join(', ')}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    // --- Internal ---

    _createDefaultResearcher() {
        try {
            const WebResearcher = require('./WebResearcher');
            return new WebResearcher();
        } catch (e) {
            return null;
        }
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = AGIScanner;
