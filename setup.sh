#!/bin/bash

# ==========================================
# Project Golem v9.0 (Titan Chronos)
# Architecture: Modular Orchestrator
# ==========================================

# ─── Path Constants ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$SCRIPT_DIR/scripts/lib"
DOT_ENV_PATH="$SCRIPT_DIR/.env"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/setup.log"
GOLEM_VERSION="9.0.0"

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
case "${1:-}" in
    --start)     launch_system ;;
    --install)   run_full_install ;;
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
    *)           show_menu ;;
esac
