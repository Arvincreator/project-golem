const MCPManager = require('../mcp/MCPManager');

module.exports = {
    name: 'duckduckgo-search',
    description: 'v1.2 DuckDuckGo HTML 搜尋（MCP優先）：透過 chrome-devtools 自主搜尋，避免 command/curl 審批。',
    tags: ['#stable', '#web-search'],
    async run(ctx, args) {
        const query = args.query || args._[0];
        if (!query) return '請輸入搜尋詞';
        try {
            const manager = MCPManager.getInstance();
            await manager.load();

            const serverName = 'chrome-devtools';
            const server = manager.getServer(serverName);
            if (!server || !server.connected) {
                return 'chrome-devtools MCP 未連線。請先在 Dashboard 啟用 MCP 後再搜尋。';
            }

            const encoded = encodeURIComponent(String(query).trim());
            const url = `https://html.duckduckgo.com/html/?q=${encoded}&kl=tw-tzh`;

            await manager.callTool(serverName, 'navigate_page', {
                url,
                timeout: 60000,
            });

            try {
                await manager.callTool(serverName, 'wait_for', {
                    text: ['DuckDuckGo', 'No results'],
                    timeout: 30000,
                });
            } catch (_) {
                // wait_for 未命中時仍嘗試解析頁面結果
            }

            const result = await manager.callTool(serverName, 'evaluate_script', {
                function: `() => {
                    const rows = Array.from(document.querySelectorAll('a.result__a'))
                        .slice(0, 10)
                        .map((a, i) => ({
                            rank: i + 1,
                            title: (a.textContent || '').trim(),
                            url: a.href || ''
                        }))
                        .filter(x => x.title && x.url);
                    return { query: ${JSON.stringify(String(query))}, count: rows.length, rows };
                }`,
            });

            let parsed = null;
            if (result && Array.isArray(result.content)) {
                const textPart = result.content.find((item) => item && item.type === 'text' && typeof item.text === 'string');
                if (textPart && textPart.text) {
                    try { parsed = JSON.parse(textPart.text); } catch (_) { /* ignore */ }
                }
            }

            const rows = Array.isArray(parsed && parsed.rows) ? parsed.rows : [];
            if (rows.length === 0) {
                return `DuckDuckGo 未找到結果（query: ${query}）。請嘗試更換關鍵字。`;
            }

            const lines = rows.map((item) => `${item.rank}. ${item.title}\n   ${item.url}`);
            return `### DuckDuckGo 搜尋結果（MCP）\n\n${lines.join('\n')}`;
        } catch (e) {
            return `系統異常: ${e.message}`;
        }
    }
};
