#!/bin/bash
 
# ─── Step 0: Node.js 20 Detection ───
step_prepare_node_version() {
    echo -e "  🏥 檢查系統環境 (Node.js)..."
    log "Checking Node.js version"
    
    check_status
    if [ "$NODE_OK" = false ]; then
        echo -e "    ${RED}✖${NC} 核心環境: Node.js ${RED}$NODE_VER${NC} (建議版本: v20)"
        log "Node.js version mismatch: $NODE_VER"
        
        if [ "$NVM_OK" = true ]; then
            echo -e "    ${CYAN}💡 偵測到 NVM，正在自動切換至 Node.js 20...${NC}"
            if switch_node_version; then
                echo -e "    ${GREEN}✔${NC} 成功切換版本！"
                sleep 1
                check_status # 重新偵測環境
                return 0
            fi
        else
            ui_warn "建議手動安裝 Node.js v20 (Titan Chronos 推薦版本) 以確保最佳相容性。"
            echo -e "    ${DIM}下載地址: https://nodejs.org/dist/latest-v20.x/${NC}"
            sleep 2
        fi
    else
        echo -e "    ${GREEN}✔${NC} 核心環境: Node.js ${GREEN}$NODE_VER${NC} (符合需求)"
    fi
    echo ""
}

# ─── Step 0.5: Running Process Check ───
step_stop_running_system() {
    echo -e "  🔍 檢查執行中進程..."
    log "Checking for running processes before installation"
    
    # [MAGIC MODE] 安裝前無條件超級清洗 (包含失聯的 zombie port 3001)
    if [ "${GOLEM_MAGIC_MODE:-false}" = "true" ]; then
        echo -e "    ${CYAN}🧹 魔法模式：正在深度清理所有相關進程與佔用通訊埠...${NC}"
        stop_system false >/dev/null 2>&1
        echo -e "    ${GREEN}✔${NC} 系統環境已淨空"
        echo ""
        return
    fi
    
    check_status
    if [ "$IS_RUNNING" = true ] || lsof -i :3000 -t &>/dev/null || lsof -i :3001 -t &>/dev/null; then
        echo ""
        box_top
        box_line_colored "  ${RED}${BOLD}⚠️  偵測到系統正在執行中或通訊埠被佔用${NC}            "
        box_line_colored "  ${DIM}為避免檔案佔用或資料損壞，建議在安裝前先關閉進程。${NC}   "
        box_bottom
        echo ""
        
        if confirm_action "是否要自動關閉相關進程並繼續？"; then
            stop_system false
            ui_success "所有相關進程已關閉。"
            sleep 1
        else
            ui_error "安裝已取消。請先手動關閉程序再重新執行。"
            exit 1
        fi
    else
        echo -e "    ${GREEN}✔${NC} 查無佔用進程或通訊埠，可安全安裝"
    fi
    echo ""
}

