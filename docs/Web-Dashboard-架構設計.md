# Web Dashboard 架構設計（拆分後）

本文說明 `web-dashboard/server.js` 拆分後的整潔架構，重點放在模組職責邊界、資料流與擴充規則。

## 1) 架構總覽

- 組裝層：`web-dashboard/server.js`
- 靜態頁與前端路由層：`web-dashboard/server/registerStaticRoutes.js`
- Socket 事件層：`web-dashboard/server/registerSocketHandlers.js`
- API 路由層：`web-dashboard/routes/api.*.js`
- 共用工具層：`web-dashboard/routes/utils/context.js`

### 設計原則

- `server.js` 只做「初始化與組裝」，不承載業務細節。
- 每個 API 模組依領域切分（system/golems/persona/memory/mcp/chat/...）。
- 路由內部可讀取 `server` 狀態，但避免跨路由直接互相呼叫。
- 共享邏輯抽到 `routes/utils`，避免複製貼上。

## 2) 目錄與職責

### `web-dashboard/server.js`

責任：
- 建立 `express` / `http` / `socket.io`
- 設定 CORS、JSON body、CSP
- 維護 server lifecycle 狀態
  - `contexts`
  - `isBooting`
  - `logBuffer`
  - `chatHistory`
- 註冊路由模組與 socket handler
- 啟動 HTTP server
- 提供 broadcast 方法
  - `broadcastLog`
  - `broadcastState`
  - `broadcastHeartbeat`

### `web-dashboard/server/registerStaticRoutes.js`

責任：
- 檔案上傳靜態服務（`/api/files`）
- 開發模式/正式模式路由分流
- `/dashboard/*` 靜態檔 fallback
- 遠端存取與初始設定導流
  - 遠端 Cookie 驗證
  - 未初始化導向 `/dashboard/system-setup`

### `web-dashboard/server/registerSocketHandlers.js`

責任：
- `io.on('connection')` 註冊
- 連線時發送 `init` payload
- 處理前端 `request_logs`

### `web-dashboard/routes/api.system.js`

責任：
- 系統狀態/設定/登入
- 更新檢查與執行
- restart/reload/shutdown
- health endpoint

### `web-dashboard/routes/api.golems.js`

責任：
- `golems` 列表
- create/start/stop/setup
- 與 `golemFactory` 整合（懶載入與啟動流程）

### `web-dashboard/routes/api.persona.js`

責任：
- 人格樣板列表與市場查詢
- 人格讀取/注入/建立/刪除
- 人格更新後熱重載（`brain.reloadSkills()`）

### `web-dashboard/routes/api.memory.js`

責任：
- memory 查詢/清除/匯出/匯入
- 手動寫入記憶
- agent log 讀取

### `web-dashboard/routes/api.mcp.js`

責任：
- MCP server CRUD/toggle/test
- MCP tools/logs
- 事件橋接：`mcpLog -> server.broadcastLog`

### 既有路由模組（保留）

- `web-dashboard/routes/api.chat.js`
- `web-dashboard/routes/api.config.js`
- `web-dashboard/routes/api.skills.js`
- `web-dashboard/routes/api.upload.js`

## 3) 關鍵資料流

### Chat 訊息（Dashboard -> Core）

1. 前端呼叫 `/api/chat`
2. `api.chat.js` 建立 mock context
3. 委派給 `index.js` 匯出的 unified handler
4. 回覆經 `server.broadcastLog` 推送到 socket

### Golem 啟動流程

1. 前端呼叫 `/api/golems/start`
2. 先從 `server.contexts` 查找 instance
3. 若不存在，透過 `server.golemFactory` 進行懶生成
4. 執行 `brain.init()` + `tgBot.startPolling()` + `autonomy.start()`

### MCP 日誌回傳

1. `api.mcp.js` 透過 `MCPManager.getInstance()` 操作
2. 首次載入時綁定 `mcpLog` 事件
3. 事件轉為 dashboard log payload
4. `broadcastLog` 推送前端

## 4) 可維護性規範

- 新增 API 時：
  - 優先新增 `web-dashboard/routes/api.<domain>.js`
  - 在 `server.js` 的 `routeFactories` 註冊
- 路由若需取得「目前活躍 golem」：
  - 使用 `routes/utils/context.js`
- 只要是 socket 廣播，都走 `server.broadcast*` 方法，避免各路由自行 `io.emit`
- 需要跨模組共用邏輯時，先抽到 `routes/utils` 或 `server/`，不要回填到 `server.js`

## 5) 拆分收益

- 單檔複雜度大幅下降（`server.js` 從超大單檔改為組裝層）
- 責任邊界清楚，降低回歸風險
- 測試與除錯定位更直接（依 domain 找檔）
- 後續可逐步把 `api.skills.js`、`api.chat.js` 內部再細分 service 層

