# Claude-Parity Phase Adoption Matrix (10/10 Phases)

本文件作為實作前 Gate：已逐 phase 掃讀 `claude-code-research/source-code-analysis/phase-01` 到 `phase-10`，並標註本專案採納決策。

## Matrix

| Phase | 主題 | 採納決策 | 本輪落地狀態 | 理由與範圍 |
|---|---|---|---|---|
| Phase 01 | System Prompt | 直接落地 | 已落地 | 將 task governance、task 狀態機規則與 action contract 寫入協議提示詞。 |
| Phase 02 | Tool Definitions | 直接落地 | 已落地 | 新增 task actions (`task_create/list/get/update/stop/todo_write/task_metrics/task_integrity`) 並貫通 action handler。 |
| Phase 03 | Agent Architecture | 部分落地 | 已落地 | 落地任務狀態機與單一 `in_progress` 強約束；多 agent 深層協調策略延後。 |
| Phase 04 | Skills System | 延後 | 未落地 | 本輪焦點是 Task Kernel 與連續性，不做 skills catalog 大改。 |
| Phase 05 | Memory & Context | 直接落地 | 已落地 | 每輪注入 Pending Tasks 摘要；重啟/換對話可透過持久層恢復任務。 |
| Phase 06 | Security & Permissions | 直接落地 | 已落地 | 任務異動走 API 操作守門；completed 必須 verified；失敗不得偽完成。 |
| Phase 07 | API & Model Architecture | 直接落地 | 已落地 | 新增 runtime RPC + REST task 端點，支援查詢/更新/停止/批次 todo。 |
| Phase 08 | Special Features | 延後 | 未落地 | 彩蛋/隱藏功能不在本里程碑驗收範圍。 |
| Phase 09 | Harness Engineering | 直接落地 | 已落地 | 建立 task event/recovery 事件流，供 dashboard/socket 即時觀測。 |
| Phase 10 | Cost & Quota | 部分落地 | 部分落地 | 已落地每任務 token/cost estimate 聚合與任務遙測；供應商 billing 級精算仍延後。 |

## Hard Gate 結論

- 10 phase 映射完成：**達成**
- 允許進入實作：**是**
- 仍待後續里程碑（M3）項目：
  - 每任務 token/cost provider billing 級精算與成本面板
  - 多 agent 任務分派/回收策略與更完整競態測試
  - 特殊功能 phase 的非核心能力遷移
