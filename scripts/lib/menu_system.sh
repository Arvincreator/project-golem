#!/bin/bash

show_header() {
    check_status
    clear; echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🤖 Project Golem v${GOLEM_VERSION}${NC} ${DIM}(Titan Chronos)${NC}              "
    box_sep
    box_line_colored "  ${BOLD}📊 系統狀態${NC}                                          "
    box_line_colored "  Node.js: $STATUS_NODE   npm: ${DIM}v$NPM_VER${NC}               "
    box_line_colored "  Config:  $STATUS_ENV   Mode:      ${BOLD}${CYAN}$CURRENT_GOLEM_MODE${NC}           "
    box_line_colored "  Docker: $STATUS_DOCKER  Dashboard: $STATUS_DASH            "
    if [ -n "$GOLEMS_LIST" ]; then
        box_sep
        box_line_colored "  ${DIM}現有實體: $GOLEMS_LIST${NC}"
    fi
    box_bottom; echo ""
}

show_menu() {
    show_header
    echo -e "  ${DIM}$(pick_tagline)${NC}"
    echo ""
    echo -e "  ${BOLD}${YELLOW}⚡ 快速啟動${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[0]${NC}  🚀 啟動系統 ${DIM}(使用目前配置)${NC}"
    echo -e "\n  ${BOLD}${YELLOW}🛠️  安裝與維護${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[1]${NC}  📦 完整安裝"
    echo -e "   ${BOLD}[I]${NC}  🧹 完全初始化"
    echo -e "   ${BOLD}[2]${NC}  ⚙️  環境配置精靈 (.env / API Keys)"
    echo -e "   ${BOLD}[G]${NC}  🌐 Golem 管理 (透過 Web Dashboard)"
    echo -e "   ${BOLD}[3]${NC}  📥 安裝依賴"
    echo -e "   ${BOLD}[4]${NC}  🌐 重建 Dashboard"
    echo -e "\n  ${BOLD}${YELLOW}🐳 Docker 容器化${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[5]${NC}  🚀 Docker 啟動"
    echo -e "   ${BOLD}[6]${NC}  🧹 清除 Docker"
    echo -e "\n  ${BOLD}${YELLOW}🔧 工具${NC}"
    echo -e "  ${CYAN}───────────────────────────────────────────────${NC}"
    echo -e "   ${BOLD}[S]${NC}  🏥 系統健康檢查"
    echo -e "   ${BOLD}[D]${NC}  🔄 切換 Dashboard"
    echo -e "   ${BOLD}[L]${NC}  📋 查看安裝日誌"
    echo -e "   ${BOLD}[K]${NC}  🛑 停止 Golem 與 Dashboard"
    echo -e "\n   ${BOLD}[Q]${NC}  🚪 退出\n"

    read -r -p "  👉 請輸入選項: " raw_choice
    # Byte-level filter: 僅保留 ASCII 字母與數字，確保排除編碼錯誤或 ANSI 殘留
    choice=$(echo "$raw_choice" | LC_ALL=C tr -dc 'a-zA-Z0-9' | awk '{print substr($0,1,1)}')

    case $choice in
        0) launch_system ;;
        1) run_full_install ;;
        [Ii]) run_clean_init; show_menu ;;
        2) step_check_env; config_wizard; show_menu ;;
        [Gg]) golems_wizard; show_menu ;;
        3) step_install_core; step_install_dashboard; show_menu ;;
        4) step_install_dashboard; show_menu ;;
        5) launch_docker; show_menu ;;
        6) clean_docker; show_menu ;;
        [Ss]) check_status; run_health_check; read -r -p " 按 Enter 返回..."; show_menu ;;
        [Dd]) toggle_dashboard ;;
        [Ll]) view_logs ;;
        [Kk]) stop_system; show_menu ;;
        [Qq]) echo -e "  ${GREEN}👋 再見！${NC}"; exit 0 ;;
        *) 
            # 防護性顯示：只有當輸入是真的安全字元時才印出，否則顯示通用錯誤
            if [[ -n "$choice" && "$choice" =~ ^[a-zA-Z0-9]$ ]]; then
                printf "  %b❌ 無效選項「%s」%b\n" "$RED" "$choice" "$NC"
            else
                printf "  %b❌ 無效輸入%b\n" "$RED" "$NC"
            fi
            sleep 1; show_menu ;;
    esac
}

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
    read -r -p "  按 Enter 返回主選單..."
    show_menu
}

