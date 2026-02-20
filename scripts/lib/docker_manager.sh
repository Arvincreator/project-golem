#!/bin/bash

launch_docker() {
    check_status
    clear; echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🐳 Docker 啟動模式${NC}                                        "
    box_sep
    if [ "$DOCKER_OK" != true ] || [ "$COMPOSE_OK" != true ]; then
         box_line_colored "  ${RED}❌ Docker 或 Docker Compose 未安裝/未啟動${NC}                 "
         box_line_colored "  ${YELLOW}   請先安裝 Docker Desktop 或啟動 Docker 服務${NC}             "
         box_bottom; read -p " 按 Enter 返回..."; show_menu; return
    fi
    
    if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
         box_line_colored "  ${RED}❌ 找不到 docker-compose.yml${NC}                             "
         box_bottom
         read -p "  按 Enter 返回..." show_menu; return
    fi

    box_line_colored "  ${GREEN}✔${NC}  Docker 環境檢查通過                                    "
    box_line_colored "  🚀 即將執行: ${BOLD}docker compose up --build${NC}                     "
    box_line_colored "  🌐 外部瀏覽器可訪問: ${BOLD}http://localhost:3000${NC}                 "
    box_line_colored "  💡 按 ${BOLD}Ctrl+C${NC} 可停止容器並返回                               "
    box_bottom
    echo ""

    mkdir -p "$SCRIPT_DIR/golem_memory" "$SCRIPT_DIR/logs"

    if grep -q "PUPPETEER_REMOTE_DEBUGGING_PORT" "$DOT_ENV_PATH"; then
        echo -e "  ${CYAN}🔌 偵測到遠端除錯設定，正在啟動主機 Chrome...${NC}"
        "$SCRIPT_DIR/scripts/start-host-chrome.sh" &
        HOST_CHROME_PID=$!
        sleep 2
    fi

    echo -e "  ${CYAN}正在建置並啟動容器... (這可能需要一點時間)${NC}\n"
    
    # Run docker compose attached
    if docker compose up --build; then
        echo ""
        echo -e "  ${GREEN}✅ Docker 容器已停止${NC}"
    else
        echo ""
        echo -e "  ${RED}❌ Docker 啟動失敗${NC}"
    fi

    read -p " 按 Enter 返回主選單..."
    show_menu
}

clean_docker() {
    echo -e "\n  ${BOLD}${CYAN}🧹 清除 Docker 資源${NC}"
    echo -e "  ${DIM}這將停止容器並移除相關網路${NC}\n"
    
    # 1. Check if Docker Daemon is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "  ${RED}❌ 錯誤: Docker Daemon 未啟動。${NC}"
        echo -e "  ${YELLOW}   請先開啟 Docker Desktop 或啟動 Docker 服務。${NC}\n"
        read -p " 按 Enter 返回主選單..."
        show_menu
        return
    fi

    if confirm_action "確定要停止並移除容器?"; then
        local down_args=""
        
        # 2. Ask for Volume removal
        if confirm_action "是否要一併移除 Docker Volumes (清除資料庫/持久化資料)?"; then
            down_args="-v"
        fi

        echo -e "\n  ${CYAN}正在執行 docker compose down ${down_args}...${NC}"
        if docker compose down $down_args; then
            echo -e "  ${GREEN}✅ Docker 容器/網路已成功清理。${NC}"
            
            # 3. Ask for local directory removal
            if confirm_action "是否要徹底刪除本地資料夾 (golem_memory/, logs/)?"; then
                echo -e "  ${YELLOW}正在刪除本地持久化目錄...${NC}"
                rm -rf "$SCRIPT_DIR/golem_memory" "$SCRIPT_DIR/logs"
                mkdir -p "$SCRIPT_DIR/logs" # 保留 logs 目錄以供系統日誌使用
                echo -e "  ${GREEN}✅ 本地資料夾已清除。${NC}"
            fi
        else
            echo -e "  ${RED}❌ docker compose down 執行失敗。${NC}"
        fi
    else
        echo -e "  ${DIM}操作已取消。${NC}"
    fi
    sleep 1
    show_menu
}
