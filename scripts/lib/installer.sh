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
GOLEM_INTERVENTION_LEVEL=CONSERVATIVE
OPTIONAL_SKILLS=
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
    echo ""
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}⚙️  環境變數配置精靈${NC}"
    box_line_colored "  ${DIM}設定 API Keys 與系統選項${NC}"
    box_sep
    box_line_colored "  ${YELLOW}ℹ 提示: Golem Bot Token 設定請透過 Web Dashboard 管理${NC}"
    box_line_colored "  ${DIM}      啟動後前往 http://localhost:3000 → 新增 Golem${NC}"
    box_sep
    box_line_colored "  ${DIM}直接按 Enter 保留目前值 │ 輸入 [B] 返回上一步${NC}"
    box_bottom
    echo ""

    # 讀取現有值
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null

    local step=1
    local total=4

    while [ $step -le 4 ]; do
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
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Web Dashboard${NC}"
                SINGLESELECT_DEFAULT="${ENABLE_WEB_DASHBOARD:-true}"
                prompt_singleselect "啟用 Web Dashboard?" \
                    "true|啟用 Dashboard (推薦)" \
                    "false|停用 Dashboard" \
                    "BACK|返回上一步 (B)"
                local input="$SINGLESELECT_RESULT"
                if [[ "$input" == "BACK" ]]; then step=$((step - 1)); continue; fi
                if [[ "$input" == "true" ]]; then update_env "ENABLE_WEB_DASHBOARD" "true"; ENABLE_WEB_DASHBOARD="true"
                elif [[ "$input" == "false" ]]; then update_env "ENABLE_WEB_DASHBOARD" "false"; ENABLE_WEB_DASHBOARD="false"; fi
                step=$((step + 1)); echo "" ;;
            3)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}觀察者介入等級 (全域預設)${NC}"
                echo -e "  ${DIM}當子機器人沒單獨設定時，將採用此全域模式。${NC}"
                SINGLESELECT_DEFAULT="${GOLEM_INTERVENTION_LEVEL:-CONSERVATIVE}"
                prompt_singleselect "選擇等級:" \
                    "CONSERVATIVE|保守 (僅限系統威脅/資安風險)" \
                    "NORMAL|標準 (錯誤糾正、邏輯矛盾、安全提示)" \
                    "PROACTIVE|積極 (主動提供建議、優化與協助)" \
                    "BACK|返回上一步 (B)"
                local input="$SINGLESELECT_RESULT"
                if [[ "$input" == "BACK" ]]; then step=$((step - 1)); continue; fi
                update_env "GOLEM_INTERVENTION_LEVEL" "$input"
                GOLEM_INTERVENTION_LEVEL="$input"
                step=$((step + 1)); echo "" ;;
            4)
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}選擇可選技能模組${NC}"
                MULTISELECT_DEFAULT="${OPTIONAL_SKILLS:-}"
                prompt_multiselect "使用空白鍵啟用特定功能 (按 Enter 確認):" \
                    "git|Git 檔案變更、分支操作" \
                    "image-prompt|圖片提示詞生成與分析" \
                    "moltbot|Moltie 相關文件/指令參考" \
                    "spotify|Spotify 音樂播放與控制" \
                    "youtube|YouTube 影片及音樂控制"
                update_env "OPTIONAL_SKILLS" "$MULTISELECT_RESULT"
                OPTIONAL_SKILLS="$MULTISELECT_RESULT"
                step=$((step + 1)); echo "" ;;
        esac
    done

    # ─── Summary ────────────────────────────────────────────
    echo ""
    box_top
    box_line_colored "  ${BOLD}📋 配置摘要${NC}"
    box_sep
    local mg; mg=$(mask_value "${GEMINI_API_KEYS:-}")
    box_line_colored "  Gemini Keys:    ${CYAN}${mg}${NC}"
    box_line_colored "  Dashboard:      ${CYAN}${ENABLE_WEB_DASHBOARD:-true}${NC}"
    box_line_colored "  Intent Level:   ${CYAN}${GOLEM_INTERVENTION_LEVEL:-CONSERVATIVE}${NC}"
    box_line_colored "  Optional Skills:${CYAN}${OPTIONAL_SKILLS:-無}${NC}"
    box_sep
    box_line_colored "  ${GREEN}${BOLD}✅ 配置已儲存到 .env${NC}"
    box_line_colored "  ${DIM}Bot Token 與 Golem 設定請透過 Web Dashboard 管理${NC}"
    box_bottom
    echo ""
    log "Config wizard completed"
    sleep 1
}

