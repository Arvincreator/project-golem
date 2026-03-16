// tests/Nexus.test.js
const path = require('path');
const fs = require('fs');

const UPGRADES_FILE = path.join(process.cwd(), 'nexus_upgrades.json');
const BENCHMARK_FILE = path.join(process.cwd(), 'benchmark_history.json');

// ─── Cleanup ───
function cleanup() {
    for (const f of [UPGRADES_FILE, BENCHMARK_FILE]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    }
}

beforeEach(cleanup);
afterAll(cleanup);

// ═══════════════════════════════════════
// WebResearcher
// ═══════════════════════════════════════
describe('WebResearcher', () => {
    const WebResearcher = require('../src/core/WebResearcher');

    it('returns empty results when query is empty', async () => {
        const wr = new WebResearcher();
        const result = await wr.search('');
        expect(result.results).toEqual([]);
        expect(result.synthesis).toContain('請提供');
    });

    it('search() graceful degrades when GEMINI_API_KEY not set', async () => {
        const origKey = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;
        const wr = new WebResearcher();
        const result = await wr.search('test query');
        expect(result.error).toBeDefined();
        expect(result.results).toEqual([]);
        if (origKey) process.env.GEMINI_API_KEY = origKey;
    });

    it('LRU cache hit on second call', async () => {
        const wr = new WebResearcher({ cacheSize: 5 });
        // Manually set cache
        wr._setCache('cached query', { query: 'cached query', results: [{ title: 'cached', url: 'http://x', snippet: '' }], synthesis: 'cached synthesis', webSearchQueries: [], timestamp: '2026-01-01' });

        const result = await wr.search('cached query');
        expect(result.fromCache).toBe(true);
        expect(result.synthesis).toBe('cached synthesis');
    });

    it('LRU cache evicts oldest when full', () => {
        const wr = new WebResearcher({ cacheSize: 2 });
        wr._setCache('a', { query: 'a' });
        wr._setCache('b', { query: 'b' });
        wr._setCache('c', { query: 'c' }); // should evict 'a'
        expect(wr._getCached('a')).toBeNull();
        expect(wr._getCached('b')).not.toBeNull();
        expect(wr._getCached('c')).not.toBeNull();
    });

    it('brainSynthesize returns empty when brain is null', async () => {
        const wr = new WebResearcher();
        const result = await wr.brainSynthesize('test', null);
        expect(result.synthesis).toBe('');
        expect(result.sources).toEqual([]);
    });

    it('brainSynthesize works with mock brain', async () => {
        const wr = new WebResearcher();
        const mockBrain = { sendMessage: jest.fn().mockResolvedValue('brain response about AI') };
        const result = await wr.brainSynthesize('AI trends', mockBrain);
        expect(result.synthesis).toBe('brain response about AI');
        expect(result.sources).toEqual(['brain-knowledge']);
        expect(mockBrain.sendMessage).toHaveBeenCalledWith('搜尋並總結: AI trends');
    });

    it('researchFusion merges web + RAG', async () => {
        const wr = new WebResearcher({ cacheSize: 5 });
        // Pre-cache web result
        wr._setCache('test fusion', {
            query: 'test fusion',
            results: [{ title: 'Web Result', url: 'http://example.com', snippet: 'info' }],
            synthesis: 'Web synthesis about fusion',
            webSearchQueries: ['fusion'],
            timestamp: '2026-01-01',
        });

        const mockRag = { execute: jest.fn().mockResolvedValue('RAG: related knowledge') };
        const result = await wr.researchFusion('test fusion', { ragSkill: mockRag });

        expect(result.fused_synthesis).toContain('Web 搜尋');
        expect(result.fused_synthesis).toContain('RAG 知識庫');
        expect(result.sources).toContain('http://example.com');
        expect(result.sources).toContain('rag-knowledge');
    });

    it('researchFusion returns RAG-only when web fails', async () => {
        const wr = new WebResearcher();
        const mockRag = { execute: jest.fn().mockResolvedValue('RAG knowledge only') };

        // No GEMINI_API_KEY → web fails
        const origKey = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        const result = await wr.researchFusion('test no web', { ragSkill: mockRag });
        expect(result.fused_synthesis).toContain('RAG 知識庫');
        expect(result.sources).toContain('rag-knowledge');

        if (origKey) process.env.GEMINI_API_KEY = origKey;
    });

    it('_parseGroundingResults handles missing metadata', () => {
        const wr = new WebResearcher();
        const parsed = wr._parseGroundingResults({});
        expect(parsed.results).toEqual([]);
        expect(parsed.webSearchQueries).toEqual([]);
    });

    it('_parseGroundingResults extracts grounding chunks', () => {
        const wr = new WebResearcher();
        const mockResponse = {
            text: 'Synthesis text',
            candidates: [{
                groundingMetadata: {
                    webSearchQueries: ['query1', 'query2'],
                    groundingChunks: [
                        { web: { title: 'Source 1', uri: 'http://s1.com' } },
                        { web: { title: 'Source 2', uri: 'http://s2.com' } },
                    ],
                },
            }],
        };
        const parsed = wr._parseGroundingResults(mockResponse);
        expect(parsed.results).toHaveLength(2);
        expect(parsed.results[0].title).toBe('Source 1');
        expect(parsed.results[0].url).toBe('http://s1.com');
        expect(parsed.webSearchQueries).toEqual(['query1', 'query2']);
        expect(parsed.synthesis).toBe('Synthesis text');
    });
});

