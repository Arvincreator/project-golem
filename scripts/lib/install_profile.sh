#!/bin/bash

INSTALL_COMPONENT_DEFAULTS="core,mempalace,dashboard,doctor"
INSTALL_COMPONENT_KEYS=("core" "mempalace" "dashboard" "doctor")

CLI_BACKEND_DEFAULT="gemini"
CLI_COMM_MODE_DEFAULT="direct"
CLI_LOCAL_EMBEDDING_MODEL_DEFAULT="Xenova/bge-small-zh-v1.5"
CLI_LOCAL_EMBEDDING_MODELS=(
    "Xenova/bge-small-zh-v1.5"
    "Xenova/all-MiniLM-L6-v2"
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
)

_list_has_item() {
    local needle="$1"
    local csv="$2"
    local item
    IFS=',' read -ra _items <<< "$csv"
    for item in "${_items[@]}"; do
        item=$(echo "$item" | tr '[:upper:]' '[:lower:]' | xargs)
        [ "$item" = "$needle" ] && return 0
    done
    return 1
}

normalize_install_components() {
    local raw="$1"
    local normalized=()
    local token

    if [ -z "$raw" ]; then
        echo "$INSTALL_COMPONENT_DEFAULTS"
        return 0
    fi

    IFS=',' read -ra _tokens <<< "$raw"
    for token in "${_tokens[@]}"; do
        token=$(echo "$token" | tr '[:upper:]' '[:lower:]' | xargs)
        [ -z "$token" ] && continue
        case "$token" in
            core|mempalace|dashboard|doctor)
                if ! _list_has_item "$token" "$(IFS=','; echo "${normalized[*]}")"; then
                    normalized+=("$token")
                fi
                ;;
            *)
                ;;
        esac
    done

    if [ "${#normalized[@]}" -eq 0 ]; then
        echo ""
        return 0
    fi

    local out=()
    local key
    for key in "${INSTALL_COMPONENT_KEYS[@]}"; do
        if _list_has_item "$key" "$(IFS=','; echo "${normalized[*]}")"; then
            out+=("$key")
        fi
    done
    (IFS=','; echo "${out[*]}")
}

ensure_install_component_dependencies() {
    local csv="$1"
    local needs_core=false

    if _list_has_item "mempalace" "$csv" || _list_has_item "dashboard" "$csv" || _list_has_item "doctor" "$csv"; then
        needs_core=true
    fi

    if [ "$needs_core" = true ] && ! _list_has_item "core" "$csv"; then
        if [ -n "$csv" ]; then
            csv="core,$csv"
        else
            csv="core"
        fi
        csv=$(normalize_install_components "$csv")
    fi
    echo "$csv"
}

install_component_enabled() {
    local needle="$1"
    local csv="$2"
    _list_has_item "$needle" "$csv"
}

normalize_cli_backend_choice() {
    local raw="$1"
    local value
    value=$(echo "$raw" | tr '[:upper:]' '[:lower:]' | xargs)
    case "$value" in
        gemini|ollama)
            echo "$value"
            ;;
        *)
            echo "$CLI_BACKEND_DEFAULT"
            ;;
    esac
}

normalize_cli_comm_mode() {
    local raw="$1"
    local value
    value=$(echo "$raw" | tr '[:upper:]' '[:lower:]' | xargs)
    case "$value" in
        direct|telegram|discord)
            echo "$value"
            ;;
        *)
            echo "$CLI_COMM_MODE_DEFAULT"
            ;;
    esac
}

normalize_local_embedding_model_choice() {
    local raw="$1"
    local model
    model=$(echo "$raw" | xargs)
    local item
    for item in "${CLI_LOCAL_EMBEDDING_MODELS[@]}"; do
        if [ "$item" = "$model" ]; then
            echo "$model"
            return 0
        fi
    done
    echo "custom"
}
