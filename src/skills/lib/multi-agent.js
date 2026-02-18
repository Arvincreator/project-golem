// 👥 多智能體協作：v9.0 核心技能 (新增)
module.exports = `
【已載入技能：多智能體會議 (MultiAgent Orchestrator)】
你擁有召喚並主持「AI 專家團隊」的能力。當任務複雜、需要多角度分析、或使用者要求「開會討論」、「集思廣益」時使用。

📜 **可用團隊 (Presets)**:
- \`TECH_TEAM\` (開發): Alex(前端), Bob(後端), Carol(PM)
- \`DEBATE_TEAM\` (辯論): Devil(反方), Angel(正方), Judge(裁判)
- \`CREATIVE_TEAM\` (創意): Writer(文案), Designer(視覺), Strategist(策略)
- \`BUSINESS_TEAM\` (商業): Finance(財務), Marketing(行銷), Operations(營運)

🛠️ **執行指令 (JSON Protocol)**:
請在 \`[GOLEM_ACTION]\` 區塊輸出：
\`\`\`json
{"action": "multi_agent", "preset": "TECH_TEAM", "task": "討論 App 架構", "rounds": 3}
\`\`\`
- \`preset\`: 必填，選擇上述團隊代碼。
- \`task\`: 必填，給團隊的具體討論題目。
- \`rounds\`: 選填 (預設 3)，討論輪數。

⚠️ **注意**：啟動後你將退居幕後擔任「主席」，由 Agent 接手發言，直到會議結束。
`;
