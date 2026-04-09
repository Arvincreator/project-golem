const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ALLOWED_SOURCES = new Set([
    'auto',
    'google',
    'news',
    'wikipedia',
    'hackernews',
    'stackoverflow'
]);
const BRIDGE_OR_AUTH_CODES = new Set([69, 77, 78]);
const NO_RESULT_CODE = 66;
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENCLI_SEARCH_TIMEOUT_MS || 45000);

function clampLimit(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 10;
    return Math.max(1, Math.min(100, Math.floor(num)));
}

function normalizeSource(source) {
    const normalized = String(source || 'auto').trim().toLowerCase();
    return ALLOWED_SOURCES.has(normalized) ? normalized : 'auto';
}

function inferLang(query, explicitLang) {
    const normalized = String(explicitLang || '').trim().toLowerCase();
    if (normalized) return normalized;
    // 簡易語言判斷：含 CJK 字元時預設中文，其餘英文
    return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(query || '')) ? 'zh' : 'en';
}

function isNewsIntent(query) {
    const text = String(query || '').toLowerCase();
    const patterns = [
        /最新/,
        /新聞/,
        /頭條/,
        /快訊/,
        /news/,
        /headline/,
        /breaking/,
        /today/,
        /current events/
    ];
    return patterns.some((regex) => regex.test(text));
}

function resolveOpencliBinary(cwd = process.cwd()) {
    const binDir = path.join(cwd, 'node_modules', '.bin');
    const candidates = process.platform === 'win32'
        ? ['opencli.cmd', 'opencli.exe', 'opencli']
        : ['opencli'];

    for (const candidate of candidates) {
        const fullPath = path.join(binDir, candidate);
        if (fs.existsSync(fullPath)) return fullPath;
    }
    return null;
}

function buildAttemptChain(source, query) {
    if (source === 'auto') {
        if (isNewsIntent(query)) {
            return ['news', 'google', 'wikipedia', 'hackernews', 'stackoverflow'];
        }
        return ['google', 'wikipedia', 'hackernews', 'stackoverflow'];
    }

    if (source === 'google') {
        return ['google', 'wikipedia', 'hackernews', 'stackoverflow'];
    }

    if (source === 'news') {
        return ['news', 'google', 'wikipedia', 'hackernews', 'stackoverflow'];
    }

    return [source];
}

function buildCommandArgs(source, query, limit, lang, options = {}) {
    switch (source) {
        case 'google':
            return ['google', 'search', query, '--limit', String(limit), '--lang', lang, '-f', 'json'];
        case 'news': {
            const region = String(options.region || (lang.startsWith('zh') ? 'TW' : 'US')).trim().toUpperCase();
            return ['google', 'news', query, '--limit', String(limit), '--lang', lang, '--region', region, '-f', 'json'];
        }
        case 'wikipedia':
            return ['wikipedia', 'search', query, '--limit', String(limit), '--lang', lang, '-f', 'json'];
        case 'hackernews':
            return ['hackernews', 'search', query, '--limit', String(limit), '-f', 'json'];
        case 'stackoverflow':
            return ['stackoverflow', 'search', query, '--limit', String(limit), '-f', 'json'];
        default:
            return ['google', 'search', query, '--limit', String(limit), '--lang', lang, '-f', 'json'];
    }
}

function runOpencli(binPath, args, { cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve) => {
        const child = spawn(binPath, args, {
            cwd,
            env: process.env,
            shell: false,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';
        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            child.kill('SIGKILL');
            resolve({
                code: null,
                stdout,
                stderr,
                error: new Error(`OpenCLI command timed out after ${timeoutMs}ms`),
                timedOut: true
            });
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk || '');
        });

        child.stderr.on('data', (chunk) => {
            stderr += String(chunk || '');
        });

        child.on('error', (error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ code: null, stdout, stderr, error, timedOut: false });
        });

        child.on('close', (code) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ code, stdout, stderr, error: null, timedOut: false });
        });
    });
}

