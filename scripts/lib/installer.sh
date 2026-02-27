#!/bin/bash

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
        echo -e "  ${RED}   請確認已正確解壓縮 V9.0 zip 檔到此目錄。${NC}"
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
            echo -e "    ${YELLOW}ℹ${NC}  已從範本 ${BOLD}.env.example${NC} 建立 ${BOLD}.env${NC}"
            log "Created .env from example"
        else
            echo -e "    ${YELLOW}ℹ${NC}  找不到 .env.example，將建立基本 .env 檔案"
            cat > "$DOT_ENV_PATH" << 'ENVEOF'
TG_AUTH_MODE=ADMIN
TG_CHAT_ID=
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

# ─── Step 3: Config Wizard ───
config_wizard() {
    echo ""
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🧙 環境變數配置精靈${NC}"
    box_line_colored "  ${DIM}設定 API Keys、Bot Tokens 與系統選項${NC}"
    box_sep
    box_line_colored "  ${DIM}提示: 直接按 Enter 保留目前值 │ 輸入 [B] 返回上一步${NC}"
    box_bottom
    echo ""

    # 讀取現有值
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null

    local step=1
    local total=6

    while [ $step -le $total ]; do
        case $step in
            1)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Google Gemini API Keys${NC}"
                echo -e "  ${DIM}取得: https://aistudio.google.com/app/apikey${NC}"
                local masked_gemini; masked_gemini=$(mask_value "${GEMINI_API_KEYS:-}")
                echo -e "  目前: ${CYAN}${masked_gemini}${NC}"
                read -r -p "  👉 輸入新 Keys (留空保留): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [ -n "$input" ]; then update_env "GEMINI_API_KEYS" "$input"; GEMINI_API_KEYS="$input"; fi
                step=$((step + 1)); echo "" ;;
            2)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Telegram Bot Token${NC}"
                local masked_tg; masked_tg=$(mask_value "${TELEGRAM_TOKEN:-}")
                echo -e "  目前: ${CYAN}${masked_tg}${NC}"
                read -r -p "  👉 輸入新 Token (留空保留 / B 返回): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then update_env "TELEGRAM_TOKEN" "$input"; TELEGRAM_TOKEN="$input"; fi
                step=$((step + 1)); echo "" ;;
            3)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Telegram 驗證模式${NC}"
                echo -e "  目前: ${CYAN}${TG_AUTH_MODE:-ADMIN}${NC}"
                read -r -p "  👉 選擇模式 [A] 個人 Admin ID / [C] 群組 Chat ID / [B] 返回: " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [[ "$input" =~ ^[Cc]$ ]]; then
                    update_env "TG_AUTH_MODE" "CHAT"
                    TG_AUTH_MODE="CHAT"
                    echo -e "  ${BOLD}${MAGENTA}[${step}.1/${total}]${NC} ${BOLD}Telegram Chat ID (群組/頻道 ID)${NC}"
                    echo -e "  目前: ${CYAN}${TG_CHAT_ID:-${DIM}(未設定)${NC}}${NC}"
                    read -r -p "  👉 輸入新 Chat ID (留空保留): " subinput
                    subinput=$(echo "$subinput" | xargs 2>/dev/null)
                    if [ -n "$subinput" ]; then update_env "TG_CHAT_ID" "$subinput"; TG_CHAT_ID="$subinput"; fi
                elif [[ "$input" =~ ^[Aa]$ ]] || [ -z "$input" ]; then
                    update_env "TG_AUTH_MODE" "ADMIN"
                    TG_AUTH_MODE="ADMIN"
                    echo -e "  ${BOLD}${MAGENTA}[${step}.1/${total}]${NC} ${BOLD}Telegram Admin User ID (個人 ID)${NC}"
                    echo -e "  目前: ${CYAN}${ADMIN_ID:-${DIM}(未設定)${NC}}${NC}"
                    read -r -p "  👉 輸入新 Admin ID (留空保留): " subinput
                    subinput=$(echo "$subinput" | xargs 2>/dev/null)
                    if [ -n "$subinput" ]; then
                        if [[ "$subinput" =~ ^-?[0-9]+$ ]]; then update_env "ADMIN_ID" "$subinput"; ADMIN_ID="$subinput"; fi
                    fi
                fi
                step=$((step + 1)); echo "" ;;
            4)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Discord Bot Token${NC}"
                local masked_dc; masked_dc=$(mask_value "${DISCORD_TOKEN:-}")
                echo -e "  目前: ${CYAN}${masked_dc}${NC}"
                read -r -p "  👉 輸入新 Token (留空保留 / B 返回): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then update_env "DISCORD_TOKEN" "$input"; DISCORD_TOKEN="$input"; fi
                step=$((step + 1)); echo "" ;;
            5)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Discord Admin User ID${NC}"
                echo -e "  目前: ${CYAN}${DISCORD_ADMIN_ID:-${DIM}(未設定)${NC}}${NC}"
                read -r -p "  👉 輸入新 ID (留空保留 / B 返回): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then
                    if [[ "$input" =~ ^[0-9]+$ ]]; then update_env "DISCORD_ADMIN_ID" "$input"; DISCORD_ADMIN_ID="$input"; fi
                fi
                step=$((step + 1)); echo "" ;;
            6)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Web Dashboard${NC}"
                echo -e "  目前: ${CYAN}${ENABLE_WEB_DASHBOARD:-false}${NC}"
                read -r -p "  👉 啟用 Web Dashboard? [Y/n/B] (留空保留): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [[ "$input" =~ ^[Yy]$ ]]; then update_env "ENABLE_WEB_DASHBOARD" "true"; ENABLE_WEB_DASHBOARD="true"
                elif [[ "$input" =~ ^[Nn]$ ]]; then update_env "ENABLE_WEB_DASHBOARD" "false"; ENABLE_WEB_DASHBOARD="false"; fi
                step=$((step + 1)); echo "" ;;
        esac
    done

    # ─── Summary Confirmation ────────────────────────────
    echo ""
    box_top
    box_line_colored "  ${BOLD}📋 配置摘要${NC}"
    box_sep
    local mg; mg=$(mask_value "${GEMINI_API_KEYS:-}")
    local mt; mt=$(mask_value "${TELEGRAM_TOKEN:-}")
    local md; md=$(mask_value "${DISCORD_TOKEN:-}")
    box_line_colored "  Gemini Keys:    ${CYAN}${mg}${NC}"
    box_line_colored "  TG Token:       ${CYAN}${mt}${NC}"
    if [ "$TG_AUTH_MODE" = "CHAT" ]; then
        box_line_colored "  TG Auth Mode:   ${CYAN}群組模式 (CHAT)${NC}"
        box_line_colored "  TG Chat ID:     ${CYAN}${TG_CHAT_ID:-未設定}${NC}"
    else
        box_line_colored "  TG Auth Mode:   ${CYAN}個人模式 (ADMIN)${NC}"
        box_line_colored "  TG Admin ID:    ${CYAN}${ADMIN_ID:-未設定}${NC}"
    fi
    box_line_colored "  DC Token:       ${CYAN}${md}${NC}"
    box_line_colored "  DC Admin ID:    ${CYAN}${DISCORD_ADMIN_ID:-未設定}${NC}"
    box_line_colored "  Dashboard:      ${CYAN}${ENABLE_WEB_DASHBOARD:-false}${NC}"
    box_sep
    box_line_colored "  ${GREEN}${BOLD}✅ 配置已儲存到 .env${NC}"
    box_bottom
    echo ""
    log "Config wizard completed"
    sleep 1
}

