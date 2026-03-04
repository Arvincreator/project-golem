#!/bin/bash

# Ensure DOT_ENV_PATH is set (fallback)
[ -z "$DOT_ENV_PATH" ] && DOT_ENV_PATH="$(cd "$(dirname "$0")/../.." && pwd)/.env"
[ -z "$LOG_FILE" ] && LOG_FILE="$(cd "$(dirname "$0")/../.." && pwd)/logs/setup.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

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

# ─── Interactive Multi-Select Prompt ────────────────────
# Usage: prompt_multiselect "Prompt String" "opt1|desc1" "opt2|desc2" ...
# Returns selected options (comma separated) via global variable MULTISELECT_RESULT
prompt_multiselect() {
    local prompt="$1"
    shift
    local options=("$@")
    local num_options=${#options[@]}
    local selected=()
    local cursor=0
    local key

    # Initialize selected array with 0
    for ((i=0; i<num_options; i++)); do
        selected[$i]=0
    done

    # If MULTISELECT_DEFAULT is set (comma separated), pre-select them
    if [ -n "${MULTISELECT_DEFAULT:-}" ]; then
        IFS=',' read -ra defaults <<< "$MULTISELECT_DEFAULT"
        for default in "${defaults[@]}"; do
            # Trim whitespace
            default=$(echo "$default" | xargs)
            for ((i=0; i<num_options; i++)); do
                local opt_key="${options[$i]%%|*}"
                if [ "$opt_key" = "$default" ]; then
                    selected[$i]=1
                fi
            done
        done
    fi

    # Check if we are in an interactive terminal
    if [ ! -t 0 ] || [ ! -t 1 ]; then
        # Non-interactive fallback: just return defaults
        MULTISELECT_RESULT="${MULTISELECT_DEFAULT:-}"
        return 0
    fi

    # Hide cursor
    printf "\033[?25l"

    # Helper function to print the menu
    print_menu() {
        echo -e "  $prompt"
        for ((i=0; i<num_options; i++)); do
            local opt_string="${options[$i]}"
            local opt_key="${opt_string%%|*}"
            local opt_desc="${opt_string#*|}"
            
            local prefix="  "
            if [ $i -eq $cursor ]; then
                prefix="${CYAN}❯${NC}"
            fi

            local checkbox="[ ]"
            if [ ${selected[$i]} -eq 1 ]; then
                checkbox="${GREEN}[x]${NC}"
            fi

            # Format strictly for our skills length to align them nicely
            printf "  %b %b %-12b %b\n" "$prefix" "$checkbox" "${BOLD}${opt_key}${NC}" "$opt_desc"
        done
        echo -e "  ${DIM}(↑/↓: 移動, Space: 选择/取消, Enter: 確認)${NC}"
    }

    # Helper function to clear the menu
    clear_menu() {
        local lines_to_clear=$((num_options + 2))
        for ((i=0; i<lines_to_clear; i++)); do
            printf "\033[1A\r\033[2K"
        done
    }

    echo ""
    print_menu

    # Input loop
    while true; do
        # Read 1 character at a time silently
        IFS= read -rsn1 key

        if [[ $key == $'\x1b' ]]; then
            # Read the rest of the escape sequence (e.g. [A for up)
            read -rsn2 -t 1 seq 2>/dev/null
            if [[ $seq == "[A" ]] || [[ $seq == "OA" ]]; then # Up arrow
                ((cursor--))
                if [ $cursor -lt 0 ]; then cursor=$((num_options - 1)); fi
            elif [[ $seq == "[B" ]] || [[ $seq == "OB" ]]; then # Down arrow
                ((cursor++))
                if [ $cursor -ge $num_options ]; then cursor=0; fi
            fi
        elif [[ $key == " " ]]; then # Spacebar
            if [ ${selected[$cursor]} -eq 1 ]; then
                selected[$cursor]=0
            else
                selected[$cursor]=1
            fi
        elif [[ $key == "" ]]; then # Enter key
            break
        elif [[ $key == "c" ]] || [[ $key == "C" ]]; then # Clear all
            for ((i=0; i<num_options; i++)); do
                selected[$i]=0
            done
        fi

        clear_menu
        print_menu
    done

    # Restore cursor
    printf "\033[?25h"
    echo ""

    # Build comma-separated result
    local result=""
    for ((i=0; i<num_options; i++)); do
        if [ ${selected[$i]} -eq 1 ]; then
            local opt_key="${options[$i]%%|*}"
            result+="$opt_key,"
        fi
    done

    # Remove trailing comma
    result="${result%,}"
    MULTISELECT_RESULT="$result"
}

# ─── Interactive Single-Select Prompt ───────────────────
# Usage: prompt_singleselect "Prompt String" "opt1|desc1" "opt2|desc2" ...
# Returns selected option via global variable SINGLESELECT_RESULT
SINGLESELECT_RESULT=""
prompt_singleselect() {
    local prompt="$1"
    shift
    local options=("$@")
    local num_options=${#options[@]}
    local cursor=0
    local key

    # If SINGLESELECT_DEFAULT is set, pre-select it
    if [ -n "${SINGLESELECT_DEFAULT:-}" ]; then
        for ((i=0; i<num_options; i++)); do
            local opt_key="${options[$i]%%|*}"
            if [ "$opt_key" = "$SINGLESELECT_DEFAULT" ]; then
                cursor=$i
                break
            fi
        done
    fi

    # Check if we are in an interactive terminal
    if [ ! -t 0 ] || [ ! -t 1 ]; then
        SINGLESELECT_RESULT="${SINGLESELECT_DEFAULT:-}"
        return 0
    fi

    printf "\033[?25l"

    print_menu() {
        if [ -n "$prompt" ]; then
            echo -e "  $prompt"
        fi
        for ((i=0; i<num_options; i++)); do
            local opt_string="${options[$i]}"
            local opt_key="${opt_string%%|*}"
            local opt_desc="${opt_string#*|}"
            
            local prefix="  "
            local checkbox="○"
            if [ $i -eq $cursor ]; then
                prefix="${CYAN}❯${NC}"
                checkbox="${CYAN}◉${NC}"
            fi

            printf "  %b %b %-5b %b\n" "$prefix" "$checkbox" "${BOLD}${opt_key}${NC}" "$opt_desc"
        done
        echo -e "  ${DIM}(↑/↓: 移動, Enter: 確認)${NC}"
    }

    clear_menu() {
        local lines_to_clear=$((num_options + 1))
        [ -n "$prompt" ] && ((lines_to_clear++))
        for ((i=0; i<lines_to_clear; i++)); do
            printf "\033[1A\r\033[2K"
        done
    }

    echo ""
    print_menu

    while true; do
        IFS= read -rsn1 key

        if [[ $key == $'\x1b' ]]; then
            read -rsn2 -t 1 seq 2>/dev/null
            if [[ $seq == "[A" ]] || [[ $seq == "OA" ]]; then # Up arrow
                ((cursor--))
                if [ $cursor -lt 0 ]; then cursor=$((num_options - 1)); fi
            elif [[ $seq == "[B" ]] || [[ $seq == "OB" ]]; then # Down arrow
                ((cursor++))
                if [ $cursor -ge $num_options ]; then cursor=0; fi
            fi
        elif [[ $key == "" ]]; then # Enter key
            break
        fi

        clear_menu
        print_menu
    done

    printf "\033[?25h"
    echo ""

    local selected_opt="${options[$cursor]%%|*}"
    SINGLESELECT_RESULT="$selected_opt"
}

# ─── Startup Taglines ───────────────────────────────────
TAGLINES=()
TAGLINES+=("🤖 Golem is awakening...")
TAGLINES+=("All your chats, one intelligent orchestrator.")
TAGLINES+=("Building the neural pathways...")
TAGLINES+=("Powering up the dimensional drive...")
TAGLINES+=("Your personal AI agent swarm, at your service.")
TAGLINES+=("Less clicking, more shipping.")
TAGLINES+=("If it works, it's automation; if it breaks, it's a feature.")
TAGLINES+=("The only local host in your network you actually want to talk to.")
TAGLINES+=("Gateway online—please keep hands, feet, and appendages inside the shell.")
TAGLINES+=("I don't just autocomplete—I auto-commit (emotionally).")

pick_tagline() {
    local count=${#TAGLINES[@]}
    if [[ "$count" -eq 0 ]]; then
        echo "The advanced modular orchestrator."
        return
    fi
    local idx=$((RANDOM % count))
    echo "${TAGLINES[$idx]}"
}
