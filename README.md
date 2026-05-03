<div align="center">
  <img src="assets/logo.png" width="320" alt="Project Golem Logo" />
  <h1>Project Golem v9.5</h1>
  <p><strong>可長期陪跑的自主 AI 代理系統：Web Gemini、Ollama、LM Studio、多代理、技能、記憶與 Web Dashboard。</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Version-9.5.2-blue?style=for-the-badge" alt="Version">
    <img src="https://img.shields.io/badge/Node.js-20--22-green?style=for-the-badge&logo=nodedotjs" alt="Node.js">
    <img src="https://img.shields.io/badge/Backend-Gemini%20Web%20%7C%20Ollama%20%7C%20LM%20Studio-orange?style=for-the-badge" alt="Backends">
    <img src="https://img.shields.io/badge/Dashboard-Next.js%2016-black?style=for-the-badge&logo=nextdotjs" alt="Dashboard">
    <img src="https://img.shields.io/badge/License-MIT-red?style=for-the-badge" alt="License">
  </p>

  <p>
    <a href="#這是什麼">這是什麼</a> ·
    <a href="#核心能力">核心能力</a> ·
    <a href="#快速開始">快速開始</a> ·
    <a href="#設定重點">設定重點</a> ·
    <a href="#文件地圖">文件地圖</a>
  </p>

  <p><strong>繁體中文</strong> | <a href="docs/README.en.md">English</a> | <a href="docs/CONTRIBUTING.zh-TW.md">貢獻指南</a></p>
</div>

---

## 這是什麼

Project Golem 是一套以 Node.js 驅動的自主 AI 代理系統。它可以透過 Playwright 操控 Web Gemini，也可以切換到 Ollama 或 LM Studio 走本機/私有模型路線；前端則提供 Web Dashboard，用來管理對話、技能、人格、記憶、MCP 工具、多代理會議與系統設定。

這個專案目前比較像「個人 AI 作業系統」而不是單純 chatbot：它有長期記憶、任務隊列、指令安全防護、Telegram/Discord bridge、瀏覽器操作、排程自省、技能熱載入，以及一個能直接操作 Golem 的網頁控制台。

## 核心能力

| 能力 | 說明 |
| --- | --- |
| 多後端大腦 | `gemini` 使用 Browser-in-the-Loop 操控 Web Gemini；`ollama` 與 `lmstudio` 支援本機/私有部署模型。 |
| Web Dashboard | 預設掛在 `http://localhost:3000/dashboard`，提供終端對話、技能管理、人格市場、記憶搜尋、MCP 管理、系統設定與更新入口。 |
| 長期記憶 | 支援 `lancedb-pro` 向量記憶與原生記憶模式，並保留金字塔式摘要、日記 rotate、備份與還原流程。 |
| 技能系統 | `src/skills/` 內建核心技能，可透過 Dashboard 開關、匯入、匯出與重新注入。 |
| 多代理討論 | InteractiveMultiAgent 可召集多個角色進行圓桌討論，並產出共識摘要。 |
| 外部通道 | 支援 Telegram 與 Discord；Telegram 預設走 grammY bridge，並有 circuit breaker 保護輪詢。 |
| MCP 工具 | Dashboard 可新增、測試與檢視 stdio MCP server，供 Golem 擴充外部工具能力。 |
| 安全控管 | 支援遠端登入、`SYSTEM_OP_TOKEN`、API rate limit、指令白名單與危險命令防護。 |

## 介面預覽

<img src="assets/1.jpg" width="800" alt="Dashboard 首頁">
<img src="assets/3.jpg" width="800" alt="Web Terminal">
<img src="assets/4.jpg" width="800" alt="Skill Manager">
<img src="assets/8.jpg" width="800" alt="Memory Core">

## 快速開始

### 環境需求

- Node.js `>=20 <23`
- npm
- Chromium 或 Google Chrome
- 第一次使用 Web Gemini 時，需要可互動的瀏覽器畫面完成 Google 登入與授權
- Telegram/Discord token 為選填；只用 Web Dashboard 可以先不設定

### 一鍵模式

macOS / Linux 可直接使用啟動腳本：

