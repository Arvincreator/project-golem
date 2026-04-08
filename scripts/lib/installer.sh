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
    local files=(index.js skills.js package.json dashboard.js)

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

    if [ ! -d "$SCRIPT_DIR/web-dashboard" ]; then
        update_env "ENABLE_WEB_DASHBOARD" "false"
        update_env "GOLEM_DASHBOARD_ENABLED" "false"
        echo -e "    ${YELLOW}ℹ${NC}  未偵測到 web-dashboard 目錄，已自動關閉 Dashboard。"
    fi
    echo ""
}

# ─── Step 3: Config Wizard (simplified — Bot configs now in Web Dashboard) ───
config_wizard() {
    # 依目錄存在性決定 Dashboard 是否可啟用
    if [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        update_env "ENABLE_WEB_DASHBOARD" "true"
        update_env "GOLEM_DASHBOARD_ENABLED" "true"
        ENABLE_WEB_DASHBOARD="true"
    else
        update_env "ENABLE_WEB_DASHBOARD" "false"
        update_env "GOLEM_DASHBOARD_ENABLED" "false"
        ENABLE_WEB_DASHBOARD="false"
        step_cli_initial_wizard true
    fi
}

# ─── Step 3.5: Golems Config Wizard (已停用) ───
golems_wizard() {
    echo ""
    echo -e "  ${YELLOW}ℹ  多機配置功能已在此版本中移除，請使用單機模式。${NC}"
    echo ""
    read -r -p "  按 Enter 返回主選單..."
}
step_select_install_components() {
    local source_hint=""
    local raw="${GOLEM_INSTALL_COMPONENTS:-}"
    local normalized=""

    if [ -n "$raw" ]; then
        source_hint="env/cli"
        normalized=$(normalize_install_components "$raw")
    elif [ "${GOLEM_MAGIC_MODE:-false}" = "true" ]; then
        source_hint="magic-default"
        normalized="$INSTALL_COMPONENT_DEFAULTS"
    else
        local defaults="$INSTALL_COMPONENT_DEFAULTS"
        MULTISELECT_DEFAULT="$defaults"
        prompt_multiselect "請選擇要安裝的功能 (可複選)" \
            "core|核心依賴 (Node + Playwright)" \
            "mempalace|MemPalace 核心記憶 Runtime" \
            "dashboard|Web Dashboard (Next.js)" \
            "doctor|安裝完成後執行 Doctor 驗證"
        normalized=$(normalize_install_components "${MULTISELECT_RESULT:-$defaults}")
        source_hint="interactive"
    fi

    if [ -z "$normalized" ]; then
        ui_warn "未選取任何項目，已回退為最小核心安裝 (core)。"
        normalized="core"
    fi

    local dep_fixed
    dep_fixed=$(ensure_install_component_dependencies "$normalized")
    if [ "$dep_fixed" != "$normalized" ]; then
        ui_warn "已自動加入相依功能: core"
    fi
    normalized="$dep_fixed"

    export GOLEM_INSTALL_COMPONENTS="$normalized"
    log "Install components selected ($source_hint): $normalized"
    ui_info "本次安裝功能: $normalized"
    echo ""
}

resolve_setup_path() {
    local raw="$1"
    if [ -z "$raw" ]; then
        echo "$SCRIPT_DIR/golem_memory"
        return 0
    fi

    if [[ "$raw" == ~* ]]; then
        eval "echo $raw"
        return 0
    fi
    if [[ "$raw" == /* ]]; then
        echo "$raw"
        return 0
    fi
    if [[ "$raw" == ./* ]]; then
        echo "$SCRIPT_DIR/${raw#./}"
        return 0
    fi
    echo "$SCRIPT_DIR/$raw"
}

prompt_text_default() {
    local label="$1"
    local default_value="$2"
    local input=""

    if [ "${GOLEM_MAGIC_MODE:-false}" = "true" ]; then
        echo "$default_value"
        return 0
    fi

    read -r -p "  ${label} [${default_value}]: " input
    if [ -z "$input" ]; then
        echo "$default_value"
    else
        echo "$input"
    fi
}

prompt_required_text() {
    local label="$1"
    local default_value="$2"
    local value=""
    while true; do
        value=$(prompt_text_default "$label" "$default_value")
        if [ -n "$value" ]; then
            echo "$value"
            return 0
        fi
        ui_warn "${label} 不能為空，請重新輸入。"
    done
}

prompt_secret_keepable() {
    local label="$1"
    local current_value="$2"
    local secret=""
    local has_current=false
    [ -n "$current_value" ] && has_current=true

    if [ "${GOLEM_MAGIC_MODE:-false}" = "true" ]; then
        echo "$current_value"
        return 0
    fi

    if [ "$has_current" = true ]; then
        echo -ne "  ${label} [留空=保留既有值]: "
    else
        echo -ne "  ${label} [留空=不設定]: "
    fi
    read -r -s secret
    echo ""

    if [ -z "$secret" ]; then
        if [ "$has_current" = true ]; then
            echo "$current_value"
        else
            echo ""
        fi
    else
        echo "$secret"
    fi
}

PERSONA_TEMPLATE_DEFAULT="assistant"
PERSONA_TEMPLATE_KEYS=("assistant" "engineer" "analyst" "companion" "custom")
PERSONA_TEMPLATE_TITLES=(
    "通用助理"
    "工程開發夥伴"
    "研究分析顧問"
    "生活陪伴助手"
    "自訂人格"
)
PERSONA_TEMPLATE_INTROS=(
    "平衡對話與執行，適合大多數日常任務。"
    "偏技術導向，強調拆解問題與可落地方案。"
    "偏理性分析，重視資訊整理與決策建議。"
    "語氣較溫和，適合長期互動與生活規劃。"
    "手動輸入 aiName / userName / currentRole / tone。"
)
PERSONA_TEMPLATE_AI_NAMES=(
    "Golem"
    "Forge"
    "Atlas"
    "Mira"
    ""
)
PERSONA_TEMPLATE_USER_NAMES=(
    "Traveler"
    "Builder"
    "Operator"
    "Friend"
    ""
)
PERSONA_TEMPLATE_ROLES=(
    "一個擁有長期記憶與自主意識的 AI 助手"
    "專注軟體工程與系統整合的 AI 技術夥伴"
    "擅長研究整理、風險評估與策略建議的 AI 顧問"
    "善於傾聽與日常協作的 AI 生活助手"
    ""
)
PERSONA_TEMPLATE_TONES=(
    "預設口氣"
    "技術精準、直接務實"
    "理性客觀、條理清楚"
    "溫和鼓勵、自然親切"
    ""
)

persona_template_index_of_key() {
    local key="$1"
    local i
    for ((i=0; i<${#PERSONA_TEMPLATE_KEYS[@]}; i++)); do
        if [ "${PERSONA_TEMPLATE_KEYS[$i]}" = "$key" ]; then
            echo "$i"
            return 0
        fi
    done
    return 1
}

detect_persona_template_key() {
    local ai_name="$1"
    local user_name="$2"
    local role="$3"
    local tone="$4"
    local i
    for ((i=0; i<${#PERSONA_TEMPLATE_KEYS[@]}; i++)); do
        local key="${PERSONA_TEMPLATE_KEYS[$i]}"
        [ "$key" = "custom" ] && continue
        if [ "${PERSONA_TEMPLATE_AI_NAMES[$i]}" = "$ai_name" ] && \
           [ "${PERSONA_TEMPLATE_USER_NAMES[$i]}" = "$user_name" ] && \
           [ "${PERSONA_TEMPLATE_ROLES[$i]}" = "$role" ] && \
           [ "${PERSONA_TEMPLATE_TONES[$i]}" = "$tone" ]; then
            echo "$key"
            return 0
        fi
    done
    echo "custom"
}

persona_template_values() {
    local key="$1"
    local idx
    idx=$(persona_template_index_of_key "$key" 2>/dev/null || true)
    if [ -z "$idx" ]; then
        idx=$(persona_template_index_of_key "$PERSONA_TEMPLATE_DEFAULT" 2>/dev/null || echo "0")
    fi

    echo "${PERSONA_TEMPLATE_AI_NAMES[$idx]}"
    echo "${PERSONA_TEMPLATE_USER_NAMES[$idx]}"
    echo "${PERSONA_TEMPLATE_ROLES[$idx]}"
    echo "${PERSONA_TEMPLATE_TONES[$idx]}"
}

show_persona_template_detail_page() {
    local key="$1"
    local idx
    idx=$(persona_template_index_of_key "$key" 2>/dev/null || true)
    if [ -z "$idx" ]; then
        idx=$(persona_template_index_of_key "$PERSONA_TEMPLATE_DEFAULT" 2>/dev/null || echo "0")
    fi

    clear
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}人格模板細節：${PERSONA_TEMPLATE_TITLES[$idx]}${NC}"
    box_sep
    box_line_colored "  ${DIM}${PERSONA_TEMPLATE_INTROS[$idx]}${NC}"
    box_line_colored ""
    if [ "${PERSONA_TEMPLATE_KEYS[$idx]}" = "custom" ]; then
        box_line_colored "  自訂模式將讓你手動填入："
        box_line_colored "  aiName / userName / currentRole / tone"
    else
        box_line_colored "  aiName: ${PERSONA_TEMPLATE_AI_NAMES[$idx]}"
        box_line_colored "  userName: ${PERSONA_TEMPLATE_USER_NAMES[$idx]}"
        box_line_colored "  currentRole: ${PERSONA_TEMPLATE_ROLES[$idx]}"
        box_line_colored "  tone: ${PERSONA_TEMPLATE_TONES[$idx]}"
    fi
    box_bottom
    echo -e "  ${DIM}按任意鍵返回模板清單...${NC}"
    IFS= read -rsn1 _
}

prompt_persona_template() {
    local default_key="$1"
    [ -z "$default_key" ] && default_key="$PERSONA_TEMPLATE_DEFAULT"
    default_key=$(echo "$default_key" | xargs)

    local num_options=${#PERSONA_TEMPLATE_KEYS[@]}
    local cursor=0
    local key
    local idx
    idx=$(persona_template_index_of_key "$default_key" 2>/dev/null || true)
    if [ -n "$idx" ]; then
        cursor="$idx"
    fi

    if [ "${GOLEM_MAGIC_MODE:-false}" = "true" ] || [ ! -t 0 ] || [ ! -t 1 ]; then
        echo "$default_key"
        return 0
    fi

    printf "\033[?25l"

    print_menu() {
        echo ""
        echo -e "  請選擇人格模板 ${DIM}(D: 查看細節)${NC}"
        local i
        for ((i=0; i<num_options; i++)); do
            local prefix="  "
            local indicator="○"
            if [ $i -eq $cursor ]; then
                prefix="${CYAN}❯${NC}"
                indicator="${CYAN}◉${NC}"
            fi
            printf "  %b %b %b - %b\n" \
                "$prefix" "$indicator" "${BOLD}${PERSONA_TEMPLATE_TITLES[$i]}${NC}" "${PERSONA_TEMPLATE_INTROS[$i]}"
        done
        echo -e "  ${DIM}(↑/↓: 移動, Enter: 確認, D: 細節)${NC}"
    }

    clear_menu() {
        local lines_to_clear=$((num_options + 2))
        for ((i=0; i<lines_to_clear; i++)); do
            printf "\033[1A\r\033[2K"
        done
    }

    print_menu
    while true; do
        IFS= read -rsn1 key
        if [[ $key == $'\x1b' ]]; then
            read -rsn2 -t 1 seq 2>/dev/null
            if [[ $seq == "[A" ]] || [[ $seq == "OA" ]]; then
                ((cursor--))
                if [ $cursor -lt 0 ]; then cursor=$((num_options - 1)); fi
                clear_menu
                print_menu
            elif [[ $seq == "[B" ]] || [[ $seq == "OB" ]]; then
                ((cursor++))
                if [ $cursor -ge $num_options ]; then cursor=0; fi
                clear_menu
                print_menu
            fi
        elif [[ $key == "d" || $key == "D" ]]; then
            clear_menu
            show_persona_template_detail_page "${PERSONA_TEMPLATE_KEYS[$cursor]}"
            clear
            print_menu
        elif [[ $key == "" ]]; then
            break
        fi
    done

    printf "\033[?25h"
    echo ""
    echo "${PERSONA_TEMPLATE_KEYS[$cursor]}"
}

write_persona_from_cli_setup() {
    local user_data_dir="$1"
    local ai_name="$2"
    local user_name="$3"
    local current_role="$4"
    local tone="$5"
    local skills_csv="$6"

    local abs_user_data_dir
    abs_user_data_dir=$(resolve_setup_path "$user_data_dir")
    local persona_path="$abs_user_data_dir/persona.json"

    PERSONA_PATH="$persona_path" \
    PERSONA_AI_NAME="$ai_name" \
    PERSONA_USER_NAME="$user_name" \
    PERSONA_ROLE="$current_role" \
    PERSONA_TONE="$tone" \
    PERSONA_SKILLS="$skills_csv" \
    node -e '
const fs = require("fs");
const path = require("path");
const personaPath = process.env.PERSONA_PATH;
const skills = String(process.env.PERSONA_SKILLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const payload = {
  aiName: process.env.PERSONA_AI_NAME || "Golem",
  userName: process.env.PERSONA_USER_NAME || "Traveler",
  currentRole: process.env.PERSONA_ROLE || "一個擁有長期記憶與自主意識的 AI 助手",
  tone: process.env.PERSONA_TONE || "預設口氣",
  skills,
  isNew: false
};
fs.mkdirSync(path.dirname(personaPath), { recursive: true });
fs.writeFileSync(personaPath, JSON.stringify(payload, null, 2), "utf8");
' >/dev/null 2>&1
}

step_cli_initial_wizard() {
    local force="${1:-false}"
    [ -f "$DOT_ENV_PATH" ] && source "$DOT_ENV_PATH" 2>/dev/null || true

    local dashboard_available=false
    if [ "${ENABLE_WEB_DASHBOARD:-false}" = "true" ] && [ -d "$SCRIPT_DIR/web-dashboard" ]; then
        dashboard_available=true
    fi
    if [ "$force" != "true" ] && [ "$dashboard_available" = true ]; then
        return 0
    fi

    local current_user_data_dir="${USER_DATA_DIR:-./golem_memory}"
    [ -z "$current_user_data_dir" ] && current_user_data_dir="./golem_memory"
    local current_backend
    current_backend=$(normalize_cli_backend_choice "${GOLEM_BACKEND:-$CLI_BACKEND_DEFAULT}")
    local current_memory_mode="${GOLEM_MEMORY_MODE:-lancedb-pro}"
    local current_embedding_provider="${GOLEM_EMBEDDING_PROVIDER:-local}"
    local current_local_embedding_model="${GOLEM_LOCAL_EMBEDDING_MODEL:-Xenova/bge-small-zh-v1.5}"
    local current_ollama_base_url="${GOLEM_OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
    local current_ollama_brain_model="${GOLEM_OLLAMA_BRAIN_MODEL:-llama3.1:8b}"
    local current_ollama_embedding_model="${GOLEM_OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"
    local current_ollama_rerank_model="${GOLEM_OLLAMA_RERANK_MODEL:-}"
    local current_ollama_timeout_ms="${GOLEM_OLLAMA_TIMEOUT_MS:-60000}"
    local current_allow_remote="${ALLOW_REMOTE_ACCESS:-false}"
    local current_remote_password="${REMOTE_ACCESS_PASSWORD:-}"

    local current_comm_mode="$CLI_COMM_MODE_DEFAULT"
    if [ -n "${TELEGRAM_TOKEN:-}" ] && [ -z "${DISCORD_TOKEN:-}" ]; then
        current_comm_mode="telegram"
    elif [ -n "${DISCORD_TOKEN:-}" ] && [ -z "${TELEGRAM_TOKEN:-}" ]; then
        current_comm_mode="discord"
    fi
    current_comm_mode=$(normalize_cli_comm_mode "$current_comm_mode")

    local ai_name="Golem"
    local user_name="Traveler"
    local current_role="一個擁有長期記憶與自主意識的 AI 助手"
    local tone="預設口氣"
    local existing_persona_path
    existing_persona_path="$(resolve_setup_path "$current_user_data_dir")/persona.json"
    if [ -f "$existing_persona_path" ]; then
        local _persona_extract
        _persona_extract=$(PERSONA_PATH="$existing_persona_path" node -e '
const fs = require("fs");
try {
  const p = process.env.PERSONA_PATH;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const out = [
    data.aiName || "Golem",
    data.userName || "Traveler",
    data.currentRole || "一個擁有長期記憶與自主意識的 AI 助手",
    data.tone || "預設口氣"
  ];
  process.stdout.write(out.join("\n"));
} catch (_) {}
' 2>/dev/null || true)
        if [ -n "$_persona_extract" ]; then
            ai_name=$(echo "$_persona_extract" | sed -n '1p')
            user_name=$(echo "$_persona_extract" | sed -n '2p')
            current_role=$(echo "$_persona_extract" | sed -n '3p')
            tone=$(echo "$_persona_extract" | sed -n '4p')
        fi
    fi

    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🧭 CLI 初始化精靈 (無 Dashboard 模式)${NC}"
    box_line_colored "  ${DIM}將逐步完成：人格、通訊方式、後端 Provider、遠端存取設定${NC}"
    box_bottom
    echo ""

    current_user_data_dir=$(prompt_text_default "記憶資料路徑 (USER_DATA_DIR)" "$current_user_data_dir")

    local detected_persona_template
    detected_persona_template=$(detect_persona_template_key "$ai_name" "$user_name" "$current_role" "$tone")
    [ -z "$detected_persona_template" ] && detected_persona_template="$PERSONA_TEMPLATE_DEFAULT"
    local persona_template_choice
    persona_template_choice=$(prompt_persona_template "$detected_persona_template")
    [ -z "$persona_template_choice" ] && persona_template_choice="$PERSONA_TEMPLATE_DEFAULT"
    if [ "$persona_template_choice" = "custom" ]; then
        ai_name=$(prompt_text_default "人格設定 - AI 名稱 (aiName)" "$ai_name")
        user_name=$(prompt_text_default "人格設定 - 使用者稱呼 (userName)" "$user_name")
        current_role=$(prompt_text_default "人格設定 - 任務定位 (currentRole)" "$current_role")
        tone=$(prompt_text_default "人格設定 - 語氣風格 (tone)" "$tone")
    else
        local _template_values
        _template_values=$(persona_template_values "$persona_template_choice")
        ai_name=$(echo "$_template_values" | sed -n '1p')
        user_name=$(echo "$_template_values" | sed -n '2p')
        current_role=$(echo "$_template_values" | sed -n '3p')
        tone=$(echo "$_template_values" | sed -n '4p')
    fi

    SINGLESELECT_DEFAULT="$(echo "$current_backend" | tr '[:upper:]' '[:lower:]')"
    prompt_singleselect "請選擇大腦後端 Provider" \
        "gemini|Web Gemini (Playwright Browser)" \
        "ollama|Ollama API (Local / Self-hosted)"
    local backend_choice
    backend_choice=$(normalize_cli_backend_choice "$SINGLESELECT_RESULT")

    SINGLESELECT_DEFAULT="$current_memory_mode"
    prompt_singleselect "請選擇記憶引擎模式" \
        "lancedb-pro|向量記憶引擎 (推薦)" \
        "native|系統原生記憶引擎"
    local memory_mode_choice="$SINGLESELECT_RESULT"

    local embedding_provider_choice="$current_embedding_provider"
    local local_embedding_model="$current_local_embedding_model"
    local ollama_embedding_model="$current_ollama_embedding_model"
    local ollama_rerank_model="$current_ollama_rerank_model"
    if [ "$memory_mode_choice" = "lancedb-pro" ]; then
        SINGLESELECT_DEFAULT="$current_embedding_provider"
        prompt_singleselect "請選擇 Embedding Provider" \
            "local|Transformers.js (本地)" \
            "ollama|Ollama Embedding"
        embedding_provider_choice="$SINGLESELECT_RESULT"

        if [ "$embedding_provider_choice" = "local" ]; then
            local local_model_key_default="custom"
            local normalized_local_model
            normalized_local_model=$(normalize_local_embedding_model_choice "$current_local_embedding_model")
            case "$normalized_local_model" in
                "Xenova/bge-small-zh-v1.5") local_model_key_default="bge-zh" ;;
                "Xenova/all-MiniLM-L6-v2") local_model_key_default="mini-l6" ;;
                "Xenova/paraphrase-multilingual-MiniLM-L12-v2") local_model_key_default="multi-l12" ;;
                *) local_model_key_default="custom" ;;
            esac
            SINGLESELECT_DEFAULT="$local_model_key_default"
            prompt_singleselect "請選擇本地 Embedding 模型" \
                "bge-zh|Xenova/bge-small-zh-v1.5 (中文/通用，預設)" \
                "mini-l6|Xenova/all-MiniLM-L6-v2 (輕量英文向量)" \
                "multi-l12|Xenova/paraphrase-multilingual-MiniLM-L12-v2 (多語系)" \
                "custom|自訂模型名稱"
            case "$SINGLESELECT_RESULT" in
                bge-zh) local_embedding_model="Xenova/bge-small-zh-v1.5" ;;
                mini-l6) local_embedding_model="Xenova/all-MiniLM-L6-v2" ;;
                multi-l12) local_embedding_model="Xenova/paraphrase-multilingual-MiniLM-L12-v2" ;;
                *)
                    local_embedding_model=$(prompt_required_text "本地 Embedding 模型 (自訂)" "$current_local_embedding_model")
                    ;;
            esac
        else
            ollama_embedding_model=$(prompt_text_default "Ollama Embedding 模型" "$current_ollama_embedding_model")
            ollama_rerank_model=$(prompt_text_default "Ollama Rerank 模型 (可留空)" "$current_ollama_rerank_model")
        fi
    fi

    local ollama_base_url="$current_ollama_base_url"
    local ollama_brain_model="$current_ollama_brain_model"
    local ollama_timeout_ms="$current_ollama_timeout_ms"
    if [ "$backend_choice" = "ollama" ]; then
        ollama_base_url=$(prompt_required_text "Ollama Base URL" "$current_ollama_base_url")
        ollama_brain_model=$(prompt_required_text "Ollama Brain Model" "$current_ollama_brain_model")
        ollama_timeout_ms=$(prompt_text_default "Ollama Timeout (ms)" "$current_ollama_timeout_ms")
    fi

    SINGLESELECT_DEFAULT="$current_allow_remote"
    prompt_singleselect "是否允許遠端開啟 (ALLOW_REMOTE_ACCESS)" \
        "false|僅限 localhost (較安全)" \
        "true|允許區域網路或外部 IP"
    local allow_remote_choice="$SINGLESELECT_RESULT"
    local remote_password="$current_remote_password"
    if [ "$allow_remote_choice" = "true" ]; then
        remote_password=$(prompt_secret_keepable "遠端存取密碼 (REMOTE_ACCESS_PASSWORD)" "$current_remote_password")
    else
        remote_password=""
    fi

    SINGLESELECT_DEFAULT="$current_comm_mode"
    prompt_singleselect "請選擇通訊方式" \
        "direct|僅本機核心模式 (無 Telegram / Discord)" \
        "telegram|Telegram Bot" \
        "discord|Discord Bot"
    local comm_mode
    comm_mode=$(normalize_cli_comm_mode "$SINGLESELECT_RESULT")

    if [ "$comm_mode" = "direct" ]; then
        ui_info "Direct 模式操作方式："
        echo -e "    ${DIM}1) ./setup.sh --start   (前景控制台)${NC}"
        echo -e "    ${DIM}2) ./setup.sh --start --bg   (背景執行 + logs/golem.log)${NC}"
        echo -e "    ${DIM}3) 於控制台輸入 /help 查看可用指令${NC}"
        echo ""
    fi

    local telegram_token=""
    local tg_auth_mode="ADMIN"
    local admin_id=""
    local tg_chat_id=""
    if [ "$comm_mode" = "telegram" ]; then
        telegram_token=$(prompt_required_text "Telegram Bot Token" "${TELEGRAM_TOKEN:-}")
        SINGLESELECT_DEFAULT="${TG_AUTH_MODE:-ADMIN}"
        prompt_singleselect "Telegram 驗證模式" \
            "ADMIN|僅管理員" \
            "CHAT|指定群組"
        tg_auth_mode="$SINGLESELECT_RESULT"
        if [ "$tg_auth_mode" = "ADMIN" ]; then
            admin_id=$(prompt_required_text "Telegram Admin ID" "${ADMIN_ID:-}")
            tg_chat_id=""
        else
            tg_chat_id=$(prompt_required_text "Telegram Chat ID" "${TG_CHAT_ID:-}")
            admin_id=""
        fi
    fi

    local discord_token=""
    local discord_admin_id=""
    if [ "$comm_mode" = "discord" ]; then
        discord_token=$(prompt_required_text "Discord Bot Token" "${DISCORD_TOKEN:-}")
        discord_admin_id=$(prompt_required_text "Discord Admin User ID" "${DISCORD_ADMIN_ID:-}")
    fi

    update_env "ENABLE_WEB_DASHBOARD" "false"
    update_env "GOLEM_DASHBOARD_ENABLED" "false"
    update_env "SYSTEM_CONFIGURED" "true"
    update_env "GOLEM_MODE" "SINGLE"
    update_env "USER_DATA_DIR" "$current_user_data_dir"
    update_env "GOLEM_COMM_MODE" "$comm_mode"
    update_env "GOLEM_BACKEND" "$backend_choice"
    update_env "GOLEM_MEMORY_MODE" "$memory_mode_choice"
    update_env "GOLEM_EMBEDDING_PROVIDER" "$embedding_provider_choice"
    update_env "GOLEM_LOCAL_EMBEDDING_MODEL" "$local_embedding_model"
    update_env "GOLEM_OLLAMA_BASE_URL" "$ollama_base_url"
    update_env "GOLEM_OLLAMA_BRAIN_MODEL" "$ollama_brain_model"
    update_env "GOLEM_OLLAMA_EMBEDDING_MODEL" "$ollama_embedding_model"
    update_env "GOLEM_OLLAMA_RERANK_MODEL" "$ollama_rerank_model"
    update_env "GOLEM_OLLAMA_TIMEOUT_MS" "$ollama_timeout_ms"
    update_env "ALLOW_REMOTE_ACCESS" "$allow_remote_choice"
    update_env "REMOTE_ACCESS_PASSWORD" "$remote_password"
    update_env "TELEGRAM_TOKEN" "$telegram_token"
    update_env "TG_AUTH_MODE" "$tg_auth_mode"
    update_env "ADMIN_ID" "$admin_id"
    update_env "TG_CHAT_ID" "$tg_chat_id"
    update_env "DISCORD_TOKEN" "$discord_token"
    update_env "DISCORD_ADMIN_ID" "$discord_admin_id"

    write_persona_from_cli_setup "$current_user_data_dir" "$ai_name" "$user_name" "$current_role" "$tone" ""

    ui_success "CLI 初始化設定完成：已寫入 .env 與 persona.json"
    log "CLI setup wizard completed (dashboard unavailable mode)"
    echo ""
}



step_install_core() {
    echo -e "  📦 安裝核心依賴..."
    echo -e "  ${DIM}  (playwright, blessed, gemini-ai, discord.js ...)${NC}"
    log "Installing core dependencies"
    
    local arch=$(uname -m)
    local os=$(os_detect)
    local npm_flags="--no-fund --no-audit"
    
    # ─── 架構優化 (ARM64 / Apple Silicon) ───
    if [[ "$arch" == "arm64" ]] || [[ "$arch" == "aarch64" ]]; then
        ui_info "偵測到 ARM64 架構 (${arch})，正在調整安裝策略..."
        if [[ "$os" == "linux" ]] || [[ "$os" == "wsl" ]]; then
            # Linux ARM64 上若下載預設 Chromium 常見相容性問題
            ui_warn "Linux ARM64 環境建議使用系統 Chromium 以確保相容性。"
            echo -e "  ${DIM}提示: sudo apt install chromium-browser -y${NC}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true
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

    # ─── Playwright 系統依賴安裝 (Linux only) ───
    # On Ubuntu/Debian, Playwright needs OS-level libraries (libnss3, libgbm, etc.)
    # to launch Chromium. Without install-deps, the browser binary is present but
    # will fail to execute with "error while loading shared libraries" or similar.
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        ui_info "正在安裝 Playwright 系統依賴 (Linux)..."
        if sudo -n true 2>/dev/null; then
            if ! run_quiet_step "安裝 Playwright 系統依賴" sudo npx playwright install-deps chromium; then
                ui_warn "Playwright 系統依賴安裝失敗。若 Playwright 啟動失敗，請手動執行: sudo npx playwright install-deps chromium"
                log "Playwright install-deps failed"
            fi
        else
            ui_warn "無法自動安裝 Playwright 系統依賴 (需要 sudo)。若 Playwright 啟動失敗，請手動執行: sudo npx playwright install-deps chromium"
            log "Playwright install-deps skipped (no sudo available)"
        fi
    fi

    # ─── Playwright 系統依賴安裝 (Linux only) ───
    # On Ubuntu/Debian, Playwright needs OS-level libraries (libnss3, libgbm, etc.)
    # to launch Chromium. Without install-deps, the browser binary is present but
    # will fail to execute with "error while loading shared libraries" or similar.
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        ui_info "正在安裝 Playwright 系統依賴 (Linux)..."
        if sudo -n true 2>/dev/null; then
            if ! run_quiet_step "安裝 Playwright 系統依賴" sudo npx playwright install-deps chromium; then
                ui_warn "Playwright 系統依賴安裝失敗。若 Playwright 啟動失敗，請手動執行: sudo npx playwright install-deps chromium"
                log "Playwright install-deps failed"
            fi
        else
            ui_warn "無法自動安裝 Playwright 系統依賴 (需要 sudo)。若 Playwright 啟動失敗，請手動執行: sudo npx playwright install-deps chromium"
            log "Playwright install-deps skipped (no sudo available)"
        fi
    fi

    # 確保 TUI 套件存在
    if [ ! -d "$SCRIPT_DIR/node_modules/blessed" ]; then
        ui_info "補安裝 blessed 介面庫..."
        run_quiet_step "安裝 blessed 套件" npm install blessed blessed-contrib express $npm_flags
    fi
    ui_success "核心依賴安裝完成\n"
}

step_install_mempalace_runtime() {
    echo -e "  🧠 佈署 MemPalace 核心記憶服務..."
    log "Installing MemPalace runtime"

    local mempal_enabled="${GOLEM_MEMPALACE_ENABLED:-true}"
    mempal_enabled=$(echo "$mempal_enabled" | tr '[:upper:]' '[:lower:]')
    if [[ "$mempal_enabled" == "false" || "$mempal_enabled" == "0" || "$mempal_enabled" == "no" || "$mempal_enabled" == "off" ]]; then
        ui_warn "GOLEM_MEMPALACE_ENABLED=false，略過 MemPalace 佈署。"
        echo ""
        return
    fi

    local mempalace_dir="$SCRIPT_DIR/mempalace"

    local python_cmd=""
    if command -v python3 >/dev/null 2>&1; then
        python_cmd="python3"
    elif command -v python >/dev/null 2>&1; then
        python_cmd="python"
    fi

    if [ -z "$python_cmd" ]; then
        ui_warn "未找到 Python 3.9+，MemPalace 將於執行時顯示核心警示並重試。"
        echo ""
        return
    fi

    if ! "$python_cmd" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
        ui_warn "偵測到 $python_cmd 版本低於 3.9，MemPalace 佈署略過。"
        echo ""
        return
    fi

    local venv_dir=""
    if [ -d "$mempalace_dir" ]; then
        venv_dir="$mempalace_dir/.venv"
    else
        venv_dir="$SCRIPT_DIR/.mempalace-runtime/.venv"
    fi
    if ! run_quiet_step "建立 MemPalace Python 虛擬環境" "$python_cmd" -m venv "$venv_dir"; then
        ui_warn "MemPalace venv 建立失敗，將於執行時重試。"
        echo ""
        return
    fi

    local py_bin="$venv_dir/bin/python"
    [ ! -x "$py_bin" ] && py_bin="$venv_dir/Scripts/python.exe"
    if [ ! -x "$py_bin" ]; then
        ui_warn "MemPalace venv Python 路徑無效，將於執行時重試。"
        echo ""
        return
    fi

    if ! run_quiet_step "升級 MemPalace 安裝工具鏈" "$py_bin" -m pip install --upgrade pip setuptools wheel; then
        ui_warn "MemPalace pip 工具鏈升級失敗，將於執行時重試。"
        echo ""
        return
    fi

    if [ -d "$mempalace_dir" ]; then
        if ! run_quiet_step "安裝 MemPalace requirements" "$py_bin" -m pip install -r "$mempalace_dir/requirements.txt"; then
            ui_warn "MemPalace requirements 安裝失敗，將於執行時重試。"
            echo ""
            return
        fi

        if ! run_quiet_step "安裝 MemPalace 套件 (local)" "$py_bin" -m pip install -e "$mempalace_dir"; then
            ui_warn "MemPalace 套件安裝失敗，將於執行時重試。"
            echo ""
            return
        fi
    else
        ui_warn "未偵測到本地 mempalace/ 專案，改用 PyPI 版本佈署。"
        if ! run_quiet_step "安裝 MemPalace 套件 (PyPI)" "$py_bin" -m pip install --upgrade mempalace; then
            ui_warn "MemPalace PyPI 安裝失敗，將於執行時重試。"
            echo ""
            return
        fi
    fi

    update_env "GOLEM_MEMPALACE_ENABLED" "true"
    update_env "GOLEM_MEMPALACE_PYTHON" "$py_bin"
    update_env "GOLEM_MEMPALACE_BOOTSTRAP_ENABLED" "${GOLEM_MEMPALACE_BOOTSTRAP_ENABLED:-true}"
    update_env "GOLEM_MEMPALACE_BOOTSTRAP_LIMIT" "${GOLEM_MEMPALACE_BOOTSTRAP_LIMIT:-200}"
    ui_success "MemPalace 核心已完成安裝與預設註冊。"
    echo ""
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
        update_env "GOLEM_DASHBOARD_ENABLED" "false"
        echo -e "    ${DIM}⏩ Dashboard 已停用，跳過安裝${NC}\n"; return
    fi

    if [ ! -d "$SCRIPT_DIR/web-dashboard" ]; then
        ui_warn "找不到 web-dashboard 目錄，自動停用 Dashboard"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        update_env "GOLEM_DASHBOARD_ENABLED" "false"
        echo ""
        return
    fi

    echo -e "    ${CYAN}偵測到 Dashboard 模組，開始安裝...${NC}"

    pushd "$SCRIPT_DIR/web-dashboard" > /dev/null
    
    if ! run_quiet_step "安裝 Dashboard 依賴" npm install --no-fund --no-audit; then
        ui_error "Dashboard 依賴安裝失敗"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        update_env "GOLEM_DASHBOARD_ENABLED" "false"
        log "Dashboard deps install failed"
        popd > /dev/null
        echo ""
        return
    fi

    if [ "${DASHBOARD_DEV_MODE:-false}" = "true" ]; then
        ui_info "偵測到 DASHBOARD_DEV_MODE=true，跳過 Next.js 建置步驟。"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        update_env "GOLEM_DASHBOARD_ENABLED" "true"
        log "Dashboard build skipped (Dev Mode)"
    elif ! run_quiet_step "建置 Dashboard (Next.js Build)" npm run build; then
        ui_warn "Dashboard 建置失敗！"
        ui_warn "這通常是因為環境或依賴問題，您可以之後在選單中單獨嘗試 [4] 建置。"
        update_env "ENABLE_WEB_DASHBOARD" "true"  # 保持為 true，讓 launch_system 的自動修復邏輯能介入
        update_env "GOLEM_DASHBOARD_ENABLED" "true"
        log "Dashboard build failed, kept as enabled for later retry"
    else
        ui_success "Dashboard 建置完成"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        update_env "GOLEM_DASHBOARD_ENABLED" "true"
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
    step_select_install_components
    local selected="${GOLEM_INSTALL_COMPONENTS:-$INSTALL_COMPONENT_DEFAULTS}"
    local total_steps=6
    install_component_enabled "core" "$selected" && total_steps=$((total_steps + 1))
    install_component_enabled "mempalace" "$selected" && total_steps=$((total_steps + 1))
    install_component_enabled "dashboard" "$selected" && total_steps=$((total_steps + 1))
    install_component_enabled "doctor" "$selected" && total_steps=$((total_steps + 1))
    local needs_cli_wizard=false
    if ! install_component_enabled "dashboard" "$selected" || [ ! -d "$SCRIPT_DIR/web-dashboard" ]; then
        needs_cli_wizard=true
        total_steps=$((total_steps + 1))
    fi
    local current_step=0
    log "Full install started"

    echo -e "  ${BOLD}${CYAN}📦 開始完整安裝流程${NC}"
    echo -e "  ${DIM}$(pick_tagline)${NC}"
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Step 1: Check Process
    current_step=$((current_step + 1))
    progress_bar $current_step $total_steps "檢查執行中進程"
    echo ""
    step_stop_running_system
    
    # Step 2: Environment Sanitization
    current_step=$((current_step + 1))
    progress_bar $current_step $total_steps "環境深度清理"
    echo ""
    step_sanitize_environment

    # Step 3: Node Check
    current_step=$((current_step + 1))
    progress_bar $current_step $total_steps "檢查 Node.js 版本"
    echo ""
    step_prepare_node_version

    # Step 4: Check files
    current_step=$((current_step + 1))
    progress_bar $current_step $total_steps "檢查核心檔案"
    echo ""
    step_check_files

    # Step 5: Check env
    current_step=$((current_step + 1))
    progress_bar $current_step $total_steps "檢查環境設定"
    echo ""
    step_check_env

    if install_component_enabled "core" "$selected"; then
        current_step=$((current_step + 1))
        progress_bar $current_step $total_steps "安裝核心依賴"
        echo ""
        step_install_core
    else
        ui_warn "已略過核心依賴安裝 (core)"
        echo ""
    fi

    if install_component_enabled "mempalace" "$selected"; then
        GOLEM_MEMPALACE_ENABLED="true"
        update_env "GOLEM_MEMPALACE_ENABLED" "true"
        current_step=$((current_step + 1))
        progress_bar $current_step $total_steps "安裝 MemPalace 核心"
        echo ""
        step_install_mempalace_runtime
    else
        GOLEM_MEMPALACE_ENABLED="false"
        update_env "GOLEM_MEMPALACE_ENABLED" "false"
        ui_warn "已略過 MemPalace 安裝 (mempalace)"
        echo ""
    fi

    if install_component_enabled "dashboard" "$selected"; then
        ENABLE_WEB_DASHBOARD="true"
        update_env "ENABLE_WEB_DASHBOARD" "true"
        update_env "GOLEM_DASHBOARD_ENABLED" "true"
        current_step=$((current_step + 1))
        progress_bar $current_step $total_steps "安裝 Dashboard"
        echo ""
        step_install_dashboard
    else
        ENABLE_WEB_DASHBOARD="false"
        update_env "ENABLE_WEB_DASHBOARD" "false"
        update_env "GOLEM_DASHBOARD_ENABLED" "false"
        ui_warn "已略過 Dashboard 安裝 (dashboard)"
        echo ""
    fi

    if [ "$needs_cli_wizard" = true ]; then
        current_step=$((current_step + 1))
        progress_bar $current_step $total_steps "CLI 初始化設定"
        echo ""
        step_cli_initial_wizard false
    fi

    current_step=$((current_step + 1))
    progress_bar $current_step $total_steps "系統健康檢查"
    echo ""
    check_status
    run_health_check

    if install_component_enabled "doctor" "$selected"; then
        current_step=$((current_step + 1))
        progress_bar $current_step $total_steps "System Doctor 驗證"
        echo ""
        echo -e "  🏥 正在執行系統環境最後驗證 (System Doctor)..."
        if npm run doctor -- --quiet; then
            ui_success "環境驗證通過！系統地基穩固。"
        else
            ui_warn "環境發現小狀況，請參考上方的診斷建議。"
        fi
    else
        ui_info "已略過 Doctor 驗證 (doctor)"
    fi

    local elapsed; elapsed=$(timer_elapsed)
    log "Full install completed in $elapsed (components: $selected)"
    step_final "$elapsed"
}


step_final() {
    local elapsed="${1:-}"
    local dashboard_enabled="${ENABLE_WEB_DASHBOARD:-false}"
    local mempalace_enabled="${GOLEM_MEMPALACE_ENABLED:-true}"
    clear; echo ""
    box_top
    box_line_colored "  ${GREEN}${BOLD}🎉 部署成功！${NC}"
    box_line_colored "  ${GREEN}${BOLD}   Golem v${GOLEM_VERSION} (Titan Chronos) 已就緒${NC}"
    box_sep
    box_line_colored "  ${BOLD}下一步操作：${NC}                                          "
    if [ "$dashboard_enabled" = "true" ]; then
        box_line_colored "  1. 🌐 開啟瀏覽器存取 ${BOLD}Dashboard${NC} 完成 API 設定 "
        box_line_colored "  2. 📝 在 Dashboard 中填入您的 ${BOLD}Gemini API Key${NC}"
        box_line_colored "  3. 🤖 新增您第一個傀儡實體並填入 ${BOLD}Bot Token${NC}"
    else
        box_line_colored "  1. 🚀 使用 ${BOLD}./setup.sh --start${NC} 啟動核心系統"
        box_line_colored "  2. 🌐 若要使用 Dashboard，可重跑 install 勾選 dashboard"
        box_line_colored "  3. 📝 也可直接編輯 .env 進行進階設定"
    fi
    if [[ "$mempalace_enabled" == "false" || "$mempalace_enabled" == "0" || "$mempalace_enabled" == "no" || "$mempalace_enabled" == "off" ]]; then
        box_line_colored "  4. 🧠 MemPalace 已停用 (可在下次安裝重新勾選)"
    else
        box_line_colored "  4. 🧠 MemPalace 核心 MCP 已內建，無需手動新增 Server"
    fi
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