function parseJsonOutput(stdout) {
    const trimmed = String(stdout || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return [];
}

function compact(value, max = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function normalizeRows(source, rows) {
    return (rows || []).map((row) => {
        const title = row.title || row.name || '(untitled)';
        const url = row.url || row.link || '';
        let snippet = row.snippet || '';

        if (!snippet && source === 'news') {
            const sourceName = row.source ? `來源: ${row.source}` : '';
            const dateText = row.date ? `時間: ${row.date}` : '';
            snippet = [sourceName, dateText].filter(Boolean).join(' | ');
        }
        if (!snippet && source === 'hackernews') {
            snippet = [
                row.author ? `author: ${row.author}` : '',
                typeof row.score === 'number' ? `score: ${row.score}` : '',
                typeof row.comments === 'number' ? `comments: ${row.comments}` : ''
            ].filter(Boolean).join(' | ');
        }
        if (!snippet && source === 'stackoverflow') {
            snippet = [
                typeof row.score === 'number' ? `score: ${row.score}` : '',
                typeof row.answers === 'number' ? `answers: ${row.answers}` : ''
            ].filter(Boolean).join(' | ');
        }

        return {
            source,
            title: compact(title, 160),
            url,
            snippet: compact(snippet, 220)
        };
    });
}

function formatDiagnostic(diag) {
    const parts = [];
    if (diag.code !== null && diag.code !== undefined) {
        parts.push(`exit ${diag.code}`);
    }
    if (diag.reason) parts.push(diag.reason);
    if (diag.stderr) parts.push(`stderr: ${compact(diag.stderr, 120)}`);
    if (diag.error) parts.push(`error: ${compact(diag.error, 120)}`);
    return `- ${diag.source}: ${parts.join(' | ')}`.trim();
}

function formatSuccess({ query, lang, attempted, diagnostics, results }) {
    const lines = [
        '🔎 [OpenCLI 搜尋]',
        `Query: ${query}`,
        `語言: ${lang}`,
        `來源策略: ${attempted.join(' -> ')}`,
        `結果數: ${results.length}`
    ];

    if (diagnostics.length > 0) {
        lines.push('⚠️ 已啟用降級路徑。');
        lines.push('診斷資訊:');
        diagnostics.forEach((diag) => lines.push(formatDiagnostic(diag)));
    }

    lines.push('');
    results.forEach((item, idx) => {
        lines.push(`${idx + 1}. [${item.source}] ${item.title}`);
        if (item.url) lines.push(`   URL: ${item.url}`);
        if (item.snippet) lines.push(`   摘要: ${item.snippet}`);
    });

    return lines.join('\n');
}

function formatNoResult({ query, lang, attempted, diagnostics }) {
    const lines = [
        'ℹ️ [OpenCLI 搜尋] 查無結果',
        `Query: ${query}`,
        `語言: ${lang}`,
        `已嘗試: ${attempted.join(' -> ') || '（無）'}`
    ];

    if (diagnostics.length > 0) {
        lines.push('診斷資訊:');
        diagnostics.forEach((diag) => lines.push(formatDiagnostic(diag)));
    }

    return lines.join('\n');
}

function extractArgs(rawArgs = {}) {
    const nested = rawArgs.parameters && typeof rawArgs.parameters === 'object'
        ? rawArgs.parameters
        : {};
    return {
        ...nested,
        ...rawArgs
    };
}

async function run(ctx) {
    const args = extractArgs(ctx.args || {});
    const query = String(args.query || args.keyword || args.q || '').trim();
    if (!query) return '❌ opencli_search 缺少 query 參數。';

    const source = normalizeSource(args.source);
    const limit = clampLimit(args.limit);
    const lang = inferLang(query, args.lang);
    const attempted = [];
    const diagnostics = [];
    const attemptChain = buildAttemptChain(source, query);

    const opencliBin = resolveOpencliBinary(process.cwd());
    if (!opencliBin) {
        return [
            '❌ 找不到 OpenCLI 可執行檔 (`node_modules/.bin/opencli`)。',
            '請先執行：`npm install` 或 `npm install @jackwener/opencli`。',
            '安裝後可用：`./node_modules/.bin/opencli doctor` 檢查 Browser Bridge 連線。'
        ].join('\n');
    }

    for (const currentSource of attemptChain) {
        attempted.push(currentSource);
        const commandArgs = buildCommandArgs(currentSource, query, limit, lang, args);
        const result = await runOpencli(opencliBin, commandArgs, { timeoutMs: DEFAULT_TIMEOUT_MS });

        if (result.error) {
            diagnostics.push({
                source: currentSource,
                code: result.code,
                reason: result.timedOut ? 'timeout' : 'command_error',
                error: result.error.message,
                stderr: result.stderr
            });
            continue;
        }

        if (result.code === 0) {
            let rows;
            try {
                rows = parseJsonOutput(result.stdout);
            } catch (e) {
                diagnostics.push({
                    source: currentSource,
                    code: result.code,
                    reason: 'JSON 解析失敗',
                    error: e.message,
                    stderr: result.stderr || result.stdout
                });
                continue;
            }

            const normalizedRows = normalizeRows(currentSource, rows).filter((item) => item.title || item.url);
            if (normalizedRows.length > 0) {
                return formatSuccess({
                    query,
                    lang,
                    attempted,
                    diagnostics,
                    results: normalizedRows.slice(0, limit)
                });
            }

            diagnostics.push({
                source: currentSource,
                code: result.code,
                reason: '空資料集',
                stderr: result.stderr
            });
            continue;
        }

        if (result.code === NO_RESULT_CODE) {
            diagnostics.push({
                source: currentSource,
                code: result.code,
                reason: '無搜尋結果',
                stderr: result.stderr
            });
            continue;
        }

        if (BRIDGE_OR_AUTH_CODES.has(result.code)) {
            diagnostics.push({
                source: currentSource,
                code: result.code,
                reason: 'Browser Bridge/授權設定不可用，改走降級路徑',
                stderr: result.stderr
            });
            continue;
        }

        diagnostics.push({
            source: currentSource,
            code: result.code,
            reason: '未知非零退出碼',
            stderr: result.stderr || result.stdout
        });
    }

    return formatNoResult({
        query,
        lang,
        attempted,
        diagnostics
    });
}

module.exports = {
    name: 'opencli_search',
    description: '透過 OpenCLI 執行網路搜尋（Google 優先，失敗自動降級）',
    run,
    __private: {
        clampLimit,
        normalizeSource,
        inferLang,
        isNewsIntent,
        resolveOpencliBinary,
        buildAttemptChain,
        buildCommandArgs,
        parseJsonOutput,
        normalizeRows,
        extractArgs
    }
};

if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) {
        console.error('❌ Missing args JSON.');
        process.exit(1);
    }

    try {
        const parsed = JSON.parse(rawArgs);
        const finalArgs = parsed.args || parsed;
        run({ args: finalArgs })
            .then((output) => console.log(output))
            .catch((error) => {
                console.error(`❌ opencli_search failed: ${error.message}`);
                process.exit(1);
            });
    } catch (e) {
        console.error(`❌ Parse Error: ${e.message}`);
        process.exit(1);
    }
}
