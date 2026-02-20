#!/bin/bash

# ==========================================
# Project Golem v9.0 (Titan Chronos) - Linux/macOS
# Enhanced Setup Script with Premium UI/UX
# ==========================================

# Note: We intentionally avoid 'set -euo pipefail' here because
# this script sources .env files, uses optional commands (lsof, tput),
# and needs graceful fallback behavior throughout.

# ─── Graceful Exit Trap ──────────────────────────────────
cleanup() {
    tput cnorm 2>/dev/null  # 恢復游標
    echo ""
    echo -e "${YELLOW}⚡ 收到中斷信號，正在安全退出...${NC}"
    # Kill background spinner if any
    if [ -n "${SPINNER_PID:-}" ] && kill -0 "$SPINNER_PID" 2>/dev/null; then
        kill "$SPINNER_PID" 2>/dev/null
        wait "$SPINNER_PID" 2>/dev/null
    fi
    # Kill Host Chrome if started by us
    if [ -n "${HOST_CHROME_PID:-}" ] && kill -0 "$HOST_CHROME_PID" 2>/dev/null; then
        echo -e "${YELLOW}🧹 Closing Host Chrome (PID: $HOST_CHROME_PID)...${NC}"
        kill "$HOST_CHROME_PID" 2>/dev/null
    fi
    echo -e "${GREEN}👋 已安全退出。感謝使用 Project Golem！${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ─── Color & Style Constants ────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
UNDERLINE='\033[4m'
NC='\033[0m' # No Color

# Disable colors in non-interactive / CI environments
if [[ "${NO_COLOR:-}" == "1" ]] || [[ ! -t 1 ]]; then
    RED='' GREEN='' YELLOW='' CYAN='' BLUE='' MAGENTA=''
    BOLD='' DIM='' UNDERLINE='' NC=''
fi

# ─── Path Constants ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOT_ENV_PATH="$SCRIPT_DIR/.env"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/setup.log"
GOLEM_VERSION="9.0.0"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# ─── Logging ────────────────────────────────────────────
log() {
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $*" >> "$LOG_FILE"
}

log "===== Setup script started ====="

# ─── .env Update Utility ────────────────────────────────
update_env() {
    local key=$1
    local val=$2
    val=$(echo "$val" | sed -e 's/[\/&]/\\&/g')

    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^$key=.*|$key=$val|" "$DOT_ENV_PATH"
    else
        sed -i "s|^$key=.*|$key=$val|" "$DOT_ENV_PATH"
    fi
    log "Updated env: $key"
}

# ═══════════════════════════════════════════════════════
#  UI UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════

# ─── Spinner Animation ──────────────────────────────────
SPINNER_PID=""
spinner_start() {
    local msg="${1:-處理中}"
    local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
    tput civis 2>/dev/null  # 隱藏游標
    (
        local i=0
        while true; do
            printf "\r  ${CYAN}${frames[$((i % ${#frames[@]}))]}${NC} ${msg}...  "
            i=$((i + 1))
            sleep 0.1
        done
    ) &
    SPINNER_PID=$!
}

spinner_stop() {
    local success=${1:-true}
    if [ -n "${SPINNER_PID:-}" ] && kill -0 "$SPINNER_PID" 2>/dev/null; then
        kill "$SPINNER_PID" 2>/dev/null
        wait "$SPINNER_PID" 2>/dev/null || true
    fi
    SPINNER_PID=""
    tput cnorm 2>/dev/null  # 恢復游標
    if [ "$success" = true ]; then
        printf "\r  ${GREEN}✔${NC} 完成                              \n"
    else
        printf "\r  ${RED}✖${NC} 失敗                              \n"
    fi
}

# ─── Progress Bar ────────────────────────────────────────
progress_bar() {
    local current=$1
    local total=$2
    local label="${3:-}"
    local width=30
    local filled=$((current * width / total))
    local empty=$((width - filled))
    local bar=""

    for ((i = 0; i < filled; i++)); do bar+="█"; done
    for ((i = 0; i < empty; i++)); do bar+="░"; done

    printf "\r  ${CYAN}[${bar}]${NC} ${BOLD}${current}/${total}${NC} ${DIM}${label}${NC}  "
}

# ─── Elapsed Timer ──────────────────────────────────────
timer_start() { TIMER_START=$(date +%s); }

timer_elapsed() {
    local end=$(date +%s)
    local diff=$((end - TIMER_START))
    if [ $diff -ge 60 ]; then
        echo "$((diff / 60))m $((diff % 60))s"
    else
        echo "${diff}s"
    fi
}

# ─── Mask Sensitive Value ────────────────────────────────
mask_value() {
    local val="$1"
    if [ -z "$val" ] || [ "$val" = "無" ]; then
        echo "${DIM}(未設定)${NC}"
        return
    fi
    local len=${#val}
    if [ $len -le 8 ]; then
        echo "****${val: -4}"
    else
        echo "****${val: -6}"
    fi
}

# ─── Confirm Prompt ─────────────────────────────────────
confirm_action() {
    local msg="${1:-確認執行?}"
    echo -e -n " ${YELLOW}⚠ ${msg} [y/N]:${NC} "
    read -r confirm
    [[ "$confirm" =~ ^[Yy]$ ]]
}

# ─── Box Drawing Helpers ────────────────────────────────
box_top()    { echo -e "${CYAN}┌─────────────────────────────────────────────────────────┐${NC}"; }
box_bottom() { echo -e "${CYAN}└─────────────────────────────────────────────────────────┘${NC}"; }
box_sep()    { echo -e "${CYAN}├─────────────────────────────────────────────────────────┤${NC}"; }
box_line()   { printf "${CYAN}│${NC} %-56s${CYAN}│${NC}\n" "$1"; }
box_line_colored() {
    # 接受含顏色碼的文字，需手動補空格
    printf "${CYAN}│${NC} %b${CYAN}│${NC}\n" "$1"
}

# ═══════════════════════════════════════════════════════
#  STATUS & HEALTH CHECK
# ═══════════════════════════════════════════════════════

check_status() {
    # Node Version
    NODE_VER=$(node -v 2>/dev/null || echo "N/A")
    if [[ "$NODE_VER" == v18* ]] || [[ "$NODE_VER" == v2* ]]; then
        STATUS_NODE="${GREEN}✅ $NODE_VER${NC}"
        NODE_OK=true
    else
        STATUS_NODE="${RED}❌ $NODE_VER (需 v18+)${NC}"
        NODE_OK=false
    fi

    # .env
    if [ -f "$DOT_ENV_PATH" ]; then
        STATUS_ENV="${GREEN}✅ 已設定${NC}"
        ENV_OK=true
    else
        STATUS_ENV="${RED}❌ 未找到${NC}"
        ENV_OK=false
    fi

    # Web Dashboard
    IsDashEnabled=false
    if grep -q "ENABLE_WEB_DASHBOARD=true" "$DOT_ENV_PATH" 2>/dev/null; then
        STATUS_DASH="${GREEN}✅ 啟用${NC}"
        IsDashEnabled=true
    else
        STATUS_DASH="${YELLOW}⏸️  停用${NC}"
    fi

    # API Keys configured?
    KEYS_SET=false
    if [ -f "$DOT_ENV_PATH" ]; then
        source "$DOT_ENV_PATH" 2>/dev/null || true
        if [ -n "${GEMINI_API_KEYS:-}" ] && [ "$GEMINI_API_KEYS" != "你的Key1,你的Key2,你的Key3" ]; then
            KEYS_SET=true
        fi
    fi

    # Port 3000 status
    PORT_3000_STATUS="${DIM}未檢查${NC}"
    if command -v lsof &>/dev/null; then
        if lsof -i :3000 &>/dev/null; then
            PORT_3000_STATUS="${GREEN}● 使用中${NC}"
        else
            PORT_3000_STATUS="${DIM}○ 閒置${NC}"
        fi
    fi

    # OS Info
    OS_INFO="$OSTYPE"
    ARCH_INFO=$(uname -m 2>/dev/null || echo "unknown")

    # npm available?
    NPM_VER=$(npm -v 2>/dev/null || echo "N/A")

    # Disk space
    DISK_AVAIL=$(df -h "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2{print $4}' || echo "N/A")

    # Docker Status
    if command -v docker &>/dev/null; then
        DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
        STATUS_DOCKER="${GREEN}✅ $DOCKER_VER${NC}"
        DOCKER_OK=true
    else
        STATUS_DOCKER="${RED}❌ 未安裝${NC}"
        DOCKER_OK=false
    fi

    if docker compose version &>/dev/null; then
        COMPOSE_VER="Yes"
        STATUS_COMPOSE="${GREEN}✅ 支援${NC}"
        COMPOSE_OK=true
    else
        STATUS_COMPOSE="${RED}❌ 不支援${NC}"
        COMPOSE_OK=false
    fi
}

# ─── Health Check (Pre-launch) ──────────────────────────
run_health_check() {
    echo ""
    box_top
    box_line "🏥 系統健康檢查 (Pre-Launch Health Check)"
    box_sep

    local all_pass=true

    # 1. Node.js
    if [ "$NODE_OK" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  Node.js          ${GREEN}$NODE_VER${NC}                        "
    else
        box_line_colored "  ${RED}✖${NC}  Node.js          ${RED}$NODE_VER (需 v18+)${NC}                "
        all_pass=false
    fi

    # 2. .env exists
    if [ "$ENV_OK" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  環境設定 (.env)  ${GREEN}已找到${NC}                           "
    else
        box_line_colored "  ${RED}✖${NC}  環境設定 (.env)  ${RED}未找到${NC}                           "
        all_pass=false
    fi

    # 3. API Keys
    if [ "$KEYS_SET" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  Gemini API Keys  ${GREEN}已設定${NC}                           "
    else
        box_line_colored "  ${YELLOW}△${NC}  Gemini API Keys  ${YELLOW}使用預設值 (請先設定)${NC}           "
    fi

    # 4. Core files
    local core_ok=true
    for file in index.js skills.js package.json dashboard.js; do
        if [ ! -f "$SCRIPT_DIR/$file" ]; then
            core_ok=false
            break
        fi
    done
    if [ "$core_ok" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  核心檔案         ${GREEN}完整${NC}                             "
    else
        box_line_colored "  ${RED}✖${NC}  核心檔案         ${RED}不完整${NC}                           "
        all_pass=false
    fi

    # 5. node_modules
    if [ -d "$SCRIPT_DIR/node_modules" ]; then
        box_line_colored "  ${GREEN}✔${NC}  依賴套件         ${GREEN}已安裝${NC}                           "
    else
        box_line_colored "  ${RED}✖${NC}  依賴套件         ${RED}未安裝 (請執行安裝)${NC}               "
        all_pass=false
    fi

    # 6. Dashboard
    if [ "$IsDashEnabled" = true ]; then
        if [ -d "$SCRIPT_DIR/web-dashboard/out" ] || [ -d "$SCRIPT_DIR/web-dashboard/node_modules" ]; then
            box_line_colored "  ${GREEN}✔${NC}  Web Dashboard    ${GREEN}已就緒${NC}                           "
        else
            box_line_colored "  ${YELLOW}△${NC}  Web Dashboard    ${YELLOW}已啟用但未建置${NC}                   "
        fi
    else
        box_line_colored "  ${DIM}─${NC}  Web Dashboard    ${DIM}已停用${NC}                             "
    fi

    # 7. Docker (Optional but recommended for Docker mode)
    if [ "$DOCKER_OK" = true ] && [ "$COMPOSE_OK" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  Docker 環境      ${GREEN}已就緒${NC}                           "
    else
        box_line_colored "  ${DIM}△${NC}  Docker 環境      ${DIM}未完整支援 (僅影響 Docker 模式)${NC}    "
    fi

    box_sep
    if [ "$all_pass" = true ]; then
        box_line_colored "  ${GREEN}${BOLD}✅ 系統就緒，可以啟動！${NC}                                "
    else
        box_line_colored "  ${RED}${BOLD}⚠️  部分檢查未通過，建議先修復再啟動${NC}                  "
    fi
    box_bottom
    echo ""

    return 0
}

# ═══════════════════════════════════════════════════════
#  HEADER & MENU
# ═══════════════════════════════════════════════════════

show_header() {
    check_status
    clear
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🤖 Project Golem v${GOLEM_VERSION}${NC} ${DIM}(Titan Chronos)${NC}              "
    box_line_colored "  ${DIM}Master Control Panel${NC}                                  "
    box_sep
    box_line_colored "  ${BOLD}📊 系統狀態${NC}                                          "
    box_line_colored "  Node.js: $STATUS_NODE   npm: ${DIM}v$NPM_VER${NC}               "
    box_line_colored "  Config:  $STATUS_ENV   Dashboard: $STATUS_DASH            "
    box_line_colored "  OS: ${DIM}$OS_INFO ($ARCH_INFO)${NC}    磁碟: ${DIM}${DISK_AVAIL} 可用${NC}     "
    box_line_colored "  Docker: $STATUS_DOCKER  Compose: $STATUS_COMPOSE              "
    box_line_colored "  Port 3000: $PORT_3000_STATUS                                       "
    box_bottom
    echo ""
}

show_menu() {
    show_header

    echo -e "  ${BOLD}${YELLOW}⚡ 快速啟動${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[0]${NC}  🚀 啟動系統 ${DIM}(使用目前配置)${NC}"
    echo ""

    echo -e "  ${BOLD}${YELLOW}🛠️  安裝與維護${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[1]${NC}  📦 完整安裝 ${DIM}(Full Setup: 檢查+配置+安裝+建置)${NC}"
    echo -e "   ${BOLD}[2]${NC}  ⚙️  配置精靈 ${DIM}(設定 API Keys / Tokens)${NC}"
    echo -e "   ${BOLD}[3]${NC}  📥 安裝依賴 ${DIM}(npm install + Dashboard)${NC}"
    echo -e "   ${BOLD}[4]${NC}  🌐 重建 Dashboard ${DIM}(重新安裝/建置 Web UI)${NC}"
    echo ""
    echo -e "  ${BOLD}${YELLOW}🐳 Docker 容器化${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[5]${NC}  🚀 Docker 啟動 ${DIM}(Build & Up, 支援外部瀏覽器)${NC}"
    echo -e "   ${BOLD}[6]${NC}  🧹 清除 Docker ${DIM}(Down & Prune)${NC}"
    echo ""

    echo -e "  ${BOLD}${YELLOW}🔧 工具${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[S]${NC}  🏥 系統健康檢查"
    echo -e "   ${BOLD}[D]${NC}  🔄 切換 Dashboard ${DIM}(Toggle On/Off)${NC}"
    echo -e "   ${BOLD}[L]${NC}  📋 查看安裝日誌"
    echo ""

    echo -e "   ${BOLD}[Q]${NC}  🚪 退出"
    echo ""

    read -p "  👉 請輸入選項: " choice
    echo ""

    case $choice in
        0) launch_system ;;
        1) run_full_install ;;
        2) step_check_env; config_wizard; show_menu ;;
        3) step_install_core; step_install_dashboard; echo -e "\n  ${GREEN}✅ 依賴與 Dashboard 安裝完成。${NC}"; read -p "  按 Enter 返回主選單..." ; show_menu ;;
        4) step_install_dashboard; echo -e "\n  ${GREEN}✅ Dashboard 安裝/重建完成。${NC}"; read -p "  按 Enter 返回主選單..." ; show_menu ;;
        5) launch_docker ;;
        6) clean_docker ;;
        [Ss]) check_status; run_health_check; read -p "  按 Enter 返回主選單..."; show_menu ;;
        [Dd]) toggle_dashboard ;;
        [Ll]) view_logs ;;
        [Qq]) echo -e "  ${GREEN}👋 再見！${NC}"; exit 0 ;;
        *) echo -e "  ${RED}❌ 無效選項「$choice」${NC}"; sleep 1; show_menu ;;
    esac
}

