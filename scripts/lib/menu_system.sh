#!/bin/bash

show_header() {
    check_status
    clear; echo ""
    box_header_dashboard
    echo -ne "  ${DIM}NODE_NAME: ${NC}${BOLD}${WHITE}$SYS_NAME${NC} ${DIM}• 核心版本: ${NC}${CYAN}v${GOLEM_VERSION}${NC}"
    echo -e " ${DIM}• Node.js: ${NC}${YELLOW}$(node -v 2>/dev/null || echo N/A)${NC}"
    echo ""
}

show_menu() {
    show_header
    echo ""
    
    # 智能推薦邏輯
    local default_choice="Start"
    if [ "$ENV_OK" = false ] || [ ! -d "$SCRIPT_DIR/node_modules" ]; then
        default_choice="Install"
    elif [ "$IS_RUNNING" = true ]; then
        default_choice="Stop"
    fi
    SINGLESELECT_DEFAULT="$default_choice"

    # ─── 目錄分區 ───
    echo -e "  ${YELLOW}⚡${NC}  ${BOLD}${YELLOW}核心操作 (Core Operations)${NC}"
    echo -e "  ${DIM}┖───────────────────────────────────────────┚${NC}"
    echo ""

    local options=()
    if [ "$IS_RUNNING" = true ]; then
        options+=("Restart|🔄 重新啟動所有服務 (Restart Stack)")
    else
        options+=("Start|🚀 啟動系統與控制台 (Power On)")
    fi
    options+=("Stop|🛑 關閉所有 Golem 程序 (Shutdown)")
    
    options+=("Install|📦 更新依賴與系統建置 (Update / Build)")
    options+=("Magic|✨ 魔法一鍵安裝 (One-Click Setup)")
    
    show_menu_tools # Call the new function for the tools header
    
    options+=("Doctor|🏥 深度系統診斷 (Run Diagnostics)")
    options+=("Clean|🧹 清除依賴 (Clean node_modules)")
    options+=("Init|🧨 完全初始化系統 (Factory Reset - ${RED}DANGER${NC})")
    options+=("Quit|🚪 退出介面 (Exit)")

    # Bottom Tip (Placed before prompt to keep it visible)
    show_system_tip # Call the new function for the system tip
    echo ""

    prompt_singleselect "" "${options[@]}"
    local choice="$SINGLESELECT_RESULT"

    case "$choice" in
        "Start")   launch_system ;;
        "Restart") stop_system false; launch_system ;;
        "Stop")    stop_system; show_menu ;;
        "Install") run_full_install ;;
        "Magic")   export GOLEM_MAGIC_MODE=true; run_full_install ;;
        "Doctor")  run_health_check; echo ""; read -r -p "  按 Enter 返回主選單..."; show_menu ;;
        "Clean")   run_clean_dependencies; show_menu ;;
        "Init")    run_clean_init; show_menu ;;
        "Quit")    echo -e "  ${GREEN}👋 關閉連線，再見！${NC}"; exit 0 ;;
        *)         show_menu ;;
    esac
}

show_menu_tools() {
    echo ""
    echo -e "  ${CYAN}🛠${NC}  ${BOLD}${CYAN}維護與診斷 (Maintenance & Tools)${NC}"
    echo -e "  ${DIM}┖───────────────────────────────────────────┚${NC}"
    echo ""
}