step_install_core() {
    echo -e "  📦 安裝核心依賴..."
    echo -e "  ${DIM}  (puppeteer, blessed, gemini-ai, discord.js ...)${NC}"
    log "Installing core dependencies"
    spinner_start "npm install 安裝中"
    npm install --no-fund --no-audit >> "$LOG_FILE" 2>&1
    local exit_code=$?
    spinner_stop $([ "$exit_code" -eq 0 ] && echo true || echo false)
    if [ "$exit_code" -ne 0 ]; then
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
    echo -e "  ${GREEN}  ✅ 核心依賴安裝完成${NC}\n"
}

step_install_dashboard() {
    echo -e "  🌐 設定 Web Dashboard..."
    log "Setting up dashboard"
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null
    if [ "$ENABLE_WEB_DASHBOARD" != "true" ]; then
        echo -e "    ${DIM}⏩ Dashboard 已停用，跳過安裝${NC}\n"; return
    fi
    if [ ! -d "$SCRIPT_DIR/web-dashboard" ]; then
        echo -e "    ${RED}⚠️  找不到 web-dashboard 目錄，自動停用 Dashboard${NC}"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        echo ""
        return
    fi

    echo -e "    ${CYAN}偵測到 Dashboard 模組，開始安裝...${NC}"

    spinner_start "安裝 Dashboard 依賴"
    (cd "$SCRIPT_DIR/web-dashboard" && npm install --no-fund --no-audit >> "$LOG_FILE" 2>&1)
    dep_exit=$?
    spinner_stop $([ "$dep_exit" -eq 0 ] && echo true || echo false)
    
    if [ "$dep_exit" -ne 0 ]; then
        echo -e "    ${RED}❌ Dashboard 依賴安裝失敗${NC}"
        echo -e "    ${DIM}詳細日誌: $LOG_FILE${NC}"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        log "Dashboard deps install failed"
        echo ""
        return
    fi

    spinner_start "建置 Dashboard (Next.js Build)"
    (cd "$SCRIPT_DIR/web-dashboard" && npm run build >> "$LOG_FILE" 2>&1)
    local build_exit=$?
    spinner_stop $([ "$build_exit" -eq 0 ] && echo true || echo false)

    if [ "$build_exit" -ne 0 ]; then
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

# ─── Full Install ───
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
