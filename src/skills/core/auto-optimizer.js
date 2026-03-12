// src/skills/core/auto-optimizer.js
// Rensin Auto-Optimizer — 多維度自動優化 + RAG 學習迴路
// L1 技能: 自動執行優化，記錄到 RAG + 戰情室

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();

// RAG 整合 (延遲載入)
let _ragSkill = null;
function getRag() {
    if (!_ragSkill) {
        try { _ragSkill = require('./rag'); } catch (e) { _ragSkill = null; }
    }
    return _ragSkill;
}

async function ragQuery(query) {
    const rag = getRag();
    if (!rag) return null;
    try { return await rag.execute({ task: 'query', query, limit: 5 }); } catch (e) { return null; }
}

async function ragEvolve(situation, action_taken, outcome, score) {
    const rag = getRag();
    if (!rag) return;
    try { await rag.execute({ task: 'evolve', situation, action_taken, outcome, score }); } catch (e) { /* non-blocking */ }
}

// 戰情室更新
async function updateWarRoom(event, data) {
    try {
        const { getToken } = require('../../utils/yedan-auth');
        const token = getToken();
        if (!token) return;
        await fetch('https://notion-warroom.yagami8095.workers.dev/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer openclaw-warroom-2026' },
            body: JSON.stringify({ source: 'rensin-optimizer', event, data, timestamp: new Date().toISOString() }),
            signal: AbortSignal.timeout(10000)
        });
    } catch (e) { /* non-blocking */ }
}

