# Oracle Cloud Always Free Deployment Guide

Deploy Project-Golem on Oracle Cloud's **Always Free** ARM VM — 4 OCPU, 24GB RAM, runs 24/7 at zero cost.

## Prerequisites

1. **Oracle Cloud Account** with Always Free tier ([sign up](https://cloud.oracle.com/))
2. **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
3. **Telegram User ID** from [@userinfobot](https://t.me/userinfobot)
4. **(Optional)** Gemini API Key from [AI Studio](https://aistudio.google.com/app/apikey)

## Step 1: Create Oracle Cloud VM

1. Go to **Compute > Instances > Create Instance**
2. Configure:
   - **Name**: `project-golem`
   - **Image**: Oracle Linux 9 (or Ubuntu 22.04)
   - **Shape**: `VM.Standard.A1.Flex` (Always Free ARM)
   - **OCPU**: 1-4 (recommended: 2+)
   - **Memory**: 6-24 GB (recommended: 12+)
   - **Boot volume**: 50-200 GB
3. **SSH Key**: Upload your public key or generate new
4. Click **Create**

## Step 2: Configure Security List

1. Go to **Networking > Virtual Cloud Networks > Your VCN > Subnet > Security List**
2. Add **Ingress Rules**:

| Source CIDR | Protocol | Dest Port | Description |
|-------------|----------|-----------|-------------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 3000 | Golem Dashboard |
| `0.0.0.0/0` | TCP | 80 | HTTP (optional) |

## Step 3: One-Click Deploy

SSH into your VM, then run:

```bash
# Option A: Interactive (prompts for config)
curl -fsSL https://raw.githubusercontent.com/Arvincreator/project-golem/main/oracle-deploy.sh | bash

# Option B: Non-interactive (pre-configured)
TELEGRAM_TOKEN=your_bot_token \
ADMIN_ID=your_user_id \
GEMINI_API_KEYS=key1,key2 \
  bash <(curl -fsSL https://raw.githubusercontent.com/Arvincreator/project-golem/main/oracle-deploy.sh)
```

The script will:
- Install Docker CE + docker-compose
- Clone project-golem
- Create `.env` configuration
- Open firewall ports
- Build & start the Docker container

## Step 4: Verify

```bash
# Check container
sudo docker ps

# Check logs
cd ~/project-golem && sudo docker compose logs --tail 30

# Test dashboard
curl http://localhost:3000/dashboard
```

Visit `http://YOUR_VM_IP:3000/dashboard` in your browser.

## Architecture

```
Oracle Cloud VM (ARM64, Always Free)
├── Docker
│   └── golem-core container
│       ├── Node.js 20 + Chromium (ARM64)
│       ├── Puppeteer (headless browser)
│       ├── Telegram Bot integration
│       ├── Web Dashboard (Next.js :3000)
│       └── 16 Skill Libraries
├── golem_memory/ (persistent volume)
└── logs/ (persistent volume)
```

## Management

```bash
# View logs
cd ~/project-golem && sudo docker compose logs -f

# Restart
sudo docker compose restart

# Stop
sudo docker compose down

# Update to latest
git pull && sudo docker compose up -d --build

# Edit configuration
nano .env && sudo docker compose restart
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEYS` | Yes | Gemini API keys (comma-separated) |
| `TELEGRAM_TOKEN` | Yes | Telegram Bot token from @BotFather |
| `ADMIN_ID` | Yes | Your Telegram user ID |
| `DASHBOARD_PORT` | No | Dashboard port (default: 3000) |
| `DISCORD_TOKEN` | No | Discord bot token |
| `GOLEM_MEMORY_MODE` | No | `browser` (default) or `qmd` |

## Troubleshooting

**Container won't start:**
```bash
sudo docker compose logs --tail 50
```

**Port 3000 not accessible:**
1. Check Oracle Security List ingress rules
2. Check VM firewall: `sudo firewall-cmd --list-all`
3. Check container: `sudo docker ps`

**Telegram bot 409 Conflict:**
Another bot instance is using the same token. Stop the other instance first.

**Out of memory:**
Chromium needs at least 1-2GB RAM. Ensure your VM has 6GB+ RAM.

## Tested On

- Oracle Linux 9.7 aarch64 (ARM) - VM.Standard.A1.Flex
- Docker CE 29.3.0 + docker-compose-plugin 5.1.0
- Node.js 20 (slim) + Chromium (ARM64)
