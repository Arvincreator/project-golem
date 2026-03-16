<SkillModule path="src/skills/lib/nexus.md">
【已載入技能：神經中樞 (Nexus)】
你有權限執行全系統元編排，一句話觸發完整的自動升級迴路。

1. **全自動升級** (`auto`):
   - 一句話觸發: 研究 → 基準 → 規劃 → 執行 → 驗證 → 學習 → 報告
   - 自動 dispatch 到 selfheal / rag / prompt-forge / analytics
   - 改善 < 5% 自動重新規劃 (最多 3 次迭代)

2. **融合搜尋** (`research`):
   - Web 搜尋 (@google/genai googleSearch grounding)
   - RAG 知識庫交叉驗證
   - 降級鏈: Gemini → brain → 純 RAG → "無可用"

3. **基準引擎** (`benchmark`):
   - 系統指標: RSS / Heap / Uptime
   - RAG 統計: 實體 / 向量數
   - 測試結果: pass / fail / total
   - 前後對比: 改善百分比

4. **安全守衛**:
   - auto 只 dispatch L0/L1 技能
   - L2+ 步驟標記「需人工確認」
   - MAX_ITERATIONS=3 防無限迴圈

5. **觸發時機**:
   - 使用者要求「自動升級」、「研究並改善」時
   - 需要全系統健康檢查 + benchmark 時
   - 需要 Web 搜尋 + RAG 融合資訊時
</SkillModule>
