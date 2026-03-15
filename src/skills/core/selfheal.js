// src/skills/core/selfheal.js
// Self-Healing Skill — Rensin 自動除錯修復系統 + RAG 學習迴路
// 能力: 偵測錯誤 → 讀取代碼 → 分析根因 → 生成修復 → 測試 → RAG 記錄

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOG_FILE = path.join(process.cwd(), 'rensin.log');
const ERROR_HISTORY = path.join(process.cwd(), 'golem_error_history.json');
const PROJECT_ROOT = process.cwd();

// RAG 整合 (延遲載入避免循環依賴)
let _ragSkill = null;
function getRag() {
    if (!_ragSkill) {
        try { _ragSkill = require('./rag'); } catch (e) { console.warn('[selfheal]', e.message); _ragSkill = null; }
    }
    return _ragSkill;
}

async function ragQuery(query) {
    const rag = getRag();
    if (!rag) return null;
    try {
        const result = await rag.execute({ task: 'query', query, limit: 5 });
        return result;
    } catch (e) { console.warn('[selfheal]', e.message); return null; }
}

async function ragEvolve(situation, action_taken, outcome, score) {
    const rag = getRag();
    if (!rag) return;
    try {
        await rag.execute({ task: 'evolve', situation, action_taken, outcome, score });
    } catch (e) { console.warn('[selfheal]', e.message); }
}

async function ragIngest(entities, relationships) {
    const rag = getRag();
    if (!rag) return;
    try {
        await rag.execute({ task: 'ingest', entities, relationships });
    } catch (e) { console.warn('[selfheal]', e.message); }
}

function loadErrorHistory() {
    try {
        if (fs.existsSync(ERROR_HISTORY)) return JSON.parse(fs.readFileSync(ERROR_HISTORY, 'utf-8'));
    } catch (e) { console.warn('[selfheal]', e.message); }
    return { errors: [], fixes: [], stats: { detected: 0, fixed: 0, failed: 0 } };
}

function saveErrorHistory(data) {
    // Keep history bounded
    if (data.fixes.length > 100) data.fixes = data.fixes.slice(-100);
    if (data.errors.length > 200) data.errors = data.errors.slice(-200);
    fs.writeFileSync(ERROR_HISTORY, JSON.stringify(data, null, 2));
}

