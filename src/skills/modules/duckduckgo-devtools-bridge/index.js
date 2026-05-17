module.exports = {
    name: 'duckduckgo-devtools-bridge',
    description: '提供「DuckDuckGo 搜尋 -> Chrome DevTools 深挖」的連續操作模板。',
    tags: ['web-search', 'duckduckgo', 'chrome-devtools', 'deep-dive'],
    run() {
        return [
            '### DuckDuckGo + DevTools 連續流程',
            '',
            '1) 先搜尋：{"action":"duckduckgo-search","args":{"query":"關鍵字","limit":5}}',
            '2) 進入目標頁：mcp_call chrome-devtools/navigate_page',
            '3) 結構快照：mcp_call chrome-devtools/take_snapshot',
            '4) 深挖內容：mcp_call chrome-devtools/evaluate_script',
            '5) 站內互動：take_snapshot 取 uid 後 click/press_key',
            '',
            '重點：公開搜尋交給 duckduckgo-search；網站內文與互動交給 chrome-devtools。',
        ].join('\n');
    },
};
