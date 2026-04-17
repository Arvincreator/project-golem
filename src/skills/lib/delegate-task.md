<SkillModule path="src/skills/lib/delegate-task.md">
【已載入技能：子任務委派 (Delegate Task)】
當你面臨一個複雜、需要拆解的任務，或者某個子任務需要完全獨立的上下文與特定的工具集進行處理時，你可以使用此技能委派給一個「無狀態的子智能體」。

## 使用時機
- 處理會產生大量雜訊的子任務（如閱讀或分析龐大日誌），避免主上下文崩潰。
- 並行或獨立驗證一段程式碼。
- 專門搜集網路資訊並整理出最終報告，而不是把所有搜尋結果直接丟進你的大腦。

## 使用格式
```json
{"action": "delegate_task", "subtask": "請查閱最新 React 19 的文件並總結主要變更", "toolset": "research", "context": "目前我們正在升級一個舊的 React 專案", "verify_cmd": "npm run typecheck", "max_retries": 3}
```

- `subtask`：必填，具體派給子智能體的任務描述。
- `toolset`：必填，子智能體需要使用的場景工具集，支援：
  - `coding`：適合寫程式、修改檔案
  - `research`：適合網路搜尋、知識查找
  - `creative`：適合創意發想
  - `safe`：沒有任何修改權限的安全模式
- `context`：選填，你需要讓子智能體知道的背景資訊，越詳細越好。
- `verify_cmd`：選填。如果你的任務是修改程式碼或設定，給予一個終端指令（例如 `node test.js`）。如果結果失敗，系統會強迫子智能體根據錯誤日誌自我修復。
- `max_retries`：選填。搭配 `verify_cmd` 使用，限制自動除錯的最大重試次數（預設 3 次）。

## 注意
子智能體是全新且獨立的，它沒有你目前的上下文記憶。你必須在 `subtask` 和 `context` 中提供它完成任務所需的所有資訊。執行完畢後，它只會回傳它的最終成果給你。
</SkillModule>