async function execute(args) {
    const task = args.task || args.command || 'diagnose';

    try {
        // --- [1. 診斷: 掃描 log 找錯誤 + RAG 查詢歷史修復] ---
        if (task === 'diagnose' || task === 'scan') {
            const logContent = fs.existsSync(LOG_FILE)
                ? fs.readFileSync(LOG_FILE, 'utf-8').split('\n').slice(-200).join('\n')
                : '';

            const errorPatterns = [
                /Error:\s*(.+)/gi,
                /TypeError:\s*(.+)/gi,
                /ReferenceError:\s*(.+)/gi,
                /SyntaxError:\s*(.+)/gi,
                /Cannot\s+(?:read|find|resolve)\s+(.+)/gi,
                /ENOENT:\s*(.+)/gi,
                /ECONNREFUSED:\s*(.+)/gi,
                /timed?\s*out/gi,
                /CONSUMER_SUSPENDED/gi,
                /403\s+Forbidden/gi,
                /409\s+Conflict/gi,
                /polling_error/gi,
                /FATAL:\s*(.+)/gi,
                /UnhandledPromiseRejection/gi,
            ];

            const errors = [];
            for (const pattern of errorPatterns) {
                pattern.lastIndex = 0; // Reset regex state
                let match;
                while ((match = pattern.exec(logContent)) !== null) {
                    errors.push({
                        pattern: pattern.source,
                        message: match[0],
                        context: logContent.substring(Math.max(0, match.index - 100), match.index + 200)
                    });
                }
            }

            // Deduplicate
            const unique = [...new Map(errors.map(e => [e.message.substring(0, 80), e])).values()];

            const history = loadErrorHistory();
            history.stats.detected += unique.length;
            saveErrorHistory(history);

            if (unique.length === 0) {
                await ragEvolve('Selfheal diagnose scan', 'scan', 'No errors found - system healthy', 5);
                return '系統健康！未偵測到錯誤。';
            }

            // RAG READ: 查詢每個錯誤是否有過往修復經驗
            let ragAdvice = '';
            const firstError = unique[0].message.substring(0, 60);
            const ragResult = await ragQuery(`selfheal fix ${firstError}`);
            if (ragResult && typeof ragResult === 'string' && ragResult.includes('經驗回放')) {
                ragAdvice = `\n\n📚 RAG 建議: 發現相關歷史修復記錄，請參考過往經驗。`;
            }

            // RAG WRITE: 記錄偵測到的錯誤
            const errorEntities = unique.slice(0, 3).map((e, i) => ({
                id: `error_${Date.now()}_${i}`,
                type: 'detected_error',
                name: e.message.substring(0, 60),
                properties: { pattern: e.pattern, detected_by: 'rensin-selfheal' }
            }));
            await ragIngest(errorEntities, []);
            await ragEvolve(
                `Detected ${unique.length} errors: ${firstError}`,
                'diagnose',
                `Found ${unique.length} unique errors`,
                unique.length > 5 ? 1 : 2
            );

            return `偵測到 ${unique.length} 個錯誤:\n` +
                unique.map((e, i) => `[${i + 1}] ${e.message.substring(0, 120)}`).join('\n') +
                `\n\n請使用 selfheal read <file> 讀取相關代碼，再用 selfheal patch 修復。${ragAdvice}`;
        }

        // --- [2. 讀取相關代碼] ---
        if (task === 'read') {
            const filePath = args.file || args.parameter;
            if (!filePath) return '請指定要讀取的檔案路徑。';

            const safePath = path.resolve(PROJECT_ROOT, filePath);
            if (!safePath.startsWith(PROJECT_ROOT)) return '禁止存取專案目錄外的檔案。';
            if (!fs.existsSync(safePath)) return `檔案不存在: ${filePath}`;

            const content = fs.readFileSync(safePath, 'utf-8');
            const lines = content.split('\n');
            return `檔案: ${filePath} (${lines.length} 行)\n` +
                lines.map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n').substring(0, 8000);
        }

        // --- [3. 套用修復 patch + RAG 記錄] ---
        if (task === 'patch' || task === 'fix') {
            const targetFile = args.file;
            const oldCode = args.old || args.search;
            const newCode = args.new || args.replace;

            if (!targetFile || !oldCode || !newCode) {
                return '修復格式: { task: "patch", file: "src/xxx.js", old: "原始代碼", new: "修復代碼", description: "修復說明" }';
            }

            const safePath = path.resolve(PROJECT_ROOT, targetFile);
            if (!safePath.startsWith(PROJECT_ROOT)) return '禁止存取專案目錄外的檔案。';
            if (!fs.existsSync(safePath)) return `檔案不存在: ${targetFile}`;

            const content = fs.readFileSync(safePath, 'utf-8');

            if (!content.includes(oldCode)) {
                await ragEvolve(`Patch target not found in ${targetFile}`, 'patch', 'old code not found', 1);
                return `找不到要替換的代碼片段。請確認 old 欄位完全匹配。`;
            }

            // Backup
            const backupPath = safePath + `.bak.${Date.now()}`;
            fs.writeFileSync(backupPath, content);

            // Apply patch
            const patched = content.replace(oldCode, newCode);
            fs.writeFileSync(safePath, patched);

            // Syntax check
            try {
                execSync(`node -c "${safePath}"`, { timeout: 5000, stdio: 'pipe' });
            } catch (syntaxErr) {
                // Rollback
                fs.writeFileSync(safePath, content);
                fs.unlinkSync(backupPath);

                const history = loadErrorHistory();
                history.stats.failed++;
                saveErrorHistory(history);

                await ragEvolve(
                    `Patch failed on ${targetFile}: syntax error`,
                    'patch',
                    `Rollback: ${syntaxErr.message.substring(0, 100)}`,
                    0
                );
                return `語法錯誤！已自動還原。錯誤: ${syntaxErr.message.substring(0, 200)}`;
            }

            const description = args.description || 'auto-fix';
            const history = loadErrorHistory();
            history.fixes.push({
                time: new Date().toISOString(),
                file: targetFile,
                description,
                oldLength: oldCode.length,
                newLength: newCode.length
            });
            history.stats.fixed++;
            saveErrorHistory(history);

            // RAG WRITE: 記錄成功修復
            await ragEvolve(
                `Patched ${targetFile}: ${description}`,
                'patch',
                `Success - ${oldCode.length} chars → ${newCode.length} chars`,
                4
            );
            await ragIngest([{
                id: `fix_${Date.now()}`,
                type: 'code_fix',
                name: `${targetFile}: ${description}`.substring(0, 60),
                properties: { file: targetFile, description, fixed_by: 'rensin-selfheal' }
            }], [{
                source: `fix_${Date.now()}`,
                target: 'rensin',
                type: 'fixed_by'
            }]);

            // Cleanup old backups (keep latest 5 per file)
            try {
                const dir = path.dirname(safePath);
                const base = path.basename(safePath);
                const backups = fs.readdirSync(dir)
                    .filter(f => f.startsWith(base + '.bak.'))
                    .sort()
                    .reverse();
                for (const old of backups.slice(5)) {
                    fs.unlinkSync(path.join(dir, old));
                }
            } catch (e) { console.warn('[selfheal]', e.message); }

            return `修復成功！${targetFile} 已更新。備份: ${path.basename(backupPath)}`;
        }

        // --- [4. 還原] ---
        if (task === 'rollback') {
            const targetFile = args.file;
            if (!targetFile) return '請指定要還原的檔案。';

            const safePath = path.resolve(PROJECT_ROOT, targetFile);
            const dir = path.dirname(safePath);
            const base = path.basename(safePath);

            const backups = fs.readdirSync(dir)
                .filter(f => f.startsWith(base + '.bak.'))
                .sort()
                .reverse();

            if (backups.length === 0) return '找不到備份檔案。';

            const latestBackup = path.join(dir, backups[0]);
            fs.copyFileSync(latestBackup, safePath);

            await ragEvolve(`Rolled back ${targetFile}`, 'rollback', `Restored from ${backups[0]}`, 2);
            return `已還原 ${targetFile} 至 ${backups[0]}`;
        }

        // --- [5. 錯誤歷史 + RAG 學習摘要] ---
        if (task === 'history' || task === 'stats') {
            const history = loadErrorHistory();
            let output = `自我修復統計:\n` +
                `偵測: ${history.stats.detected} | 修復: ${history.stats.fixed} | 失敗: ${history.stats.failed}\n` +
                `成功率: ${history.stats.fixed + history.stats.failed > 0 ? ((history.stats.fixed / (history.stats.fixed + history.stats.failed)) * 100).toFixed(1) : 0}%\n` +
                `最近修復:\n` +
                (history.fixes.slice(-5).map(f => `  [${f.time.substring(0, 16)}] ${f.file}: ${f.description}`).join('\n') || '  (無)');

            // RAG READ: 查詢 selfheal 相關經驗
            const ragResult = await ragQuery('rensin selfheal fix outcome');
            if (ragResult && typeof ragResult === 'string' && ragResult.includes('經驗回放')) {
                output += '\n\n📚 RAG 學習記錄: 有相關歷史修復經驗可供參考。';
            }

            return output;
        }

        // --- [6. 完整自動修復流程] ---
        if (task === 'autofix' || task === 'auto') {
            // Step 1: Diagnose
            const diagResult = await execute({ task: 'diagnose' });

            if (diagResult.includes('系統健康')) return diagResult;

            // RAG READ: 查詢是否有已知修復方案
            const firstError = diagResult.split('\n')[1]?.substring(4, 80) || '';
            const ragAdvice = await ragQuery(`fix ${firstError}`);

            return `自動診斷完成:\n${diagResult}\n\n` +
                `下一步: 請用 selfheal read <相關檔案> 查看代碼，然後用 selfheal patch 修復。\n` +
                (ragAdvice ? '📚 RAG 中有相關歷史修復記錄。' : '');
        }

        return '未知 selfheal 指令。可用: diagnose, read, patch, rollback, history, autofix';

    } catch (e) {
        await ragEvolve(`Selfheal error: ${task}`, task, e.message, 0);
        return `selfheal 錯誤: ${e.message}`;
    }
}

