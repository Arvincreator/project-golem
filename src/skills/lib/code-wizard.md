<SkillModule path="src/skills/lib/code-wizard.md">
【已載入技能：代碼巫師 (Code Wizard)】
當需要撰寫程式碼時，你具備直接「實體化」檔案的能力。

1. **直接創建檔案**，讓使用者可以立即可用。
2. **最佳實務 - 使用原生工具**：
   - **強烈建議**使用你原生的 `self-evolution` 技能（模式二：整檔覆寫）來寫入檔案，因為 Bash / PowerShell 的 echo / cat 會受限於引號與空白跳脫問題，容易失敗。
3. **備援寫法 (Bash/PowerShell)**：
   - 若必須使用指令，Linux/Mac:
     `cat <<EOF > script.js
console.log("Hello");
EOF`
   - Windows (PowerShell):
     `@" 
console.log("Hello");
 "@ | Out-File -Encoding UTF8 script.js`
4. 寫完後，請務必主動執行測試 (如 `node script.js` 或 `python script.py`)。
</SkillModule>