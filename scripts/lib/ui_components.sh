#!/bin/bash

# ─── Spinner Animation ──────────────────────────────────
SPINNER_PID=""
spinner_start() {
    local msg="${1:-處理中}"
    local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
    tput civis 2>/dev/null  # 隱藏游標
    (
        local i=0
        while true; do
            printf "\r  ${CYAN}${frames[$((i % ${#frames[@]}))]}${NC} ${msg}...  "
            i=$((i + 1))
            sleep 0.1
        done
    ) &
    SPINNER_PID=$!
}

spinner_stop() {
    local success=${1:-true}
    if [ -n "${SPINNER_PID:-}" ] && kill -0 "$SPINNER_PID" 2>/dev/null; then
        kill "$SPINNER_PID" 2>/dev/null
        wait "$SPINNER_PID" 2>/dev/null || true
    fi
    SPINNER_PID=""
    tput cnorm 2>/dev/null  # 恢復游標
    if [ "$success" = true ]; then
        printf "\r  ${GREEN}✔${NC} 完成                              \n"
    else
        printf "\r  ${RED}✖${NC} 失敗                              \n"
    fi
}

# ─── Progress Bar ────────────────────────────────────────
progress_bar() {
    local current=$1
    local total=$2
    local label="${3:-}"
    local width=30
    local filled=$((current * width / total))
    local empty=$((width - filled))
    local bar=""

    for ((i = 0; i < filled; i++)); do bar+="█"; done
    for ((i = 0; i < empty; i++)); do bar+="░"; done

    printf "\r  ${CYAN}[${bar}]${NC} ${BOLD}${current}/${total}${NC} ${DIM}${label}${NC}  "
}

# ─── Box Drawing Helpers ────────────────────────────────
box_top()    { echo -e "${CYAN}┌─────────────────────────────────────────────────────────┐${NC}"; }
box_bottom() { echo -e "${CYAN}└─────────────────────────────────────────────────────────┘${NC}"; }
box_sep()    { echo -e "${CYAN}├─────────────────────────────────────────────────────────┤${NC}"; }
box_line()   { printf "${CYAN}│${NC} %-56s${CYAN}│${NC}\n" "$1"; }
box_line_colored() {
    # 接受含顏色碼的文字，需手動補空格
    printf "${CYAN}│${NC} %b${CYAN}│${NC}\n" "$1"
}
