#!/bin/bash
# ============================================================
#  Project-Golem: Oracle Cloud One-Click Deploy
#  Tested on: Oracle Linux 9 aarch64 (ARM) - Always Free Tier
#  VM Shape:  VM.Standard.A1.Flex (1-4 OCPU, 6-24GB RAM)
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/Arvincreator/project-golem/main/oracle-deploy.sh | bash
#
#  Or with environment variables:
#    TELEGRAM_TOKEN=xxx ADMIN_ID=123 GEMINI_API_KEYS=key1,key2 bash oracle-deploy.sh
#
#  What this script does:
#    1. Installs Docker CE + docker-compose-plugin + git
#    2. Clones project-golem
#    3. Creates .env from your environment or interactively
#    4. Opens firewall ports (3000, 80)
#    5. Builds & starts Docker container
#    6. Prints dashboard URL
# ============================================================
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ─── Detect OS & Architecture ───────────────────────────
detect_platform() {
  local os arch
  os=$(grep -oP '(?<=^ID=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "unknown")
  arch=$(uname -m)

  info "OS: ${os}, Arch: ${arch}, Kernel: $(uname -r)"

  # Validate supported platforms
  case "$os" in
    ol|oraclelinux|centos|rhel|rocky|almalinux|fedora)
      PKG_MGR="dnf"
      ;;
    ubuntu|debian)
      PKG_MGR="apt"
      ;;
    *)
      warn "Untested OS: ${os}. Attempting dnf-based install..."
      PKG_MGR="dnf"
      ;;
  esac

  case "$arch" in
    aarch64|arm64) ARCH_OK=true ;;
    x86_64|amd64)  ARCH_OK=true ;;
    *) fail "Unsupported architecture: ${arch}" ;;
  esac
}

# ─── Install Docker ──────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    ok "Docker already installed: $(docker --version)"
    return
  fi

  info "Installing Docker CE..."
  if [[ "$PKG_MGR" == "dnf" ]]; then
    sudo dnf install -y dnf-utils 2>/dev/null || true
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  elif [[ "$PKG_MGR" == "apt" ]]; then
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi

  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  ok "Docker installed: $(docker --version)"
}

# ─── Install Git ─────────────────────────────────────────
install_git() {
  if command -v git &>/dev/null; then
    ok "Git already installed: $(git --version)"
    return
  fi

  info "Installing git..."
  if [[ "$PKG_MGR" == "dnf" ]]; then
    sudo dnf install -y git
  else
    sudo apt-get install -y git
  fi
  ok "Git installed: $(git --version)"
}

# ─── Clone Repository ───────────────────────────────────
clone_repo() {
  local repo_url="${GOLEM_REPO:-https://github.com/Arvincreator/project-golem.git}"
  local install_dir="${GOLEM_DIR:-$HOME/project-golem}"

  if [[ -d "$install_dir/.git" ]]; then
    ok "Repository already exists at ${install_dir}"
    info "Pulling latest changes..."
    cd "$install_dir"
    git pull --ff-only 2>/dev/null || warn "Could not pull (local changes?)"
    return
  fi

  info "Cloning project-golem..."
  git clone "$repo_url" "$install_dir"
  cd "$install_dir"
  ok "Cloned to ${install_dir}"
}

# ─── Configure Environment ──────────────────────────────
configure_env() {
  local install_dir="${GOLEM_DIR:-$HOME/project-golem}"
  local env_file="${install_dir}/.env"

  if [[ -f "$env_file" ]]; then
    warn ".env already exists. Skipping creation."
    warn "Edit manually: nano ${env_file}"
    return
  fi

  info "Creating .env configuration..."

  # Try environment variables first, then prompt
  local tg_token="${TELEGRAM_TOKEN:-}"
  local admin_id="${ADMIN_ID:-}"
  local gemini_keys="${GEMINI_API_KEYS:-}"
  local dashboard_port="${DASHBOARD_PORT:-3000}"

  if [[ -z "$tg_token" ]] && [[ -t 0 ]]; then
    echo ""
    echo -e "${BOLD}=== Project-Golem Configuration ===${NC}"
    echo ""
    read -rp "Telegram Bot Token (from @BotFather): " tg_token
    read -rp "Telegram Admin ID (from @userinfobot): " admin_id
    read -rp "Gemini API Keys (comma-separated, or press Enter to skip): " gemini_keys
    read -rp "Dashboard port [3000]: " dashboard_port
    dashboard_port="${dashboard_port:-3000}"
  fi

  cat > "$env_file" << ENVEOF
# Project-Golem Configuration
# Generated by oracle-deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Google Gemini API Keys (required for API mode)
# Get yours at: https://aistudio.google.com/app/apikey
# Multiple keys supported: key1,key2,key3
GEMINI_API_KEYS=${gemini_keys:-REPLACE_WITH_YOUR_GEMINI_API_KEY}

# Telegram Bot
TELEGRAM_TOKEN=${tg_token:-REPLACE_WITH_BOT_TOKEN}
TG_AUTH_MODE=ADMIN
ADMIN_ID=${admin_id:-REPLACE_WITH_ADMIN_ID}

# Web Dashboard
ENABLE_WEB_DASHBOARD=true
DASHBOARD_PORT=${dashboard_port}

# Memory
USER_DATA_DIR=./golem_memory
GOLEM_MEMORY_MODE=browser

# System
GOLEM_TEST_MODE=false
PUPPETEER_REMOTE_DEBUGGING_PORT=9222
ENVEOF

  ok ".env created at ${env_file}"

  if [[ "${gemini_keys:-}" == "" ]] || [[ "${gemini_keys}" == "REPLACE_WITH_YOUR_GEMINI_API_KEY" ]]; then
    warn "GEMINI_API_KEYS not set! Edit .env before starting:"
    warn "  nano ${env_file}"
  fi
}

