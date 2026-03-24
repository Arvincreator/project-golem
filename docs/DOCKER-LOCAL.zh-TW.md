# 本地 Linux Docker 部署指南 (Ubuntu/Debian/CentOS)

本文件說明如何在本地 Linux 機器（如您的個人電腦、工作站或伺服器）上，透過 Docker 快速部署 Project-Golem。

## 環境要求

- **作業系統**：Ubuntu 20.04+ (推薦 24.04)、Debian 11+、CentOS 9+ 或其他支援 Docker 的 Linux 發行版。
- **硬體需求**：
  - CPU: 2 核心以上
  - RAM: 4GB 以上 (推薦 8GB+，因 Chromium 較耗記憶體)
  - 磁碟空間: 10GB 以上
- **軟體**：已安裝 Docker 與 Docker Compose。

## 快速啟動步驟

### 1. 複製專案與準備環境

```bash
# 複製專案
git clone https://github.com/Arvincreator/project-golem.git
cd project-golem

# 建立必要的資料夾
mkdir -p golem_memory logs

# 確保目錄權限 (與 Docker 內的 ubuntu 使用者 UID 1000 匹配)
# 如果您的目前使用者 UID 就是 1000 (通常 Linux 第一個使用者都是)，則無需更動
sudo chown -R 1000:1000 golem_memory logs
```

### 2. 配置環境變數

建立 `.env` 檔案：

```bash
cp .env.example .env
# 編輯 .env 填入您的 Telegram Token 與 Gemini API Key
nano .env
```

### 3. 使用優化腳本重構與啟動

我們提供了優化過的重構腳本，它會自動處理 `package-lock.json` 並確保使用最新的 `playwright:v1.50.0-noble` 映像檔（內建 GLIBC 2.39）：

```bash
# 執行重構與構建
./scripts/rebuild-docker.sh

# 啟動容器
docker compose up -d
```

### 4. 驗證運行狀態

```bash
# 查看容器狀態
docker ps

# 查看即時日誌
docker logs -f golem-core
```

訪問瀏覽器：`http://localhost:3000/dashboard`

---

## 常見問題 (FAQ)

### Q: 遇到 `GLIBC_2.38 not found` 錯誤？
**A**: 請確保您使用的是最新的 `Dockerfile`。我們已將基礎映像檔更換為 `mcr.microsoft.com/playwright:v1.50.0-noble`，它內建了 GLIBC 2.39，能解決舊版 `node:slim` 映像檔與新版原生模組不相容的問題。

### Q: 遇到 `SQLITE_READONLY` 權限錯誤？
**A**: 這是因為 Docker 內的執行使用者 (UID 1000) 對掛載的 `golem_memory` 目錄沒有寫入權限。請在主機執行：
`sudo chown -R 1000:1000 golem_memory logs`

### Q: 如何更新到最新版本？
**A**:
```bash
git pull
./scripts/rebuild-docker.sh
docker compose up -d
```

---

## 為什麼使用 Playwright Noble 映像檔？
1. **內建依賴**：無需在 Dockerfile 手動安裝數十個系統庫。
2. **最新 GLIBC**：基於 Ubuntu 24.04，解決所有 Node.js 原生模組的相容性問題。
3. **高效能**：官方優化的瀏覽器運行環境。
