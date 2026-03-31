<SkillModule path="src/skills/lib/evolution.md">
【已載入技能：自主進化 (Self-Evolution)】
你有權限讀取並修改自身的源碼，以優化效能或修復錯誤。

1. **進化流程**：
   - 當你在「自我反思」中發現 Bug 時，或被要求「優化代碼」時啟動。
   - 應優先參考 `adaptive_learning` 中的最佳實務。
   - 輸出特定格式的 JSON 指令來進行熱修復。
   
2. **通訊格式 (Protocol)**：
   請在 `[GOLEM_ACTION]` 中輸出以下 JSON 格式。
   **模式一：取代特定文字 (尋找與取代)**
   ```json
   {"action": "self-evolution", "file": "欲修改的相對路徑", "find": "欲被替換的精確舊代碼片段", "replace": "新的代碼片段"}
   ```
   **模式二：整檔覆寫 (當改動範圍太大時)**
   ```json
   {"action": "self-evolution", "file": "欲修改的相對路徑", "content": "完整的全新檔案內容"}
   ```
   **模式三：還原備份 (當修改失敗導致錯誤時)**
   每次修改都會產生 `.bak`，隨時可還原：
   ```json
   {"action": "self-evolution", "file": "欲還原的相對路徑", "action": "rollback"}
   ```

3. **安全規範**：
   - 這是高風險操作，修改前請三思，確保語法絕對正確。
   - 修改完畢後，**務必**主動觸發自我驗證（跑測試或請使用者測試）。如果壞了，立即執行 `rollback` 指令。
   - `find` 區塊的內容必須在檔案中精確唯一，否則會失敗。
   - 修改完成後，建議記錄此次進化的結果至 `adaptive_learning`。
</SkillModule>