```bash
chmod +x setup.sh
./setup.sh --magic
./setup.sh --start
```

也可以雙擊根目錄的 `Start-Golem.command`。Windows 使用者可用 `Start-Golem.bat`、`setup.bat`，或在 Git Bash 裡執行 `./setup.sh --magic`。

### 手動模式

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dashboard
```

啟動後開啟：

```text
http://localhost:3000/dashboard
```

如果只想跑主 runtime，也可以使用：

```bash
npm start
```

## 設定重點

`.env.example` 已收錄主要設定。第一次啟動時若根目錄沒有 `.env`，系統會自動從 `.env.example` 複製一份。

### Web Gemini 預設模式

```env
GOLEM_BACKEND=gemini
GOLEM_MEMORY_MODE=lancedb-pro
PLAYWRIGHT_STEALTH_ENABLED=true
ALLOW_REMOTE_ACCESS=false
```

第一次登入請不要開 headless：

```env
PLAYWRIGHT_HEADLESS=
```

等 Google session 寫入 `golem_memory/` 後，再視需求改成背景模式：

```env
PLAYWRIGHT_HEADLESS=true
```

### Ollama 本機模型

```env
GOLEM_BACKEND=ollama
GOLEM_OLLAMA_BASE_URL=http://127.0.0.1:11434
GOLEM_OLLAMA_BRAIN_MODEL=llama3.1:8b
GOLEM_EMBEDDING_PROVIDER=ollama
GOLEM_OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

### LM Studio

```env
GOLEM_BACKEND=lmstudio
GOLEM_LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
GOLEM_LMSTUDIO_BRAIN_MODEL=local-model
GOLEM_LMSTUDIO_API_KEY=
```

### Dashboard 與遠端存取

```env
ENABLE_WEB_DASHBOARD=true
DASHBOARD_PORT=3000
ALLOW_REMOTE_ACCESS=false
REMOTE_ACCESS_PASSWORD=
SYSTEM_OP_TOKEN=
```

若把 `ALLOW_REMOTE_ACCESS` 設為 `true`，請務必設定強密碼，並搭配防火牆、VPN 或反向代理權限控管。

### Telegram / Discord

```env
TELEGRAM_TOKEN=
TG_AUTH_MODE=ADMIN
ADMIN_ID=
TG_CHAT_ID=

DISCORD_TOKEN=
DISCORD_ADMIN_ID=
```

Token 取得方式請看 [如何獲取 TG 或 DC 的 Token 及開啟權限](docs/如何獲取TG或DC的Token及開啟權限.md)。

## 常用指令

### npm scripts

| 指令 | 說明 |
| --- | --- |
| `npm run dashboard` | 啟動 Golem runtime 與 Web Dashboard。 |
| `npm start` | 啟動核心 runtime。 |
| `npm run dev` | 使用 nodemon 啟動 Dashboard 模式。 |
| `npm run doctor` | 檢查 Node、npm、`.env`、依賴、Playwright Chromium 與 Dashboard port。 |
| `npm test` | 執行 Jest 測試。 |
| `npm run test:coverage` | 執行測試並輸出 coverage。 |
| `npm run test:security` | 執行安全相關測試。 |
| `npm run arch:check` | 檢查架構分層邊界。 |
| `npm run build` | 建置 `web-dashboard`。 |

### 對話指令

| 指令 | 說明 |
| --- | --- |
| `/help` | 查看可用指令。 |
| `/new` | 重開 Gemini 對話視窗並載入相關記憶。 |
| `/new_memory` | 清空底層記憶資料並重新開始。 |
| `/sos` | 清除 DOM 快取，讓 DOM Doctor 重新掃描頁面。 |
| `/model` | 操作 Web Gemini UI 切換模型。 |
| `/skills` | 列出已安裝技能。 |
| `/learn <功能>` | 讓 Golem 嘗試產生或學習新技能。 |

更多指令請看 [Golem 指令說明一覽表](docs/golem指令說明一覽表.md)。

## Docker / VPS

本專案提供 Docker Compose 與 noVNC/headless 相關設定。常用入口：

```bash
docker compose up -d --build
```