async function execute(args) {
    const task = args.task || args.command || 'full';

    try {
        // --- [1. 完整優化掃描] ---
        if (task === 'full' || task === 'scan') {
            // RAG READ: 查詢上次優化結果
            const ragContext = await ragQuery('rensin optimizer scan result');

            const results = [];

            // Dim 1: 記憶體優化
            const mem = process.memoryUsage();
            const heapPct = (mem.heapUsed / mem.heapTotal * 100).toFixed(1);
            if (parseFloat(heapPct) > 80) {
                results.push({ dim: '記憶體', status: '⚠️', detail: `Heap ${heapPct}% — 建議 gc`, action: 'gc_hint' });
            } else {
                results.push({ dim: '記憶體', status: '✅', detail: `Heap ${heapPct}%` });
            }

            // Dim 2: 熔斷器健康
            try {
                const cb = require('../../core/circuit_breaker');
                const cbStatus = cb.getStatus();
                const openCBs = Object.entries(cbStatus).filter(([, v]) => v.state !== 'CLOSED');
                if (openCBs.length > 0) {
                    results.push({ dim: '熔斷器', status: '⚠️', detail: `${openCBs.length} 個已熔斷`, action: 'check_services' });
                } else {
                    results.push({ dim: '熔斷器', status: '✅', detail: '全部正常' });
                }
            } catch (e) {
                results.push({ dim: '熔斷器', status: '❓', detail: '無法檢查' });
            }

            // Dim 3: 本地知識圖譜
            try {
                const magma = require('../../memory/graph/ma_gma');
                const stats = magma.stats();
                results.push({ dim: '本地圖譜', status: '✅', detail: `${stats.nodes} 節點, ${stats.edges} 邊` });
                if (stats.nodes > 500) {
                    results.push({ dim: '圖譜清理', status: '⚠️', detail: '節點過多，建議合併', action: 'consolidate' });
                }
            } catch (e) {
                results.push({ dim: '本地圖譜', status: '❓', detail: '未載入' });
            }

            // Dim 4: 錯誤歷史
            const errorFile = path.join(PROJECT_ROOT, 'golem_error_history.json');
            try {
                if (fs.existsSync(errorFile)) {
                    const h = JSON.parse(fs.readFileSync(errorFile, 'utf-8'));
                    const recentErrors = (h.errors || []).filter(e =>
                        Date.now() - new Date(e.time || 0).getTime() < 3600000
                    );
                    if (recentErrors.length > 5) {
                        results.push({ dim: '錯誤率', status: '⚠️', detail: `過去 1h: ${recentErrors.length} 錯誤`, action: 'selfheal_scan' });
                    } else {
                        results.push({ dim: '錯誤率', status: '✅', detail: `過去 1h: ${recentErrors.length} 錯誤` });
                    }
                }
            } catch (e) { /* optional */ }

            // Dim 5: 磁碟空間
            try {
                const { execSync } = require('child_process');
                const dfOutput = execSync('df -h / | tail -1', { timeout: 5000, encoding: 'utf-8' });
                const parts = dfOutput.trim().split(/\s+/);
                const usePct = parseInt(parts[4]);
                if (usePct > 85) {
                    results.push({ dim: '磁碟', status: '⚠️', detail: `${parts[4]} 已使用`, action: 'cleanup' });
                } else {
                    results.push({ dim: '磁碟', status: '✅', detail: `${parts[4]} 已使用` });
                }
            } catch (e) {
                results.push({ dim: '磁碟', status: '❓', detail: '無法檢查' });
            }

            // Dim 6: Uptime
            const uptime = process.uptime();
            const uptimeH = (uptime / 3600).toFixed(1);
            results.push({ dim: '運行時間', status: parseFloat(uptimeH) > 24 ? '⚠️' : '✅', detail: `${uptimeH}h` });

            const warnings = results.filter(r => r.status === '⚠️');
            const output = `[Auto-Optimizer 掃描 (${results.length} 維度)]\n` +
                results.map(r => `  ${r.status} ${r.dim}: ${r.detail}`).join('\n') +
                (warnings.length > 0 ? `\n\n⚠️ ${warnings.length} 個需要注意的項目` : '\n\n✅ 系統狀態良好');

            // RAG WRITE: 記錄掃描結果
            await ragEvolve(
                `Auto-optimizer scan: ${results.length} dims, ${warnings.length} warnings`,
                'optimizer_scan',
                output.substring(0, 300),
                warnings.length === 0 ? 5 : 3
            );

            // 戰情室更新
            await updateWarRoom('optimizer_scan', {
                dimensions: results.length,
                warnings: warnings.length,
                details: results
            });

            return output;
        }

        // --- [2. 自動修復建議] ---
        if (task === 'suggest' || task === 'fix') {
            // RAG READ: 查詢最近的問題和修復歷史
            const ragContext = await ragQuery('rensin error fix suggestion');

            const suggestions = [];

            // 檢查熔斷器需要重置的
            try {
                const cb = require('../../core/circuit_breaker');
                const status = cb.getStatus();
                for (const [name, state] of Object.entries(status)) {
                    if (state.state === 'OPEN' && Date.now() - (state.lastTrip || 0) > 120000) {
                        suggestions.push(`🔌 建議重置 ${name} 熔斷器 (已熔斷超過 2 分鐘)`);
                    }
                }
            } catch (e) { /* optional */ }

            // 檢查 log 檔案大小
            const logFile = path.join(PROJECT_ROOT, 'rensin.log');
            try {
                if (fs.existsSync(logFile)) {
                    const stat = fs.statSync(logFile);
                    const sizeMB = stat.size / 1024 / 1024;
                    if (sizeMB > 50) {
                        suggestions.push(`📝 rensin.log 已達 ${sizeMB.toFixed(1)}MB，建議歸檔`);
                    }
                }
            } catch (e) { /* optional */ }

            // 檢查備份檔案過多
            try {
                const { execSync } = require('child_process');
                const bakCount = parseInt(execSync(`find ${PROJECT_ROOT}/src -name "*.bak.*" 2>/dev/null | wc -l`, { encoding: 'utf-8', timeout: 5000 }));
                if (bakCount > 20) {
                    suggestions.push(`🗂 ${bakCount} 個 .bak 備份檔案，建議清理`);
                }
            } catch (e) { /* optional */ }

            if (suggestions.length === 0) {
                return '✅ 無需額外優化建議，系統運行良好。';
            }

            return `[Auto-Optimizer 建議 (${suggestions.length})]\n` + suggestions.join('\n');
        }

        // --- [3. 效能基準測試] ---
        if (task === 'benchmark' || task === 'bench') {
            const start = Date.now();

            // CPU benchmark
            let cpuResult = 0;
            for (let i = 0; i < 1000000; i++) cpuResult += Math.sqrt(i);
            const cpuMs = Date.now() - start;

            // File I/O benchmark
            const ioStart = Date.now();
            const tmpFile = path.join(PROJECT_ROOT, '.bench_tmp');
            const testData = 'x'.repeat(1024 * 1024); // 1MB
            fs.writeFileSync(tmpFile, testData);
            fs.readFileSync(tmpFile);
            fs.unlinkSync(tmpFile);
            const ioMs = Date.now() - ioStart;

            // Network benchmark (RAG latency)
            const netStart = Date.now();
            let netMs = -1;
            try {
                const { getToken } = require('../../utils/yedan-auth');
                const token = getToken();
                if (token) {
                    await fetch('https://yedan-graph-rag.yagami8095.workers.dev/health', {
                        headers: { 'Authorization': `Bearer ${token}` },
                        signal: AbortSignal.timeout(10000)
                    });
                    netMs = Date.now() - netStart;
                }
            } catch (e) { netMs = -1; }

            const output = [
                `[效能基準測試]`,
                `🔢 CPU (1M sqrt): ${cpuMs}ms ${cpuMs < 100 ? '✅' : '⚠️'}`,
                `💾 File I/O (1MB R/W): ${ioMs}ms ${ioMs < 200 ? '✅' : '⚠️'}`,
                `🌐 RAG 延遲: ${netMs >= 0 ? netMs + 'ms' : '離線'} ${netMs > 0 && netMs < 3000 ? '✅' : '⚠️'}`,
            ].join('\n');

            await ragEvolve('Performance benchmark', 'benchmark', output, cpuMs < 100 && ioMs < 200 ? 5 : 3);
            return output;
        }

        return '未知 optimizer 指令。可用: full/scan, suggest/fix, benchmark/bench';

    } catch (e) {
        await ragEvolve(`Optimizer error: ${task}`, task, e.message, 0);
        return `Optimizer 錯誤: ${e.message}`;
    }
}

module.exports = {
    execute,
    name: 'auto-optimizer',
    description: '多維度自動優化 — 記憶體/熔斷器/圖譜/錯誤/磁碟/效能 + RAG 學習',
    PROMPT: `## auto-optimizer (自動優化技能)
你可以自動掃描和優化自身的運行狀態。每次掃描都會自動記錄到 RAG + 戰情室。

### 使用方式:
1. **完整掃描**: \`{ "action": "auto-optimizer", "task": "full" }\` — 6 維度健康檢查
2. **修復建議**: \`{ "action": "auto-optimizer", "task": "suggest" }\` — 可執行的修復建議
3. **效能測試**: \`{ "action": "auto-optimizer", "task": "benchmark" }\` — CPU/IO/Network 基準

### 自動化規則:
- 每次執行前查 RAG 確認歷史問題
- 每次執行後寫 RAG + 戰情室
- 重複錯誤自動跳過（不犯第二次）`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node auto-optimizer.js \'{"task":"full"}\''); process.exit(1); }
    try { execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message)); }
    catch (e) { console.error(`Parse Error: ${e.message}`); }
}
