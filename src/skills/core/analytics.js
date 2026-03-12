// src/skills/core/analytics.js
// Rensin Self-Analytics — 自我分析 + 效能追蹤 + RAG 知識圖譜整合
// L0 技能: 只讀取/統計，不修改任何東西

const fs = require('fs');
const path = require('path');
const circuitBreaker = require('../../core/circuit_breaker');

const PROJECT_ROOT = process.cwd();
const ERROR_HISTORY = path.join(PROJECT_ROOT, 'golem_error_history.json');

async function execute(args) {
    const task = args.task || args.command || 'overview';

    try {
        // --- [1. 總覽] ---
        if (task === 'overview' || task === 'o') {
            const uptime = process.uptime();
            const uptimeStr = `${Math.floor(uptime / 3600)}h${Math.floor((uptime % 3600) / 60)}m`;
            const mem = process.memoryUsage();
            const memMB = Math.round(mem.rss / 1024 / 1024);
            const heapUsed = Math.round(mem.heapUsed / 1024 / 1024);
            const heapTotal = Math.round(mem.heapTotal / 1024 / 1024);

            // Circuit Breaker 狀態
            const cbStatus = circuitBreaker.getStatus();
            const openCBs = Object.entries(cbStatus).filter(([, v]) => v.state !== 'CLOSED');
            const cbInfo = openCBs.length > 0
                ? openCBs.map(([k, v]) => `  🔴 ${k}: ${v.state} (${v.failures}x fail)`).join('\n')
                : '  🟢 全部正常';

            // 錯誤歷史統計
            let errorStats = '(無記錄)';
            try {
                if (fs.existsSync(ERROR_HISTORY)) {
                    const h = JSON.parse(fs.readFileSync(ERROR_HISTORY, 'utf-8'));
                    const rate = h.stats.fixed + h.stats.failed > 0
                        ? ((h.stats.fixed / (h.stats.fixed + h.stats.failed)) * 100).toFixed(0)
                        : 0;
                    errorStats = `偵測: ${h.stats.detected} | 修復: ${h.stats.fixed} | 失敗: ${h.stats.failed} | 成功率: ${rate}%`;
                }
            } catch (e) { /* optional */ }

            // Skills 統計
            const skillsDir = path.join(PROJECT_ROOT, 'src/skills/core');
            let skillCount = 0;
            try {
                skillCount = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js')).length;
            } catch (e) { /* optional */ }

            // 本地 MAGMA 統計
            let magmaInfo = '(未載入)';
            try {
                const magma = require('../../memory/graph/ma_gma');
                const stats = magma.stats();
                magmaInfo = `節點: ${stats.nodes} | 邊: ${stats.edges} | 類型: ${Object.keys(stats.nodeTypes).length}`;
            } catch (e) { /* optional */ }

            return [
                `📊 [Rensin Analytics 總覽]`,
                ``,
                `⏱ 運行時間: ${uptimeStr}`,
                `💾 記憶體: ${memMB}MB RSS | ${heapUsed}/${heapTotal}MB Heap`,
                `📦 技能數: ${skillCount}`,
                `🧠 本地 MAGMA: ${magmaInfo}`,
                ``,
                `🔌 熔斷器:`,
                cbInfo,
                ``,
                `🔧 自我修復: ${errorStats}`,
            ].join('\n');
        }

        // --- [2. 記憶體分析] ---
        if (task === 'memory' || task === 'mem') {
            const mem = process.memoryUsage();
            return [
                `[記憶體分析]`,
                `RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB`,
                `Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
                `Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`,
                `External: ${(mem.external / 1024 / 1024).toFixed(1)}MB`,
                `ArrayBuffers: ${((mem.arrayBuffers || 0) / 1024 / 1024).toFixed(1)}MB`,
                ``,
                `Heap 使用率: ${((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)}%`,
                mem.heapUsed > 500 * 1024 * 1024 ? '⚠️ Heap 使用偏高，建議關注' : '✅ 記憶體正常',
            ].join('\n');
        }

        // --- [3. 熔斷器詳情] ---
        if (task === 'circuits' || task === 'cb') {
            const status = circuitBreaker.getStatus();
            if (Object.keys(status).length === 0) return '所有熔斷器正常 (無記錄)';
            return '[熔斷器詳情]\n' + Object.entries(status).map(([k, v]) =>
                `${v.state === 'CLOSED' ? '🟢' : v.state === 'OPEN' ? '🔴' : '🟡'} ${k}: ${v.state}\n` +
                `  連續失敗: ${v.failures} | 總 trips: ${v.totalTrips} | 成功: ${v.successes || 0}`
            ).join('\n\n');
        }

        // --- [4. 技能清單] ---
        if (task === 'skills' || task === 'sk') {
            const skillsDir = path.join(PROJECT_ROOT, 'src/skills/core');
            try {
                const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js'));
                const skills = files.map(f => {
                    try {
                        const mod = require(path.join(skillsDir, f));
                        return `  ${mod.name || f.replace('.js', '')} — ${(mod.description || '').substring(0, 60)}`;
                    } catch (e) {
                        return `  ${f.replace('.js', '')} — ⚠️ 載入錯誤: ${e.message.substring(0, 40)}`;
                    }
                });
                return `[已安裝技能 (${files.length})]\n${skills.join('\n')}`;
            } catch (e) {
                return `技能目錄讀取失敗: ${e.message}`;
            }
        }

        // --- [5. 日誌分析] ---
        if (task === 'logs' || task === 'log') {
            const logFile = path.join(PROJECT_ROOT, 'rensin.log');
            if (!fs.existsSync(logFile)) return '無 rensin.log 檔案';

            const content = fs.readFileSync(logFile, 'utf-8');
            const lines = content.split('\n');
            const errors = lines.filter(l => /error|Error|ERROR|FATAL|failed|Failed/i.test(l));
            const warnings = lines.filter(l => /warn|Warning|WARN/i.test(l));

            return [
                `[日誌分析]`,
                `總行數: ${lines.length}`,
                `錯誤: ${errors.length}`,
                `警告: ${warnings.length}`,
                ``,
                errors.length > 0 ? `最近錯誤:\n${errors.slice(-5).map(l => '  ' + l.substring(0, 120)).join('\n')}` : '✅ 無錯誤',
            ].join('\n');
        }

        return '未知 analytics 指令。可用: overview, memory, circuits, skills, logs';

    } catch (e) {
        return `Analytics 錯誤: ${e.message}`;
    }
}

module.exports = {
    execute,
    name: 'analytics',
    description: 'Rensin 自我分析 — 效能/記憶體/熔斷器/技能/日誌 (L0 只讀)',
    PROMPT: `## analytics (自我分析技能)
你可以檢查自己的運行狀態和效能指標。這是一個 L0 (只讀) 技能。

### 使用方式:
1. **總覽**: \`{ "action": "analytics", "task": "overview" }\`
2. **記憶體**: \`{ "action": "analytics", "task": "memory" }\`
3. **熔斷器**: \`{ "action": "analytics", "task": "circuits" }\`
4. **技能清單**: \`{ "action": "analytics", "task": "skills" }\`
5. **日誌分析**: \`{ "action": "analytics", "task": "logs" }\``
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node analytics.js \'{"task":"overview"}\''); process.exit(1); }
    try { execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message)); }
    catch (e) { console.error(`Parse Error: ${e.message}`); }
}