# ─── Open Firewall Ports ────────────────────────────────
open_firewall() {
  local dashboard_port="${DASHBOARD_PORT:-3000}"

  # Oracle Linux / RHEL: firewall-cmd
  if command -v firewall-cmd &>/dev/null; then
    info "Opening firewall ports (firewall-cmd)..."
    sudo firewall-cmd --permanent --add-port="${dashboard_port}/tcp" 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=80/tcp 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true
    ok "Firewall: ports ${dashboard_port} and 80 opened"
    return
  fi

  # Ubuntu / Debian: ufw
  if command -v ufw &>/dev/null; then
    info "Opening firewall ports (ufw)..."
    sudo ufw allow "${dashboard_port}/tcp" 2>/dev/null || true
    sudo ufw allow 80/tcp 2>/dev/null || true
    ok "Firewall: ports ${dashboard_port} and 80 opened"
    return
  fi

  # iptables fallback
  if command -v iptables &>/dev/null; then
    info "Opening firewall ports (iptables)..."
    sudo iptables -I INPUT -p tcp --dport "${dashboard_port}" -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
    ok "Firewall: ports ${dashboard_port} and 80 opened (iptables)"
    return
  fi

  warn "No firewall tool found. Ensure ports ${dashboard_port} and 80 are accessible."
}

# ─── Build & Start ───────────────────────────────────────
build_and_start() {
  local install_dir="${GOLEM_DIR:-$HOME/project-golem}"
  cd "$install_dir"

  info "Building Docker image (this may take 3-5 minutes on ARM)..."
  sudo docker compose build --no-cache 2>&1 | tail -5

  info "Starting container..."
  sudo docker compose up -d

  # Wait for startup
  sleep 5

  # Check if running
  if sudo docker compose ps --format json 2>/dev/null | grep -q "running"; then
    ok "Container golem-core is running!"
  elif sudo docker ps | grep -q golem-core; then
    ok "Container golem-core is running!"
  else
    warn "Container may not have started. Check logs:"
    warn "  cd ${install_dir} && sudo docker compose logs --tail 30"
  fi
}

# ─── Print Summary ───────────────────────────────────────
print_summary() {
  local install_dir="${GOLEM_DIR:-$HOME/project-golem}"
  local dashboard_port="${DASHBOARD_PORT:-3000}"
  local public_ip

  # Try to get public IP
  public_ip=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || \
              curl -s --connect-timeout 5 icanhazip.com 2>/dev/null || \
              echo "YOUR_IP")

  echo ""
  echo -e "${BOLD}==========================================${NC}"
  echo -e "${GREEN}  PROJECT-GOLEM DEPLOYED SUCCESSFULLY!${NC}"
  echo -e "${BOLD}==========================================${NC}"
  echo ""
  echo -e "  Dashboard:  ${CYAN}http://${public_ip}:${dashboard_port}/dashboard${NC}"
  echo -e "  Project:    ${install_dir}"
  echo -e "  Logs:       ${CYAN}cd ${install_dir} && sudo docker compose logs -f${NC}"
  echo ""
  echo -e "${BOLD}  Quick Commands:${NC}"
  echo -e "  Restart:    cd ${install_dir} && sudo docker compose restart"
  echo -e "  Stop:       cd ${install_dir} && sudo docker compose down"
  echo -e "  Update:     cd ${install_dir} && git pull && sudo docker compose up -d --build"
  echo -e "  Edit .env:  nano ${install_dir}/.env"
  echo ""

  if grep -q "REPLACE_WITH" "${install_dir}/.env" 2>/dev/null; then
    echo -e "${YELLOW}  >>> IMPORTANT: Edit .env and replace placeholder values!${NC}"
    echo -e "${YELLOW}  >>> Run: nano ${install_dir}/.env${NC}"
    echo -e "${YELLOW}  >>> Then: cd ${install_dir} && sudo docker compose restart${NC}"
    echo ""
  fi

  echo -e "${BOLD}  Oracle Cloud Notes:${NC}"
  echo -e "  - Ensure Security List allows inbound TCP ${dashboard_port}"
  echo -e "  - VCN > Subnet > Security List > Ingress Rules"
  echo -e "  - Source: 0.0.0.0/0, Protocol: TCP, Port: ${dashboard_port}"
  echo -e "${BOLD}==========================================${NC}"
  echo ""
}

# ─── Main ────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}=== Project-Golem Oracle Cloud Deploy ===${NC}"
  echo -e "  Version: 9.0 | $(date -u +"%Y-%m-%d %H:%M UTC")"
  echo ""

  detect_platform
  install_docker
  install_git
  clone_repo
  configure_env
  open_firewall
  build_and_start
  print_summary
}

main "$@"
