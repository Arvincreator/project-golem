# 🤖 Project Golem: 編碼代理指南 (AI Agent Coding Instructions)

> 本文件旨在供 AI 編碼代理（如您）了解如何高效維護與演進此倉庫。請利用此背景資訊避免常見陷阱，並遵循既有的架構模式。

---

## 🏗️ 核心架構模式: "Browser-in-the-Loop"

- **入口點**: `src/index.js` 或 `src/main.js`。
- **LLM 控制**: 除非明確要求，否則**不得**將 `GolemBrain` 改寫為官方 REST API。Golem 的核心價值在於透過 Puppeteer 操控瀏覽器以存取 Web Gemini。
- **狀態管理**: 大部分狀態保存在 `ConversationManager` 中。跨平台邏輯抽象於 `UniversalContext`。

## 🧠 記憶協定: "Pyramid Memory" (金字塔記憶)

- **儲存路徑**: `golem_memory/` (包含敏感內容，請謹慎處理)。
- **壓縮邏輯**: 記憶分為 5 層壓縮（每小時 -> 每日 -> 每月 -> 每年 -> 紀元）。
- **修改記憶時**: 確保保留 `src/memory/` 中的壓縮邏輯，以維持「50 年保存」的承諾。

## 🛠️ 技能開發 (Skill Capsules)

- **熱載入**: 技能從 `src/skills/` 載入，應為獨立模組。
- **協定**: 所有 AI 回應必須遵循 `GOLEM_PROTOCOL`（Markdown 內的 JSON 結構），以便 `NeuroShunter` 解析動作。

## 🚀 環境與設定

- **指令**: 
  - 安裝: `./setup.sh --magic`
  - 啟動: `./setup.sh --start`
- **Node 版本**: v20+
- **樣式**: Vanilla CSS (原生 CSS)。

## 🔒 安全與隱私

- **資料隱私**: 避免自動發佈 `golem_memory/` 內的任何檔案。
- **系統存取**: AI 可執行本地腳本；請確保新的本地執行技能具備安全防護。

---
*最後更新: 2026-03-16*
