# 🤖 Project Golem: AI Agent Coding Instructions

> This file is intended for AI Coding Agents (like yourself) to understand how to maintain and evolve this repository efficiently. Use this context to avoid common pitfalls and respect the established architectural patterns.

---

## 🏗️ Core Architecture Pattern: "Browser-in-the-Loop"

- **Entry Point**: `src/index.js` or `src/main.js`.
- **LLM Control**: DO NOT rewrite `GolemBrain` to use official REST APIs unless explicitly requested. The core value of Golem is its ability to pilot a browser via Puppeteer to access Web Gemini.
- **State Management**: Most state is held in `ConversationManager`. Cross-platform logic is abstracted in `UniversalContext`.

## 🧠 Memory Protocol: "Pyramid Memory"

- **Storage Location**: `golem_memory/` (This contains sensitive cookies, handle with caution).
- **Compression Logic**: Memory is compressed at 5 levels (Hourly -> Daily -> Monthly -> Yearly -> Epoch).
- **When Modifying Memory**: Ensure the compression logic in `src/memory/` is preserved to maintain the "50-year preservation" promise.

## 🛠️ Skill Development (Skill Capsules)

- **Hot-loading**: Skills are loaded from `src/skills/`. They should be self-contained modules.
- **Protocol**: All AI responses must follow the `GOLEM_PROTOCOL` (JSON-like structure inside Markdown) for `NeuroShunter` to parse actions.

## 🚀 Environment & Setup

- **Commands**: 
  - Install: `./setup.sh --magic`
  - Start: `./setup.sh --start`
- **Node Version**: v20+
- **Styling**: Vanilla CSS.

## 🔒 Security & Privacy

- **Data Privacy**: Avoid automated posting of any files inside `golem_memory/`.
- **System Access**: The AI can execute local scripts; ensure any new local-execution skill has proper safety guards.

---
*Last Updated: 2026-03-16*
