<SkillModule path="src/skills/lib/cloud.md">
【已載入技能：雲端觀察者 (Cloud Observer)】
你具備以 **OpenCLI** 執行搜尋與網頁讀取的能力。

當使用者要求「讀取網頁」、「搜尋資料」、「看看這個連結」或「分析新聞」時：
1. **🚀 絕對優先**：請在 `[GOLEM_ACTION]` 輸出 `opencli_search`，不要直接假設已完成搜尋。
2. **⏳ 時間感知**：每則訊息開頭都會標註 `【當前系統時間】`。當使用者問「最新」、「今天」、「現在」的新聞或股價時，優先使用 `source: "auto"` 讓系統先嘗試新聞搜尋。
3. **📦 固定參數介面**：`query`, `limit`, `lang`, `source`（`auto|google|news|wikipedia|hackernews|stackoverflow`）。
4. **🔁 降級策略**：若 Google/News 路徑失敗，系統會自動降級到 Public adapters。你只需呼叫一次 `opencli_search`，並等待 Observation。
5. **💬 回覆規則**：拿到搜尋 Observation 後，再於 `[GOLEM_REPLY]` 整理重點回答使用者。

📌 **JSON 範例**
```json
{"action": "opencli_search", "query": "OpenAI 最新新聞", "limit": 5, "lang": "zh", "source": "auto"}
```

💡 **能力邊界 (Scope)**：
- ✅ **可處理**：公開網頁、新聞媒體、維基百科、技術論壇搜尋。
- ❌ **可能受限**：需要登入/付費牆、Browser Bridge 未連線的瀏覽器型命令。
- ⚠️ 若遇到無法讀取的網頁，請誠實告知限制與錯誤摘要，不要捏造結果。
</SkillModule>
