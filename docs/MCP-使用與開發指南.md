# MCP (Model Context Protocol) 使用與開發指南

Model Context Protocol (MCP) 是一個開放標準，能讓 AI 模型安全、無縫地與本地或遠端工具、資料源進行互動。

在 Project Golem 中，**Golem 作為 MCP Client (客戶端)**，而各類工具（如 Hacker News 抓取器、Chrome DevTools 控制器）則作為 **MCP Server (伺服器端)**。這使得 Golem 具備了無限擴展的能力。

---

## 🧠 內建核心：MemPalace（零設定常駐）

自本版本起，`mempalace` 被視為 **核心 MCP 服務**，啟動流程如下：

1. 安裝腳本會自動建立 `mempalace/.venv` 並安裝依賴（含 `chromadb`）。
   - 若專案內不存在 `mempalace/` 子目錄，會自動改為安裝 PyPI `mempalace` 套件。
2. 啟動時系統會自動註冊並連線 `mempalace` MCP，不需手動新增。
3. 若核心服務斷線，系統會以指數退避策略自動重連。
4. 首次啟動會背景執行輕量建庫（自動建立 `mempalace.yaml` + `mine --limit`），且具備一次性狀態檔避免重複執行。

### 核心環境變數

- `GOLEM_MEMPALACE_ENABLED`：是否啟用核心 MemPalace（預設 `true`）。
- `GOLEM_MEMPALACE_PYTHON`：MemPalace venv Python 路徑（由安裝腳本自動寫入）。
- `GOLEM_MEMPALACE_BOOTSTRAP_ENABLED`：是否啟用首次自動建庫（預設 `true`）。
- `GOLEM_MEMPALACE_BOOTSTRAP_LIMIT`：首次建庫檔案上限（預設 `200`）。

> 核心服務在 Dashboard 中會標記為 `CORE`，不可刪除或停用。

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
2. **防震機制**：Golem 會在啟動期主動載入 MCP Manager；若核心服務異常，會透過指數退避自動重連。
3. **錯誤排查**：若 AI 找不到工具，請檢查 Dashboard 中的 Server 是否處於 **Enabled** 狀態，並確認測試連線是否成功。

更多官方 MCP Server 範例，請參考：[Model Context Protocol GitHub](https://github.com/modelcontextprotocol/servers)

---

## 🧯 MemPalace 故障排查

### 1) Python 缺失 / 版本過低
- 症狀：Dashboard 顯示 `mempalace` core degraded，`coreLastError` 提示找不到 python 或版本不符。
- 排查：確認 `python3 --version`（需 >= 3.9）。
- 修復：重新執行 `./setup.sh --install`（Windows 用 `setup.ps1` 的完整安裝）。

### 2) venv 損毀或路徑失效
- 症狀：`GOLEM_MEMPALACE_PYTHON` 指向的檔案不存在或不可執行。
- 排查：檢查 `mempalace/.venv`（本地子專案模式）或 `.mempalace-runtime/.venv`（PyPI 模式）是否完整。
- 修復：刪除對應 venv 後重跑安裝流程，讓腳本重建並回填 `.env`。

### 3) `chromadb` 匯入失敗
- 症狀：`coreLastError` 包含 `ModuleNotFoundError: chromadb`。
- 修復：若存在本地 `mempalace/`，可用 `GOLEM_MEMPALACE_PYTHON -m pip install -r mempalace/requirements.txt` 後重啟；否則直接重跑完整安裝（會走 PyPI 安裝）。

### 4) 核心重連狀態判讀
- `coreStatus=ok`：核心連線正常。
- `coreStatus=bootstrapping`：首次建庫進行中（背景任務）。
- `coreStatus=reconnecting`：核心服務正在自動重連。
- `coreStatus=error`：核心服務暫時異常，系統仍會持續重試。