stop_system() {
    echo ""
    echo -e "  ${YELLOW}🛑 正在停止 Golem 與 Web Dashboard...${NC}"
    local killed=0

    # 1. Kill via .golem.pid
    local pid_file="$SCRIPT_DIR/.golem.pid"
    if [ -f "$pid_file" ]; then
        local gpid
        gpid=$(cat "$pid_file")
        if kill -0 "$gpid" 2>/dev/null; then
            kill "$gpid" 2>/dev/null
            echo -e "  ${GREEN}✅ Golem 主程序已停止 (PID: $gpid)${NC}"
            killed=1
        else
            echo -e "  ${DIM}   PID $gpid 已不存在${NC}"
        fi
        rm -f "$pid_file"
    fi

    # 2. Kill anything on Dashboard port (default 3000)
    local dash_port="${DASHBOARD_PORT:-3000}"
    local dash_pids
    dash_pids=$(lsof -ti tcp:"$dash_port" 2>/dev/null)
    if [ -n "$dash_pids" ]; then
        echo "$dash_pids" | xargs kill 2>/dev/null
        echo -e "  ${GREEN}✅ Dashboard (port $dash_port) 已停止${NC}"
        killed=1
    fi

    # 3. Also kill any lingering 'node index.js' / 'npm start' spawned by setup
    local golem_pids
    golem_pids=$(pgrep -f 'node.*index\.js' 2>/dev/null)
    if [ -n "$golem_pids" ]; then
        echo "$golem_pids" | xargs kill 2>/dev/null
        echo -e "  ${GREEN}✅ 殘留 Node.js 程序已終止${NC}"
        killed=1
    fi

    if [ "$killed" -eq 0 ]; then
        echo -e "  ${DIM}   找不到正在執行的 Golem 程序${NC}"
    fi

    log "System stopped via stop_system"
    echo ""
    read -r -p "  按 Enter 返回主選單..."
}

launch_system() {
    local bg_mode=false
    local mode=""
    local auth_mode=""

    while [[ $# -gt 0 ]]; do
        case "${1:-}" in
            --bg)     bg_mode=true ;;
            --single) mode="SINGLE" ;;
            --multi)  mode="MULTI" ;;
            --admin)  auth_mode="ADMIN" ;;
            --chat)   auth_mode="CHAT" ;;
        esac
        shift
    done

    check_status

    if [ "$bg_mode" = true ]; then
        echo -e "  ${GREEN}🚀 正在以背景模式啟動 Golem v${GOLEM_VERSION}...${NC}"
        [ -n "$mode" ] && echo -e "  ${DIM}   模式: $mode${NC}"
        [ -n "$auth_mode" ] && echo -e "  ${DIM}   權限: $auth_mode${NC}"
        echo -e "  ${DIM}   所有輸出將重新導向至 logs/golem.log${NC}"
        
        mkdir -p "$SCRIPT_DIR/logs"
        
        # 建立環境變數前綴
        local env_cmd="env"
        [ -n "$mode" ] && env_cmd="$env_cmd GOLEM_MODE=$mode"
        [ -n "$auth_mode" ] && env_cmd="$env_cmd TG_AUTH_MODE=$auth_mode"
        
        nohup $env_cmd npm start > "$SCRIPT_DIR/logs/golem.log" 2>&1 &
        local pid=$!
        echo "$pid" > "$SCRIPT_DIR/.golem.pid"
        echo -e "  ${CYAN}✅ 系統已在背景啟動 (PID: $pid)${NC}"
        echo -e "  ${DIM}   你可以使用 'tail -f logs/golem.log' 查看日誌${NC}"
        log "System launched in background (PID: $pid, Mode: $mode, Auth: $auth_mode)"
        sleep 1
        return
    fi
    
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
    log "System launched (Mode: $mode, Auth: $auth_mode)"

    # 建立環境變數前綴
    local env_cmd="env"
    [ -n "$mode" ] && env_cmd="$env_cmd GOLEM_MODE=$mode"
    [ -n "$auth_mode" ] && env_cmd="$env_cmd TG_AUTH_MODE=$auth_mode"

    $env_cmd npm run dashboard

    echo ""
    echo -e "  ${YELLOW}[INFO] 系統已停止。${NC}"
    log "System stopped"
    read -r -p "  按 Enter 返回主選單..."
    show_menu
}