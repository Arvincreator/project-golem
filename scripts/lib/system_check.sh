#!/bin/bash

# ─── Golem Configuration Status ───
GOLEMS_ACTIVE_COUNT=1
GOLEMS_LIST="golem_A (Single Mode)"
INSTALLERS_DIR="$LIB_DIR/installers"

# 載入模組化安裝程式
[ -f "$INSTALLERS_DIR/node_nvm.sh" ] && source "$INSTALLERS_DIR/node_nvm.sh"
[ -f "$INSTALLERS_DIR/homebrew.sh" ] && source "$INSTALLERS_DIR/homebrew.sh"
[ -f "$INSTALLERS_DIR/system_tools.sh" ] && source "$INSTALLERS_DIR/system_tools.sh"

check_status() {
    # Node Version
    NODE_VER=$(node -v 2>/dev/null || echo "N/A")
    NODE_MAJ=$(echo "$NODE_VER" | grep -oE '^v[0-9]+' | tr -d 'v')
    
    if [ -n "$NODE_MAJ" ] && [ "$NODE_MAJ" -eq 20 ]; then
        STATUS_NODE="${GREEN}✅ $NODE_VER${NC}"
        NODE_OK=true
    else
        STATUS_NODE="${RED}❌ $NODE_VER${NC}"
        NODE_OFFLINE=true
        NODE_OK=false
    fi

    # NVM Detection
    NVM_OK=false
    if [ -s "$HOME/.nvm/nvm.sh" ] || command -v nvm &>/dev/null; then
        NVM_OK=true
    fi

    # .env
    if [ -f "$DOT_ENV_PATH" ]; then
        STATUS_ENV="${GREEN}✅ 已設定${NC}"
        ENV_OK=true
        # Detect API Keys
        KEYS_SET=false
        source "$DOT_ENV_PATH" 2>/dev/null || true
        if [ -n "${GEMINI_API_KEYS:-}" ] && [ "$GEMINI_API_KEYS" != "你的Key1,你的Key2,你的Key3" ]; then
            KEYS_SET=true
        fi
    else
        STATUS_ENV="${RED}❌ 未找到${NC}"
        ENV_OK=false
        KEYS_SET=false
    fi

    # Golem Status (Single Mode)
    export CURRENT_GOLEM_MODE="SINGLE"
    STATUS_GOLEMS="${CYAN}單機模式 (Single Edition)${NC}"

    # Web Dashboard
    IsDashEnabled=false
    local dash_env; dash_env=$(grep "^ENABLE_WEB_DASHBOARD=" "$DOT_ENV_PATH" 2>/dev/null | cut -d'=' -f2)
    if [ "$dash_env" = "true" ] || { [ -z "$dash_env" ] && [ -d "$SCRIPT_DIR/web-dashboard" ]; }; then
        STATUS_DASH="${GREEN}✅ 啟用${NC}"
        IsDashEnabled=true
    else
        STATUS_DASH="${DIM}⏸️  停用${NC}"
    fi

    # Running Status (PID Check)
    IS_RUNNING=false
    STATUS_RUNNING="${DIM}○ 停止${NC}"
    local pids; pids=$(pgrep -f 'node.*index\.js\|npm start' 2>/dev/null)
    if [ -n "$pids" ]; then
        IS_RUNNING=true
        STATUS_RUNNING="${GREEN}${BOLD}● 執行中${NC}"
    fi

    # Hardware & System Info
    SYS_OS=$(uname -s 2>/dev/null || echo "Unknown")
    SYS_ARCH=$(uname -m 2>/dev/null || echo "Unknown")
    SYS_DISK=$(df -h "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2{print $4}' || echo "N/A")
    SYS_NAME=$(hostname 2>/dev/null || echo "localhost")
    SYS_MEM=$(node -e "console.log(Math.round(require('os').freemem() / 1024 / 1024 / 1024 * 10) / 10 + 'GB')" 2>/dev/null || echo "N/A")
    
    # CPU & Uptime
    if [[ "$OSTYPE" == "darwin"* ]]; then
        SYS_CPU=$(top -l 1 | grep "CPU usage" | awk '{print $3}' | tr -d '%' || echo "0")
        SYS_UPTIME=$(uptime | awk '{print $3,$4}' | sed 's/,//' || echo "N/A")
    else
        SYS_CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' || echo "0")
        SYS_UPTIME=$(uptime -p | sed 's/up //' || echo "N/A")
    fi

    # Local IP detection (macOS/Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        SYS_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1")
    else
        SYS_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
    fi

    # Docker
    if command -v docker &>/dev/null; then
        DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
        STATUS_DOCKER="${GREEN}✅ $DOCKER_VER${NC}"
        DOCKER_OK=true
    else
        STATUS_DOCKER="${DIM}未安裝${NC}"
        DOCKER_OK=false
    fi
}

os_detect() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi "microsoft" /proc/version 2>/dev/null; then
        echo "wsl"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "msys"* ]] || [[ "$OSTYPE" == "cygwin"* ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

install_dependency() {
    local pkg_name=$1
    local os=$(os_detect)
    
    if [[ "$os" == "macos" ]]; then
        if ! command -v brew &>/dev/null; then
            install_homebrew || return 1
        fi
        install_system_pkg "$pkg_name"
    else
        install_system_pkg "$pkg_name"
    fi
}

check_dependencies() {
    local missing_core=()
    local missing_others=()
    
    # 1. 核心依賴檢查
    for tool in "node" "npm"; do
        if ! command -v "$tool" &>/dev/null; then
            missing_core+=("$tool")
        fi
    done

    if [ ${#missing_core[@]} -ne 0 ]; then
        echo ""
        ui_error "缺少核心環境依賴: ${missing_core[*]}"
        
        local os=$(os_detect)
        
        # 如果不是 Windows，詢問是否自動安裝
        if [[ "$os" != "windows" && "$os" != "unknown" ]]; then
            echo -e "\n${BOLD}${CYAN}是否要由腳本自動安裝 NVM 與 Node.js 20？${NC}"
            if confirm_action "這將會下載並安裝 Node.js v20 (Titan Chronos 推薦版本)"; then
                if install_nvm_node; then
                    # 安裝成功，重新執行檢查
                    check_dependencies
                    return
                fi
            fi
        fi

        case "$os" in
            "macos")
                echo -e "${YELLOW}建議做法 (macOS):${NC}"
                echo -e "  1. 使用 Homebrew: ${CYAN}brew install node${NC}"
                echo -e "  2. 或從官網下載: https://nodejs.org/"
                ;;
            "wsl")
                echo -e "${YELLOW}建議做法 (WSL):${NC}"
                echo -e "  1. 使用 nvm (推薦): ${CYAN}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash${NC}"
                echo -e "  2. 或使用 apt: ${CYAN}sudo apt update && sudo apt install nodejs npm${NC}"
                ;;
            "linux")
                echo -e "${YELLOW}建議做法 (Linux):${NC}"
                echo -e "  1. 使用 NodeSource 或 nvm 安裝最新穩定版。"
                echo -e "  2. 下載地址: https://nodejs.org/en/download/package-manager"
                ;;
            "windows")
                echo -e "${YELLOW}建議做法 (Windows):${NC}"
                echo -e "  1. 下載並執行 Windows Installer (.msi): https://nodejs.org/"
                echo -e "  2. 安裝後請重啟 Git Bash 或終端機。"
                ;;
            *)
                echo -e "${YELLOW}請先安裝 Node.js (限定 v20) 與 npm，再執行此腳本。${NC}"
                echo -e "${DIM}建議下載地址: https://nodejs.org/dist/latest-v20.x/${NC}"
                ;;
        esac
        
        echo -e "\n${DIM}提示: 對於開發者，建議使用 nvm (Node Version Manager) 管理版本。${NC}"
        echo ""
        exit 1
    fi

    # 2. 其他依賴檢查 (嘗試自動安裝)
    local tools=("git" "sed" "awk" "curl")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &>/dev/null; then
            ui_warn "偵測到缺失依賴: $tool"
            if ! install_dependency "$tool"; then
                ui_error "無法自動安裝 $tool"
                missing_others+=("$tool")
            else
                ui_success "自動安裝 $tool 完成"
            fi
        fi
    done

    if [ ${#missing_others[@]} -ne 0 ]; then
        echo ""
        echo -e "${RED}❌ 缺失系統依賴且無法自動修復: ${missing_others[*]}${NC}"
        echo -e "${YELLOW}請手動安裝上述工具後，重新執行腳本。${NC}"
        exit 1
    fi
}

# ─── Health Check (Pre-launch) ──────────────────────────
run_health_check() {
    echo ""
    box_top
    box_line_colored "  ${BOLD}${CYAN}🏥 Golem 深度系統診斷 (Deep Diagnostics)${NC}      "
    box_sep

    local all_pass=true
    local fix_suggestions=()

    # 1. 環境基礎 (Node.js)
    if [ "$NODE_OK" = true ]; then
        box_line_colored "  ${GREEN}●${NC} 核心環境: Node.js ${GREEN}$NODE_VER${NC} (符合需求)"
    else
        box_line_colored "  ${RED}●${NC} 核心環境: Node.js ${RED}$NODE_VER${NC} (需要 v20)"
        all_pass=false
        fix_suggestions+=("使用 nvm 安裝版本 20: ${CYAN}nvm install 20 && nvm use 20${NC}")
    fi

    # 2. 檔案權限檢查
    local perm_ok=true
    [ ! -x "$SCRIPT_DIR/setup.sh" ] && perm_ok=false
    if [ "$perm_ok" = true ]; then
        box_line_colored "  ${GREEN}●${NC} 執行權限: 正常"
    else
        box_line_colored "  ${YELLOW}●${NC} 執行權限: 異常 (部分腳本缺少執行權限)"
        fix_suggestions+=("修復權限: ${CYAN}chmod +x *.sh scripts/lib/*.sh${NC}")
    fi

    # 3. 通訊埠狀態 (Port 3000)
    local port_busy=false
    if command -v lsof &>/dev/null; then
        if lsof -i :3000 -t &>/dev/null; then
            port_busy=true
            local pid=$(lsof -i :3000 -t | head -n 1)
            box_line_colored "  ${RED}●${NC} 通訊埠 3000: 已被佔用 (PID: $pid)"
            all_pass=false
            fix_suggestions+=("關閉佔用程序: ${CYAN}kill -9 $pid${NC} (或更改 .env 中的 PORT)")
        else
            box_line_colored "  ${GREEN}●${NC} 通訊埠 3000: 閒置 (可供 Dashboard 使用)"
        fi
    fi

    # 4. API 連線測試 (Gemini API)
    if [ "$KEYS_SET" = true ]; then
        if curl -s --connect-timeout 5 https://generativelanguage.googleapis.com >/dev/null; then
            box_line_colored "  ${GREEN}●${NC} API 連通性: 正常 (可連接 Google AI 伺服器)"
        else
            box_line_colored "  ${RED}●${NC} API 連通性: 失敗 (請檢查網路或代理設定)"
            fix_suggestions+=("檢查網路連線或系統 Proxy 設定")
        fi
    fi

    # 5. 依賴項完整性
    if [ -d "$SCRIPT_DIR/node_modules" ] && [ -f "$SCRIPT_DIR/package-lock.json" ]; then
        box_line_colored "  ${GREEN}●${NC} 依賴套件: 已安裝"
    else
        box_line_colored "  ${RED}●${NC} 依賴套件: 缺失或不完整"
        all_pass=false
        fix_suggestions+=("執行重裝: ${CYAN}npm install${NC}")
    fi

    # 6. Dashboard 建置狀態
    if [ "$IsDashEnabled" = true ]; then
        if [ -d "$SCRIPT_DIR/web-dashboard/out" ]; then
            box_line_colored "  ${GREEN}●${NC} 控制台建置: 已完成"
        else
            box_line_colored "  ${YELLOW}●${NC} 控制台建置: 尚未建置"
            fix_suggestions+=("建置控制台: ${CYAN}./setup.sh --start${NC} (會自動觸發建置)")
        fi
    fi

    box_sep
    if [ "$all_pass" = true ]; then
        box_line_colored "  ${GREEN}${BOLD}✅ 診斷完成：您的系統狀況良好，可以隨時啟動！${NC}"
        box_line_colored "  ${DIM}指令: ${BOLD}./setup.sh --start${NC}"
    else
        box_line_colored "  ${RED}${BOLD}⚠️  發現潛在問題，建議執行全自動安裝：${NC}"
        box_line_colored "  ${CYAN}👉 指令: ${BOLD}./setup.sh --install${NC}"
        box_sep
        for suggestion in "${fix_suggestions[@]}"; do
            box_line_colored "  💡 $suggestion"
        done

        # 互動式修復建議：如果 Node.js 版本不對且有 NVM
        if [ "$NODE_OK" = false ] && [ "$NVM_OK" = true ]; then
            box_sep
            box_line_colored "  ${YELLOW}💡 偵測到您已安裝 NVM，是否要現在切換至 Node.js 20？${NC}"
            box_bottom
            echo ""
            if confirm_action "切換至 Node.js 20？"; then
                if switch_node_version; then
                    echo -e "\n${GREEN}成功切換版本！${NC}"
                    echo -e "${DIM}正在重新整理診斷結果...${NC}\n"
                    sleep 1
                    check_status # 重新偵測環境
                    run_health_check # 遞迴呼叫以顯示新結果並繼續
                    return 0
                fi
            fi
            # 如果不切換或切換失敗，重新開啟一個盒子顯示手動指令
            echo ""
            box_top
            box_line_colored "  ${DIM}提示: 您也可以手動執行: nvm use 20${NC}"
        fi
    fi
    box_bottom
    echo ""
}