# ─── Step 0.7: Environment Sanitization (Magic Mode Optimization) ───
step_sanitize_environment() {
    [ "${GOLEM_MAGIC_MODE:-false}" != "true" ] && return
    
    echo -e "  🧹 正在進行環境深度清理 (Sanitizing Environment)..."
    log "Magic mode sanitization started"

    # 1. Backup .env
    if [ -f "$DOT_ENV_PATH" ]; then
        mv "$DOT_ENV_PATH" "$DOT_ENV_PATH.tmp"
        echo -e "    ${GREEN}✔${NC} 已將現有的 .env 備份至 .env.tmp"
        log "Backed up .env to .env.tmp"
    fi

    # 2. Remove node_modules & lockfiles
    echo -e "    ${CYAN}📦 清除舊有依賴套件與 Lockfiles...${NC}"
    rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/package-lock.json"
    
    if [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        rm -rf "$SCRIPT_DIR/web-dashboard/node_modules"
        rm -rf "$SCRIPT_DIR/web-dashboard/.next"
        rm -rf "$SCRIPT_DIR/web-dashboard/.out"
        rm -rf "$SCRIPT_DIR/web-dashboard/out"
        rm -f "$SCRIPT_DIR/web-dashboard/package-lock.json"
    fi
    echo -e "    ${GREEN}✔${NC} 已清除所有 node_modules, .next, .out, out 與 package-lock.json"
    log "Removed node_modules, build cache, and package-lock.json files"

    # 3. Remove Memory
    local mem_dir="${USER_DATA_DIR:-./golem_memory}"
    if [[ "$mem_dir" == ./* ]]; then
        mem_dir="$SCRIPT_DIR/${mem_dir#./}"
    elif [[ "$mem_dir" != /* ]]; then
        mem_dir="$SCRIPT_DIR/$mem_dir"
    fi
    if [ -d "$mem_dir" ]; then
        rm -rf "$mem_dir"
        echo -e "    ${GREEN}✔${NC} 已清除舊有的 Golem 記憶資料庫"
        log "Removed memory directory"
    fi

    # 4. Backup Logs
    if [ -d "$LOG_DIR" ]; then
        # 先關閉當前 log 檔案 (若有需要) 並更名
        local timestamp; timestamp=$(date +%Y%m%d_%H%M%S)
        mv "$LOG_DIR" "${LOG_DIR}-tmp-${timestamp}"
        mkdir -p "$LOG_DIR"
        echo -e "    ${GREEN}✔${NC} 已將舊日誌封存至 ${LOG_DIR}-tmp-${timestamp}"
        log "Archived logs and recreated log directory"
    fi

    echo -e "  ${GREEN}✅ 環境清理完成，即將開始全新安裝流程。${NC}"
    echo ""
    sleep 2
}

# ─── Step 1: File Integrity ───
step_check_files() {
    echo -e "  🔍 檢查核心檔案完整性..."
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
        echo -e "  ${RED}   請確認已正確解壓縮 v9.1 zip 檔到此目錄。${NC}"
        echo -e "  ${DIM}   目前目錄: $SCRIPT_DIR${NC}"
        log "FATAL: Core files missing"
        exit 1
    fi
    echo -e "  ${GREEN}  ✅ 檔案完整性檢查通過 (${checked}/${#files[@]})${NC}"
    echo ""
}

# ─── Step 2: Env Check ───
step_check_env() {
    echo -e "  📄 檢查環境設定檔..."
    log "Checking .env"

    if [ ! -f "$DOT_ENV_PATH" ]; then
        if [ -f "$SCRIPT_DIR/.env.example" ]; then
            cp "$SCRIPT_DIR/.env.example" "$DOT_ENV_PATH"
            echo -e "    ${GREEN}✔${NC}  已從範本 ${BOLD}.env.example${NC} 建立 ${BOLD}.env${NC}"
            log "Created .env from example"
        else
            echo -e "    ${YELLOW}ℹ${NC}  找不到 .env.example，將建立基本 .env 檔案"
            cat > "$DOT_ENV_PATH" << 'ENVEOF'
TG_AUTH_MODE=ADMIN
# Golem Setup will be handled via Web Dashboard
DASHBOARD_PORT=3000
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

# ─── Step 3: Config Wizard (simplified — Bot configs now in Web Dashboard) ───
config_wizard() {
    # 自動啟用 Web Dashboard，不顯示任何資訊
    update_env "ENABLE_WEB_DASHBOARD" "true"
    ENABLE_WEB_DASHBOARD="true"
}

# ─── Step 3.5: Golems Config Wizard (已停用) ───
golems_wizard() {
    echo ""
    echo -e "  ${YELLOW}ℹ  多機配置功能已在此版本中移除，請使用單機模式。${NC}"
    echo ""
    read -r -p "  按 Enter 返回主選單..."
}



step_install_core() {
    echo -e "  📦 安裝核心依賴..."
    echo -e "  ${DIM}  (puppeteer, blessed, gemini-ai, discord.js ...)${NC}"
    log "Installing core dependencies"
    
    local arch=$(uname -m)
    local os=$(os_detect)
    local npm_flags="--no-fund --no-audit"
    
    # ─── 架構優化 (ARM64 / Apple Silicon) ───
    if [[ "$arch" == "arm64" ]] || [[ "$arch" == "aarch64" ]]; then
        ui_info "偵測到 ARM64 架構 (${arch})，正在調整安裝策略..."
        if [[ "$os" == "linux" ]] || [[ "$os" == "wsl" ]]; then
            # Linux ARM64 上的 Puppeteer 預設下載 amd64 Chromium 會失敗
            ui_warn "Linux ARM64 環境建議使用系統 Chromium 以確保相容性。"
            echo -e "  ${DIM}提示: sudo apt install chromium-browser -y${NC}"
            export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
        fi
    fi

    if ! run_quiet_step "npm install 安裝中" npm install $npm_flags; then
        echo -e "  ${RED}${BOLD}❌ 依賴安裝失敗${NC}"
        echo -e "  ${YELLOW}💡 建議解決方法:${NC}"
        echo -e "     • 🌐 ${BOLD}檢查網路${NC}：如果是 npm 連線問題，請確認是否需要設定 Proxy。"
        echo -e "     • 🔄 ${BOLD}Node.js 版本${NC}：確保版本 >= v20 (目前: $(node -v 2>/dev/null || echo N/A))。"
        echo -e "     • 🛡️  ${BOLD}權限問題${NC}：如果是 EACCES 錯誤，嘗試使用 ${BOLD}sudo npm install${NC}。"
        if [[ "$arch" == "arm64" ]]; then
            echo -e "     • 🍎 ${CYAN}ARM64/M1/M2${NC}：若編譯失敗，請安裝系統編譯工具：${DIM}xcode-select --install${NC}"
        fi
        echo ""
        echo -e "  ${CYAN}🏥 您可以執行實用的診斷工具：${BOLD}./setup.sh --doctor${NC}"
        echo -e "  ${DIM}詳細錯誤記錄於: $LOG_FILE${NC}"
        log "FATAL: npm install failed"
        exit 1
    fi

    # ─── Playwright 瀏覽器安裝 ───
    ui_info "正在準備瀏覽器核心 (Playwright Chromium)..."
    if ! run_quiet_step "安裝 Playwright 瀏覽器" npx playwright install chromium; then
        ui_warn "Playwright 瀏覽器安裝失敗，但系統可能仍可運作 (若已安裝過)。"
        log "Playwright browser install failed or was already present"
    fi

    # 確保 TUI 套件存在
    if [ ! -d "$SCRIPT_DIR/node_modules/blessed" ]; then
        ui_info "補安裝 blessed 介面庫..."
        run_quiet_step "安裝 blessed 套件" npm install blessed blessed-contrib express $npm_flags
    fi
    ui_success "核心依賴安裝完成\n"
}

step_install_dashboard() {
    echo -e "  🌐 設定 Web Dashboard..."
    log "Setting up dashboard"
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null
    # 若變數未設定但目錄存在，預設為開啟
    if [ -z "${ENABLE_WEB_DASHBOARD:-}" ] && [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        ENABLE_WEB_DASHBOARD="true"
        update_env "ENABLE_WEB_DASHBOARD" "true"
    fi

    if [ "${ENABLE_WEB_DASHBOARD:-false}" != "true" ]; then
        echo -e "    ${DIM}⏩ Dashboard 已停用，跳過安裝${NC}\n"; return
    fi

    if [ ! -d "$SCRIPT_DIR/web-dashboard" ]; then
        ui_warn "找不到 web-dashboard 目錄，自動停用 Dashboard"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        echo ""
        return
    fi

    echo -e "    ${CYAN}偵測到 Dashboard 模組，開始安裝...${NC}"

    pushd "$SCRIPT_DIR/web-dashboard" > /dev/null
    
    if ! run_quiet_step "安裝 Dashboard 依賴" npm install --no-fund --no-audit; then
        ui_error "Dashboard 依賴安裝失敗"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        log "Dashboard deps install failed"
        popd > /dev/null
        echo ""
        return
    fi

    if [ "${DASHBOARD_DEV_MODE:-false}" = "true" ]; then
        ui_info "偵測到 DASHBOARD_DEV_MODE=true，跳過 Next.js 建置步驟。"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        log "Dashboard build skipped (Dev Mode)"
    elif ! run_quiet_step "建置 Dashboard (Next.js Build)" npm run build; then
        ui_warn "Dashboard 建置失敗！"
        ui_warn "這通常是因為環境或依賴問題，您可以之後在選單中單獨嘗試 [4] 建置。"
        update_env "ENABLE_WEB_DASHBOARD" "true"  # 保持為 true，讓 launch_system 的自動修復邏輯能介入
        log "Dashboard build failed, kept as enabled for later retry"
    else
        ui_success "Dashboard 建置完成"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        log "Dashboard build succeeded"
    fi
    
    popd > /dev/null
    echo ""
}

# ─── Clean Dependencies (Preserve configs) ───
run_clean_dependencies() {
    echo ""
    box_top
    box_line_colored "  ${BOLD}${YELLOW}🧹 警告：即將清除所有套件依賴 (node_modules)${NC}        "
    box_line_colored "  ${DIM}此操作將保留：.env, golems.json, 記憶資料, 日誌${NC}      "
    box_bottom
    echo ""
    if ! confirm_action "確定要清除依賴並重新初始化環境嗎？"; then
        echo -e "  ${DIM}已取消操作。${NC}\n"
        sleep 1
        return
    fi

    # 停止系統服務以釋放檔案鎖
    stop_system false

    echo -e "  ${CYAN}🧹 正在清除套件依賴與建置檔...${NC}"
    log "Running clean dependencies - preserving configs/data"
    
    # 清除主程式依賴
    rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/package-lock.json"
    echo -e "    ${GREEN}✔${NC} 已移除主程式 node_modules"
    
    # 清除 Dashboard 依賴與建置結果
    if [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        rm -rf "$SCRIPT_DIR/web-dashboard/node_modules" "$SCRIPT_DIR/web-dashboard/package-lock.json" "$SCRIPT_DIR/web-dashboard/.next" "$SCRIPT_DIR/web-dashboard/.out" "$SCRIPT_DIR/web-dashboard/out"
        echo -e "    ${GREEN}✔${NC} 已移除 Dashboard node_modules 與 .out/out 目錄"
    fi
    
    echo -e "  ${GREEN}✅ 清除完成！${NC}"
    echo -e "  ${DIM}提示：您可以接著執行「Install」重新安裝套件。${NC}"
    log "Clean dependencies completed"
    sleep 2
}

# ─── Clean Init ───
run_clean_init() {
    echo ""
    box_top
    box_line_colored "  ${BOLD}${RED}⚠️  警告：這將會刪除所有本地資料！${NC}                      "
    box_line_colored "  ${DIM}即將刪除：node_modules、記憶資料、logs 等目錄${NC}        "
    box_bottom
    echo ""
    if ! confirm_action "確定要執行完全初始化嗎？"; then
        echo -e "  ${DIM}已取消初始化。${NC}\n"
        sleep 1
        return
    fi

    # ✅ 優先停止系統服務再刪除資源
    stop_system false

    echo -e "  ${CYAN}🧹 正在清理系統資料...${NC}"
    log "Running clean init - stopping system and deleting directories"
    
    # 刪除各項目錄
    rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/package-lock.json"
    echo -e "    ${GREEN}✔${NC} 刪除主程式依賴 (node_modules)"
    
    if [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        rm -rf "$SCRIPT_DIR/web-dashboard/node_modules" "$SCRIPT_DIR/web-dashboard/package-lock.json" "$SCRIPT_DIR/web-dashboard/.next" "$SCRIPT_DIR/web-dashboard/.out" "$SCRIPT_DIR/web-dashboard/out"
        echo -e "    ${GREEN}✔${NC} 刪除 Dashboard 依賴與建置快取"
    fi
    
    local mem_dir="${USER_DATA_DIR:-./golem_memory}"
    # Resolving if it's relative
    if [[ "$mem_dir" == ./* ]]; then
        mem_dir="$SCRIPT_DIR/${mem_dir#./}"
    elif [[ "$mem_dir" != /* ]]; then
        mem_dir="$SCRIPT_DIR/$mem_dir"
    fi
    rm -rf "$mem_dir"
    echo -e "    ${GREEN}✔${NC} 刪除 Golem 記憶資料庫"
    
    # Logs directory
    rm -rf "$SCRIPT_DIR/logs"
    echo -e "    ${GREEN}✔${NC} 刪除系統日誌 (logs)"

    # .env file
    if [ -f "$DOT_ENV_PATH" ]; then
        rm -f "$DOT_ENV_PATH"
        echo -e "    ${GREEN}✔${NC} 刪除環境設定檔 (.env)"
    fi
    
    echo -e "  ${GREEN}✅ 清理完成！請重新啟動或進行手動配置。${NC}"
    sleep 2
    
    # recreate log dir since we just deleted it
    mkdir -p "$SCRIPT_DIR/logs"
}

# ─── Full Install ───
run_full_install() {
    timer_start
    local total_steps=8
    log "Full install started"

    echo -e "  ${BOLD}${CYAN}📦 開始完整安裝流程${NC}"
    echo -e "  ${DIM}$(pick_tagline)${NC}"
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Step 1: Check Process
    progress_bar 1 $total_steps "檢查執行中進程"
    echo ""
    step_stop_running_system
    
    # Step 2: Environment Sanitization
    progress_bar 2 $total_steps "環境深度清理"
    echo ""
    step_sanitize_environment

    # Step 3: Node Check
    progress_bar 3 $total_steps "檢查 Node.js 版本"
    echo ""
    step_prepare_node_version

    # Step 4: Check files
    progress_bar 4 $total_steps "檢查核心檔案"
    echo ""
    step_check_files

    # Step 5: Check env
    progress_bar 5 $total_steps "檢查環境設定"
    echo ""
    step_check_env

    # Step 6: Install core deps
    progress_bar 6 $total_steps "安裝核心依賴"
    echo ""
    step_install_core

    # Step 7: Install dashboard
    progress_bar 7 $total_steps "安裝 Dashboard"
    echo ""
    step_install_dashboard

    # Step 8: Health check & Verification
    progress_bar 8 $total_steps "系統健康檢查 & 驗證"
    echo ""
    check_status
    run_health_check
    
    echo -e "  🏥 正在執行系統環境最後驗證 (System Doctor)..."
    if npm run doctor -- --quiet; then
        ui_success "環境驗證通過！系統地基穩固。"
    else
        ui_warn "環境發現小狀況，請參考上方的診斷建議。"
    fi

    local elapsed; elapsed=$(timer_elapsed)
    log "Full install completed in $elapsed"
    step_final "$elapsed"
}


step_final() {
    local elapsed="${1:-}"
    clear; echo ""
    box_top
    box_line_colored "  ${GREEN}${BOLD}🎉 部署成功！${NC}"
    box_line_colored "  ${GREEN}${BOLD}   Golem v${GOLEM_VERSION} (Titan Chronos) 已就緒${NC}"
    box_sep
    box_line_colored "  ${BOLD}下一步操作：${NC}                                          "
    box_line_colored "  1. 🌐 開啟瀏覽器存取 ${BOLD}Dashboard${NC} 完成 API 設定 "
    box_line_colored "  2. 📝 在 Dashboard 中填入您的 ${BOLD}Gemini API Key${NC}"
    box_line_colored "  3. 🤖 新增您第一個傀儡實體並填入 ${BOLD}Bot Token${NC}"
    box_sep
    [ -n "$elapsed" ] && box_line_colored "  ⏱️  安裝耗時: ${CYAN}${elapsed}${NC}"
    box_line_colored "  📋 安裝日誌: ${DIM}${LOG_FILE}${NC}"
    box_bottom
    echo -e "\n  ${YELLOW}系統將在 5 秒後自動啟動... (按 Ctrl+C 取消)${NC}\n"

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
