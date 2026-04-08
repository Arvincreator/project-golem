#!/bin/bash

# ==========================================
# Project Golem v9.1 (Titan Chronos)
# Architecture: Modular Orchestrator
# ==========================================

# ─── Path Constants ─────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly LIB_DIR="$SCRIPT_DIR/scripts/lib"
readonly DOT_ENV_PATH="$SCRIPT_DIR/.env"
readonly LOG_DIR="$SCRIPT_DIR/logs"
readonly LOG_FILE="$LOG_DIR/setup.log"
readonly GOLEM_VERSION=$(grep '"version":' "$SCRIPT_DIR/package.json" | cut -d '"' -f 4)

# ─── Initialize Environment ─────────────────────────────
mkdir -p "$LOG_DIR"

# ─── Load Modules ───────────────────────────────────────
source "$LIB_DIR/colors.sh"
source "$LIB_DIR/utils.sh"
source "$LIB_DIR/ui_components.sh"
source "$LIB_DIR/system_check.sh"
source "$LIB_DIR/install_profile.sh"
source "$LIB_DIR/installer.sh"
source "$LIB_DIR/docker_manager.sh"
source "$LIB_DIR/headless_manager.sh"
source "$LIB_DIR/menu_system.sh"

# ─── Graceful Exit Trap ──────────────────────────────────
cleanup() {
    tput cnorm 2>/dev/null  # Restore cursor
    echo -e "\n${YELLOW}⚡ 收到中斷信號，正在安全退出...${NC}"
    
    # Cleanup background processes using the new utility
    cleanup_pids
    
    echo -e "${GREEN}👋 已安全退出。感謝使用 Project Golem！${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ─── Non-interactive Status ─────────────────────────────
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
    echo -e "  Port 3001:     $(lsof -i :3001 &>/dev/null 2>&1 && echo "In Use" || echo "Free")"
    echo -e "  Docker:        $([ -x "$(command -v docker)" ] && echo "Yes" || echo "No")"
    echo -e "  Disk:          $DISK_AVAIL available"
    echo ""
}

# ─── Entry Point ────────────────────────────────────────
# Normalize global optional flags first (so all modes can share them)
GOLEM_INSTALL_COMPONENTS_CLI="${GOLEM_INSTALL_COMPONENTS:-}"
PARSED_ARGS=()
while [[ $# -gt 0 ]]; do
    case "${1:-}" in
        --components)
            if [[ $# -lt 2 ]]; then
                echo -e "${RED}❌ --components 需要帶值，例如: --components core,dashboard${NC}"
                exit 1
            fi
            GOLEM_INSTALL_COMPONENTS_CLI="$2"
            shift 2
            ;;
        --components=*)
            GOLEM_INSTALL_COMPONENTS_CLI="${1#*=}"
            shift
            ;;
        *)
            PARSED_ARGS+=("$1")
            shift
            ;;
    esac
done
set -- "${PARSED_ARGS[@]}"
export GOLEM_INSTALL_COMPONENTS="$GOLEM_INSTALL_COMPONENTS_CLI"

# Detect magic mode early to bypass prompts during check_dependencies
if [ "${1:-}" = "--magic" ]; then
    export GOLEM_MAGIC_MODE=true
fi

# Docker / Headless 指令允許在未安裝 Node.js 的主機上執行
LIGHTWEIGHT_ONLY_MODE=false
case "${1:-}" in
    --docker|--headless-deploy|--headless-stop|--desktop-start|--desktop-stop|--desktop-status|--deploy-linux|--deploy-local|--deploy-docker|--deploy-auto|--status|--help|-h|--version)
        LIGHTWEIGHT_ONLY_MODE=true
        ;;
esac

if [ "$LIGHTWEIGHT_ONLY_MODE" = true ]; then
    check_status
else
    check_dependencies
fi

