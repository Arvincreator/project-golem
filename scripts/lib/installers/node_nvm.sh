#!/bin/bash

# ─── NVM & Node.js Installer ───

install_nvm_node() {
    ui_info "正在嘗試自動安裝 NVM (Node Version Manager)..."
    
    # 執行 NVM 安裝腳本
    if ! curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash; then
        ui_error "NVM 安裝腳本執行失敗。"
        return 1
    fi

    # 嘗試為當前 Session 載入 NVM
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

    if ! command -v nvm &>/dev/null; then
        ui_error "無法載入 NVM，請嘗試重啟終端機後再次執行。"
        return 1
    fi

    ui_success "NVM 安裝成功！正在安裝 Node.js 20 版本..."
    if nvm install 20 && nvm use 20; then
        ui_success "Node.js $(node -v) 安裝完成！"
        return 0
    else
        ui_error "Node.js 安裝失敗。"
        return 1
    fi
}

switch_node_version() {
    ui_info "正在嘗試使用 NVM 切換至 Node.js 20..."
    
    # 確保 NVM 已載入
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    if ! command -v nvm &>/dev/null; then
        ui_error "找不到 NVM，無法自動切換。"
        return 1
    fi

    if nvm use 20; then
        ui_success "已成功為當前 Session 切換至 Node.js $(node -v)"
        echo -e "  ${DIM}💡 提示: 此切換僅對目前執行的腳本對話 (Session) 有效。${NC}"
        echo -e "  ${DIM}💡 若要永久切換，請於終端機執行: ${CYAN}nvm alias default 20${NC}"
        return 0
    else
        ui_warn "NVM 切換失敗，可能尚未安裝 Node.js 20。嘗試安裝中..."
        if nvm install 20 && nvm use 20; then
            ui_success "已安裝並為當前 Session 切換至 Node.js $(node -v)"
            echo -e "  ${DIM}💡 若要永久切換，請於終端機執行: ${CYAN}nvm alias default 20${NC}"
            return 0
        else
            ui_error "Node.js 20 安裝或切換失敗。"
            return 1
        fi
    fi
}
