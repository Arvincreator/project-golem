#!/bin/bash

# ─── Color & Style Constants ────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
UNDERLINE='\033[4m'
NC='\033[0m' # No Color

# Disable colors in non-interactive / CI environments
if [[ "${NO_COLOR:-}" == "1" ]] || [[ ! -t 1 ]]; then
    RED='' GREEN='' YELLOW='' CYAN='' BLUE='' MAGENTA=''
    BOLD='' DIM='' UNDERLINE='' NC=''
fi

export RED GREEN YELLOW CYAN BLUE MAGENTA BOLD DIM UNDERLINE NC