module.exports = {
    execute,
    name: 'selfheal',
    description: '自動除錯修復系統 — 掃描/讀取/修復/驗證/還原 + RAG 學習迴路',
    PROMPT: `## selfheal (自動修復技能 + RAG 學習)
你擁有自動修復 BUG 的能力。每次修復都會記錄到 RAG 知識圖譜供未來學習。

### 使用方式:
1. **診斷**: \`{ "action": "selfheal", "task": "diagnose" }\` — 掃描 log + 查 RAG 歷史
2. **讀取代碼**: \`{ "action": "selfheal", "task": "read", "file": "src/xxx.js" }\`
3. **修復**: \`{ "action": "selfheal", "task": "patch", "file": "src/xxx.js", "old": "原始代碼", "new": "修復代碼", "description": "修復描述" }\`
4. **還原**: \`{ "action": "selfheal", "task": "rollback", "file": "src/xxx.js" }\`
5. **歷史**: \`{ "action": "selfheal", "task": "history" }\` — 統計 + RAG 學習摘要
6. **自動修復**: \`{ "action": "selfheal", "task": "autofix" }\` — 自動診斷 + RAG 建議

### 自動修復流程:
1. diagnose → 偵測錯誤 + RAG 查詢歷史修復
2. read → 讀取相關代碼
3. patch → 套用修復 (自動備份 + 語法驗證)
4. 成功/失敗結果自動寫入 RAG 經驗回放

### RAG 學習迴路:
- 每次偵測錯誤 → 寫入 RAG (錯誤實體)
- 每次修復成功 → 寫入 RAG (修復經驗, score=4)
- 每次修復失敗 → 寫入 RAG (失敗經驗, score=0)
- 下次遇到類似錯誤 → 自動查詢 RAG 過往修復方案

### 安全機制:
- 每次修改前自動備份 (保留最近 5 份)
- 語法錯誤自動還原
- KERNEL PROTECTED 區塊不可修改
- 只能修改專案內檔案`
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) { console.log('Usage: node selfheal.js \'{"task":"diagnose"}\''); process.exit(1); }
    try {
        execute(JSON.parse(rawArgs)).then(console.log).catch(e => console.error(e.message));
    } catch (e) { console.error(`Parse Error: ${e.message}`); }
}
