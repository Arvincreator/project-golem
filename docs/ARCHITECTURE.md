# Project Golem — Architecture Guide

## System Overview

Project Golem is a self-evolving AI agent that uses Google Gemini as its brain. It can browse the web, execute skills, manage memory, and interact through Telegram/Discord.

```
┌─────────────────────────────────────────────────┐
│                   Entry Point                    │
│                   (index.js)                     │
├──────────┬──────────┬──────────┬────────────────┤
│  Brain   │  Skills  │  Memory  │   Dashboard    │
│  Layer   │  Layer   │  Layer   │   Layer        │
├──────────┼──────────┼──────────┼────────────────┤
│          │          │          │                │
│ GolemBrain│ Skill   │ Browser  │ Next.js        │
│ ApiBrain │ Manager  │ Driver   │ Socket.IO      │
│ PageIntr │ Architect│ Native   │ Recharts       │
│          │          │ QMD      │                │
├──────────┴──────────┴──────────┴────────────────┤
│              Infrastructure Layer                │
│  EventBus · CircuitBreaker · RateLimiter        │
│  TaskQueue · ProcessManager · RetryHelper       │
└─────────────────────────────────────────────────┘
```

## Component Details

### Brain Layer

The brain is the AI core that processes inputs and generates responses.

**GolemBrain** (browser mode):
- Launches Chromium via Puppeteer
- Navigates to Google AI Studio
- Sends prompts through the web UI
- Parses Titan Protocol responses

**ApiBrain** (API mode):
- Direct Gemini API calls (no browser needed)
- Lighter resource usage
- Suitable for servers and containers

### Skills Layer

Skills are modular capabilities that extend Golem's abilities.

**Loading**: Skills are defined as `.md` files in `src/skills/lib/`. Each skill has a name, description, and instructions that are injected into the AI prompt.

**Hot-reload**: `SkillManager.refresh()` reloads skills without restarting.

**Execution**: When the brain's response contains a skill invocation, the SkillManager routes it to the appropriate handler.

### Memory Layer

Memory provides persistence across sessions.

| Driver | Storage | Use Case |
|--------|---------|----------|
| BrowserMemoryDriver | IndexedDB (via Puppeteer) | Browser-based sessions |
| SystemNativeDriver | File system (.md files) | Server deployments |
| SystemQmdDriver | QMD format | Structured data |

### Infrastructure Layer

Shared utilities that all layers depend on:

| Utility | Purpose |
|---------|---------|
| **EventBus** | Decoupled pub/sub communication between components |
| **CircuitBreaker** | Prevents cascading failures (CLOSED/OPEN/HALF states) |
| **RetryHelper** | Exponential backoff with jitter for transient failures |
| **RateLimiter** | Token bucket algorithm for request throttling |
| **TaskQueue** | Priority-based async task scheduling with concurrency |
| **ProcessManager** | Crash recovery and auto-restart for subsystems |

## Data Flow

```
User Input (Telegram/Discord/CLI)
    │
    ▼
┌──────────────┐
│ Message      │ → Parse input, check security
│ Manager      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ GolemBrain   │ → Build prompt with context + skills + memory
│              │ → Send to Gemini
│              │ → Parse Titan Protocol response
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Executor     │ → Route actions to handlers
│              │   ├── PageInteractor (web browsing)
│              │   ├── AndroidHandler (ADB commands)
│              │   ├── SkillManager (skill execution)
│              │   └── Memory drivers (store/recall)
└──────┬───────┘
       │
       ▼
Response → User
```

## Configuration

Key environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `DISCORD_TOKEN` | No | Discord bot token |
| `DASHBOARD_PORT` | No | Dashboard port (default: 3000) |
| `DASHBOARD_ORIGIN` | No | CORS allowed origins |

## Deployment Options

| Platform | Config File | Notes |
|----------|-------------|-------|
| Docker | `docker-compose.yml` | Self-contained with healthcheck |
| Render.com | `render.yaml` | Free tier Blueprint |
| Fly.io | `fly.toml` | Tokyo region, auto-stop/start |
| Manual | `node index.js` | Direct execution |

## Extension Points

1. **New Skills**: Add `.md` file to `src/skills/lib/`
2. **New Memory Driver**: Implement `memorize()`, `recall()`, `forget()` interface
3. **New Action Handler**: Add to `src/core/action_handlers/`
4. **New Dashboard Page**: Add to `web-dashboard/src/app/`
5. **New Language**: Add locale file to `src/i18n/locales/`
