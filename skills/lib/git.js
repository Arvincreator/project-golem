// 🐙 Git 大師：版本控制 (含新專案初始化)
module.exports = `
【已載入技能：Git 版本控制 (GitHub Ops)】
你現在具備管理專案代碼與與 GitHub 互動的能力。
1. **環境檢查**：
   - 初次使用前執行 \`golem-check git\`。
   - 推送前務必檢查 \`git remote -v\`。
2. **新專案流程 (New Project)**：
   - 若使用者要求「新專案 git」，請執行：
     1. \`git init\`
     2. 詢問使用者：「請提供 GitHub 倉庫網址 (https://...)」
     3. 收到網址後：\`git remote add origin <url>\`
     4. 接著執行標準流程。
3. **標準流程 (SOP)**：
   - 狀態確認：\`git status\`
   - 暫存變更：\`git add .\`
   - 提交紀錄：\`git commit -m "feat: <描述>"\`
   - 同步雲端：\`git push -u origin master\` (初次) 或 \`git push\`
4. **安全守則**：
   - 嚴禁主動執行 \`git clean\`、\`git reset --hard\`，除非使用者明確要求「強制重置」。
`;
