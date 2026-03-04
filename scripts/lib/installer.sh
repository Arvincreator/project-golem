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

# ─── Step 3: Config Wizard ───
config_wizard() {
    local skip_bot_config="${1:-false}"
    echo ""
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🧙 環境變數配置精靈${NC}"
    box_line_colored "  ${DIM}設定 API Keys、Bot Tokens 與系統選項${NC}"
    box_sep
    box_line_colored "  ${DIM}提示: 直接按 Enter 保留目前值 │ 輸入 [B] 返回上一步${NC}"
    if [ "$skip_bot_config" = "true" ]; then
        box_line_colored "  ${YELLOW}ℹ 已開啟多機模式，將跳過 .env 中的 Bot Token 設定${NC}"
    fi
    box_bottom
    echo ""

    # 讀取現有值
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null

    local step=1
    local total=8
    [ "$skip_bot_config" = "true" ] && total=6

    while [ $step -le 8 ]; do
        local display_step=$step
        if [ "$skip_bot_config" = "true" ]; then
            if [ $step -ge 4 ]; then display_step=$((step - 2)); fi
        fi

        case $step in
            1)
                echo -e "  ${BOLD}${MAGENTA}[${display_step}/${total}]${NC} ${BOLD}Google Gemini API Keys${NC}"
                echo -e "  ${DIM}取得: https://aistudio.google.com/app/apikey${NC}"
                local masked_gemini; masked_gemini=$(mask_value "${GEMINI_API_KEYS:-}")
                echo -e "  目前: ${CYAN}${masked_gemini}${NC}"
                read -r -p "  👉 輸入新 Keys (留空保留): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [ -n "$input" ]; then update_env "GEMINI_API_KEYS" "$input"; GEMINI_API_KEYS="$input"; fi
                step=$((step + 1)); echo "" ;;
            2)
                if [ "$skip_bot_config" = "true" ]; then
                    step=$((step + 1)); continue
                fi
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Telegram Bot Token${NC}"
                local masked_tg; masked_tg=$(mask_value "${TELEGRAM_TOKEN:-}")
                echo -e "  目前: ${CYAN}${masked_tg}${NC}"
                read -r -p "  👉 輸入新 Token (留空保留 / B 返回): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then update_env "TELEGRAM_TOKEN" "$input"; TELEGRAM_TOKEN="$input"; fi
                step=$((step + 1)); echo "" ;;
            3)
                if [ "$skip_bot_config" = "true" ]; then
                    step=$((step + 1)); continue
                fi
                echo -e "  ${BOLD}${MAGENTA}[${step}/${total}]${NC} ${BOLD}Telegram 驗證模式${NC}"
                
                SINGLESELECT_DEFAULT="${TG_AUTH_MODE:-ADMIN}"
                prompt_singleselect "選擇模式:" \
                    "ADMIN|個人 Admin ID" \
                    "CHAT|群組 Chat ID" \
                    "BACK|返回上一步 (B)"
                local input="$SINGLESELECT_RESULT"

                if [[ "$input" == "BACK" ]]; then step=$((step - 1)); continue; fi
                
                if [[ "$input" == "CHAT" ]]; then
                    update_env "TG_AUTH_MODE" "CHAT"
                    TG_AUTH_MODE="CHAT"
                    echo -e "  ${BOLD}${MAGENTA}[${step}.1/${total}]${NC} ${BOLD}Telegram Chat ID (群組/頻道 ID)${NC}"
                    echo -e "  目前: ${CYAN}${TG_CHAT_ID:-${DIM}(未設定)${NC}}${NC}"
                    read -r -p "  👉 輸入新 Chat ID (留空保留): " subinput
                    subinput=$(echo "$subinput" | xargs 2>/dev/null)
                    if [ -n "$subinput" ]; then update_env "TG_CHAT_ID" "$subinput"; TG_CHAT_ID="$subinput"; fi
                elif [[ "$input" == "ADMIN" ]]; then
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
                echo -e "  ${BOLD}${MAGENTA}[${display_step}/${total}]${NC} ${BOLD}Discord Bot Token${NC}"
                local masked_dc; masked_dc=$(mask_value "${DISCORD_TOKEN:-}")
                echo -e "  目前: ${CYAN}${masked_dc}${NC}"
                read -r -p "  👉 輸入新 Token (留空保留 / B 返回): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then update_env "DISCORD_TOKEN" "$input"; DISCORD_TOKEN="$input"; fi
                step=$((step + 1)); echo "" ;;
            5)
                echo -e "  ${BOLD}${MAGENTA}[${display_step}/${total}]${NC} ${BOLD}Discord Admin User ID${NC}"
                echo -e "  目前: ${CYAN}${DISCORD_ADMIN_ID:-${DIM}(未設定)${NC}}${NC}"
                read -r -p "  👉 輸入新 ID (留空保留 / B 返回): " input
                input=$(echo "$input" | xargs 2>/dev/null)
                if [[ "$input" =~ ^[Bb]$ ]]; then step=$((step - 1)); continue; fi
                if [ -n "$input" ]; then
                    if [[ "$input" =~ ^[0-9]+$ ]]; then update_env "DISCORD_ADMIN_ID" "$input"; DISCORD_ADMIN_ID="$input"; fi
                fi
                step=$((step + 1)); echo "" ;;
            6)
                echo -e "  ${BOLD}${MAGENTA}[${display_step}/${total}]${NC} ${BOLD}Web Dashboard${NC}"
                SINGLESELECT_DEFAULT="${ENABLE_WEB_DASHBOARD:-false}"
                prompt_singleselect "啟用 Web Dashboard?" \
                    "true|啟用 Dashboard" \
                    "false|停用 Dashboard" \
                    "BACK|返回上一步 (B)"
                local input="$SINGLESELECT_RESULT"
                
                if [[ "$input" == "BACK" ]]; then step=$((step - 1)); continue; fi
                
                if [[ "$input" == "true" ]]; then update_env "ENABLE_WEB_DASHBOARD" "true"; ENABLE_WEB_DASHBOARD="true"
                elif [[ "$input" == "false" ]]; then update_env "ENABLE_WEB_DASHBOARD" "false"; ENABLE_WEB_DASHBOARD="false"; fi
                step=$((step + 1)); echo "" ;;
            7)
                echo -e "  ${BOLD}${MAGENTA}[${display_step}/${total}]${NC} ${BOLD}觀察者介入等級 (全域預設 / Global Default)${NC}"
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
            8)
                echo -e "  ${BOLD}${MAGENTA}[${display_step}/${total}]${NC} ${BOLD}選擇可選技能模組${NC}"
                MULTISELECT_DEFAULT="${OPTIONAL_SKILLS:-}"
                prompt_multiselect "使用空白鍵啟用特定功能 (按 Enter 確認):" \
                    "git|Git 檔案變更、分支操作" \
                    "image-prompt|圖片提示詞生成與分析" \
                    "moltbot|Moltie 相關文件/指令參考" \
                    "spotify|Spotify 音樂播放與控制" \
                    "youtube|YouTube 影片及音樂控制"
                
                # MULTISELECT_RESULT is set by prompt_multiselect
                update_env "OPTIONAL_SKILLS" "$MULTISELECT_RESULT"
                OPTIONAL_SKILLS="$MULTISELECT_RESULT"
                
                step=$((step + 1)); echo "" ;;
        esac
    done

    # ─── Summary Confirmation ────────────────────────────
    echo ""
    box_top
    box_line_colored "  ${BOLD}📋 配置摘要${NC}"
    box_sep
    local mg; mg=$(mask_value "${GEMINI_API_KEYS:-}")
    box_line_colored "  Gemini Keys:    ${CYAN}${mg}${NC}"
    
    if [ "$skip_bot_config" != "true" ]; then
        local mt; mt=$(mask_value "${TELEGRAM_TOKEN:-}")
        box_line_colored "  TG Token:       ${CYAN}${mt}${NC}"
        if [ "$TG_AUTH_MODE" = "CHAT" ]; then
            box_line_colored "  TG Auth Mode:   ${CYAN}群組模式 (CHAT)${NC}"
            box_line_colored "  TG Chat ID:     ${CYAN}${TG_CHAT_ID:-未設定}${NC}"
        else
            box_line_colored "  TG Auth Mode:   ${CYAN}個人模式 (ADMIN)${NC}"
            box_line_colored "  TG Admin ID:    ${CYAN}${ADMIN_ID:-未設定}${NC}"
        fi
    else
        box_line_colored "  TG Config:      ${YELLOW}於 golems.json 獨立配置${NC}"
    fi

    local md; md=$(mask_value "${DISCORD_TOKEN:-}")
    box_line_colored "  DC Token:       ${CYAN}${md}${NC}"
    box_line_colored "  DC Admin ID:    ${CYAN}${DISCORD_ADMIN_ID:-未設定}${NC}"
    box_line_colored "  Dashboard:      ${CYAN}${ENABLE_WEB_DASHBOARD:-false}${NC}"
    box_line_colored "  Intent Level:   ${CYAN}${GOLEM_INTERVENTION_LEVEL:-CONSERVATIVE}${NC}"
    box_line_colored "  Optional Skills:${CYAN}${OPTIONAL_SKILLS:-無}${NC}"
    box_sep
    box_line_colored "  ${GREEN}${BOLD}✅ 配置已儲存到 .env${NC}"
    box_bottom
    echo ""
    log "Config wizard completed"
    sleep 1
}

