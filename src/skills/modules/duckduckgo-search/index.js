const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_REGION = 'tw-tzh';

const SEARCH_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,text/plain',
    'Accept-Language': 'zh-TW,zh;q=0.9',
    Referer: 'https://html.duckduckgo.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1)',
};

function decodeHtml(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x2F;/g, '/')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveDuckDuckGoUrl(value) {
    const raw = decodeHtml(value);
    try {
        const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
        const parsed = new URL(normalized, 'https://html.duckduckgo.com');
        const uddg = parsed.searchParams.get('uddg');
        return uddg ? decodeURIComponent(uddg) : parsed.toString();
    } catch (_) {
        return raw;
    }
}

function parseDuckDuckGoHtml(html, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT), 20));
    const source = String(html || '');
    const anchorRegex = /<a\b[^>]*class=(["'])[^"']*\bresult__a\b[^"']*\1[^>]*href=(["'])(.*?)\2[^>]*>([\s\S]*?)<\/a>/gi;
    const anchors = Array.from(source.matchAll(anchorRegex));
    const rows = [];

    for (const [index, match] of anchors.entries()) {
        const nextAnchorIndex = anchors[index + 1]?.index ?? source.length;
        const block = source.slice(match.index || 0, nextAnchorIndex);
        const snippetMatch = block.match(/class=(["'])[^"']*\bresult__snippet\b[^"']*\1[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
        const sourceMatch = block.match(/class=(["'])[^"']*\bresult__url\b[^"']*\1[^>]*>([\s\S]*?)<\/(?:a|span|div)>/i);
        const title = decodeHtml(match[4]);
        const url = resolveDuckDuckGoUrl(match[3]);
        if (!title || !url) continue;

        rows.push({
            rank: rows.length + 1,
            title,
            url,
            snippet: decodeHtml(snippetMatch?.[2] || ''),
            source: decodeHtml(sourceMatch?.[2] || '') || 'DuckDuckGo HTML search',
        });
        if (rows.length >= limit) break;
    }

    return rows;
}

async function fetchDuckDuckGoHtml(query, options = {}) {
    const q = String(query || '').trim();
    if (!q) throw new Error('Missing query');

    const region = String(options.region || DEFAULT_REGION).trim() || DEFAULT_REGION;
    const params = new URLSearchParams({ q, kl: region });
    const url = `https://html.duckduckgo.com/html/?${params.toString()}`;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: SEARCH_HEADERS,
            redirect: 'follow',
            signal: controller.signal,
        });
        const html = await response.text();
        if (!response.ok) {
            throw new Error(`DuckDuckGo HTML request failed (${response.status})`);
        }
        return { html, url };
    } finally {
        clearTimeout(timer);
    }
}

function formatResults(query, rows, meta = {}) {
    if (!rows.length) {
        return `DuckDuckGo HTML 未找到結果（query: ${query}）。請嘗試更換關鍵字。`;
    }

    const lines = rows.map((item) => {
        const snippet = item.snippet ? `\n   ${item.snippet}` : '';
        return `${item.rank}. ${item.title}\n   ${item.url}${snippet}`;
    });
    const sourceLine = meta.searchUrl ? `\n\n搜尋節點：${meta.searchUrl}` : '';
    return `### DuckDuckGo HTML 搜尋結果\n\n${lines.join('\n')}${sourceLine}`;
}

async function run(ctx = {}) {
    const args = ctx.args || ctx.parameters || {};
    const query = args.query || args.keyword || args.q || args.input || (Array.isArray(args._) ? args._[0] : '');
    if (!query) return '請輸入搜尋詞，例如 {"action":"duckduckgo-search","args":{"query":"台灣 AI 新聞"}}';

    try {
        const { html, url } = await fetchDuckDuckGoHtml(query, {
            region: args.region || args.kl,
            timeoutMs: args.timeoutMs,
        });
        const rows = parseDuckDuckGoHtml(html, { limit: args.limit });
        return formatResults(String(query).trim(), rows, { searchUrl: url });
    } catch (error) {
        return `DuckDuckGo HTML 搜尋失敗: ${error.message || String(error)}`;
    }
}

module.exports = {
    name: 'duckduckgo-search',
    description: '使用 html.duckduckgo.com 與瀏覽器指紋標頭搜尋公開網頁，作為 Chrome DevTools 搜尋被擋時的內建後備。',
    tags: ['web-search', 'duckduckgo', 'public-data'],
    paramsSchema: {
        query: { type: 'string', required: true, description: '搜尋關鍵字' },
        limit: { type: 'number', description: '最多回傳筆數，預設 10，上限 20' },
        region: { type: 'string', description: 'DuckDuckGo kl 參數，預設 tw-tzh' },
    },
    run,
    parseDuckDuckGoHtml,
    fetchDuckDuckGoHtml,
    formatResults,
    SEARCH_HEADERS,
};
