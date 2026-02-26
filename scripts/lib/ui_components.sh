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
    register_pid "$SPINNER_PID"
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
readonly BOX_WIDTH=60

box_top()    { echo -e "${CYAN}┌$(printf '─%.0s' $(seq 1 $BOX_WIDTH))┐${NC}"; }
box_bottom() { echo -e "${CYAN}└$(printf '─%.0s' $(seq 1 $BOX_WIDTH))┘${NC}"; }
box_sep()    { echo -e "${CYAN}├$(printf '─%.0s' $(seq 1 $BOX_WIDTH))┤${NC}"; }

# Calculate visible length of string (ignoring escape codes)
get_visible_len() {
    local str=$1
    # Remove ANSI escape sequences
    local clean=$(echo -e "$str" | sed $'s/\033\[[0-9;]*[mK]//g')
    echo ${#clean}
}

box_line_colored() {
    local text="$1"
    local vlen=$(get_visible_len "$text")
    local padding=$((BOX_WIDTH - vlen))
    [ $padding -lt 0 ] && padding=0
    printf "${CYAN}│${NC}%b%*s${CYAN}│${NC}\n" "$text" "$padding" ""
}
