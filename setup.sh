#!/bin/bash

# ==========================================
# Project Golem v9.0 (Titan Chronos)
# Architecture: Modular Orchestrator
# ==========================================

# ─── Path Constants ─────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly LIB_DIR="$SCRIPT_DIR/scripts/lib"
readonly DOT_ENV_PATH="$SCRIPT_DIR/.env"
readonly LOG_DIR="$SCRIPT_DIR/logs"
readonly LOG_FILE="$LOG_DIR/setup.log"
readonly GOLEM_VERSION="9.0.0"

# ─── Initialize Environment ─────────────────────────────
mkdir -p "$LOG_DIR"

# ─── Load Modules ───────────────────────────────────────
source "$LIB_DIR/colors.sh"
source "$LIB_DIR/utils.sh"
source "$LIB_DIR/ui_components.sh"
source "$LIB_DIR/system_check.sh"
source "$LIB_DIR/installer.sh"
source "$LIB_DIR/docker_manager.sh"
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
    echo -e "  Docker:        $([ -x "$(command -v docker)" ] && echo "Yes" || echo "No")"
    echo -e "  Disk:          $DISK_AVAIL available"
    echo ""
}

# ─── Entry Point ────────────────────────────────────────
# Check basic dependencies first
check_dependencies

case "${1:-}" in
    --start)
        shift
        launch_args=""
        while [[ $# -gt 0 ]]; do
            case "${1:-}" in
                --bg)     launch_args="$launch_args --bg" ;;
                --single) launch_args="$launch_args --single" ;;
                --multi)  launch_args="$launch_args --multi" ;;
                --admin)  launch_args="$launch_args --admin" ;;
                --chat)   launch_args="$launch_args --chat" ;;
            esac
            shift
        done
        launch_system $launch_args
        ;;
    --install)   run_full_install ;;
    --init)      run_clean_init ;;
    --stop)      stop_system ;;
    --docker)    launch_docker ;;
    --config)    step_check_env; config_wizard ;;
    --status)    print_status ;;
    --version)   echo "Project Golem v${GOLEM_VERSION} (Titan Chronos)" ;;
    --help|-h)
        echo ""
        echo -e "${BOLD}Project Golem v${GOLEM_VERSION} Setup Script${NC}"
        echo ""
        echo "Usage: ./setup.sh [OPTIONS]"
        echo ""
        echo "OPTIONS:"
        echo "  (none)        啟動互動式主選單"
        echo "  --start       直接啟動系統 (跳過選單)"
        echo "  --start --bg  以背景模式啟動系統"
        echo "  --install     執行完整安裝流程"
        echo "  --init        完全初始化 (刪除資料並重新安裝)"
        echo "  --stop        停止 Golem 與 Web Dashboard"
        echo "  --config      啟動配置精靈 (Gemini Key / 系統選項)"
        echo "  --docker      使用 Docker 啟動系統"
        echo "  --status      顯示系統狀態 (非互動)"
        echo "  --version     顯示版本號"
        echo "  --help, -h    顯示此說明"
        echo ""
        echo "Golem Bot 設定 (Token / Auth Mode 等) 請透過 Web Dashboard 管理:"
        echo "  1. 執行 ./setup.sh --start"
        echo "  2. 開啟瀏覽器 http://localhost:3000"
        echo "  3. 點擊「新增 Golem」填入 Telegram Token 即可啟動"
        echo ""
        echo "ENVIRONMENT:"
        echo "  NO_COLOR=1    停用所有顏色輸出 (適用於 CI/管線)"
        echo ""
        echo "EXAMPLES:"
        echo "  ./setup.sh                  # 互動式選單"
        echo "  ./setup.sh --start --bg     # 背景啟動"
        echo "  ./setup.sh --install        # 自動完整安裝"
        echo "  ./setup.sh --init           # 完全初始化"
        echo "  ./setup.sh --status         # 檢查狀態"
        echo ""
        exit 0
        ;;
    *)           show_menu ;;
esac
