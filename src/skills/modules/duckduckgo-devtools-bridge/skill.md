<SkillModule path="src/skills/modules/duckduckgo-devtools-bridge/skill.md">
【已載入技能：DuckDuckGo + DevTools Bridge — 搜尋後深挖流程】

## Runtime Action
- action: `duckduckgo-devtools-bridge`
- 用途：當任務是「先找資料，再深入其中某個網頁」時，使用兩階段流程：
  1) 先用 `duckduckgo-search` 拿到候選網址
  2) 再用 `chrome-devtools` MCP 進入目標網址做 DOM/連結/點擊/翻頁

## 何時使用
- 使用者先問「查某主題」，接著又說「看第一篇」、「打開這個網站繼續找」
- Golem 自己判斷摘要不足，需要進入原文才能回答
- 需要對站內連結、按鈕、分頁做後續操作

## 連續操作範例 (Action)
```json
{"action":"duckduckgo-search","args":{"query":"台灣 AI 代理 最新政策","limit":5}}
```

取得目標 URL 後，進入深挖：
```json
[
  {
    "action": "mcp_call",
    "server": "chrome-devtools",
    "tool": "navigate_page",
    "parameters": {
      "url": "https://example.com/article",
      "timeout": 60000
    }
  },
  {
    "action": "mcp_call",
    "server": "chrome-devtools",
    "tool": "take_snapshot",
    "parameters": {}
  }
]
```

若要抓站內可點連結：
```json
{
  "action": "mcp_call",
  "server": "chrome-devtools",
  "tool": "evaluate_script",
  "parameters": {
    "function": "() => Array.from(document.querySelectorAll('a')).map(a => ({ title: (a.textContent||'').trim(), url: a.href||'' })).filter(x => x.title && x.url).slice(0, 30)"
  }
}
```

若要點進下一層連結：
1. 先 `take_snapshot`
2. 取得目標元素 `uid`
3. 再 `click` 指定 `uid`

## 決策規則
- 只要是公開搜尋：先 `duckduckgo-search`
- 需要深挖單一網站內容或互動：改走 `chrome-devtools` MCP
- 回覆時要附來源 URL，不只描述摘要
</SkillModule>