# ─── Step 3.5: Golems Config Wizard ───
golems_wizard() {
    echo ""
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🧙 多子神經網路配置精靈 (golems.json)${NC}"
    box_line_colored "  ${DIM}自動生成無限展頻的 Golems 配置檔${NC}"
    box_sep
    box_line_colored "  ${DIM}提示: 直接按 Enter 使用預設值 │ 輸入 [B] 返回主選單${NC}"
    box_bottom
    echo ""

    local GOLEMS_FILE="$SCRIPT_DIR/golems.json"
    local existing_count=2
    local has_existing=false

    if [ -f "$GOLEMS_FILE" ]; then
        has_existing=true
        echo -e "  ${YELLOW}⚠️  偵測到 golems.json 已經存在。${NC}"
        read -r -p "  👉 請問是否要覆寫或修改目前的設定檔？[y/N]: " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            echo -e "  ${DIM}已取消配置。${NC}\n"
            sleep 1
            return
        fi
        # 讀取現有數量
        existing_count=$(node -e "try { const c = require('$GOLEMS_FILE'); console.log(Array.isArray(c) ? c.length : 2); } catch(e) { console.log(2); }" 2>/dev/null)
    fi

    read -r -p "  👉 請問您想要部署幾台 Golem？ (輸入數字，預設: $existing_count / B 返回): " golem_count
    golem_count=$(echo "$golem_count" | xargs 2>/dev/null)
    if [[ "$golem_count" =~ ^[Bb]$ ]]; then return; fi
    if [[ ! "$golem_count" =~ ^[0-9]+$ ]] || [ "$golem_count" -le 0 ]; then
        golem_count=$existing_count
    fi

    local json_output="[\n"
    
    for (( i=1; i<=golem_count; i++ )); do
        # 嘗試讀取舊有值
        local old_id="" old_token="" old_role="" old_mode="ADMIN" old_auth_id="" old_intent="CONSERVATIVE"
        if [ "$has_existing" = "true" ]; then
            local idx=$((i-1))
            local raw; raw=$(node -e "try { 
                const c = require('$GOLEMS_FILE'); 
                const g = c[$idx] || {};
                console.log([g.id||'', g.tgToken||'', g.role||'', g.tgAuthMode||'ADMIN', g.adminId||g.chatId||'', g.interventionLevel||'CONSERVATIVE'].join('|'));
            } catch(e) { console.log('|||||'); }" 2>/dev/null)
            old_id=$(echo "$raw" | cut -d'|' -f1)
            old_token=$(echo "$raw" | cut -d'|' -f2)
            old_role=$(echo "$raw" | cut -d'|' -f3)
            old_mode=$(echo "$raw" | cut -d'|' -f4)
            old_auth_id=$(echo "$raw" | cut -d'|' -f5)
            old_intent=$(echo "$raw" | cut -d'|' -f6)
        fi

        # ASCII A, B, C...
        local default_id="golem_$(printf "\\$(printf "%03o" $((64+i)))")"
        if [ $i -gt 26 ]; then default_id="golem_$i"; fi
        [ -n "$old_id" ] && default_id="$old_id"
        
        echo -e "\n  ${BOLD}${MAGENTA}--- 設定第 $i 台 Golem (共 $golem_count 台) ---${NC}"
        
        read -r -p "  👉 [1/5] 輸入 Golem ID (預設: $default_id): " g_id
        g_id=$(echo "$g_id" | xargs 2>/dev/null)
        [ -z "$g_id" ] && g_id="$default_id"

        local masked_old_token; masked_old_token=$(mask_value "$old_token")
        local token_prompt="  👉 [2/5] 輸入 Telegram Token (必填): "
        [ -n "$old_token" ] && token_prompt="  👉 [2/5] 輸入 Telegram Token (留空保留: $masked_old_token): "
        
        read -r -p "$token_prompt" g_token
        g_token=$(echo "$g_token" | xargs 2>/dev/null)
        [ -z "$g_token" ] && g_token="$old_token"
        
        while [ -z "$g_token" ]; do
            read -r -p "    ${RED}Token 不能為空${NC}，請重新輸入: " g_token
            g_token=$(echo "$g_token" | xargs 2>/dev/null)
        done

        local def_role="一般助手"
        if [ $i -eq 1 ]; then def_role="主要對外對話窗口 (預設)"; fi
        if [ $i -eq 2 ]; then def_role="測試機/除錯/開發環境"; fi
        [ -n "$old_role" ] && def_role="$old_role"
        
        read -r -p "  👉 [3/5] 輸入角色/職責 (預設: $def_role): " g_role
        g_role=$(echo "$g_role" | xargs 2>/dev/null)
        [ -z "$g_role" ] && g_role="$def_role"

        read -r -p "  👉 [4/5] 選擇驗證模式 [A] 個人 ADMIN / [C] 群組 CHAT (目前: $old_mode): " g_auth_mode
        g_auth_mode=$(echo "$g_auth_mode" | xargs 2>/dev/null)
        local auth_mode_str="$old_mode"
        if [[ "$g_auth_mode" =~ ^[Cc]$ ]]; then auth_mode_str="CHAT"
        elif [[ "$g_auth_mode" =~ ^[Aa]$ ]]; then auth_mode_str="ADMIN"; fi

        local g_auth_id=""
        local id_prompt="    👉 輸入對應 個人 Admin ID"
        [ "$auth_mode_str" = "CHAT" ] && id_prompt="    👉 輸入對應 群組 Chat ID"
        [ -n "$old_auth_id" ] && id_prompt="$id_prompt (留空保留: $old_auth_id)"
        
        read -r -p "$id_prompt: " g_auth_id
        g_auth_id=$(echo "$g_auth_id" | xargs 2>/dev/null)
        [ -z "$g_auth_id" ] && g_auth_id="$old_auth_id"

        echo -e "    👉 [5/5] 選擇介入等級 (1:保守 / 2:標準 / 3:積極)"
        read -r -p "       (目前: $old_intent): " g_intent
        g_intent=$(echo "$g_intent" | xargs 2>/dev/null)
        local intent_str="$old_intent"
        case $g_intent in
            1) intent_str="CONSERVATIVE" ;;
            2) intent_str="NORMAL" ;;
            3) intent_str="PROACTIVE" ;;
        esac

        json_output+="  {\n    \"id\": \"$g_id\",\n    \"tgToken\": \"$g_token\",\n    \"role\": \"$g_role\",\n    \"interventionLevel\": \"$intent_str\""
        if [ -n "$auth_mode_str" ]; then json_output+=",\n    \"tgAuthMode\": \"$auth_mode_str\""; fi
        if [ -n "$g_auth_id" ]; then
            if [ "$auth_mode_str" = "CHAT" ]; then json_output+=",\n    \"chatId\": \"$g_auth_id\""
            else json_output+=",\n    \"adminId\": \"$g_auth_id\""; fi
        fi
        json_output+="\n  }"
        if [ $i -lt $golem_count ]; then json_output+=",\n"
        else json_output+="\n"; fi
    done

    json_output+="]"
    echo -e "$json_output" > "$GOLEMS_FILE"

    echo ""
    box_top
    box_line_colored "  ${BOLD}📋 多機配置摘要${NC}"
    box_sep
    # 使用 node 讀取剛才寫入的檔案並顯示摘要
    node -e "
        try {
            const golems = require('$GOLEMS_FILE');
            golems.forEach((g, i) => {
                console.log('  ' + (i+1) + '. ID: ' + g.id.padEnd(10) + ' | Level: ' + (g.interventionLevel || 'CONSERVATIVE'));
            });
        } catch(e) {}
    " | while read -r line; do
        box_line_colored "$line"
    done
    box_sep
    box_line_colored "  ${GREEN}${BOLD}✅ 多機配置已成功寫入 golems.json${NC}"
    box_line_colored "  ${DIM}共計 $golem_count 台 Golems | 模式: MULTI${NC}"
    box_bottom
    echo ""
    update_env "GOLEM_MODE" "MULTI"
    log "Golems wizard completed ($golem_count instances)"
    sleep 1
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

