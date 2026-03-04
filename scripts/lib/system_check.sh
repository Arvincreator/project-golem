#!/bin/bash

# ─── Golem Configuration Status ───
GOLEMS_ACTIVE_COUNT=0
GOLEMS_LIST=""
GOLEMS_JSON_PATH="$SCRIPT_DIR/golems.json"

check_multi_golems() {
    # 先讀取 .env 中的 GOLEM_MODE
    local golem_mode=""
    if [ -f "$DOT_ENV_PATH" ]; then
        golem_mode=$(grep '^GOLEM_MODE=' "$DOT_ENV_PATH" 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
    fi

    if [ "$golem_mode" = "SINGLE" ]; then
        # 強制單機模式，忽略 golems.json
        if [ -f "$DOT_ENV_PATH" ]; then
            source "$DOT_ENV_PATH" 2>/dev/null
            if [ -n "${TELEGRAM_TOKEN:-}" ] && [ "$TELEGRAM_TOKEN" != "你的BotToken" ]; then
                GOLEMS_ACTIVE_COUNT=1
                GOLEMS_LIST="golem_A (單機模式)"
            fi
        fi
        return
    fi

    if [ -f "$GOLEMS_JSON_PATH" ]; then
        # 利用 Node.js 解析 JSON 取得 ID 列表與數量
        local result
        result=$(node -e "
            try {
                const cfg = require('$GOLEMS_JSON_PATH');
                if (Array.isArray(cfg)) {
                    const ids = cfg.map(g => g.id).join(', ');
                    console.log(cfg.length + '|' + ids);
                } else { console.log('0|'); }
            } catch (e) { console.log('0|'); }
        " 2>/dev/null)
        
        GOLEMS_ACTIVE_COUNT=$(echo "$result" | cut -d'|' -f1)
        GOLEMS_LIST=$(echo "$result" | cut -d'|' -f2)
        CURRENT_GOLEM_MODE="MULTI"
    else
        # Fallback to single golem mode
        GOLEMS_ACTIVE_COUNT=0
        if [ -n "${TELEGRAM_TOKEN:-}" ] && [ "$TELEGRAM_TOKEN" != "你的BotToken" ]; then
            GOLEMS_ACTIVE_COUNT=1
            GOLEMS_LIST="golem_A (單體模式)"
        fi
        CURRENT_GOLEM_MODE="SINGLE"
    fi
}

check_status() {
    # Node Version
    NODE_VER=$(node -v 2>/dev/null || echo "N/A")
    if [[ "$NODE_VER" == v20* ]]; then
        STATUS_NODE="${GREEN}✅ $NODE_VER${NC}"
        NODE_OK=true
    else
        STATUS_NODE="${RED}❌ $NODE_VER (需 v20)${NC}"
        NODE_OK=false
    fi

    # .env
    if [ -f "$DOT_ENV_PATH" ]; then
        STATUS_ENV="${GREEN}✅ 已設定${NC}"
        ENV_OK=true
    else
        STATUS_ENV="${RED}❌ 未找到${NC}"
        ENV_OK=false
    fi

    # 執行多 Golem 檢查
    check_multi_golems
    if [ "$GOLEMS_ACTIVE_COUNT" -gt 0 ]; then
        STATUS_GOLEMS="${GREEN}✅ ${GOLEMS_ACTIVE_COUNT} 個實體${NC}"
    else
        STATUS_GOLEMS="${YELLOW}⚠️ 未配置${NC}"
    fi

    # Web Dashboard
    IsDashEnabled=false
    if grep -q "ENABLE_WEB_DASHBOARD=true" "$DOT_ENV_PATH" 2>/dev/null; then
        STATUS_DASH="${GREEN}✅ 啟用${NC}"
        IsDashEnabled=true
    else
        STATUS_DASH="${YELLOW}⏸️  停用${NC}"
    fi

    # API Keys configured?
    KEYS_SET=false
    if [ -f "$DOT_ENV_PATH" ]; then
        # Use a temporary subshell to source env without polluting main scope
        # but we actually need some variables like GEMINI_API_KEYS
        # Sourcing it is fine as long as we are careful
        source "$DOT_ENV_PATH" 2>/dev/null || true
        if [ -n "${GEMINI_API_KEYS:-}" ] && [ "$GEMINI_API_KEYS" != "你的Key1,你的Key2,你的Key3" ]; then
            KEYS_SET=true
        fi
    fi

    # Port 3000 status
    PORT_3000_STATUS="${DIM}未檢查${NC}"
    if command -v lsof &>/dev/null; then
        if lsof -i :3000 &>/dev/null; then
            PORT_3000_STATUS="${GREEN}● 使用中${NC}"
        else
            PORT_3000_STATUS="${DIM}○ 閒置${NC}"
        fi
    fi

    # OS Info
    OS_INFO="$OSTYPE"
    ARCH_INFO=$(uname -m 2>/dev/null || echo "unknown")
    NPM_VER=$(npm -v 2>/dev/null || echo "N/A")
    DISK_AVAIL=$(df -h "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2{print $4}' || echo "N/A")

    # Docker Status
    if command -v docker &>/dev/null; then
        DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
        STATUS_DOCKER="${GREEN}✅ $DOCKER_VER${NC}"
        DOCKER_OK=true
    else
        STATUS_DOCKER="${RED}❌ 未安裝${NC}"
        DOCKER_OK=false
    fi

    if docker compose version &>/dev/null; then
        COMPOSE_VER="Yes"
        STATUS_COMPOSE="${GREEN}✅ 支援${NC}"
        COMPOSE_OK=true
    else
        STATUS_COMPOSE="${RED}❌ 不支援${NC}"
        COMPOSE_OK=false
    fi
}

os_detect() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

install_dependency() {
    local pkg_name=$1
    local os=$(os_detect)
    
    if [[ "$os" == "macos" ]]; then
        if command -v brew &>/dev/null; then
            run_quiet_step "嘗試使用 Homebrew 安裝 $pkg_name" brew install "$pkg_name"
            return $?
        fi
    elif [[ "$os" == "linux" ]]; then
        if command -v apt-get &>/dev/null; then
            run_quiet_step "嘗試使用 apt-get 安裝 $pkg_name" sudo apt-get install -y "$pkg_name"
            return $?
        elif command -v dnf &>/dev/null; then
            run_quiet_step "嘗試使用 dnf 安裝 $pkg_name" sudo dnf install -y "$pkg_name"
            return $?
        elif command -v yum &>/dev/null; then
            run_quiet_step "嘗試使用 yum 安裝 $pkg_name" sudo yum install -y "$pkg_name"
            return $?
        elif command -v apk &>/dev/null; then
            run_quiet_step "嘗試使用 apk 安裝 $pkg_name" sudo apk add "$pkg_name"
            return $?
        fi
    fi
    return 1
}

check_dependencies() {
    local missing=()
    local tools=("node" "npm" "git" "sed" "awk" "curl")
    
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &>/dev/null; then
            ui_warn "偵測到缺失依賴: $tool"
            if ! install_dependency "$tool"; then
                ui_error "無法自動安裝 $tool"
                missing+=("$tool")
            else
                ui_success "自動安裝 $tool 完成"
            fi
        fi
    done

    if [ ${#missing[@]} -ne 0 ]; then
        echo ""
        echo -e "${RED}❌ 缺失系統依賴且無法自動修復: ${missing[*]}${NC}"
        echo -e "${YELLOW}請手動安裝上述工具後，重新執行腳本。${NC}"
        exit 1
    fi
}

# ─── Health Check (Pre-launch) ──────────────────────────
run_health_check() {
    echo ""
    box_top
    box_line_colored "🏥 系統健康檢查 (Pre-Launch Health Check)"
    box_sep

    local all_pass=true

    # 1. Node.js
    if [ "$NODE_OK" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  Node.js          ${GREEN}$NODE_VER${NC}"
    else
        box_line_colored "  ${RED}✖${NC}  Node.js          ${RED}$NODE_VER (需 v20)${NC}"
        all_pass=false
    fi

    # 2. .env exists
    if [ "$ENV_OK" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  環境設定 (.env)  ${GREEN}已找到${NC}"
    else
        box_line_colored "  ${RED}✖${NC}  環境設定 (.env)  ${RED}未找到${NC}"
        all_pass=false
    fi

    # 3. API Keys
    if [ "$KEYS_SET" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  Gemini API Keys  ${GREEN}已設定${NC}"
    else
        box_line_colored "  ${YELLOW}△${NC}  Gemini API Keys  ${YELLOW}使用預設值 (請先設定)${NC}"
    fi

    # 3.5 Golem Config
    if [ "$GOLEMS_ACTIVE_COUNT" -gt 0 ]; then
        local list_short="$GOLEMS_LIST"
        [ ${#list_short} -gt 25 ] && list_short="${list_short:0:22}..."
        box_line_colored "  ${GREEN}✔${NC}  Golem 實體配置   ${GREEN}${GOLEMS_ACTIVE_COUNT} 個 (${list_short})${NC}"
    else
        box_line_colored "  ${RED}✖${NC}  Golem 實體配置   ${RED}未偵測到有效 Bot Token${NC}"
        all_pass=false
    fi

    # 4. Core files
    local core_ok=true
    for file in index.js skills.js package.json dashboard.js; do
        if [ ! -f "$SCRIPT_DIR/$file" ]; then
            core_ok=false
            break
        fi
    done
    if [ "$core_ok" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  核心檔案         ${GREEN}完整${NC}"
    else
        box_line_colored "  ${RED}✖${NC}  核心檔案         ${RED}不完整${NC}"
        all_pass=false
    fi

    # 5. node_modules
    if [ -d "$SCRIPT_DIR/node_modules" ]; then
        box_line_colored "  ${GREEN}✔${NC}  依賴套件         ${GREEN}已安裝${NC}"
    else
        box_line_colored "  ${RED}✖${NC}  依賴套件         ${RED}未安裝 (請執行安裝)${NC}"
        all_pass=false
    fi

    # 6. Dashboard
    if [ "$IsDashEnabled" = true ]; then
        if [ -d "$SCRIPT_DIR/web-dashboard/out" ] || [ -d "$SCRIPT_DIR/web-dashboard/node_modules" ]; then
            box_line_colored "  ${GREEN}✔${NC}  Web Dashboard    ${GREEN}已就緒${NC}"
        else
            box_line_colored "  ${YELLOW}△${NC}  Web Dashboard    ${YELLOW}已啟用但未建置${NC}"
        fi
    else
        box_line_colored "  ${DIM}─${NC}  Web Dashboard    ${DIM}已停用${NC}"
    fi

    # 7. Docker
    if [ "$DOCKER_OK" = true ] && [ "$COMPOSE_OK" = true ]; then
        box_line_colored "  ${GREEN}✔${NC}  Docker 環境      ${GREEN}已就緒${NC}"
    else
        box_line_colored "  ${DIM}△${NC}  Docker 環境      ${DIM}未完整支援 (僅影響 Docker 模式)${NC}"
    fi

    box_sep
    if [ "$all_pass" = true ]; then
        box_line_colored "  ${GREEN}${BOLD}✅ 系統就緒，可以啟動！${NC}"
    else
        box_line_colored "  ${RED}${BOLD}⚠️  部分檢查未通過，建議先修復再啟動${NC}"
    fi
    box_bottom
    echo ""
}