# ═══════════════════════════════════════════════════════
#  FULL INSTALL FLOW
# ═══════════════════════════════════════════════════════

run_full_install() {
    timer_start
    local total_steps=7
    log "Full install started"

    echo -e "  ${BOLD}${CYAN}📦 開始完整安裝流程${NC}"
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Step 1: Check files
    progress_bar 1 $total_steps "檢查核心檔案"
    echo ""
    step_check_files

    # Step 2: Check env
    progress_bar 2 $total_steps "檢查環境設定"
    echo ""
    step_check_env

    # Step 3: Config wizard
    progress_bar 3 $total_steps "配置精靈"
    echo ""
    config_wizard

    # Step 4: Install core deps
    progress_bar 4 $total_steps "安裝核心依賴"
    echo ""
    step_install_core

    # Step 5: Install dashboard
    progress_bar 5 $total_steps "安裝 Dashboard"
    echo ""
    step_install_dashboard

    # Step 6: Health check
    progress_bar 6 $total_steps "健康檢查"
    echo ""
    check_status
    run_health_check

    # Step 7: Done
    progress_bar 7 $total_steps "完成"
    echo ""

    local elapsed
    elapsed=$(timer_elapsed)
    log "Full install completed in $elapsed"
    step_final "$elapsed"
}