# ─── Full Install ───
run_full_install() {
    timer_start
    local total_steps=8
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

    # Step 3 & 4: Configuration
    progress_bar 3 $total_steps "部署模式選擇"
    echo ""
    echo -e "  ${BOLD}${CYAN}💡 請選擇您的部署模式：${NC}"
    
    SINGLESELECT_DEFAULT="1"
    prompt_singleselect "" \
        "1|單機模式 (Single Golem - 只啟動一個機器人，簡單快速)" \
        "2|多機模式 (Multi Golems - 可同時啟動多個機器人，需額外配置)"
    local install_mode="$SINGLESELECT_RESULT"

    if [ "$install_mode" = "2" ]; then
        # 多機模式 — 寫入 GOLEM_MODE=MULTI
        update_env "GOLEM_MODE" "MULTI"
        log "Mode set to MULTI"

        progress_bar 3 $total_steps "配置基礎環境 (跳過 Bot 設定)"
        echo ""
        config_wizard "true"

        progress_bar 4 $total_steps "配置多機實體 (golems.json)"
        echo ""
        golems_wizard
    else
        # 單機模式 — 寫入 GOLEM_MODE=SINGLE
        update_env "GOLEM_MODE" "SINGLE"
        log "Mode set to SINGLE"

        progress_bar 3 $total_steps "配置環境變數 (.env)"
        echo ""
        config_wizard "false"
        update_env "GOLEM_MODE" "SINGLE"

        progress_bar 4 $total_steps "確認單機配置"
        echo -e "  ${DIM}單機模式下將直接使用 .env 中的 Telegram 設定。${NC}\n"
        sleep 1
    fi

    # Step 5: Install core deps
    progress_bar 5 $total_steps "安裝核心依賴"
    echo ""
    step_install_core

    # Step 6: Install dashboard
    progress_bar 6 $total_steps "安裝 Dashboard"
    echo ""
    step_install_dashboard

    # Step 7: Health check
    progress_bar 7 $total_steps "健康檢查"
    echo ""
    check_status
    run_health_check

    # Step 8: Done
    progress_bar 8 $total_steps "完成"
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
