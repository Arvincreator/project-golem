#!/bin/bash

# ==========================================================
# 🦞 Project Golem v8.6 - Mac/Linux 安裝精靈 (Titan Chronos)
# ==========================================================

# 定義顏色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}==========================================================${NC}"
echo -e "${CYAN}🦞 Project Golem v8.6 (Titan Chronos) - 全自動安裝精靈${NC}"
echo -e "${CYAN}==========================================================${NC}"
echo ""

# ------------------------------------------------------------
# 0. 檔案完整性檢查
# ------------------------------------------------------------
echo -e "[1/6] 正在檢查核心檔案完整性..."
# [v8.6 Update] 新增 dashboard.js 檢查
REQUIRED_FILES=("index.js" "skills.js" "package.json" "memory.html" "dashboard.js")
MISSING_FILES=()

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    MISSING_FILES+=("$file")
  fi
done

if [ ${#MISSING_FILES[@]} -ne 0 ]; then
  echo -e "${RED}❌ 錯誤：核心檔案遺失！${NC}"
  echo "遺失檔案: ${MISSING_FILES[*]}"
  exit 1
fi
echo -e "${GREEN}✅ 核心檔案檢查通過。${NC}"
echo ""

# ------------------------------------------------------------
# 1. 檢查 Node.js
# ------------------------------------------------------------
echo -e "[2/6] 正在檢查 Node.js 環境..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 找不到 Node.js！${NC}"
    echo -e "${YELLOW}請使用以下方式安裝 (建議 v18+)：${NC}"
    echo " - macOS: brew install node"
    echo " - Linux: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo " - 通用 (推薦): 使用 nvm (https://github.com/nvm-sh/nvm)"
    exit 1
fi
echo -e "${GREEN}✅ Node.js 已安裝 ($(node -v))。${NC}"
echo ""

# ------------------------------------------------------------
# 2. 設定環境變數 (.env)
# ------------------------------------------------------------
echo -e "[3/6] 正在設定環境變數 (.env)..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ 已從範本建立 .env 檔案。${NC}"
    else
        echo -e "${YELLOW}⚠️ 找不到 .env.example，跳過。${NC}"
    fi
else
    echo -e "${GREEN}✅ .env 已存在。${NC}"
fi
echo ""

# ------------------------------------------------------------
# 3. 安裝 NPM 依賴 (含 Dashboard)
# ------------------------------------------------------------
echo -e "[4/6] 正在安裝核心依賴..."
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ NPM 安裝失敗。請檢查網路連線。${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 正在加裝 Dashboard (戰術控制台) 擴充套件...${NC}"
npm install blessed blessed-contrib
if [ $? -ne 0 ]; then
    echo -e "${RED}⚠️ Dashboard 套件安裝失敗 (非致命錯誤)，您可能無法使用圖形介面。${NC}"
else
    echo -e "${GREEN}✅ Dashboard 套件安裝完成。${NC}"
fi
echo ""

# ------------------------------------------------------------
# 4. 選擇記憶引擎
# ------------------------------------------------------------
echo -e "[5/6] 請選擇 Golem 的記憶引擎模式："
echo "=========================================================="
echo " [1] 🌐 瀏覽器模式 (預設) - 適合新手，v8.6 Chronos 原生支援。"
echo " [2] 🚀 系統模式 (qmd)   - 高效能，需安裝 Bun/qmd。"
echo -e "${YELLOW}     (⚠️ 注意：QMD 模式不支援 v8.6 排程與隊列持久化功能)${NC}"
echo "=========================================================="
echo ""

read -p "👉 請輸入選項 [1 或 2] (預設 1): " MODE

# 輔助函式：修改 .env
update_env() {
    local key="GOLEM_MEMORY_MODE"
    local value="$1"
    if grep -q "^$key=" .env; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
             sed -i '' "s/^$key=.*/$key=$value/" .env
        else
             sed -i "s/^$key=.*/$key=$value/" .env
        fi
    else
        echo "$key=$value" >> .env
    fi
}

if [ "$MODE" == "2" ]; then
    echo ""
    echo -e "${CYAN}⚙️ 配置為：系統模式 (qmd)...${NC}"
    
    if ! command -v bun &> /dev/null; then
        echo -e "${YELLOW}📦 正在自動安裝 Bun...${NC}"
        curl -fsSL https://bun.sh/install | bash
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
    fi

    echo -e "${YELLOW}📦 正在安裝 qmd...${NC}"
    bun install -g https://github.com/tobi/qmd
    update_env "qmd"
else
    echo ""
    echo -e "${CYAN}⚙️ 配置為：瀏覽器模式 (Native Chronos Ready)...${NC}"
    update_env "browser"
fi
echo ""

# ------------------------------------------------------------
# 5b. 選擇 AI 模型
# ------------------------------------------------------------
echo -e "[6/7] 請選擇 AI 大腦核心 (Brain Core)："
echo "=========================================================="
echo " [1] 💎 Google Gemini (預設) - 穩定、免費額度高、支援視覺 (OpticNerve)。"
echo " [2] 🤖 OpenAI ChatGPT     - 強大、邏輯清晰。"
echo "=========================================================="
echo ""

# 讀取使用者輸入，若無輸入則預設為 1
read -p "👉 請輸入選項 [1 或 2] (預設 1): " MODEL_OPT
MODEL_OPT=${MODEL_OPT:-1}

# 輔助函式：修改(或新增) AI_MODEL
update_model() {
    local key="GOLEM_AI_MODEL"
    local value="$1"
    # 檢查 .env 是否已有此 Key
    if grep -q "^$key=" .env; then
        # 根據 OS 類型執行 sed
        if [[ "$OSTYPE" == "darwin"* ]]; then
             sed -i '' "s/^$key=.*/$key=$value/" .env
        else
             sed -i "s/^$key=.*/$key=$value/" .env
        fi
    else
        # 若無則追加
        echo "$key=$value" >> .env
    fi
}

if [ "$MODEL_OPT" == "2" ]; then
    echo -e "${CYAN}🧠 設定核心為：OpenAI ChatGPT${NC}"
    update_model "openai"
else
    echo -e "${CYAN}🧠 設定核心為：Google Gemini${NC}"
    update_model "gemini"
fi
echo ""

# ------------------------------------------------------------
# 6. 自動修補檢測 (Auto-Patch)
# ------------------------------------------------------------
echo -e "[7/7] 正在檢查自動修補腳本 (patch.js)..."

if [ -f "patch.js" ]; then
    echo -e "${YELLOW}🔧 偵測到 patch.js，正在執行修補程序...${NC}"
    echo "----------------------------------------------------------"
    node patch.js
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ 自動修補執行完畢！${NC}"
        echo -e "${YELLOW}📝 (若需保留補丁紀錄，patch.js 檔案將保留在目錄中)${NC}"
    else
        echo -e "${RED}❌ 修補執行失敗，請檢查上方錯誤訊息。${NC}"
    fi
else
    echo -e "${GREEN}🆗 無須修補 (未偵測到 patch.js)。${NC}"
fi

echo ""
echo -e "${GREEN}==========================================================${NC}"
echo -e "${GREEN}🎉 安裝完成！(v8.6 Titan Chronos Edition)${NC}"
echo -e "🚀 啟動命令："
echo -e "   - 標準模式: ${YELLOW}npm start${NC}"
echo -e "   - 戰術面板: ${YELLOW}npm start dashboard${NC} (推薦：可監控排程與隊列)"
echo -e "   - 🌐 Web UI: ${YELLOW}http://localhost:3000${NC} (啟動 Dashboard 後可用)"
echo -e "${GREEN}==========================================================${NC}"
