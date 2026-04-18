// src/skills/core/chrome-devtools.js
// 🌐 Chrome DevTools MCP Skill — Golem v10 集成
//
// 此 skill 為純 Prompt Injection 模組。
// chrome-devtools 工具透過 MCP 協議直接由 LLM 呼叫，
// 無需 run() 方法，僅需將操作指南注入 system prompt。

const fs   = require('fs');
const path = require('path');

module.exports = {
    PROMPT: fs.readFileSync(path.join(__dirname, '../lib/chrome-devtools.md'), 'utf8'),
};
