# GBrain Recipes (進階外部資料流入)

GBrain 強大的地方在於可以將外界多維度資料全都收束進 PGLite 的知識庫（Compiled Truth）中。
在 Project-Golem 的架構中，由於有了完整的 Dream Cycle 與 MCP 讀寫掛鉤，您現在也可以自由引進這類被動擴充來源。

## 推薦的擴充來源 (Recipes)

### 1. Twilio Voice Recipe (電話自動寫入大腦)
在 `~/.gbrain/` 下面配置 Twilio Webhook，可將使用者的通話內容或語音筆記直接 Transcription 並自動丟給 GBrain 進行實體分析及寫入檔案。
- **詳情與設定方式**：請參考 GBrain 官方文件 `recipes/twilio-voice-brain.md`
- **所需條件**：Twilio 帳號、OpenAI API Key（作 Whisper 及 LLM 提煉用）。

### 2. Email-to-Brain
允許 GBrain 自動掃描指定的信箱或標籤（透過 Gmail API 或 IMAP），將收到的重要資訊直接整理到 `companies/<name>` 等相關頁面，供 Golem 隨時調閱。
- **所需條件**：Email App Passwords 或 OAuth2 憑證。

### 3. Apple Calendar / Google Calendar
將「今天遇到了誰」的主題直接同步到 Timeline 中，這樣 Golem 就能隨時知道你的行事曆對應了圖譜中的哪些人與事。<br>

## 如何啟動？
Project-Golem 並未將這些強制綁定在系統內以免造成資安疑慮與環境複雜化。
如果您有意啟用，可以直接透過 `gbrain` CLI 手動掛載擴充，或者在背景額外啟動這幾支服務腳本。Golem 的 `GBrainDriver` 會無縫讀取所有更新的資料！
