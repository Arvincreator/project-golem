# Google Workspace MCP 整合說明

此文件說明如何設定與使用 `googleworkspace/cli` (gws) 作為 Golem 的 MCP Server。

## 1. 準備工作

在使用之前，您需要完成 Google Cloud 專案的設定並取得授權。

### A. 建立 Google Cloud 專案
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)。
2. 建立一個新專案（例如：`project-golem-workspace`）。
3. 啟用您需要的 API：
   - Gmail API
   - Google Drive API
   - Google Calendar API
   - Google Sheets API
   - Google Docs API

### B. 設定 OAuth 同意畫面
1. 在「API 和服務」>「OAuth 同意畫面」中，選擇「外部」並填寫必要資訊。
2. 在「測試使用者」中新增您自己的 Email。

### C. 建立憑證
1. 進入「憑證」頁面。
2. 點擊「建立憑證」>「OAuth 用戶端 ID」。
3. 應用程式類型選擇「桌面應用程式 (Desktop App)」。
4. 建立後，下載 JSON 檔案並重新命名為 `client_secret.json`。
5. 將此檔案放置於 `~/.config/gws/client_secret.json`。

## 2. 身份驗證

請在終端機執行以下指令完成初次設定：

```bash
# 進行自動化設定引導
npx gws auth setup

# 或手動登入
npx gws auth login --account your-email@gmail.com
```

## 3. Golem 整合配置

Golem 已自動新增配置至 `data/mcp-servers.json`。

**伺服器名稱：** `googleworkspace`
**指令：** `npx`
**參數：** `["-y", "@aaronsb/google-workspace-mcp"]`

> [!NOTE]
> 整合底層仍使用 `gws` CLI 進行認證，因此請確保已完成 `npx gws auth setup`。

## 4. 常用工具範例

一旦連線成功，Golem 將可以使用以下工具（每個工具都需要提供 `email`）：

- **Google Drive**: 使用 `manage_drive`
  - `operation: "search"`: 搜尋或列出檔案。
  - `operation: "get"`: 取得檔案細節。
- **Gmail**: 使用 `manage_email`
  - `operation: "list"`: 取得郵件列表。
  - `operation: "get"`: 讀取郵件內容。
- **Calendar**: 使用 `manage_calendar`
  - `operation: "viewAgenda"`: 查看行程。
- **Sheets**: 使用 `manage_sheets`
  - `operation: "read"`: 讀取試算表區塊。

### 指令範例

您現在可以對 Golem 說：
- 「使用 `manage_drive` 幫我搜尋 Google Drive 中最近修改的 5 個檔案，operation 用 search，包含我的 email」
- 「使用 `manage_calendar` 幫我查看明天的行程，operation 用 viewAgenda」
- 「使用 `manage_email` 幫我搜尋主旨包含 '專案' 的郵件，operation 用 list」

> [!TIP]
> 這些工具通常需要 `email` 參數來指定要操作的帳號。如果 Golem 沒有自動填入，請直接告訴它您的 Email。
