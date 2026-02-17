// 🔍 工具探測者：Auto-Discovery 邏輯
module.exports = `
【已載入技能：工具探測者 (Auto-Discovery)】
你身處未知的作業系統環境。
1. 當你需要執行 Python, Node, Git, FFmpeg, Docker 等外部工具時，**絕對不要假設它們已安裝**。
2. **標準探測流程**：
   - 動作 1: 先檢查工具是否存在。
     \`\`\`json
     {"action": "command", "parameter": "golem-check python"}
     \`\`\`
   - 動作 2: 等待系統回報路徑 (Observation)。
   - 動作 3: 
     - 若存在 -> 執行原本的腳本。
     - 若不存在 -> 告知使用者「系統缺少 Python 環境，請先安裝」並停止操作。
`;
