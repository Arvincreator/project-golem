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

1. `TaskKernel` 新增任務遙測與一致性稽核：
   - completion rate、blocked age、recovery success rate
   - fake completion intercepts（未驗證完成攔截）
   - version conflict / idempotency hits
   - 每任務 usage token/cost estimate 聚合
2. 新增 `task_metrics` / `task_integrity` actions，讓對話流程可即時自檢。
3. Runtime + REST 新增：
   - `tasks.metrics` / `tasks.integrity` RPC
   - `GET /api/tasks/metrics`
   - `GET /api/tasks/integrity`
4. 任務 mutation API 支援 `x-idempotency-key`、`if-match` / `x-expected-version`，補齊樂觀鎖與冪等鍵入口。
5. Dashboard Task 頁新增 Metrics & Integrity 卡片，支援跨會話觀察任務健康度與違規分佈。

## 尚未完成（後續 M3）

1. 每任務 token/cost「模型回報級」精算（目前為 estimate 聚合，尚未接供應商 billing）。
2. 多 worker 真平行寫入下的競態壓測矩陣（目前為單 worker + optimistic lock）。
3. 更深層的 multi-agent task orchestration parity（目前為單核心嚴格流轉優先）。
