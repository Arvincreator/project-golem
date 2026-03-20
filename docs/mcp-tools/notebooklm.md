# NotebookLM MCP 工具整合指南

本指南說明如何將 [notebooklm-py](https://github.com/teng-lin/notebooklm-py) 整合至 Golem 中。透過此整合，Golem 具備了操作 Google NotebookLM 的完整能力，包括筆記本管理、資料匯入以及強大的 AI 研究分析功能。

---

## 🛠️ 技術組件
*   **核心庫**：`notebooklm-py` (Python 3.10+)
*   **傳輸橋接**：`src/mcp/notebooklm_stdio.py` (將 SSE 轉換為 Stdio 以支援 Golem)
*   **環境**：獨立的虛擬環境 `notebooklm_venv`

---

## 🚀 安裝步驟

### 1. 建立虛擬環境與安裝依賴
我們建議使用專用的虛擬環境以避免 Python 版本衝突：

```bash
# 建立虛擬環境 (需 Python 3.10+)
/opt/homebrew/bin/python3.12 -m venv notebooklm_venv

# 安裝 notebooklm-py (含 MCP 支援的分支)
./notebooklm_venv/bin/pip install "git+https://github.com/s4steve/notebooklm-py.git@feat/mcp-server#egg=notebooklm-py[mcp]"

# 安裝瀏覽器驅動程式 (供登入使用)
./notebooklm_venv/bin/pip install playwright
./notebooklm_venv/bin/playwright install chromium
```

### 2. 認證與登入 (一次性)
NotebookLM 需要 Google 帳號授權，請執行以下指令進行互動式登入：

```bash
./notebooklm_venv/bin/notebooklm login
```
登入成功後，認證資訊會儲存在 `~/.notebooklm/storage_state.json`。

### 3. 配置 Golem 環境變數
開啟專案根目錄的 `.env` 檔案，將上述 JSON 檔案的內容貼入：

```env
# Google NotebookLM 認證 Cookies (JSON 字串)
NOTEBOOKLM_AUTH_JSON={"cookies": [...], "origins": [...]}
```

---

## ⚙️ Dashboard 配置

在 Golem Web Dashboard 的「MCP 工具」頁面中，新增以下設定：

*   **名稱**：`notebooklm`
*   **指令**：`./notebooklm_venv/bin/python`
*   **參數**：`["src/mcp/notebooklm_stdio.py"]`
*   **描述**：`Google NotebookLM API 整合工具`

---

## 📖 可用工具一覽

整合後，Golem 將學會以下工具（部分列出）：

| 工具名稱 | 功能描述 |
| :--- | :--- |
| `list_notebooks` | 列出目前帳號下所有的筆記本 |
| `create_notebook` | 建立新的筆記本 |
| `add_url_source` | 匯入網址、YouTube 或網頁內容作為資料源 |
| `ask` | 針對特定筆記本內容進行深度問答 |
| `generate_audio` | 生成 Audio Overview (Podcast 音訊) |
| `generate_quiz` | 根據來源資料自動生成測驗 |
| `list_artifacts` | 查看已生成的 AI 產出物 (如音訊、報告) |

---

## 💡 使用範例
您可以對 Golem 下達以下指令：
*   「幫我列出目前的 NotebookLM 筆記本」
*   「將這個網址加入我的『AI 研究』筆記本：[URL]」
*   「幫我針對筆記本 [ID] 生成一份 Podcast 音訊」

---

## ⚠️ 注意事項
1. **認證過期**：若工具回報 401 或認證錯誤，請重新執行 `notebooklm login` 並更新 `.env`。
2. **絕對路徑**：在 Dashboard 中配置參數時，建議使用完整的絕對路徑。
