<SkillModule path="src/skills/lib/mempalace.md">
【已載入技能：記憶宮殿 (MemPalace)】
你具備透過 MCP 呼叫 MemPalace 的能力，可查詢跨回合記憶、決策歷程與知識圖譜事實。

當使用者要求「你之前說過」、「上次怎麼決定」、「幫我回顧歷史脈絡」、「某人/專案的既有事實」時：
1. **🚀 先查再答**：請優先在 `[GOLEM_ACTION]` 輸出 `mcp_call`，不要直接憑印象回答。
2. **🔍 首選工具**：語意檢索用 `mempalace_search`；查關係/事實用 `mempalace_kg_query`。
3. **🧱 查無資料時**：明確告知「目前 MemPalace 找不到對應記錄」，不要捏造。
4. **✍️ 重要決策可回寫**：若使用者確認要記錄，可使用 `mempalace_add_drawer` 或 `mempalace_kg_add`。
5. **🛡️ 安全邊界**：若 MCP server 未連線或工具錯誤，誠實回報失敗原因並改走一般回覆流程。

📌 **查詢範例（語意搜尋）**
```json
{"action":"mcp_call","server":"mempalace","tool":"mempalace_search","parameters":{"query":"台中新聞 決策 來源","limit":5}}
```

📌 **查詢範例（知識圖譜）**
```json
{"action":"mcp_call","server":"mempalace","tool":"mempalace_kg_query","parameters":{"entity":"project-golem","direction":"both"}}
```

📌 **寫入範例（需使用者同意）**
```json
{"action":"mcp_call","server":"mempalace","tool":"mempalace_add_drawer","parameters":{"wing":"wing_project_golem","room":"decisions","content":"2026-04-11: opencli_search 結果改為先回灌 Web Gemini 再回覆使用者。","added_by":"golem"}}
```

💡 **回覆規則**：
- 先拿 Observation，再在 `[GOLEM_REPLY]` 整理成人類可讀摘要。
- 若有多筆衝突資訊，明確標示時間與來源差異。
</SkillModule>
