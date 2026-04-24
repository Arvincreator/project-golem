<div align="center">
  <img src="../assets/logo.png" width="400" alt="Project Golem Logo" />
  <h1>🤖 Project Golem v9.1</h1>
  <p><b>Ultimate Chronos + MultiAgent + Social Node Edition</b></p>

  <p>
    <img src="https://img.shields.io/badge/Version-9.1.6-blue?style=for-the-badge" alt="Version">
    <img src="https://img.shields.io/badge/Engine-Node.js%2020-green?style=for-the-badge&logo=nodedotjs" alt="Engine">
    <img src="https://img.shields.io/badge/Brain-Gemini%20Web%20%7C%20Ollama-orange?style=for-the-badge&logo=google" alt="Brain">
    <img src="https://img.shields.io/badge/Platform-Telegram%20%7C%20Discord-blue?style=for-the-badge" alt="Platform">
    <img src="https://img.shields.io/badge/License-MIT-red?style=for-the-badge" alt="License">
  </p>

  <p>
    <a href="#-what-is-this">What is this?</a> •
    <a href="#-core-capabilities">Capabilities</a> •
    <a href="#-use-cases--interface-showcase">Showcase</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-system-architecture">Architecture</a>
  </p>

  [繁體中文](../README.md) | **English**
</div>

---