# ─── Step 3.5: Golems Config Wizard (已遷移至 Web Dashboard) ───
golems_wizard() {
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🌐 Golem 多機配置 → 已遷移至 Web Dashboard${NC}"
    box_sep
    box_line_colored "  ${DIM}現在可直接透過 Web Dashboard 新增並管理 Golem 實體：${NC}"
    box_line_colored ""
    box_line_colored "  ${GREEN}1.${NC} 啟動系統:  ${BOLD}./setup.sh --start${NC}"
    box_line_colored "  ${GREEN}2.${NC} 開啟瀏覽器: ${BOLD}http://localhost:${DASHBOARD_PORT:-3000}${NC}"
    box_line_colored "  ${GREEN}3.${NC} 點擊「新增 Golem」填入 Token 即可啟動"
    box_line_colored ""
    box_line_colored "  ${DIM}golems.json 仍可手動編輯，格式不變。${NC}"
    box_bottom
    echo ""
    read -r -p "  按 Enter 返回主選單..."
}



step_install_core() {
    echo -e "  📦 安裝核心依賴..."
    echo -e "  ${DIM}  (puppeteer, blessed, gemini-ai, discord.js ...)${NC}"
    log "Installing core dependencies"
    
    if ! run_quiet_step "npm install 安裝中" npm install --no-fund --no-audit; then
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
        ui_info "補安裝 blessed 介面庫..."
        run_quiet_step "安裝 blessed 套件" npm install blessed blessed-contrib express --no-fund --no-audit
    fi
    ui_success "核心依賴安裝完成\n"
}

step_install_dashboard() {
    echo -e "  🌐 設定 Web Dashboard..."
    log "Setting up dashboard"
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null
    if [ "$ENABLE_WEB_DASHBOARD" != "true" ]; then
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

    if ! run_quiet_step "建置 Dashboard (Next.js Build)" npm run build; then
        ui_error "Dashboard 建置失敗"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        log "Dashboard build failed"
    else
        ui_success "Dashboard 建置完成"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        log "Dashboard build succeeded"
    fi
    
    popd > /dev/null
    echo ""
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

    echo -e "  ${CYAN}🧹 正在清理系統資料...${NC}"
    log "Running clean init - deleting directories"
    
    # 刪除各項目錄
    rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/package-lock.json"
    echo -e "    ${GREEN}✔${NC} 刪除主程式依賴 (node_modules)"
    
    if [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        rm -rf "$SCRIPT_DIR/web-dashboard/node_modules" "$SCRIPT_DIR/web-dashboard/package-lock.json" "$SCRIPT_DIR/web-dashboard/.next" "$SCRIPT_DIR/web-dashboard/out"
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
    
    echo -e "  ${GREEN}✅ 清理完成！請重新啟動或進行手動配置。${NC}"
    sleep 2
    
    # recreate log dir since we just deleted it
    mkdir -p "$SCRIPT_DIR/logs"
}

# ─── Full Install ───
run_full_install() {
    timer_start
    local total_steps=6
    log "Full install started"

    echo -e "  ${BOLD}${CYAN}📦 開始完整安裝流程${NC}"
    echo -e "  ${DIM}$(pick_tagline)${NC}"
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

    # Step 3: Configure .env (Gemini Keys + System Options)
    progress_bar 3 $total_steps "配置環境變數"
    echo ""
    echo -e "  ${DIM}ℹ 設定 Gemini API Key 等系統選項。Golem Bot Token 請啟動後透過 Web Dashboard 配置。${NC}"
    echo ""
    config_wizard
    # 預設採用 MULTI 模式讓每個 Golem 可獨立設定
    update_env "GOLEM_MODE" "MULTI"

    # Step 4: Install core deps
    progress_bar 4 $total_steps "安裝核心依賴"
    echo ""
    step_install_core

    # Step 5: Install dashboard
    progress_bar 5 $total_steps "安裝 Dashboard"
    echo ""
    step_install_dashboard

    # Step 6: Health check + Done
    progress_bar 6 $total_steps "健康檢查 & 完成"
    echo ""
    check_status
    run_health_check

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