# ═══════════════════════════════════════════════════════
#  STEP 1: FILE INTEGRITY CHECK
# ═══════════════════════════════════════════════════════

step_check_files() {
    echo -e "  ${BOLD}[Step 1/7]${NC} 🔍 檢查核心檔案完整性..."
    log "Checking core files"

    local missing=0
    local checked=0
    local files=(index.js skills.js package.json dashboard.js memory.html)

    for file in "${files[@]}"; do
        checked=$((checked + 1))
        if [ ! -f "$SCRIPT_DIR/$file" ]; then
            echo -e "    ${RED}✖${NC} 缺失: ${BOLD}$file${NC}"
            missing=1
            log "MISSING: $file"
        else
            echo -e "    ${GREEN}✔${NC} $file"
        fi
    done

    if [ $missing -eq 1 ]; then
        echo ""
        echo -e "  ${RED}${BOLD}❌ 嚴重錯誤：核心檔案不完整！${NC}"
        echo -e "  ${RED}   請確認已正確解壓縮 V9.0 zip 檔到此目錄。${NC}"
        echo -e "  ${DIM}   目前目錄: $SCRIPT_DIR${NC}"
        log "FATAL: Core files missing"
        exit 1
    fi
    echo -e "  ${GREEN}  ✅ 檔案完整性檢查通過 (${checked}/${#files[@]})${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════
#  STEP 2: ENV FILE CHECK
# ═══════════════════════════════════════════════════════

step_check_env() {
    echo -e "  ${BOLD}[Step 2/7]${NC} 📄 檢查環境設定檔..."
    log "Checking .env"

    if [ ! -f "$DOT_ENV_PATH" ]; then
        if [ -f "$SCRIPT_DIR/.env.example" ]; then
            cp "$SCRIPT_DIR/.env.example" "$DOT_ENV_PATH"
            echo -e "    ${YELLOW}ℹ${NC}  已從範本 ${BOLD}.env.example${NC} 建立 ${BOLD}.env${NC}"
            log "Created .env from example"
        else
            echo -e "    ${YELLOW}ℹ${NC}  找不到 .env.example，將建立基本 .env 檔案"
            # Create a basic .env file with sensible defaults
            cat > "$DOT_ENV_PATH" << 'ENVEOF'
GEMINI_API_KEYS=
TELEGRAM_TOKEN=
ADMIN_ID=
DISCORD_TOKEN=
DISCORD_ADMIN_ID=
USER_DATA_DIR=./golem_memory
GOLEM_TEST_MODE=false
DASHBOARD_PORT=3000
GOLEM_MEMORY_MODE=browser
GITHUB_REPO=
ENABLE_WEB_DASHBOARD=true
ENVEOF
            echo -e "    ${GREEN}✔${NC}  已建立基本 .env 設定檔"
            log "Created basic .env"
        fi
    else
        echo -e "    ${GREEN}✔${NC}  .env 檔案已存在"
    fi
    echo ""
}

# ═══════════════════════════════════════════════════════
#  STEP 3: CONFIG WIZARD (Enhanced)
# ═══════════════════════════════════════════════════════

config_wizard() {
    clear
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🧙 環境變數配置精靈${NC}                                  "
    box_line_colored "  ${DIM}設定 API Keys、Bot Tokens 與系統選項${NC}                  "
    box_sep
    box_line_colored "  ${DIM}提示: 直接按 Enter 保留目前值 │ 輸入 [B] 返回上一步${NC}   "
    box_bottom
    echo ""

    # 讀取現有值
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null

    local step=1
    local total=6

    while [ $step -le $total ]; do
        case $step in
            1)
                # --- Gemini API Keys ---
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Google Gemini API Keys${NC}"
                echo -e "  ${DIM}取得: https://aistudio.google.com/app/apikey${NC}"
                echo -e "  ${DIM}支援多組 Key 用半形逗號分隔${NC}"
                local masked_gemini
                masked_gemini=$(mask_value "${GEMINI_API_KEYS:-}")
                echo -e "  目前: ${CYAN}${masked_gemini}${NC}"
                read -p "  👉 輸入新 Keys (留空保留): " input
                if [ -n "$input" ]; then
                    update_env "GEMINI_API_KEYS" "$input"
                    GEMINI_API_KEYS="$input"
                    echo -e "  ${GREEN}✔ 已更新${NC}"
                fi
                echo ""
                step=$((step + 1))
                ;;
            2)
                # --- Telegram Bot Token ---
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Telegram Bot Token${NC}"
                echo -e "  ${DIM}取得: 在 Telegram 搜尋 @BotFather 申請${NC}"
                local masked_tg
                masked_tg=$(mask_value "${TELEGRAM_TOKEN:-}")
                echo -e "  目前: ${CYAN}${masked_tg}${NC}"
                read -p "  👉 輸入新 Token (留空保留): " input
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then
                    update_env "TELEGRAM_TOKEN" "$input"
                    TELEGRAM_TOKEN="$input"
                    echo -e "  ${GREEN}✔ 已更新${NC}"
                fi
                echo ""
                step=$((step + 1))
                ;;
            3)
                # --- Telegram Admin ID ---
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Telegram Admin User ID${NC}"
                echo -e "  ${DIM}取得: 在 Telegram 搜尋 @userinfobot，查看 ID 欄位${NC}"
                echo -e "  目前: ${CYAN}${ADMIN_ID:-${DIM}(未設定)${NC}}${NC}"
                read -p "  👉 輸入新 ID (留空保留): " input
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then
                    # 數字驗證
                    if [[ "$input" =~ ^[0-9]+$ ]]; then
                        update_env "ADMIN_ID" "$input"
                        ADMIN_ID="$input"
                        echo -e "  ${GREEN}✔ 已更新${NC}"
                    else
                        echo -e "  ${RED}✖ Admin ID 必須為純數字，請重新輸入${NC}"
                        continue
                    fi
                fi
                echo ""
                step=$((step + 1))
                ;;
            4)
                # --- Discord Bot Token ---
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Discord Bot Token${NC}"
                echo -e "  ${DIM}取得: Discord Developer Portal → Bot → Reset Token${NC}"
                echo -e "  ${DIM}注意: 請確保已開啟 Message Content Intent${NC}"
                local masked_dc
                masked_dc=$(mask_value "${DISCORD_TOKEN:-}")
                echo -e "  目前: ${CYAN}${masked_dc}${NC}"
                read -p "  👉 輸入新 Token (留空保留): " input
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then
                    update_env "DISCORD_TOKEN" "$input"
                    DISCORD_TOKEN="$input"
                    echo -e "  ${GREEN}✔ 已更新${NC}"
                fi
                echo ""
                step=$((step + 1))
                ;;
            5)
                # --- Discord Admin ID ---
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Discord Admin User ID${NC}"
                echo -e "  ${DIM}取得: Discord 設定 → 進階 → 開發者模式 → 右鍵複製 ID${NC}"
                echo -e "  目前: ${CYAN}${DISCORD_ADMIN_ID:-${DIM}(未設定)${NC}}${NC}"
                read -p "  👉 輸入新 ID (留空保留): " input
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then
                    if [[ "$input" =~ ^[0-9]+$ ]]; then
                        update_env "DISCORD_ADMIN_ID" "$input"
                        DISCORD_ADMIN_ID="$input"
                        echo -e "  ${GREEN}✔ 已更新${NC}"
                    else
                        echo -e "  ${RED}✖ Admin ID 必須為純數字，請重新輸入${NC}"
                        continue
                    fi
                fi
                echo ""
                step=$((step + 1))
                ;;
            6)
                # --- Web Dashboard ---
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Web Dashboard${NC}"
                echo -e "  目前: ${CYAN}${ENABLE_WEB_DASHBOARD:-false}${NC}"
                read -p "  👉 啟用 Web Dashboard? [Y/n/B] (留空保留): " input
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [[ "$input" =~ ^[Yy]$ ]]; then
                    update_env "ENABLE_WEB_DASHBOARD" "true"
                    ENABLE_WEB_DASHBOARD="true"
                    echo -e "  ${GREEN}✔ 已啟用${NC}"
                elif [[ "$input" =~ ^[Nn]$ ]]; then
                    update_env "ENABLE_WEB_DASHBOARD" "false"
                    ENABLE_WEB_DASHBOARD="false"
                    echo -e "  ${YELLOW}⏸️  已停用${NC}"
                fi
                echo ""
                step=$((step + 1))
                ;;
        esac
    done

    # ─── Summary Confirmation ────────────────────────────
    echo ""
    box_top
    box_line_colored "  ${BOLD}📋 配置摘要${NC}                                            "
    box_sep
    local mg; mg=$(mask_value "${GEMINI_API_KEYS:-}")
    local mt; mt=$(mask_value "${TELEGRAM_TOKEN:-}")
    local md; md=$(mask_value "${DISCORD_TOKEN:-}")
    box_line_colored "  Gemini Keys:    ${CYAN}${mg}${NC}                                "
    box_line_colored "  TG Token:       ${CYAN}${mt}${NC}                                "
    box_line_colored "  TG Admin ID:    ${CYAN}${ADMIN_ID:-未設定}${NC}                              "
    box_line_colored "  DC Token:       ${CYAN}${md}${NC}                                "
    box_line_colored "  DC Admin ID:    ${CYAN}${DISCORD_ADMIN_ID:-未設定}${NC}                              "
    box_line_colored "  Dashboard:      ${CYAN}${ENABLE_WEB_DASHBOARD:-false}${NC}                            "
    box_sep
    box_line_colored "  ${GREEN}${BOLD}✅ 配置已儲存到 .env${NC}                                  "
    box_bottom
    echo ""
    log "Config wizard completed"
    sleep 1
}