case "${1:-}" in
    --magic)
        # GOLEM_MAGIC_MODE already set above
        run_full_install
        ;;
    --start)
        shift
        launch_args=""
        while [[ $# -gt 0 ]]; do
            case "${1:-}" in
                --bg)     launch_args="$launch_args --bg" ;;
                --single) launch_args="$launch_args --single" ;;
                --admin)  launch_args="$launch_args --admin" ;;
                --chat)   launch_args="$launch_args --chat" ;;
            esac
            shift
        done
        launch_system $launch_args
        ;;
    --install)   run_full_install ;;
    --init)      run_clean_init ;;
    --stop|--stop-all) stop_system ;;
    --docker)    launch_docker ;;
    --desktop-start) headless_start_local_desktop ;;
    --desktop-stop) headless_stop_local_desktop ;;
    --desktop-status) headless_status_local_desktop ;;
    --headless-deploy)
        shift
        deploy_mode="auto"
        while [[ $# -gt 0 ]]; do
            case "${1:-}" in
                --docker) deploy_mode="docker" ;;
                --local)  deploy_mode="local" ;;
            esac
            shift
        done
        headless_one_click_deploy "$deploy_mode"
        ;;
    --headless-stop) headless_one_click_stop ;;
    --deploy-linux|--deploy-local) headless_one_click_deploy local ;;
    --deploy-docker) headless_one_click_deploy docker ;;
    --deploy-auto) headless_one_click_deploy auto ;;
    --doctor)    npm run doctor ;;
    --config)    step_check_env; config_wizard ;;
    --status)    print_status ;;
    --version)   echo "Project Golem v${GOLEM_VERSION} (Single-Golem Edition)" ;;
    --help|-h)
        echo ""
        echo -e "${BOLD}Project Golem v${GOLEM_VERSION} Setup Script${NC}"
        echo ""
        echo "Usage: ./setup.sh [OPTIONS]"
        echo ""
        echo "OPTIONS:"
        echo "  (none)        啟動互動式主選單"
        echo "  --magic       全自動背景安裝與設定 (無對話框)"
        echo "  --start       直接啟動系統 (跳過選單)"
        echo "  --start --bg  以背景模式啟動系統"
        echo "  --install     執行完整安裝流程"
        echo "  --components  安裝功能清單（逗號分隔）"
        echo "                可選: core,mempalace,dashboard,doctor"
        echo "                例: --install --components core,dashboard"
        echo "  --init        完全初始化 (刪除資料並重新安裝)"
        echo "  --stop, --stop-all  關閉所有 Golem 與 Web Dashboard 程序"
        echo "  --config      啟動配置精靈 (Gemini Key / 系統選項)"
        echo "  --docker      使用 Docker 啟動系統"
        echo "  --desktop-start   啟動 Linux 無桌面虛擬桌面 (Xvfb + noVNC)"
        echo "  --desktop-stop    停止虛擬桌面服務"
        echo "  --desktop-status  顯示虛擬桌面狀態"
        echo "  --headless-deploy 一鍵 Headless 部署 (自動選 Docker/本機)"
        echo "  --headless-stop   停止 Headless 部署服務 (Docker + 本機)"
        echo "  --deploy-linux    Linux 本機一鍵安裝部署 (含 noVNC)"
        echo "  --deploy-docker   Docker 一鍵安裝部署 (含 noVNC)"
        echo "  --deploy-auto     自動判斷 Linux/Docker 一鍵部署"
        echo "  --doctor      執行系統環境自我診斷"
        echo "  --status      顯示系統狀態 (非互動)"
        echo "  --version     顯示版本號"
        echo "  --help, -h    顯示此說明"
        echo ""
        echo "Golem 設定 (API Keys / Bot Token 等) 請透過 Web Dashboard 管理:"
        echo "  1. 執行 ./setup.sh --start"
        echo "  2. 開啟瀏覽器 http://localhost:3000"
        echo "  3. 進入「系統設定」完成初始化即可"
        echo ""
        echo "若未安裝或停用 Web Dashboard，setup.sh 會自動切換為 CLI 初始化精靈，"
        echo "並逐步詢問人格、通訊方式、後端 provider、遠端存取等必要設定。"
        echo ""
        echo "MemPalace 核心記憶 MCP 已內建為常駐服務，無需手動到 Dashboard 新增。"
        echo ""
        echo "ENVIRONMENT:"
        echo "  NO_COLOR=1    停用所有顏色輸出 (適用於 CI/管線)"
        echo "  GOLEM_INSTALL_COMPONENTS=core,mempalace,dashboard,doctor"
        echo ""
        echo "EXAMPLES:"
        echo "  ./setup.sh                  # 互動式選單"
        echo "  ./setup.sh --start --bg     # 背景啟動"
        echo "  ./setup.sh --install        # 自動完整安裝"
        echo "  ./setup.sh --install --components core,dashboard"
        echo "  ./setup.sh --stop           # 關閉所有程序"
        echo "  ./setup.sh --deploy-linux   # Linux 本機一鍵安裝部署"
        echo "  ./setup.sh --deploy-docker  # Docker 一鍵安裝部署"
        echo "  ./setup.sh --headless-deploy --docker  # Docker + noVNC 一鍵部署"
        echo "  ./setup.sh --headless-deploy --local   # Linux 本機 + noVNC 一鍵部署"
        echo "  ./setup.sh --status         # 檢查狀態"
        echo ""
        exit 0
        ;;
    *)
        # 🔗 核心優化：優化首次執行體驗
        if [ ! -f "$DOT_ENV_PATH" ] && [ ! -d "$SCRIPT_DIR/node_modules" ]; then
            clear; echo ""
            box_top
            box_line_colored "  ${BOLD}${CYAN}👋 歡迎使用 Project Golem 部署助手${NC}                "
            box_sep
            box_line_colored "  ${DIM}這是您第一次執行本系統。我們將引導您完成以下步驟：${NC}"
            box_line_colored ""
            box_line_colored "  ${GREEN}1.${NC} 🏥 檢查系統環境 (Node.js/npm) "
            box_line_colored "  ${GREEN}2.${NC} 📄 初始化環境設定檔 (.env)"
            box_line_colored "  ${GREEN}3.${NC} 📦 安裝核心依賴與 Web Dashboard"
            box_line_colored "  ${GREEN}4.${NC} 🚀 啟動系統戰術介面"
            box_line_colored ""
            box_line_colored "  ${DIM}此過程大約需要 2-5 分鐘，視您的網路速度而定。${NC}"
            box_bottom
            echo ""
            
            if confirm_action "準備好開始一鍵安裝了嗎？"; then
                run_full_install
            else
                echo -e "  ${DIM}已取消自動安裝。您可以稍後在選單中執行「完整安裝」。${NC}"
                sleep 2
                show_menu
            fi
        else
            show_menu
        fi
        ;;
esac
