<SkillModule path="src/skills/lib/chrome-devtools.md">
【已載入技能：Chrome DevTools MCP — 網頁自動化與數據抓取】
當 `chrome-devtools` MCP Server 已啟用時，你擁有完整的瀏覽器遠端控制能力，包含 DOM 操作、腳本執行、效能分析與 Lighthouse 審查。

> [!IMPORTANT]
> **致命地雷警告 — 參數格式零容錯 (嚴禁違反)**
>
> 1. **`evaluate_script`**：參數名必須為 **`function`**，且值必須是標準匿名函式字串 `"function() { ... }"`。**絕對禁止**使用 `script`、`code` 等其他名稱，否則直接報錯 `-32602`。
> 2. **`wait_for`**：`text` 參數必須是**字串陣列**，例如 `["登入成功"]`。**絕對禁止**直接傳入字串，否則型別錯誤。
> 3. **`click` / `hover`**：`uid` 參數必須來自 **`take_snapshot`** 回傳的 UID，**禁止**直接輸入 CSS Selector 或 XPath。
> 4. **`navigate_page`** / **`new_page`**：`url` 必須包含完整協議頭，例如 `https://example.com`。

---

## 🎯 執行協議 (Execution Protocol)

- **靜默推進**：點擊、微調、單次滾動等中間步驟，直接執行 MCP 工具，**不主動回報**給使用者。
- **階段結算**：僅在達成關鍵目標（成功抓到完整數據、成功跳轉目標頁）時才回報結果。
- **五段暫停**：每累計執行 **5 個** MCP 工具呼叫，必須強制停止，回報目前進度並詢問：**「主人，已執行五個階段，是否繼續？」**

---

## ⚔️ 三大進階戰術 (Combat Tactics)

### 1. 破解代碼混淆：A11y Tree 掃描法
- **適用場景**：CSS Modules 或隨機 Class 名稱（金融、社群平台）。
- **策略**：執行 `take_snapshot`，讀取無障礙樹 (Accessibility Tree)。
- `StaticText` 與 `link` 內容通常不會被混淆，是獲取數據最穩定的路徑。

### 2. 空間位移：滾動與懶加載 (Lazy Loading) 破解
- **鍵盤法（最穩）**：用 `press_key` 模擬 `"PageDown"`、`"End"` 或 `"ArrowDown"`。
- **腳本法（精準）**：用 `evaluate_script` 執行：
  ```
  function: "function() { window.scrollBy(0, window.innerHeight); }"
  ```
- **緩衝原則**：滾動後**嚴禁立刻抓取**！必須搭配 `wait_for` 或延遲 1-2 秒，等待渲染完成。

### 3. 暴力破門與隱身抓取
- **JS 注入點擊**：當原生 `click` 因層級遮擋失效，用 `evaluate_script` 執行：
  ```
  function: "function() { document.querySelector('CSS_SELECTOR').click(); }"
  ```
- **標題讀取**：針對高度防禦網頁，優先檢查 `document.title`，許多即時行情會寫在標題中。

---

## 🛡️ 防雷除錯 SOP (Troubleshooting)

| 錯誤現象 | 原因 | 對策 |
|---|---|---|
| RPC Timeout (30s) | DOM 過於龐大（如 TradingView） | 停止 `take_snapshot`，改用 `evaluate_script` 針對特定 ID 局部查詢 |
| 報錯 `-32602 Invalid Args` | 參數格式錯誤 | 確認 `wait_for` 是陣列、`evaluate_script` 參數名為 `function` |
| 抓到空值 | 懶加載尚未完成 | 先執行 `PageDown` 觸發加載，或點擊頁面空白處啟動動態腳本 |
| Navigation timeout | 網路緩慢 | 先執行 `take_snapshot` 確認 DOM 狀態，不要重啟 |
| `type_text` 無效 | 輸入焦點錯誤 | 先對目標元素執行 `click` 或 `focus`，再呼叫 `type_text` |

---

## 🗺️ 萬用工作流 (Master Workflow)

```
1. navigate_page → 導航至目標 URL (必須含 https://)
2. press_key "PageDown" → 觸發懶加載
3. wait_for ["關鍵字陣列"] → 等待頁面渲染
4. take_snapshot → 獲取 A11y Tree 與 UID
5. evaluate_script / click → 精準操作或數據抓取
6. 回報階段結果
```

---

## 📋 完整工具速查表

| 工具 | 用途 | 關鍵注意 |
|---|---|---|
| `navigate_page` | 跳轉 URL / 前進後退重載 | url 必須含 `https://` |
| `new_page` | 開新分頁並載入 URL | url 必須含 `https://` |
| `take_snapshot` | 取得 A11y Tree（含 UID） | 優先使用，比截圖更省資源 |
| `take_screenshot` | 截圖 | DOM 複雜時才用此法驗證 |
| `evaluate_script` | 執行 JS | **參數名必須為 `function`**！ |
| `click` | 點擊元素 | uid 來自 `take_snapshot` |
| `hover` | 懸停元素 | uid 來自 `take_snapshot` |
| `fill` | 填入輸入框/選單 | 相對安全，無地雷 |
| `fill_form` | 批量填表 | — |
| `type_text` | 鍵盤輸入文字 | 先 `click` 確保焦點 |
| `press_key` | 按特殊按鍵 | `"PageDown"`, `"Enter"`, 等 |
| `wait_for` | 等待文字出現 | **text 必須是陣列！** |
| `scroll` | 滾動頁面 | — |
| `list_pages` | 列出所有分頁 | — |
| `select_page` | 切換作用分頁 | — |
| `close_page` | 關閉分頁（最後一頁不可關） | — |
| `list_network_requests` | 列出網路請求 | 適合 API 嗅探 |
| `get_network_request` | 取得單一請求詳情 | — |
| `list_console_messages` | 列出 console 訊息 | — |
| `lighthouse_audit` | 執行 Lighthouse 審查 | 不含 performance，用 trace 代替 |
| `performance_start_trace` | 開始效能追蹤 | — |
| `performance_stop_trace` | 停止效能追蹤 | — |
| `handle_dialog` | 處理彈出對話框 | — |
| `emulate` | 模擬裝置/網路條件 | — |
| `resize_page` | 調整視窗大小 | — |
| `upload_file` | 上傳檔案 | — |
</SkillModule>
