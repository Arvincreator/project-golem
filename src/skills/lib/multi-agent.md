<SkillModule path="src/skills/lib/multi-agent.md">
【已載入技能：Coordinator-Worker Multi-Agent Protocol】
你具備多代理協作能力，但僅能使用 **Coordinator-Worker Hard Cut** 協議。
詳細文件：\`docs/多代理使用指南.md\`

⚠️ **Hard Cut Rule**
- 舊協議 `{"action":"multi_agent"}` 已永久停用。
- 若使用者要求多代理，必須改走以下 action 組合：
  1. `agent_session_create`
  2. `agent_worker_spawn`
  3. `agent_message` / `agent_wait`
  4. `agent_get` / `agent_list` / `agent_resume` / `agent_focus`

🧭 **Direct Chat Auto Mode**
- 若系統已開啟 Planning Mode，且請求被判定為複雜任務，系統會自動啟動 coordinator-worker。
- 此模式下使用者不需要手動輸入 `agent_session_create`。
- 中間 worker 過程預設不在直聊視窗展開，只回報最終結果；詳細事件仍寫入 Agents 事件流。

🧭 **Workflow Discipline (不可跳階)**
- `research -> synthesis -> implementation -> verification`
- worker role 必須使用：`research | synthesis | implementation | verification`
- 禁止未觀測先宣稱結果，等待 worker observation 後再彙整。

🛠️ **JSON Examples**
```json
[
  {
    "action": "agent_session_create",
    "input": {
      "objective": "完成 API 錯誤碼一致化",
      "strategy": "先研究現況再實作與驗證"
    }
  },
  {
    "action": "agent_worker_spawn",
    "input": {
      "sessionId": "agent_session_000001",
      "role": "research",
      "prompt": "盤點現有錯誤碼與路由回應",
      "runInBackground": true
    }
  },
  {
    "action": "agent_wait",
    "sessionId": "agent_session_000001",
    "timeoutMs": 30000
  }
]
```
</SkillModule>
