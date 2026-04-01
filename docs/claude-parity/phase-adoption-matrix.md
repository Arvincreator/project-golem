# Claude-Parity Phase Adoption Matrix (Evidence-Based)

本文件已改為「證據矩陣」：每一個 phase 必須對應程式碼與測試，而非僅文字宣告。

## Matrix

| Phase | 主題 | 採納決策 | 目前狀態 | 主要證據（程式碼 / 測試） |
|---|---|---|---|---|
| Phase 01 | System Prompt | adopt now | partial | `src/skills/core/definition.js`、`packages/protocol/ProtocolFormatter.js`、`tests/DefinitionPrompt.test.js` |
| Phase 02 | Tool Definitions | adopt now | partial | `src/core/action_handlers/TaskActionHandler.js`、`tests/TaskActionHandler.test.js` |
| Phase 03 | Agent Architecture | adopt now | done (task scope) | `src/core/CoordinatorEngine.js`、`src/managers/AgentKernel.js`、`tests/CoordinatorEngine.test.js`、`tests/AgentConcurrencyMatrix.test.js` |
| Phase 04 | Skills System | defer | partial | 既有技能市場與索引保留，未進行 Claude-style catalog 全量對齊 |
| Phase 05 | Memory & Context | adopt now | partial | `src/core/ConversationManager.js` pending snapshot 注入、`TaskKernel` 持久化恢復 |
| Phase 06 | Security & Permissions | adopt now | partial | `web-dashboard/server/security.js` + `TaskKernel` decision object；尚未達多層 hook + permission engine 完整度 |
| Phase 07 | API & Model Architecture | adopt now | partial | `src/runtime/RuntimeController.js` + `apps/runtime/worker.js` + `web-dashboard/routes/api.tasks.js` |
| Phase 08 | Special Features | defer | defer | 以核心任務連續性為主，特別功能維持延後 |
| Phase 09 | Harness Engineering | adopt now | partial | task_event/task_recovery + dashboard socket；完整 harness/trace pipeline 尚未齊備 |
| Phase 10 | Cost & Quota | partial | partial | `TaskKernel` usage estimate + budget policy；provider billing adapter 先以 estimate fallback |

## 本輪新增證據（Task Continuity First）

- `task_resume` / `task_focus` action + Resume Brief：
  - `src/core/action_handlers/TaskActionHandler.js`
  - `src/managers/TaskKernel.js`
  - `web-dashboard/routes/api.tasks.js`
- 任務預算治理與硬限制錯誤碼：
  - `src/managers/TaskKernel.js`
  - `src/managers/billing/ProviderBillingAdapter.js`
- recovery 事件升級（`recoveryType` + `seq` + dedup）：
  - `apps/runtime/worker.js`
  - `web-dashboard/server.js`
- 多代理 orchestration 與競態壓測矩陣：
  - `tests/CoordinatorEngine.test.js`
  - `tests/AgentConcurrencyMatrix.test.js`
  - `web-dashboard/routes/api.agents.js`（orchestration endpoint）

## Gate 結論（更新）

- 10 phase 映射：**達成（證據化）**
- 「全部已落地」修正：**否，現為 partial-heavy，持續分里程碑收斂**
- 下一階段優先：**M4 成本對帳精算（provider billing adapter 實帳）**
