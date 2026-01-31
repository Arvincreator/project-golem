# project-golem
Headless browser agent powered by Gemini &amp; Ollama.

# 🦞 Project Golem v6.3 (Ouroboros Edition) 魔像計畫

![GitHub license](https://img.shields.io/github/license/Arvincreator/project-golem)
![GitHub repo size](https://img.shields.io/github/repo-size/Arvincreator/project-golem)
![Node.js](https://img.shields.io/badge/node-%3E%3D16.0-green.svg)
![Status](https://img.shields.io/badge/status-experimental-orange.svg)

> **"Two Brains, One Body, Infinite Evolution."**
> **無需昂貴 Dashboard，用 Telegram 打造住在你電腦裡的進化型 AI 代理人。**

**Project Golem** 是一個基於 **雙腦架構 (Dual-Brain Architecture)** 的本機自動化 Agent。它打破了傳統自動化腳本的限制，利用 **Google Gemini** 的強大認知能力作為「大腦」，配合 **Ollama (Local LLM)** 作為「小腦」，並透過 **Telegram** 作為唯一的安全指令中樞。

**v6.3 Ouroboros Edition** 引入了革命性的 **遞迴自我改進 (Recursive Self-Improvement)** 機制。Golem 現在能透過 Telegram 接收你的指令，讀取自身源碼、主動構思優化、並在對話視窗中傳送「測試補丁」供你審核，實現真正的互動式進化。

---

## 🌟 全功能特性 (Comprehensive Features)

### 💬 Telegram 指令中樞 (Telegram Command Center)

* **隨處控制**：透過 Telegram App，無論你身在何處，都能安全地監控與操作家中電腦 。

* **雙模互動 (Dual-Mode UI)**：
  
* **GUI 按鈕**：提供 [ 🚀 部署 ] [ 🗑️ 丟棄 ] 等直觀按鈕，一鍵決定 AI 的進化方向 。


* **NLP 意圖識別**：支援自然語言決策。只需回覆 *"好"*, *"OK"*, *"不要"*, *"爛透了"*，Golem 就能理解。



### 🧬 銜尾蛇進化協議 (Ouroboros Protocol) `v6.3`

讓 AI 從工具升級為生命體的關鍵：

* **內省機制 (Introspection)**：Golem 擁有讀取自身 `index.js` 的權限，能理解自己的架構與邏輯。
* **自主覺醒 (Autonomy)**：內建生物鐘，Golem 會在隨機時間（18-30小時）甦醒，主動思考優化方向。
* **神經補丁 (Neural Patching)**：進化不需重寫整個檔案。AI 生成精準的 JSON Patch，建立 `index.test.js` 分身進行**語法沙箱測試**。
* **經驗記憶庫 (Experience Memory)**：具備 RLHF 雛形，會記住使用者的拒絕/接受紀錄。

### 🧠 雙腦協作核心 (The Dual-Brain Core)

**大腦 (Gemini Web)**：負責自然語言理解、複雜邏輯推演與情緒化對話 。透過 Puppeteer 自動化操作，**零 API 成本**。

**小腦 (Ollama/Llama3)**：負責將大腦的抽象意圖「翻譯」為標準化、可執行的 Shell 指令 JSON，去除雜訊與幻覺 。



### 🛡️ 堡壘級安全體系 (Fortress Security)

透過 Telegram 實時攔截危險操作：

* **風險分級控制 (RBAC)**：
* 🟢 **Safe**：讀取類 (`ls`, `cat`) -> 自動放行。
* 🟡 **Warning**：修改類 (`npm install`) -> Telegram 跳出確認按鈕。
* 🔴 **Danger**：高危險 (`rm`) -> 紅色警報 + 強制確認 。


* ☠️ **Blocked**：毀滅性 (`rm -rf /`) -> **直接攔截** 。





---

## 🏗️ 系統運作流程 (Architecture)

```ascii
[📱 手機/電腦 (Telegram)] 
       ↕️ (1. 傳送指令 / 點擊按鈕)
[🤖 Node.js 本體] <────────────────────────────┐
       │                                       │
       ├──(2. 一般任務)──> [🦎 Ollama] ──> [🛡️ 安全審計] ──> [💻 Shell 執行]
       │                                       │
       └──(3. 進化任務)──> [🧠 Gemini]         │
               │                               │
               │ (4. 生成 Patch)               │
               ▼                               │
        [🧬 Patch Manager] ──> [📝 測試分身] ──┘
               │
               ▼ (5. 驗證通過)
        [📲 回傳檔案至 Telegram]
               │
               ▼ (6. 使用者授權 /deploy)
        [🚀 熱更新重啟 (Respawn)]

```

---

## 🚀 完整部署指南 (Deployment Guide)

### 第一步：環境準備 (Prerequisites)

確保您的系統已安裝以下工具：

1. **Node.js** (v16.0 或更高版本)
2. **Git**
3. **Google Chrome** (Gemini 自動化需要)
4. **Telegram App** (作為接收端)
5. **Ollama** (請至 [ollama.com](https://ollama.com) 下載)

### 第二步：模型設定 (Setup Ollama)

啟動 Ollama 並下載推薦模型（Llama3 表現最佳）：

```bash
ollama serve
# 開啟另一個終端機執行：
ollama pull llama3

```

### 第三步：安裝專案 (Installation)

```bash
# 1. 下載專案
git clone https://github.com/Arvincreator/project-golem.git
cd project-golem

# 2. 安裝依賴
npm install

# 3. 安裝 Puppeteer 瀏覽器核心 (重要)
node node_modules/puppeteer/install.js

```

### 第四步：設定 Telegram Bot (Configuration)

1. 開啟 Telegram，搜尋 **@BotFather**。
2. 輸入 `/newbot` 建立新機器人，取得 **API Token**。
3. 搜尋 **@userinfobot**，取得你個人的 **User ID** (這很重要，確保只有你能控制電腦)。

### 第五步：設定環境變數

複製範例設定檔並填入資訊：

```bash
cp .env.example .env

```

編輯 `.env`：

```ini
# 填入 BotFather 給你的 Token
TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqRstUVwxyz

# 填入 userinfobot 給你的 ID
ADMIN_ID=987654321

# 瀏覽器資料存檔位置
USER_DATA_DIR=./golem_memory

```

### 第六步：啟動 (Launch)

```bash
node index.js

```

> **👋 首次啟動注意**：
> 程式會自動開啟一個 Chrome 視窗。請在該視窗中**手動登入您的 Google 帳號**。登入完成後，您可以將視窗最小化。

---

## 📖 Telegram 操作手冊 (User Manual)

### 1. 基礎對話 (Chat)

打開你的 Bot 聊天視窗，直接輸入中文指令：

* **檔案管理**：*"把 Downloads 資料夾裡所有的 jpg 圖片移動到 Pictures/Backup"*
* **系統監控**：*"現在記憶體剩多少？"*
* **網路工具**：*"幫我 ping https://www.google.com/search?q=google.com 看網路通不通"*

### 2. 進化與優化 (Evolution) `v6.3`

你可以主動要求 Golem 進行自我升級：

* **代碼審計**：輸入 ` /audit`
* *功能*：請 Golem 讀取自己的原始碼，分析潛在漏洞或優化空間。


* **指定修補**：輸入 ` /patch [需求]`
* *範例*：`/patch 幫我增加一個 /weather 指令來查詢天氣`
* *流程*：Golem 生成代碼 -> **傳送 index.test.js 到 Telegram** -> 你審核 -> 同意後自動部署。



### 3. 自主提案處理 (Handling Proposals)

Golem 會在每天隨機時間醒來，如果它想到好點子，你的 Telegram 會跳出通知：

> **💡 靈感湧現！**
> 主人，我發現 `skills.js` 可以增加錯誤重試機制，我已經寫好測試版了。
> [ **🚀 部署** ] [ **🗑️ 丟棄** ]

* **接受提案**：點擊 **[部署]** 按鈕。系統將自動更新並重啟。
* **拒絕提案**：點擊 **[丟棄]** 按鈕。系統會刪除測試檔，並記住你不喜歡這類修改。

---

## 📂 專案結構 (File Structure)

```text
project-golem/
├── index.js             # 🧠 核心本體 (會隨時間自我演化，請定期備份)
├── skills.js            # 📚 技能書 (定義 Prompt 與工具能力)
├── golem_learning.json  # 🧠 經驗記憶庫 (記錄你的偏好與失敗經驗)
├── index.test.js        # 🧪 演化過程中的暫存分身 (自動生成/刪除)
├── golem_memory/        # 🍪 Chrome User Data (保存登入狀態)
└── .env                 # 🔑 環境變數與金鑰

```

---

## ⚠️ 免責聲明 (Disclaimer)

**Project Golem v6.3 是一個具備「修改自身原始碼」能力的實驗性專案。**
雖然我們實作了多重安全機制（語法沙箱、人類審核 HITL、指令黑名單），但在極端情況下（如 Prompt Injection 或邏輯死鎖），AI 仍可能產生不可預期的行為。

1. **請勿**在生產環境 (Production) 或存有重要機密資料的電腦上運行。
2. **強烈建議**定期手動備份 `index.js`。
3. 開發者不對因使用本軟體而導致的任何資料遺失或系統損壞負責。

---

## 📜 License

MIT License

---

Created with 🧠 by **Arvin_Chen** & **Gemini**
<a href="https://www.buymeacoffee.com/arvincreator" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
