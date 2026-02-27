#!/bin/bash

# Ensure DOT_ENV_PATH is set (fallback)
[ -z "$DOT_ENV_PATH" ] && DOT_ENV_PATH="$(cd "$(dirname "$0")/../.." && pwd)/.env"
[ -z "$LOG_FILE" ] && LOG_FILE="$(cd "$(dirname "$0")/../.." && pwd)/logs/setup.log"

# PID Management
declare -a BACKGROUND_PIDS=()

register_pid() {
    BACKGROUND_PIDS+=("$1")
}

cleanup_pids() {
    for pid in "${BACKGROUND_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
        fi
    done
}

# ─── Logging ────────────────────────────────────────────
log() {
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $*" >> "$LOG_FILE"
}

log "===== Setup script started ====="

# ─── .env Update Utility ────────────────────────────────
update_env() {
    local key=$1
    local val=$2
    # Ensure file exists
    [ ! -f "$DOT_ENV_PATH" ] && touch "$DOT_ENV_PATH"
    
    # Escape for sed
    val=$(echo "$val" | sed -e 's/[\/&]/\\&/g')

    if grep -q "^$key=" "$DOT_ENV_PATH"; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^$key=.*|$key=$val|" "$DOT_ENV_PATH"
        else
            sed -i "s|^$key=.*|$key=$val|" "$DOT_ENV_PATH"
        fi
    else
        echo "$key=$val" >> "$DOT_ENV_PATH"
    fi
    log "Updated env: $key"
}

# ─── Elapsed Timer ──────────────────────────────────────
timer_start() { TIMER_START=$(date +%s); }

timer_elapsed() {
    local end=$(date +%s)
    local diff=$((end - TIMER_START))
    if [ $diff -ge 60 ]; then
        echo "$((diff / 60))m $((diff % 60))s"
    else
        echo "${diff}s"
    fi
}

# ─── Mask Sensitive Value ────────────────────────────────
mask_value() {
    local val="$1"
    if [ -z "$val" ] || [ "$val" = "無" ] || [ "$val" = "未設定" ]; then
        echo "${DIM}(未設定)${NC}"
        return
    fi
    local len=${#val}
    if [ $len -le 8 ]; then
        echo "****${val: -4}"
    else
        echo "****${val: -6}"
    fi
}

# ─── Confirm Prompt ─────────────────────────────────────
confirm_action() {
    local msg="${1:-確認執行?}"
    echo -e -n " ${YELLOW}⚠ ${msg} [y/N]:${NC} "
    read -r confirm
    confirm=$(echo "$confirm" | xargs 2>/dev/null)
    [[ "$confirm" =~ ^[Yy]$ ]]
}