// ═══════════════════════════════════════
// BenchmarkEngine
// ═══════════════════════════════════════
describe('BenchmarkEngine', () => {
    const BenchmarkEngine = require('../src/core/BenchmarkEngine');

    it('snapshot() collects system metrics', async () => {
        const be = new BenchmarkEngine({ historyFile: BENCHMARK_FILE });
        const snap = await be.snapshot('test');

        expect(snap.label).toBe('test');
        expect(snap.timestamp).toBeDefined();
        expect(snap.system.rss).toBeGreaterThan(0);
        expect(snap.system.heapUsed).toBeGreaterThan(0);
        expect(snap.system.uptime).toBeGreaterThanOrEqual(0);
    });

    it('snapshot() handles jest/rag failures gracefully', async () => {
        const be = new BenchmarkEngine({ historyFile: BENCHMARK_FILE });
        const snap = await be.snapshot('graceful');

        // Tests & RAG may not be available in test env, should degrade gracefully
        expect(snap.tests).toBeDefined();
        expect(snap.rag).toBeDefined();
        // Either available: true or available: false
        expect(typeof snap.tests.available === 'boolean' || snap.tests.available === undefined).toBeTruthy();
    });

    it('computeDelta() calculates improvement correctly', () => {
        const be = new BenchmarkEngine();
        const before = {
            system: { rss: 100, heapUsed: 50 },
            rag: { entities: 10, vectors: 100, available: true },
            tests: { passed: 700, failed: 10, total: 710, available: true },
        };
        const after = {
            system: { rss: 90, heapUsed: 45 },
            rag: { entities: 15, vectors: 120, available: true },
            tests: { passed: 750, failed: 5, total: 755, available: true },
        };

        const delta = be.computeDelta(before, after);
        expect(delta.improved.length).toBeGreaterThan(0);
        expect(delta.improvement_pct).toBeGreaterThan(0);
        expect(delta.deltas.rss_mb.improved).toBe(true);  // lower is better
        expect(delta.deltas.tests_passed.improved).toBe(true);  // higher is better
        expect(delta.deltas.tests_failed.improved).toBe(true);  // lower is better
    });

    it('computeDelta() identifies degradation', () => {
        const be = new BenchmarkEngine();
        const before = {
            system: { rss: 90, heapUsed: 40 },
            tests: { passed: 750, failed: 5, total: 755, available: true },
        };
        const after = {
            system: { rss: 120, heapUsed: 60 },
            tests: { passed: 700, failed: 15, total: 715, available: true },
        };

        const delta = be.computeDelta(before, after);
        expect(delta.degraded.length).toBeGreaterThan(0);
        expect(delta.degraded).toContain('rss_mb');
    });

    it('saveSnapshot() bounded to max snapshots', () => {
        const file = path.join(process.cwd(), 'test_bench_bounded.json');
        const be = new BenchmarkEngine({ historyFile: file, maxSnapshots: 3 });

        try {
            for (let i = 0; i < 5; i++) {
                be.saveSnapshot({ label: `snap_${i}`, timestamp: new Date().toISOString() });
            }
            const history = be.loadHistory();
            expect(history.length).toBe(3);
            expect(history[0].label).toBe('snap_2');
        } finally {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
    });

    it('loadHistory() returns empty array when file missing', () => {
        const be = new BenchmarkEngine({ historyFile: '/tmp/nonexistent_bench.json' });
        const history = be.loadHistory();
        expect(history).toEqual([]);
    });

    it('computeDelta() returns 0% when no metrics available', () => {
        const be = new BenchmarkEngine();
        const delta = be.computeDelta({}, {});
        expect(delta.improvement_pct).toBe(0);
        expect(delta.improved).toEqual([]);
        expect(delta.degraded).toEqual([]);
    });
});

// ═══════════════════════════════════════
// Nexus Skill
// ═══════════════════════════════════════
describe('Nexus Skill', () => {
    const nexus = require('../src/skills/core/nexus');

    it('exports name, execute, PROMPT', () => {
        expect(nexus.name).toBe('nexus');
        expect(typeof nexus.execute).toBe('function');
        expect(nexus.PROMPT).toBeDefined();
        expect(nexus.PROMPT).toContain('nexus');
        expect(nexus.PROMPT).toContain('auto');
    });

    describe('research', () => {
        it('returns error when query missing', async () => {
            const result = await nexus.execute({ task: 'research' });
            expect(result).toContain('請提供');
        });

        it('returns fusion result with query', async () => {
            const result = await nexus.execute({ task: 'research', query: 'test nexus research' });
            expect(result).toContain('Nexus Research');
            expect(result).toContain('test nexus research');
        });

        it('degrades gracefully without web (no GEMINI_API_KEY)', async () => {
            const origKey = process.env.GEMINI_API_KEY;
            delete process.env.GEMINI_API_KEY;
            const result = await nexus.execute({ task: 'research', query: 'offline test' });
            expect(result).toContain('Nexus Research');
            if (origKey) process.env.GEMINI_API_KEY = origKey;
        });
    });

    describe('benchmark', () => {
        it('returns formatted snapshot', async () => {
            const result = await nexus.execute({ task: 'benchmark', label: 'test' });
            expect(result).toContain('Benchmark');
            expect(result).toContain('RSS=');
            expect(result).toContain('Heap=');
        });
    });

    describe('plan', () => {
        it('returns error when goal missing', async () => {
            const result = await nexus.execute({ task: 'plan' });
            expect(result).toContain('請提供');
        });

        it('generates heuristic plan without brain', async () => {
            const result = await nexus.execute({ task: 'plan', goal: '升級記憶系統' });
            expect(result).toContain('Nexus Plan');
            expect(result).toContain('步驟');
        });

        it('generates plan with mock brain', async () => {
            const mockBrain = {
                sendMessage: jest.fn().mockResolvedValue('[{"step":"selfheal:diagnose","args":{},"description":"診斷"}]'),
            };
            const result = await nexus.execute({ task: 'plan', goal: 'test plan', _brain: mockBrain });
            expect(result).toContain('Nexus Plan');
            expect(result).toContain('selfheal:diagnose');
        });
    });

    describe('validate', () => {
        it('computes delta between snapshots', async () => {
            const before = {
                system: { rss: 100, heapUsed: 50 },
                tests: { passed: 700, failed: 10, total: 710, available: true },
            };
            const after = {
                system: { rss: 90, heapUsed: 45 },
                tests: { passed: 750, failed: 5, total: 755, available: true },
            };
            const result = await nexus.execute({ task: 'validate', _before: before, _after: after });
            expect(result).toContain('Nexus Validate');
            expect(result).toContain('改善率');
        });

        it('returns error without snapshots', async () => {
            const result = await nexus.execute({ task: 'validate' });
            expect(result).toContain('before');
        });
    });

    describe('status', () => {
        it('returns empty state message when no upgrades', async () => {
            const result = await nexus.execute({ task: 'status' });
            expect(result).toContain('尚無升級記錄');
        });

        it('returns history when upgrades exist', async () => {
            // Write fake upgrade data
            const data = {
                upgrades: [{
                    id: 'test_1',
                    goal: '測試升級',
                    status: 'completed',
                    improvement_pct: 25,
                    created_at: '2026-01-01T00:00:00Z',
                }],
                stats: { total_upgrades: 1, total_completed: 1, avg_improvement: 25, best_improvement: 25 },
            };
            fs.writeFileSync(UPGRADES_FILE, JSON.stringify(data));

            const result = await nexus.execute({ task: 'status' });
            expect(result).toContain('Nexus Status');
            expect(result).toContain('測試升級');
            expect(result).toContain('25%');
        });
    });

    describe('execute_plan', () => {
        it('returns error without steps', async () => {
            const result = await nexus.execute({ task: 'execute_plan' });
            expect(result).toContain('請提供');
        });

        it('skips steps requiring approval', async () => {
            const result = await nexus.execute({
                task: 'execute_plan',
                steps: [{ step: 'command:rm', requires_approval: true, description: 'dangerous' }],
            });
            expect(result).toContain('需人工確認');
        });

        it('handles unknown skills gracefully', async () => {
            const result = await nexus.execute({
                task: 'execute_plan',
                steps: [{ step: 'nonexistent:task', args: {} }],
            });
            expect(result).toContain('未知技能');
        });
    });

    describe('auto', () => {
        it('returns error when goal missing', async () => {
            const result = await nexus.execute({ task: 'auto' });
            expect(result).toContain('請提供');
        });

        it('runs full pipeline with heuristic plan (no brain)', async () => {
            const result = await nexus.execute({ task: 'auto', goal: '測試全自動升級' });
            expect(result).toContain('Nexus Auto Upgrade');
            expect(result).toContain('測試全自動升級');
            expect(result).toContain('迭代');
            expect(result).toContain('改善率');

            // Should persist upgrade record
            const data = JSON.parse(fs.readFileSync(UPGRADES_FILE, 'utf-8'));
            expect(data.upgrades.length).toBeGreaterThan(0);
            expect(data.stats.total_upgrades).toBeGreaterThan(0);
        }, 30000);

        it('returns unknown command for invalid task', async () => {
            const result = await nexus.execute({ task: 'nonexistent' });
            expect(result).toContain('未知 nexus 指令');
        });
    });

    describe('report', () => {
        it('generates formatted report', async () => {
            const result = await nexus.execute({
                task: 'report',
                _data: {
                    goal: '測試報告',
                    research_summary: 'test research',
                    plan_steps: [{ step: 'selfheal:diagnose', success: true }],
                    delta: { summary: '改善 3/5 指標', improvement_pct: 60 },
                    iterations: 2,
                },
            });
            expect(result).toContain('Nexus Upgrade Report');
            expect(result).toContain('測試報告');
            expect(result).toContain('60%');
        });
    });
});