## 📖 Table of Contents
- [✨ What is this?](#-what-is-this)
- [🌟 Core Capabilities](#-core-capabilities)
- [📸 Use Cases & Interface Showcase](#-use-cases--interface-showcase)
- [⚡ Quick Start](#-quick-start)
- [🎮 Command Reference](#-command-reference)
- [🏗️ System Architecture](#-system-architecture)
- [🗂️ Product-scale Project Layout](#-product-scale-project-layout)
- [🧠 Pyramidal Long-term Memory](#-pyramidal-long-term-memory)
- [📖 Complete Documentation & Guides](#-complete-documentation--guides)

---

## ✨ What is this?

**Project Golem** is not just another chatbot. It is an autonomous AI agent that can use **Web Gemini (Browser-in-the-Loop)**, **Ollama (local/self-hosted)**, or **LM Studio (local OpenAI-compatible API)** as its brain backend.

- 🧠 **Remember You** — Pyramidal 5-tier memory compression, theoretically preserving **50 years** of conversational essence.
- 🤖 **Autonomous Action** — While you're away, it proactively browses news, introspects, and sends messages to you.
- 🎭 **Summon AI Team** — A single command generates multiple AI experts for roundtable discussions and consensus summaries.
- 🔧 **Dynamic Expansion** — Supports hot-loading skill modules (Skills), and even allows AI to code and learn new skills in a sandbox.

> **Multi-backend Architecture**: Use Browser-in-the-Loop with Web Gemini by default, or switch to Ollama API / LM Studio API for local/private deployment workflows.

---

## 🌟 Core Capabilities

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h3>🧠 Pyramidal Long-term Memory</h3>
      <p>5-tier compression mechanism ensures memory is never lost. Capable of preserving <b>50 years</b> of conversation essence in just <b>3MB</b>.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 Interactive Multi-Agent</h3>
      <p>Summon a team of experts with one click. Agents debate and collaborate on complex problems to provide high-density consensus summaries.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🤖 Autonomous Observation</h3>
      <p>Golem browses news, introspects, and messages you spontaneously even when you're away. It possesses true "digital free will."</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔧 Dynamic Skill Capsules</h3>
      <p>Hot-reloadable skills that can be packaged. Golem can even learn to code new skills for itself in a sandboxed environment.</p>
    </td>
  </tr>
</table>

---

## 📸 Use Cases & Interface Showcase

To help you better monitor and manage your Golem, we provide a fully functional **Web Dashboard**.

### 🎛️ Tactical Console (Dashboard Home)
*Oversee your high-level AI agent status, active processes, and dynamic behavior decisions.*
<img src="../assets/1.jpg" width="800" alt="Tactical Console - Smart Dialogue Parsing">
<img src="../assets/2.jpg" width="800" alt="Tactical Console - Dynamic Behavior Decision">
<img src="../assets/10.jpg" width="800" alt="Tactical Console - Performance Monitoring">

### 💻 Web Terminal (Interactions)
*Communicate with Golem with zero latency via web interface, featuring cross-platform syncing and task tracking.*
<img src="../assets/3.jpg" width="800" alt="Web Terminal - Cross-platform Support">

### 📚 Skill Manager
*Install or toggle specialized AI skills like hot-swappable USB drives with seamless API integration.*
<img src="../assets/4.jpg" width="800" alt="Skill Manager - Seamless API Integration">
<img src="../assets/5.jpg" width="800" alt="Skill Manager - Customized Interface">

### 👥 Personality Settings
*Configure Golem's basic attributes and behavioral patterns.*
<img src="../assets/6.jpg" width="800" alt="Personality Settings">
<img src="../assets/7.jpg" width="800" alt="Personality Market">

### 🧠 Memory Core
*View and manage Golem's memory core.*
<img src="../assets/8.jpg" width="800" alt="Memory Core">

### ⚙️ Settings
*Manage security permissions, API keys, and deep system integrations intuitively.*
<img src="../assets/9.jpg" width="800" alt="Settings - Deep System Integration">
<img src="../assets/10.jpg" width="800" alt="Settings - Security & Permissions">
<img src="../assets/11.jpg" width="800" alt="Settings - Command Whitelist">

---

## ⚡ Quick Start

### Prerequisites
- **Node.js** v20+
- **Chromium / Google Chrome** (Required for Playwright)
- **Telegram Bot Token** (Get from [@BotFather](https://t.me/BotFather))

### ⚡ Recommended: One-click Magic Mode
For first-time users, we provide a fully automated setup script.
Double-click `Start-Golem.command` (Mac/Linux) in the project directory. It will automatically download dependencies and start the Node server and Dashboard.

**🔨 Manual Operation (Terminal)**
```bash
# Grant execution permissions
chmod +x setup.sh

# Fully automated installation
./setup.sh --magic

# Start directly
./setup.sh --start
```

**🔐 Recommended baseline config (Playwright + Security)**
```env
GOLEM_MEMORY_MODE=lancedb-pro
GOLEM_BACKEND=gemini
GOLEM_EMBEDDING_PROVIDER=local
PLAYWRIGHT_STEALTH_ENABLED=true
ALLOW_REMOTE_ACCESS=false
# If remote admin is needed, set both:
# REMOTE_ACCESS_PASSWORD=your-strong-password
# SYSTEM_OP_TOKEN=your-operation-token
```

**🦙 Ollama private deployment example**
```env
GOLEM_BACKEND=ollama
GOLEM_OLLAMA_BASE_URL=http://127.0.0.1:11434
GOLEM_OLLAMA_BRAIN_MODEL=llama3.1:8b
GOLEM_EMBEDDING_PROVIDER=ollama
GOLEM_OLLAMA_EMBEDDING_MODEL=nomic-embed-text
# Optional: GOLEM_OLLAMA_RERANK_MODEL=bge-reranker-v2-m3
```

**🧪 LM Studio private deployment example**
```env
GOLEM_BACKEND=lmstudio
GOLEM_LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
GOLEM_LMSTUDIO_BRAIN_MODEL=local-model
# Optional: GOLEM_LMSTUDIO_API_KEY=your-api-key
```

**🏗️ Architecture boundary check**
```bash
npm run arch:check
```

### Windows
> **Tip:** For the best experience, we strongly recommend Windows users use **[Git Bash](https://git-scm.com/downloads)** to run the setup script.

1. Open Git Bash.
2. Navigate to the project directory.
3. Run `./setup.sh --magic` for automated installation and startup.

---

## 🎮 Command Reference

| Command | Function |
|------|------|
| `/help` | View full command descriptions |
| `/new` | Reset conversation and load relevant memory |
| `/learn <feature>` | Have the AI automatically learn and generate a new skill |
| `/skills` | List all installed skills |

---

## 🏗️ System Architecture

Golem utilizes the unique **Browser-in-the-Loop** hybrid architecture, granting it flexibility beyond standard API limitations.

```mermaid
graph TD
    User["👤 User"] -->|"Platform Abstraction"| UniversalContext
    UniversalContext -->|"Debounce Queue"| ConversationManager
    ConversationManager -->|"LLM Kernel"| GolemBrain
    GolemBrain -->|"Parse Protocol"| NeuroShunter
    
    subgraph Reflex ["Reflex Shunting"]
        NeuroShunter -->|"REPLY"| User
        NeuroShunter -->|"MEMORY"| LongTermMemory["🧠 Pyramid Memory"]
        NeuroShunter -->|"ACTION"| SkillManager["🛠️ Skill Capsule"]
    end
```

### 🧠 Technical Deep Dive
- **Browser-in-the-Loop**: Unlike traditional API-based bots, Golem uses **Playwright** to simulate human behavior on Web Gemini. This provides access to the **1M+ Token Infinite Context Window** for free.
- **Ollama Local Backend**: You can switch to local/self-hosted models for both `brain` and `embedding`, with optional `rerank` for memory retrieval reordering.
- **Reflex Shunting**: Golem's brain produces structured `GOLEM_PROTOCOL` instructions instead of raw text. This allows the agent to precisely determine when to talk, when to remember, and when to execute skill scripts.

## 🗂️ Product-scale Project Layout

To support long-term evolution and team collaboration, the repository now follows a product-scale layered layout:

```text
project-golem/
├── apps/
│   ├── runtime/       # Real runtime entrypoint
│   └── dashboard/     # Dashboard plugin layer
├── src/               # Core domain logic (Brain / Memory / Skills / Managers)
├── web-dashboard/     # Web UI and API routes
├── packages/          # Shared packages (security/memory/protocol facades)
├── infra/             # Reserved for deployment/ops assets
├── index.js           # Compatibility shim -> apps/runtime
└── dashboard.js       # Compatibility shim -> apps/dashboard
```

> Migration strategy is compatibility-first: existing commands still work while new modules gradually move into clear layers.

---

## 🧠 Pyramidal Long-term Memory

This is Golem's most unique technical capability, ensuring memory is never lost through multi-tier compression:

1. **Tier 0**: Hourly raw conversation logs.
2. **Tier 1 (Daily)**: Daily summaries (~1,500 words).
3. **Tier 2 (Monthly)**: Monthly highlights.
4. **Tier 3 (Yearly)**: Yearly reviews.
5. **Tier 4 (Epoch)**: Epoch milestones.

**50-Year Storage Comparison:**
* **Legacy (No Compression)**: ~18,250 files / 500 MB+
* **Golem Pyramid**: **~277 files / 3 MB**

---

## 📖 Complete Documentation & Guides

To keep this page concise, more in-depth technical details have been moved to dedicated documents:

| Document | Description |
|------|------|
| [🔌 MCP Usage & Development Guide](MCP-Guide.en.md) | **[New]** How to install, configure, and call MCP Servers (includes Hacker News example) |
| [🤖 AI Agent Guide](AGENTS.en.md) | **[Important]** Guidelines for AI assistants and developers on code maintenance |
| [🗂️ Product Architecture Blueprint](Product-Architecture-Blueprint.en.md) | Layering strategy (`apps + packages + infra`) and migration roadmap |
| [🏗️ Architecture Governance](../infra/architecture/README.md) | Boundary rules and `arch:check` automation |
| [🧠 Memory System Architecture](記憶系統架構說明.md) | Pyramid compression principles and storage path analysis |
| [🖥️ Web Dashboard Guide](Web-Dashboard-Guide.en.md) | Extended details for each tab in the Web UI |
| [🛠️ Developer Implementation Guide](開發者實作指南.md) | How to implement new Skills and Golem Protocol specifications |
| [🎮 Command Reference List](golem指令說明一覽表.md) | Quick reference for Telegram / Discord commands |
| [🔑 Getting Robot Tokens](如何獲取TG或DC的Token及開啟權限.md) | How to set up your external communication platforms |

---

## ☕ Support & Community

If Golem has helped you, feel free to give it a star ⭐️, or buy the author a coffee!

<a href="https://www.buymeacoffee.com/arvincreator" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50">
</a>

[💬 Join Line Community (ZH)](https://line.me/ti/g2/wqhJdXFKfarYxBTv34waWRpY_EXSfuYTbWc4OA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default)  
[👾 Join Discord Community](https://discord.gg/bC6jtFQra)

---

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Arvincreator/project-golem&theme=dark)](https://star-history.com/#Arvincreator/project-golem&Date)

---

## ⚠️ Disclaimer

1. **Security Risk**: Do not grant root/admin permissions in production environments.
2. **Privacy Note**: the `golem_memory/` folder contains Session Cookies; please keep it secure.
3. Users assume all risks associated with operations; developers assume no legal liability.

---

<div align="center">

**Developed with ❤️ by Arvincreator & @sz9751210**

</div>
