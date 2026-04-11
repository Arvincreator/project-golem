# MCP (Model Context Protocol) 使用與開發指南

Model Context Protocol (MCP) 是一個開放標準，能讓 AI 模型安全、無縫地與本地或遠端工具、資料源進行互動。

在 Project Golem 中，**Golem 作為 MCP Client (客戶端)**，而各類工具（如 Hacker News 抓取器、Chrome DevTools 控制器）則作為 **MCP Server (伺服器端)**。這使得 Golem 具備了無限擴展的能力。

---

## 🚀 快速上手：以 Hacker News MCP 為例

本節將指導你如何安裝並整合 [hn-server](https://github.com/pskill9/hn-server) 到 Golem 中。

### 1. 本地編譯 MCP Server
首先，你需要將 MCP Server 下載到本地並完成編譯：

```bash
# 建議統一放在專案目錄下的 vendors (或其他你喜歡的地方)
git clone https://github.com/pskill9/hn-server
cd hn-server

# 安裝依賴並編譯
npm install
npm run build
```

編譯完成後，核心檔案路徑通常位於 `dist/index.js` 或 `build/index.js`。

### 2. 在 Web Dashboard 中新增 Server
開啟 Golem 的 Web Dashboard，點擊左側導航欄的 **「MCP 工具」**。

1. 點擊 **「新增 Server」**。
2. 填寫以下欄位：
   - **名稱**：`hacker-news` (建議使用英文小寫，這也是 AI 調用時的識別碼)
   - **指令**：`node`
   - **參數**：填入編譯後檔案的 **絕對路徑**，例如：
     `["/Users/yourname/project-golem/hn-server/build/index.js"]`
   - **描述**：`Hacker News 實時數據抓取工具`
3. 點擊 **「儲存」**。

### 3. 測試連線
在伺服器列表中找到 `hacker-news`，點擊右側的 **「測試連線」** (高壓電圖示)。
若顯示「發現 X 個工具」，則表示 Golem 已成功與該 Server 建立 JSON-RPC 連線。

### 4. 與 Golem 對話
重啟 Golem 後，你就可以直接下達指令：
> 「幫我抓 Hacker News 目前前 5 名的頭條」

Golem 會自動識別並發出如下 Action：
```json
[ACTION]
{
  "action": "mcp_call",
  "server": "hacker-news",
  "tool": "get_stories",
  "parameters": {
    "type": "top",
    "limit": 5
  }
}
[/ACTION]
```

---

## 🛠️ 管理功能說明

### MemPalace 一鍵啟用（自動安裝 + 驗證）
若你在 Dashboard 將 `mempalace` Server 切換為啟用，系統會自動執行以下流程：

1. 先執行安裝器（`scripts/mcp/install-mempalace.js`），建立專案內隔離虛擬環境 `data/mcp/mempalace-runtime/.venv` 並安裝 `mempalace`（已安裝則跳過）。
2. 啟用 MCP 連線並執行 `tools/list` 連線測試。
3. 嘗試呼叫一個只讀 probe 工具（例如 `mempalace_search`）做功能驗證。
4. 若驗證失敗，會自動將 `mempalace` 停用，避免留下「已啟用但不可用」狀態。

你也可以手動執行安裝器：
```bash
npm run mcp:install:mempalace
```

### 實時日誌 (Live Logs)
在 MCP 頁面下方設有日誌面板，會實時顯示：
- 調用的時間與耗時
- 傳送的參數
- Server 回傳的原始資料
- 錯誤訊息（若調用失敗）

### 工具檢查 (Tool Inspector)
點擊清單中的 Server，右側會顯示該 Server 提供的所有可用工具清單及其參數定義 (JSON Schema)。Golem 的大腦也會在啟動時自動讀取這些清單，確保能準確調用。

---

## 💡 開發建議

1. **路徑問題**：在設定參數時，請務必使用 **絕對路徑**。Node.js 在執行子進程時不會自動展開 `~`。
2. **防震機制**：Golem 的 MCP Manager 具備 Lazy-load 機制，只有在第一次需要調用或開啟 Dashboard 時才會啟動 Server 進程。
3. **錯誤排查**：若 AI 找不到工具，請檢查 Dashboard 中的 Server 是否處於 **Enabled** 狀態，並確認測試連線是否成功。

更多官方 MCP Server 範例，請參考：[Model Context Protocol GitHub](https://github.com/modelcontextprotocol/servers)
