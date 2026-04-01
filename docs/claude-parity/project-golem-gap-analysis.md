# Project Golem Gap Analysis vs Claude-Code (Task Kernel Scope)

## 核心缺陷（實作前）

1. 任務僅存在記憶體 `pendingTasks`，重啟或 `/new` 後容易遺失。
2. 缺乏嚴格任務狀態機（可被誤標 `completed`）。
3. 缺少跨入口一致的任務 API（chat/web/runtime 分裂）。
4. Dashboard 沒有任務追蹤頁與審計事件流。
5. 提示詞未強制「先建任務再執行多步行動」。

## 本輪補齊

1. 導入持久化 `TaskKernel`（狀態、審計、審批、恢復摘要、idempotency）。
2. `TaskController` 接入 `TaskKernel`，新增嚴格任務操作介面與審批持久化。
3. 新增 task actions handler：`task_create/list/get/update/stop/todo_write`。
4. worker/runtime/web 三層新增 task RPC 與 REST 端點。
5. Dashboard 新增 `/dashboard/tasks`，含列表、狀態流轉、恢復摘要、審計時間軸。
6. 每輪對話注入 Pending Tasks Snapshot，降低模型漏執行與漂移。

## M3 補強（本次續作）

1. `TaskKernel` 補齊 Resume/Budget/Decision 核心：
   - `task_resume` + `Resume Brief`
   - `ask/allow/deny` decision object
   - `task/session` token-cost budget（soft/hard）
   - 標準錯誤碼（`TASK_VERSION_CONFLICT` / `TASK_INVALID_TRANSITION` 等）
2. 新增恢復導向與治理端點：
   - `GET /api/tasks/resume-brief`
   - `POST /api/tasks/resume`
   - `GET /api/tasks/budgets`
   - `POST /api/tasks/budgets`
3. Runtime/WebSocket 升級：
   - `task_recovery` payload 新增 `recoveryType`、`seq`
   - 新增 `task_resume`、`task_violation` websocket 事件
   - recovery dedup（`GOLEM_TASK_RECOVERY_DEDUP_MS`）
4. `todo_write` 補上 preflight + rollback 保護，降低部分成功造成的狀態漂移風險。
5. `.env.example` 補齊 prompt/task/budget 必要開關，避免部署時隱性預設差異。
6. 多代理深層協調與競態壓測補齊：
   - strict synthesis gate（`research -> synthesis -> implementation -> verification` 不可跳階）
   - 新增 orchestration state（next action / blockers / phase status）
   - 新增多 worker 並行競態壓測矩陣（version conflict / idempotency / final consistency）

## 本輪新增證據（完成你指定的兩項）

1. 多 worker 真平行寫入競態壓測矩陣：
   - `tests/AgentConcurrencyMatrix.test.js`
   - 覆蓋 matrix A/B/C：stale expectedVersion、shared idempotency、multi-worker parallel consistency
2. 更深層 multi-agent orchestration parity：
   - `src/core/CoordinatorEngine.js`（synthesis gate + orchestration state + terminal normalization）
   - `src/managers/AgentKernel.js`（managedByCoordinator session reconciliation）
   - `tests/CoordinatorEngine.test.js`（不可跳階、完整四階段、失敗路徑）
   - `web-dashboard/routes/api.agents.js` + `apps/runtime/worker.js` + `src/runtime/RuntimeController.js`
     （`GET /api/agents/sessions/:sessionId/orchestration`）

## 尚未完成（後續 M4）

1. 每任務 token/cost「供應商 billing 對帳級」精算（目前為 adapter + estimate fallback）。
2. 本里程碑明確將 billing 新增實作列為 out-of-scope；僅保留既有 estimate 能力，不新增 provider 對帳邏輯。