show_system_tip() {
    local tips=(
        "Your personal AI agent, at your service."
        "Mainframe stabilized. All systems nominal."
        "Pro Tip: Use 'Doctor' if you encounter any port conflicts."
        "Neural link established. Golem core active."
    )
    local tip=${tips[$RANDOM % ${#tips[@]}]}
    echo -e "  ${DIM}💡 提示: $tip${NC}"
    echo ""
}

# toggle_dashboard and view_logs are now handled via Web Dashboard

stop_system() {
    local interactive="${1:-true}"
    echo ""
    echo -e "  ${YELLOW}🛑 正在執行深度清理，停止所有相關程序...${NC}"
    local killed=0

    # Helper to kill gracefully then forcefully
    safe_kill() {
        local pids=$1
        local name=$2
        if [ -n "$pids" ]; then
            echo "$pids" | xargs kill -15 2>/dev/null
            sleep 0.5
            # Fallback to -9 if still alive
            local still_alive
            still_alive=$(echo "$pids" | xargs ps -p 2>/dev/null | grep -v PID)
            if [ -n "$still_alive" ]; then
                echo "$pids" | xargs kill -9 2>/dev/null
            fi
            echo -e "  ${GREEN}✅ $name 已停止${NC}"
            killed=1
        fi
    }

    # 1. Kill via .golem.pid (Primary PID file)
    local pid_file="$SCRIPT_DIR/.golem.pid"
    if [ -f "$pid_file" ]; then
        local gpid
        gpid=$(cat "$pid_file")
        safe_kill "$gpid" "Golem 主程序 (PID: $gpid)"
        rm -f "$pid_file"
    fi

    # 2. Kill anything on Dashboard port
    local dash_port="${DASHBOARD_PORT:-3000}"
    local dash_pids
    dash_pids=$(lsof -ti tcp:"$dash_port" 2>/dev/null)
    safe_kill "$dash_pids" "Dashboard (port $dash_port)"

    # 3. Kill Next.js Dev Server if running on 3000 (standard for dev mode)
    local next_pids
    next_pids=$(lsof -ti tcp:3000 2>/dev/null)
    if [ -n "$next_pids" ] && [ "$dash_port" != "3000" ]; then
        safe_kill "$next_pids" "Next.js Dev Server (port 3000)"
    fi

    # 4. Kill Backend API if running on 3001
    local backend_pids
    backend_pids=$(lsof -ti tcp:3001 2>/dev/null)
    safe_kill "$backend_pids" "Backend API (port 3001)"

    # 5. Comprehensive regex kill for all related node/npm processes
    local golem_pids
    golem_pids=$(pgrep -f 'node.*(index|dashboard|migrateData)\.js|nodemon|next-dev|npm.*(start|dev|dashboard)' 2>/dev/null)
    safe_kill "$golem_pids" "其餘 Node.js 進程"

    if [ "$killed" -eq 0 ]; then
        echo -e "  ${DIM}   找不到正在執行的 Golem 相關程序${NC}"
    fi

    log "System stopped and cleaned via stop_system"
    echo ""

    if [ "$interactive" = true ]; then
        read -r -p "  按 Enter 返回主選單..."
    fi
}

launch_system() {
    local bg_mode=false
    local auth_mode=""

    while [[ $# -gt 0 ]]; do
        case "${1:-}" in
            --bg)     bg_mode=true ;;
            --admin)  auth_mode="ADMIN" ;;
            --chat)   auth_mode="CHAT" ;;
        esac
        shift
    done

    # [MAGIC MODE] 自動清理殘留進程與釋放 Port (3000/3001)
    if [ "${GOLEM_MAGIC_MODE:-false}" = "true" ]; then
        echo -e "  🧹 魔法模式：自動排除潛在的 Port 佔用..."
        # 隱藏 stdout，保留必要的錯誤輸出，讓畫面乾淨一點
        stop_system false >/dev/null 2>&1
    fi

    check_status

    if [ "$bg_mode" = true ]; then
        echo -e "  ${GREEN}🚀 正在以背景模式啟動 Golem v${GOLEM_VERSION} (Single)...${NC}"
        [ -n "$auth_mode" ] && echo -e "  ${DIM}   權限: $auth_mode${NC}"
        echo -e "  ${DIM}   所有輸出將重新導向至 logs/golem.log${NC}"
        
        mkdir -p "$SCRIPT_DIR/logs"
        
        # 建立環境變數前綴
        local env_cmd="env"
        [ -n "$auth_mode" ] && env_cmd="$env_cmd TG_AUTH_MODE=$auth_mode"
        
        nohup $env_cmd npm start > "$SCRIPT_DIR/logs/golem.log" 2>&1 &
        local pid=$!
        echo "$pid" > "$SCRIPT_DIR/.golem.pid"
        echo -e "  ${CYAN}✅ 系統已在背景啟動 (PID: $pid)${NC}"
        echo -e "  ${DIM}   你可以使用 'tail -f logs/golem.log' 查看日誌${NC}"
        log "System launched in background (PID: $pid, Auth: $auth_mode)"
        sleep 1
        return
    fi
    
    clear
    show_header

    # Pre-launch health check
    run_health_check

    if [ "$IsDashEnabled" = true ]; then
        if [ "${DASHBOARD_DEV_MODE:-false}" = "true" ]; then
            echo -e "  ${YELLOW}🚧 Dashboard 處於開發模式 (Dev Mode)${NC}"
            echo -e "  ${DIM}   🚀 正在背景啟動 Next.js 開發伺服器...${NC}"
            
            # 自動在背景啟動 Next.js Dev Server
            (cd "$SCRIPT_DIR/web-dashboard" && npm run dev > "$SCRIPT_DIR/logs/next-dev.log" 2>&1) &
            
            echo -e "  ${DIM}   後端伺服器已自動避讓至埠號 3001${NC}"
            echo -e "  ${GREEN}   🌐 存取介面指令 → ${BOLD}http://localhost:3000/dashboard${NC}"
            echo -e "  ${DIM}   開發伺服器日誌: logs/next-dev.log${NC}"
        elif [ ! -d "$SCRIPT_DIR/web-dashboard/out" ]; then
            echo -e "  ${YELLOW}⚠️  偵測到 Dashboard 尚未建置，正在為您自動建置...${NC}"
            step_install_dashboard
            # 重新檢查建置結果
            if [ ! -d "$SCRIPT_DIR/web-dashboard/out" ]; then
                echo -e "  ${RED}❌ 自動建置失敗，請檢查網路或執行 ./setup.sh --doctor 查看原因。${NC}"
                sleep 2
            fi
        else
            echo -e "  ${GREEN}🌐 Web Dashboard → http://localhost:${DASHBOARD_PORT:-3000}${NC}"
        fi
    fi

    echo -e "  ${CYAN}🚀 正在啟動 Golem v${GOLEM_VERSION} 控制台 (Single Mode)...${NC}"
    echo -e "  ${DIM}   正在載入 Neural Memory 與戰術介面...${NC}"
    echo -e "  ${DIM}   若要離開，請按 'q' 或 Ctrl+C${NC}"
    echo ""
    sleep 1
    log "System launched (Auth: $auth_mode)"

    # 建立環境變數前綴
    local env_cmd="env"
    [ -n "$auth_mode" ] && env_cmd="$env_cmd TG_AUTH_MODE=$auth_mode"

    $env_cmd npm run dashboard

    echo ""
    echo -e "  ${YELLOW}[INFO] 系統已停止。${NC}"
    log "System stopped"
    read -r -p "  按 Enter 返回主選單..."
    show_menu
}