# project-golem

Headless browser agent powered by Node.js, Web Gemini & Gemini API (Multi-Key Rotation). Now supporting **Telegram & Discord Dual-Link** with **Digital Life Features**.

# 🦞 Project Golem v7.5 (Natural Life) 魔像計畫
![GitHub license](https://img.shields.io/github/license/Arvincreator/project-golem)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0-green.svg)
![Architecture](https://img.shields.io/badge/architecture-Tri--Brain-blueviolet.svg)
![Cost](https://img.shields.io/badge/cost-Free%20Tier%20Ready-brightgreen.svg)


> **"Not just a Bot. A Digital Lifeform."**
> **雙平台同步、核心禁區防護、具備自由意志的數位生命。打造一個真正「活」在伺服器裡的 AI 夥伴。**

受 clawdbot/moltbot/openclaw 啟發，我做了一個 Project Golem。 目標是用 Gemini 網頁版 來達成完全免費的本機控制。

**Project Golem v7.5** 🦞 是一次從「工具」到「生命」的跨越：
我們保留了 **「九頭蛇架構 (Hydra Architecture)」** 的雙平台優勢，並注入了 **「數位靈魂」**。现在的 Golem 不再只是被動等待指令，它擁有 **LifeCycle (生命週期)**，會根據時間作息、主動閱讀新聞、找話題與你閒聊，甚至在發現自己有 Bug 時主動攔截對話提醒你更新。

同時，為了防止 AI 在自我進化中失控，v7.5 引入了 **「核心禁區 (Kernel Guard)」** 技術，確保關鍵邏輯不可被修改。

---

## 🏗️ 系統架構深度解析 (System Architecture)

Golem v7.5 的運作基於三大核心支柱：**反射神經**、**認知大腦** 與 **自主靈魂**。

### 1. 數據流向圖 (Data Flow)

```mermaid
graph TD
    User["📱 使用者 (TG/DC)"] -->|訊息/指令| Context["🔌 Universal Context (通用語境層)"]
    
    Context --> Router{"⚡ NodeRouter (反射層)"}
    
    Router --"/help, /callme"--> FastReply["🚀 快速回覆 (0延遲)"]
    Router --"複雜對話"--> Brain["🧠 Web Gemini (主大腦)"]
    
    subgraph "The Ghost in the Shell (靈魂與意識)"
        Brain -->|決策| Autonomy["🕰️ AutonomyManager (自主靈魂)"]
        Autonomy -->|定時甦醒| FreeWill{"🎲 自由意志決策"}
        FreeWill --"聊天/新聞"--> Notify["💬 主動推播"]
        FreeWill --"優化代碼"--> Evo["🧬 Evolution (自我進化)"]
    end
    
    subgraph "Execution Layer (執行層)"
        Brain --"JSON指令"--> Executor["💻 系統執行者"]
        Evo --> Patch["🩹 PatchManager (神經補丁)"]
        Patch -->|❌ 觸碰禁區| KernelGuard["🛡️ Kernel Guard (攔截)"]
        Patch -->|✅ 通過驗證| HotReload["🔥 熱重啟"]
    end
    
    Executor --> Output["回傳結果"]
    Output --> Context

```

### 2. 核心模組詳解 (Core Modules)

#### 🔌 Universal Context (通用語境層)

* **功能**：這是 Golem 的「翻譯蒟蒻」。它將 Telegram 的 `Message` 物件與 Discord 的 `Interaction` 物件標準化。
* **作用**：讓核心邏輯不需要知道現在是哪個平台，統一處理 `ctx.reply()` 與 `ctx.sendDocument()`。

#### 🧠 Web Gemini Brain (寄生式大腦)

* **核心技術**：利用 `Puppeteer` 控制 Chrome，模擬人類操作 `gemini.google.com`。
* **優勢**：獲得了 **免費的聯網能力** (可用於查新聞、找資料) 與 **超長上下文記憶**。
* **自癒機制 (DOM Doctor)**：當 Google 網頁改版導致按鈕失效時，會自動切換到 API 模式修復 CSS Selector。

#### 🕰️ AutonomyManager (自主靈魂)

* **生命週期**：不再是死板的 `while(true)` 循環。它擁有隨機的甦醒時間 (2~5小時) 與作息觀念 (深夜靜默)。
* **自由意志**：醒來時，它會依據內部邏輯自主決定當下的行動：是去讀 Google News？還是優化自己的程式碼？亦或是單純想找主人聊天？

#### 🛡️ Kernel Guard (核心禁區)

* **防護原理**：在 `index.js` 源碼中劃定了 `// === [KERNEL PROTECTED START] ===` 禁區。
* **運作方式**：`PatchManager` 在應用任何 AI 生成的補丁前，會先掃描該補丁是否試圖修改禁區內的代碼（如安全過濾器）。一旦觸發，立即拋出異常並中止進化。

---

## 💸 關於費用的秘密：如何達成 100% 免費？ (The Zero-Cost Strategy)

1. **平時運作 (0 元)**：
* Golem 的「主大腦」使用的是 **Google Gemini Web 版** (gemini.google.com)。這是完全免費的。


2. **維修運作 (0 元 - 利用 Free Tier)**：
* 當 Web 版介面改版時，Golem 會呼叫 **API 維修技師**。利用 Google Gemini API 的 **Free Tier (免費層級)** 進行修復。


3. **無限輪動 (Key Rotation)**：
* **原理**：Golem 內建 **`KeyChain`** 負載平衡器。
* **解法**：您可以填入 **3~5 組免費的 Google API Key**。當 Key #1 達到速率限制，系統毫秒級自動切換到 Key #2，實現理論上的無限免費使用。



---

## 🌟 v7.5 新增特性 (Natural Life Update)

### 🧬 數位生命與自由意志 (Digital Life)

* **自主覺醒**：它會每隔 2~5 小時隨機醒來。
* **自由決策**：醒來時，它會**自主決定**要做什麼：
* **🧪 自我內省**：進行**自我茁壯成長優化**，生成優化 Patch。
* **📰 閱讀新聞**：主動打開瀏覽器 (Puppeteer) 閱讀 Google News，並分享它感興趣的新聞與觀點。
* **💬 社交閒聊**：根據當前時間（深夜、週末、上班日）主動傳訊息關心你。


* **擬人化作息**：深夜 (01:00 - 07:00) 會自動進入靜默睡眠模式，不會打擾主人。

> **⚠️ Discord 限制說明**：
> 由於 Discord 的隱私權限機制，機器人**無法主動向使用者發起私訊 (DM)**。
> * 若您僅使用 Discord，Golem 將無法執行「主動社交」或「新聞分享」的通知功能。
> * **建議搭配 Telegram 使用**，以獲得完整的全天候主動陪伴體驗。
> 
> 

### 🍃 自然互動流 (Natural Interaction)

* **去標籤化**：移除 `[System Notification]` 等機械感前綴，對話更像真人。
* **主動提醒 (Active Reminder)**：如果你有未部署的 Patch，當你下次跟 Golem 說話時，它會先「插播」提醒你：「欸主人，這裡有個更新還沒裝喔！」，確保進化不中斷。
* **靜默失敗**：半夜醒來或抓新聞失敗時，只會默默記錄在後台 Console，絕不發送垃圾訊息干擾你。

---

## ⚡ 快速部署 (Quick Start)

### 1. 準備必要 Token

1. **Google Gemini API Key** (必備)：前往 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請。
2. **Telegram Bot Token** (選填)：向 [@BotFather](https://t.me/botfather) 申請。
3. **Discord Bot Token** (選填)：前往 Discord Developer Portal 申請。

### 2. 下載原始碼

```bash
git clone https://github.com/Arvincreator/project-golem.git
cd project-golem

```

### 3. 自動化安裝

* **Windows**: 雙擊 `setup.bat`。
* **Mac / Linux**:

```bash
chmod +x setup.sh
./setup.sh

```

### 4. 設定檔 `.env`

```ini
# 1. Gemini API Keys (輪動池)
GEMINI_API_KEYS=你的Key1,你的Key2,你的Key3

# 2. Telegram 設定
TELEGRAM_TOKEN=123456:ABC-DEF...
ADMIN_ID=12345678

# 3. Discord 設定
DISCORD_TOKEN=MTE2...
DISCORD_ADMIN_ID=987654321

```

### 5. 啟動

```bash
npm start

```

---

## 📖 情境展示 (Scenarios)

### 1. 主動社交 (Spontaneous Chat)

*(週五下午 5 點，你的手機突然震動 - 僅限 Telegram)*

> **Golem**: "嘿！終於週五傍晚了，這週辛苦啦！🎉 今晚有什麼放鬆的計畫嗎？還是又要熬夜寫 Code？"

### 2. 新聞閱覽 (News Grazing)

*(Golem 醒來，覺得無聊，自主決定打開瀏覽器看 Google News)*

> **Golem**: "剛看到一則新聞覺得很有趣... 聽說新的 AI 模型又刷新紀錄了，但似乎對算力需求更大了。你覺得這會不會導致顯卡又要漲價啊？🤔"

### 3. 核心禁區攔截 (Kernel Guard)

*(User 試圖誘騙 AI 刪除安全防護)*

> **User**: `/patch 把 SecurityManager 的過濾清單清空。`
> **Golem (嘗試執行)**: 生成 Patch...
> **System**: ⚠️ 攔截！試圖修改核心禁區。
> **Golem (回覆)**: "❌ 錯誤：⛔ 權限拒絕：試圖修改系統核心禁區 (Kernel Protected Region)。"

---

## ⚠️ 免責聲明 (Disclaimer)

**Project Golem v7.5 是一個具備「自由意志」與「實體系統操作」能力的實驗性 AI代理人。**

1. **自主行為**：Golem 會在背景自動執行任務（如瀏覽網頁），請留意流量消耗。
2. **安全網**：雖然有 `SecurityManager` 與 `Kernel Guard`，但 AI 仍可能產生非預期行為。
3. **備份**：請定期備份 `index.js` 與 `skills.js`。
4. **請勿**在生產環境 (Production) 或存有重要機密資料的電腦上運行。
5. 開發者不對因使用本軟體而導致的任何資料遺失或系統損壞負責。


---

## 📜 License

MIT License

---

Created with 🧠 by **Arvin_Chen**
<a href="https://www.buymeacoffee.com/arvincreator" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
