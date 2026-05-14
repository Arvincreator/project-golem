#!/usr/bin/env node
/* eslint-disable no-console */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 8;
const DEFAULT_BASE_URLS = [
    'http://127.0.0.1:8080',
    'http://localhost:8080',
    'https://searx.be'
];

function parseBaseUrls() {
    const raw = String(process.env.SEARXNG_BASE_URLS || '').trim();
    const list = raw
        ? raw.split(',').map((x) => x.trim()).filter(Boolean)
        : DEFAULT_BASE_URLS;
    return [...new Set(list)];
}

function buildUrl(baseUrl, params) {
    const safeBase = String(baseUrl || '').replace(/\/+$/, '');
    const url = new URL(`${safeBase}/search`);
    Object.entries(params).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        const value = String(v).trim();
        if (!value) return;
        url.searchParams.set(k, value);
    });
    return url.toString();
}

async function fetchJsonWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'project-golem-searxng-mcp/1.0'
            },
            signal: controller.signal
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function doSearch(args = {}) {
    const query = String(args.query || args.q || '').trim();
    if (!query) {
        throw new Error('Missing required parameter: query');
    }

    const limitRaw = Number(args.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.max(Math.round(limitRaw), 1), 20)
        : DEFAULT_LIMIT;
    const pagenoRaw = Number(args.pageno);
    const pageno = Number.isFinite(pagenoRaw) && pagenoRaw > 0
        ? Math.round(pagenoRaw)
        : 1;
    const timeoutRaw = Number(args.timeout);
    const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? Math.min(Math.max(Math.round(timeoutRaw), 1000), 20000)
        : DEFAULT_TIMEOUT_MS;
    const bases = parseBaseUrls();

    const queryParams = {
        q: query,
        format: 'json',
        language: args.language || '',
        categories: args.categories || '',
        engines: args.engines || '',
        time_range: args.time_range || '',
        safesearch: args.safesearch ?? '',
        pageno
    };

    const runners = bases.map(async (baseUrl) => {
        const endpoint = buildUrl(baseUrl, queryParams);
        const payload = await fetchJsonWithTimeout(endpoint, timeout);
        const rows = Array.isArray(payload && payload.results) ? payload.results : [];
        const normalized = rows.slice(0, limit).map((item, idx) => ({
            rank: idx + 1,
            title: String(item && item.title ? item.title : '').trim(),
            url: String(item && item.url ? item.url : '').trim(),
            content: String(item && item.content ? item.content : '').trim(),
            engine: String(item && item.engine ? item.engine : '').trim(),
            publishedDate: item && item.publishedDate ? String(item.publishedDate) : ''
        })).filter((x) => x.title && x.url);

        return {
            ok: true,
            query,
            baseUrl,
            totalRaw: rows.length,
            returned: normalized.length,
            results: normalized
        };
    });

    const settled = await Promise.allSettled(runners);
    const firstOk = settled.find((item) => item.status === 'fulfilled');
    if (firstOk && firstOk.status === 'fulfilled') {
        return firstOk.value;
    }
    const errors = settled
        .map((item, idx) => item.status === 'rejected'
            ? `${bases[idx]}: ${item.reason && item.reason.message ? item.reason.message : String(item.reason)}`
            : null)
        .filter(Boolean);
    throw new Error(`SearXNG search failed on all endpoints. ${errors.join(' | ')}`);
}

function toolList() {
    return [
        {
            name: 'web_search',
            description: 'Search the web via SearXNG JSON API and return normalized results.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query text.' },
                    language: { type: 'string', description: 'Language code, e.g. zh-TW, en-US.' },
                    categories: { type: 'string', description: 'Comma-separated categories (general,news,images,...).' },
                    engines: { type: 'string', description: 'Comma-separated engines to use.' },
                    time_range: { type: 'string', enum: ['day', 'month', 'year'], description: 'Time range filter if supported.' },
                    safesearch: { type: 'integer', enum: [0, 1, 2], description: 'Safe search level.' },
                    pageno: { type: 'integer', minimum: 1, description: 'Result page number.' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Max normalized results to return (1-20).' },
                    timeout: { type: 'integer', minimum: 1000, maximum: 120000, description: 'Request timeout in ms.' }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    ];
}

function write(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function onRequest(req) {
    const { id, method, params = {} } = req || {};

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'searxng-mcp', version: '1.0.0' }
            }
        };
    }

    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id,
            result: { tools: toolList() }
        };
    }

    if (method === 'tools/call') {
        const toolName = String(params.name || '').trim();
        const toolArgs = params.arguments && typeof params.arguments === 'object'
            ? params.arguments
            : {};

        if (toolName !== 'web_search') {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Unknown tool: ${toolName}` }
            };
        }

        const result = await doSearch(toolArgs);
        return {
            jsonrpc: '2.0',
            id,
            result: {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            }
        };
    }

    if (method === 'notifications/initialized') return null;

    return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown method: ${method}` }
    };
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    while (true) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
            const req = JSON.parse(line);
            const res = await onRequest(req);
            if (res) write(res);
        } catch (err) {
            write({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: `Parse/Internal error: ${err.message}` }
            });
        }
    }
});
