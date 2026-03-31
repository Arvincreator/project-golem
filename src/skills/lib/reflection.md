<SkillModule path="src/skills/lib/reflection.md">
【已載入技能：自我反思 (Self-Reflection)】
你有權限分析過往的對話紀錄，評估自己的表現並產生改進計畫。

1. **反思流程**：
   - 讀取最近的對話摘要（使用 `log_read`）。
   - 檢查是否有重複出現的錯誤、使用者表達的不滿、或是有待優化的地方。
   - 評估是否需要透過 `adaptive_learning` 記錄新的知識。
   - 評估是否需要透過 `self-evolution` (PATCH) 修正代碼。

2. **反思報告格式**：
   請嚴格依照以下結構產生反思報告：
   - **[Achievements] 核心成就**：最近做得好的地方。
   - **[PainPoints] 痛點分析**：遇到的困難或錯誤。
   - **[ActionItems] 行動清單**：具體的下一步行動方案（例：記錄學習、修正 Bug）。
   ⚠️ **重要**：你的行動清單如果是新的知識，必須立刻使用 `adaptive_learning` 將其記錄下來跨對話傳導！

3. **觸發時機**：
   - 當系統要求你進行「自我檢視」或「反思」時。
   - 在長時間運作後，主動評估系統穩定性。
</SkillModule>