# ═══════════════════════════════════════════════════════
#  STEP 4: CORE DEPENDENCY INSTALL
# ═══════════════════════════════════════════════════════

step_install_core() {
    echo -e "  ${BOLD}[Step 4/7]${NC} 📦 安裝核心依賴..."
    echo -e "  ${DIM}  (puppeteer, blessed, gemini-ai, discord.js ...)${NC}"
    log "Installing core dependencies"

    spinner_start "npm install 安裝中"
    npm install --no-fund --no-audit >> "$LOG_FILE" 2>&1
    local exit_code=$?
    spinner_stop $([ $exit_code -eq 0 ] && echo true || echo false)

    if [ $exit_code -ne 0 ]; then
        echo -e "  ${RED}${BOLD}❌ npm install 失敗${NC}"
        echo -e "  ${YELLOW}💡 可能原因:${NC}"
        echo -e "     • 網路連線問題 → 請確認網路是否正常"
        echo -e "     • Node.js 版本不符 → 需要 v18+ (目前: $(node -v 2>/dev/null || echo N/A))"
        echo -e "     • 權限問題 → 嘗試 ${BOLD}sudo npm install${NC}"
        echo -e "  ${DIM}  詳細日誌: $LOG_FILE${NC}"
        log "FATAL: npm install failed"
        exit 1
    fi

    # 確保 TUI 套件存在
    if [ ! -d "$SCRIPT_DIR/node_modules/blessed" ]; then
        echo -e "  ${YELLOW}ℹ${NC}  補安裝 blessed 介面庫..."
        spinner_start "安裝 blessed 套件"
        npm install blessed blessed-contrib express --no-fund --no-audit >> "$LOG_FILE" 2>&1
        spinner_stop
    fi

    echo -e "  ${GREEN}  ✅ 核心依賴安裝完成${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════
#  STEP 5: WEB DASHBOARD INSTALL
# ═══════════════════════════════════════════════════════

step_install_dashboard() {
    echo -e "  ${BOLD}[Step 5/7]${NC} 🌐 設定 Web Dashboard..."
    log "Setting up dashboard"

    # 重新讀取 .env
    if [ -f "$DOT_ENV_PATH" ]; then source "$DOT_ENV_PATH" 2>/dev/null || true; fi

    if [ "$ENABLE_WEB_DASHBOARD" != "true" ]; then
        echo -e "    ${DIM}⏩ Dashboard 已停用，跳過安裝${NC}"
        echo ""
        return
    fi

    if [ ! -d "$SCRIPT_DIR/web-dashboard" ]; then
        echo -e "    ${RED}⚠️  找不到 web-dashboard 目錄，自動停用 Dashboard${NC}"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        echo ""
        return
    fi

    echo -e "    ${CYAN}偵測到 Dashboard 模組，開始安裝...${NC}"

    # Install deps
    spinner_start "安裝 Dashboard 依賴"
    (cd "$SCRIPT_DIR/web-dashboard" && npm install --no-fund --no-audit >> "$LOG_FILE" 2>&1)
    local dep_exit=$?
    spinner_stop $([ $dep_exit -eq 0 ] && echo true || echo false)

    if [ $dep_exit -ne 0 ]; then
        echo -e "    ${RED}❌ Dashboard 依賴安裝失敗${NC}"
        echo -e "    ${DIM}詳細日誌: $LOG_FILE${NC}"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        log "Dashboard deps install failed"
        echo ""
        return
    fi

    # Build
    spinner_start "建置 Dashboard (Next.js Build)"
    (cd "$SCRIPT_DIR/web-dashboard" && npm run build >> "$LOG_FILE" 2>&1)
    local build_exit=$?
    spinner_stop $([ $build_exit -eq 0 ] && echo true || echo false)

    if [ $build_exit -ne 0 ]; then
        echo -e "    ${RED}❌ Dashboard 建置失敗${NC}"
        echo -e "    ${DIM}詳細日誌: $LOG_FILE${NC}"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        log "Dashboard build failed"
    else
        echo -e "    ${GREEN}✅ Dashboard 建置完成${NC}"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        log "Dashboard build succeeded"
    fi
    echo ""
}

# ═══════════════════════════════════════════════════════
#  STEP FINAL: COMPLETION
# ═══════════════════════════════════════════════════════

step_final() {
    local elapsed="${1:-}"
    clear
    echo ""
    box_top
    box_line_colored "  ${GREEN}${BOLD}🎉 部署成功！${NC}                                          "
    box_line_colored "  ${GREEN}${BOLD}   Golem v${GOLEM_VERSION} (Titan Chronos) 已就緒${NC}                    "
    box_sep
    if [ -n "$elapsed" ]; then
        box_line_colored "  ⏱️  安裝耗時: ${CYAN}${elapsed}${NC}                                   "
    fi
    box_line_colored "  📋 安裝日誌: ${DIM}${LOG_FILE}${NC}                "
    box_bottom
    echo ""

    echo -e "  ${YELLOW}系統將在 5 秒後自動啟動... (按 Ctrl+C 取消)${NC}"
    echo ""

    # Animated countdown
    local secs=5
    while [ $secs -gt 0 ]; do
        local bar_w=20
        local filled=$(( (5 - secs) * bar_w / 5 ))
        local empty=$((bar_w - filled))
        local bar=""
        for ((i = 0; i < filled; i++)); do bar+="█"; done
        for ((i = 0; i < empty; i++)); do bar+="░"; done
        printf "\r  ${CYAN}[${bar}]${NC} ⏳ ${BOLD}${secs}${NC} 秒... "
        sleep 1
        secs=$((secs - 1))
    done

    # Fill the bar completely
    printf "\r  ${GREEN}[████████████████████]${NC} 🚀 啟動中...   \n"
    echo ""
    launch_system
}

# ═══════════════════════════════════════════════════════
#  TOGGLE DASHBOARD
# ═══════════════════════════════════════════════════════

toggle_dashboard() {
    check_status
    echo ""
    if [ "$IsDashEnabled" = true ]; then
        update_env "ENABLE_WEB_DASHBOARD" "false"
        echo -e "  ${YELLOW}⏸️  已停用 Web Dashboard${NC}"
        log "Dashboard disabled"
    else
        update_env "ENABLE_WEB_DASHBOARD" "true"
        echo -e "  ${GREEN}✅ 已啟用 Web Dashboard${NC}"
        log "Dashboard enabled"
    fi
    sleep 1
    show_menu
}

# ═══════════════════════════════════════════════════════
#  VIEW LOGS
# ═══════════════════════════════════════════════════════

view_logs() {
    clear
    echo ""
    box_top
    box_line_colored "  ${BOLD}📋 安裝日誌${NC} ${DIM}(最近 30 行)${NC}                             "
    box_bottom
    echo ""

    if [ -f "$LOG_FILE" ]; then
        tail -30 "$LOG_FILE" | while IFS= read -r line; do
            echo -e "  ${DIM}$line${NC}"
        done
    else
        echo -e "  ${DIM}(暫無日誌紀錄)${NC}"
    fi

    echo ""
    read -p "  按 Enter 返回主選單..."
    show_menu
}

# ═══════════════════════════════════════════════════════
#  LAUNCH SYSTEM
# ═══════════════════════════════════════════════════════

launch_system() {
    check_status

    clear
    show_header

    # Pre-launch health check
    run_health_check

    if [ "$IsDashEnabled" = true ]; then
        if [ ! -d "$SCRIPT_DIR/web-dashboard/out" ] && [ ! -d "$SCRIPT_DIR/web-dashboard/node_modules" ]; then
            echo -e "  ${YELLOW}⚠️  Dashboard 已啟用但尚未建置${NC}"
            echo -e "  ${DIM}   請先執行 [4] 重建 Web Dashboard${NC}"
            echo ""
        else
            echo -e "  ${GREEN}🌐 Web Dashboard → http://localhost:${DASHBOARD_PORT:-3000}${NC}"
        fi
    fi

    echo -e "  ${CYAN}🚀 正在啟動 Golem v${GOLEM_VERSION} 控制台...${NC}"
    echo -e "  ${DIM}   正在載入 Neural Memory 與戰術介面...${NC}"
    echo -e "  ${DIM}   若要離開，請按 'q' 或 Ctrl+C${NC}"
    echo ""
    sleep 1
    log "System launched"

    npm run dashboard

    echo ""
    echo -e "  ${YELLOW}[INFO] 系統已停止。${NC}"
    log "System stopped"
    read -p "  按 Enter 返回主選單..."
    show_menu
}

# ═══════════════════════════════════════════════════════
#  PRINT STATUS (Non-interactive)
# ═══════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════
#  DOCKER FUNCTIONS
# ═══════════════════════════════════════════════════════

launch_docker() {
    check_status
    clear
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🐳 Docker 啟動模式 (Containerized Launch)${NC}                  "
    box_sep

    if [ "$DOCKER_OK" != true ] || [ "$COMPOSE_OK" != true ]; then
         box_line_colored "  ${RED}❌ Docker 或 Docker Compose 未安裝/未啟動${NC}                 "
         box_line_colored "  ${YELLOW}   請先安裝 Docker Desktop 或啟動 Docker 服務${NC}             "
         box_bottom
         read -p "  按 Enter 返回..."
         show_menu
         return
    fi

    if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
         box_line_colored "  ${RED}❌ 找不到 docker-compose.yml${NC}                             "
         box_bottom
         read -p "  按 Enter 返回..."
         show_menu
         return
    fi
    
    box_line_colored "  ${GREEN}✔${NC}  Docker 環境檢查通過                                    "
    box_line_colored "  🚀 即將執行: ${BOLD}docker compose up --build${NC}                     "
    box_line_colored "  🌐 外部瀏覽器可訪問: ${BOLD}http://localhost:3000${NC}                 "
    box_line_colored "  💡 按 ${BOLD}Ctrl+C${NC} 可停止容器並返回                               "
    box_bottom
    echo ""

    # Ensure memory dir exists for volume mount
    mkdir -p "$SCRIPT_DIR/golem_memory"
    mkdir -p "$SCRIPT_DIR/logs"

    # [Integration] Check and launch Host Chrome
    if grep -q "PUPPETEER_REMOTE_DEBUGGING_PORT" "$DOT_ENV_PATH"; then
        echo -e "  ${CYAN}🔌 偵測到遠端除錯設定，正在啟動主機 Chrome...${NC}"
        $SCRIPT_DIR/start-host-chrome.sh &
        HOST_CHROME_PID=$!
        sleep 2 # Wait for Chrome to start
    fi

    echo -e "  ${CYAN}正在建置並啟動容器... (這可能需要一點時間)${NC}"
    echo ""
    
    # Run docker compose attached
    if docker compose up --build; then
        echo ""
        echo -e "  ${GREEN}✅ Docker 容器已停止${NC}"
    else
        echo ""
        echo -e "  ${RED}❌ Docker 啟動失敗${NC}"
    fi

    read -p "  按 Enter 返回主選單..."
    show_menu
}

clean_docker() {
    echo ""
    echo -e "  ${BOLD}${CYAN}🧹 清除 Docker 資源${NC}"
    echo -e "  ${DIM}這將停止容器並移除相關網路 (不會刪除 volumes/memory)${NC}"
    echo ""
    
    if confirm_action "確定要執行 docker compose down?"; then
        echo ""
        docker compose down
        echo -e "  ${GREEN}✅ 已執行 docker compose down${NC}"
    else
        echo -e "  ${DIM}已取消${NC}"
    fi
    sleep 1
    show_menu
}

print_status() {
    check_status
    echo ""
    echo -e "${BOLD}Project Golem v${GOLEM_VERSION} - System Status${NC}"
    echo "─────────────────────────────────────────"
    echo -e "  Node.js:       $(node -v 2>/dev/null || echo N/A)"
    echo -e "  npm:           v$(npm -v 2>/dev/null || echo N/A)"
    echo -e "  OS:            $OSTYPE ($ARCH_INFO)"
    echo -e "  .env:          $([ -f "$DOT_ENV_PATH" ] && echo "Found" || echo "Missing")"
    echo -e "  Dashboard:     ${ENABLE_WEB_DASHBOARD:-unknown}"
    echo -e "  Port 3000:     $(lsof -i :3000 &>/dev/null 2>&1 && echo "In Use" || echo "Free")"
    echo -e "  Docker:        $([ -x "$(command -v docker)" ] && echo "Yes" || echo "No")"
    echo -e "  Disk:          $DISK_AVAIL available"
    echo ""
}

# ═══════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════

# 檢查權限
if [ ! -x "$0" ]; then
    echo -e "${YELLOW}[WARN] 請先執行: chmod +x setup.sh${NC}"
fi

# --- CLI Arguments ---
case "${1:-}" in
    --start)
        launch_system
        ;;
    --install)
        run_full_install
        ;;
    --dashboard)
        step_install_dashboard
        ;;
    --docker)
        launch_docker
        ;;
    --config)
        step_check_env
        config_wizard
        ;;
    --status)
        print_status
        ;;
    --version)
        echo "Project Golem v${GOLEM_VERSION} (Titan Chronos)"
        ;;
    --help|-h)
        echo ""
        echo -e "${BOLD}Project Golem v${GOLEM_VERSION} Setup Script${NC}"
        echo ""
        echo "Usage: ./setup.sh [OPTIONS]"
        echo ""
        echo "OPTIONS:"
        echo "  (none)        啟動互動式主選單"
        echo "  --start       直接啟動系統 (跳過選單)"
        echo "  --install     執行完整安裝流程"
        echo "  --config      啟動配置精靈 (.env)"
        echo "  --dashboard   僅安裝/重建 Web Dashboard"
        echo "  --docker      使用 Docker 啟動系統"
        echo "  --status      顯示系統狀態 (非互動)"
        echo "  --version     顯示版本號"
        echo "  --help, -h    顯示此說明"
        echo ""
        echo "ENVIRONMENT:"
        echo "  NO_COLOR=1    停用所有顏色輸出 (適用於 CI/管線)"
        echo ""
        echo "EXAMPLES:"
        echo "  ./setup.sh                  # 互動式選單"
        echo "  ./setup.sh --start          # 快速啟動"
        echo "  ./setup.sh --install        # 自動完整安裝"
        echo "  ./setup.sh --status         # 檢查狀態"
        echo "  NO_COLOR=1 ./setup.sh --status  # CI 環境狀態"
        echo ""
        exit 0
        ;;
    *)
        show_menu
        ;;
esac
