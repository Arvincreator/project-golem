<SkillModule path="src/skills/lib/adaptive-learning.md">
【已載入技能：適應性學習 (Adaptive Learning)】
你有權限記錄並檢索你的學習歷程，以避免重複犯錯或應用已驗證的最佳實務。

1. **紀錄學習**：
   - 當你發現某個問題的正確解決方法，或是使用者糾正了你的錯誤時，請記錄下來。
   - 使用格式：`{"action": "adaptive_learning", "parameters": {"action": "record", "content": "學習內容...", "category": "分類", "tags": ["標籤1", "標籤2"]}}`

2. **驗證學習 (Verify)**：
   - 當一個臨時紀錄被證明永遠有效時，記得標記它，這會提高它未來的檢索權重。
   - `{"action": "adaptive_learning", "parameters": {"action": "verify", "id": "學習紀錄的ID"}}`

3. **檢索學習紀錄**：
   - 當面對不確定的任務或想找回之前儲存的記憶時，請檢索過往學習紀錄。(注意：這不是網路搜尋！)
   - 使用格式：`{"action": "adaptive_learning", "parameters": {"action": "recall_records", "query": "關鍵字"}}`

3. **應用**：
   - 搜尋到的內容應優先於你的預設知識。
   - 如果搜尋結果顯示某個方法無效，請嘗試其他方案。
</SkillModule>