或使用 setup 腳本：

```bash
./setup.sh --deploy-docker
./setup.sh --deploy-linux
./setup.sh --headless-stop
```

詳細部署方式請看 [Docker 本機部署指南](docs/DOCKER-LOCAL.zh-TW.md) 與 [VPS Headless + VNC 指南](docs/VPS_VNC_Setup_Guide.md)。

## 專案結構

```text
project-golem-plus/
├── apps/
│   ├── runtime/              # 實際核心啟動入口
│   └── dashboard/            # Dashboard app/plugin layer
├── src/
│   ├── core/                 # GolemBrain、ConversationManager、ActionQueue 等核心流程
│   ├── managers/             # 記憶、技能、設定、日誌、自主行動等管理器
│   ├── bridges/              # Telegram / Discord bridge
│   ├── services/             # Ollama、LM Studio、DOM Doctor、Optic Nerve 等服務
│   ├── mcp/                  # MCP client/manager
│   └── skills/               # 核心技能與技能文件
├── web-dashboard/            # Next.js Dashboard
├── packages/                 # memory / protocol / security facade
├── infra/                    # 架構治理與部署相關資料
├── docs/                     # 使用、部署、架構與開發文件
├── assets/                   # README 與 Dashboard 截圖素材
├── index.js                  # 相容入口，轉交 apps/runtime
└── dashboard.js              # 相容入口，啟動 Dashboard server
```

新開發請優先參考 `apps/`、`src/`、`packages/` 的分層；提交前建議跑：

```bash
npm run arch:check
npm test
```

## 文件地圖

| 文件 | 用途 |
| --- | --- |
| [AI 編碼代理指南](docs/AGENTS.md) | 給開發者與 coding agent 的架構維護守則。 |
| [Web Dashboard 使用說明](docs/Web-Dashboard-使用說明.md) | Dashboard 頁面、API、設定與操作說明。 |
| [MCP 使用與開發指南](docs/MCP-使用與開發指南.md) | 新增與除錯 MCP server。 |
| [記憶系統架構說明](docs/記憶系統架構說明.md) | 長期記憶、摘要與資料路徑。 |
| [大型產品架構藍圖](docs/大型產品架構藍圖.md) | `apps + packages + infra` 分層與遷移策略。 |
| [架構治理規範](infra/architecture/README.md) | 架構邊界規則與檢查工具。 |
| [開發者實作指南](docs/開發者實作指南.md) | Skill 與 Golem Protocol 開發方式。 |
| [Docker 本機部署指南](docs/DOCKER-LOCAL.zh-TW.md) | Docker Compose 本機部署。 |
| [VPS Headless + VNC 指南](docs/VPS_VNC_Setup_Guide.md) | 無桌面 Linux / noVNC 部署。 |
| [貢獻指南](docs/CONTRIBUTING.zh-TW.md) | 貢獻流程與注意事項。 |

## 安全與隱私

- `golem_memory/` 可能包含 Google session、對話記憶與私人資料，請不要提交或公開。
- `.env` 可能包含 token、密碼與操作金鑰，請只提交 `.env.example`。
- 不建議以 root/admin 身份長期運行 Golem。
- 開放遠端 Dashboard 前，請先設定 `REMOTE_ACCESS_PASSWORD`、`SYSTEM_OP_TOKEN`，並使用可信網路邊界。
- Golem 可執行本地指令與自動化流程，請謹慎啟用 `GOLEM_AUTO_APPROVE_ALL`。

## 授權

本專案採用 [MIT License](LICENSE)。

## 社群與支持

如果 Project Golem 對你有幫助，歡迎 star 這個 repo，或請作者喝杯咖啡。

<a href="https://www.buymeacoffee.com/arvincreator" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50">
</a>

- [Line 社群：Project Golem AI 系統代理群](https://line.me/ti/g2/wqhJdXFKfarYxBTv34waWRpY_EXSfuYTbWc4OA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default)
- [Discord 社群：Project Golem 官方頻道](https://discord.gg/bC6jtFQra)

---

<div align="center">
  <strong>Developed by Arvincreator and contributors.</strong>
</div>
