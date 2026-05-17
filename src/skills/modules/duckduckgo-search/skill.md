<SkillModule path="src/skills/modules/duckduckgo-search/skill.md">
【已載入技能：DuckDuckGo HTML Search — 公開網路搜尋】

## Runtime Action
- action: `duckduckgo-search`
- 用途：搜尋公開網頁資料、查即時公開資訊、Chrome DevTools 或一般搜尋頁被自動化阻擋時的內建後備路徑。

## 使用規則
- 公開網路搜尋優先使用此技能，不需要先開 Chrome DevTools。
- 查繁體中文或台灣脈絡時保留預設 `kl=tw-tzh`。
- 這個技能只抓公開搜尋結果標題、連結與摘要；需要登入、點擊、表單、console、network 時才改用 `chrome-devtools` MCP。

## Action 格式
```json
{"action":"duckduckgo-search","args":{"query":"2026 台灣 AI 新聞","limit":8}}
```

## 內建探測邏輯
- 目標節點：`https://html.duckduckgo.com/html/?q={KEYWORD}&kl=tw-tzh`
- 固定帶瀏覽器指紋標頭：
  - `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1)`
  - `Accept-Language: zh-TW,zh;q=0.9`
  - `Referer: https://html.duckduckgo.com/`
- 解析策略只抓 `a.result__a` 以及鄰近摘要，避免整頁複雜 Regex。
- 回覆使用者時要附搜尋結果來源連結，不要只給無來源摘要。
</SkillModule>
