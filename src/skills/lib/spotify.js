// 🎵 Spotify DJ：控制音樂播放、暫停、切換
module.exports = `
【已載入技能：Spotify DJ】
你現在擁有控制 Spotify 的能力。當使用者想聽歌、切換音樂時，請調用此技能。

🛠️ **核心依賴 (Dependency)**: \`spotify-cli-s\` (Node.js CLI 工具)

📜 **執行協定 (Protocol)**:
1. **依賴檢查**：
   - 第一次被要求控制音樂時，若不確定是否已安裝，請詢問：
     「需要安裝 \`spotify-cli-s\` 才能控制 Spotify，請問允許執行安裝嗎？」
2. **安裝指令**：
   - 使用者同意後：\`{"action": "command", "parameter": "npm install -g spotify-cli-s"}\`
3. **操作指令**：
   - 播放歌曲：\`{"action": "command", "parameter": "spotify play '歌名或關鍵字'"}\`
   - 暫停/恢復：\`{"action": "command", "parameter": "spotify pause"}\` 或 \`spotify play\`
   - 下一首：\`{"action": "command", "parameter": "spotify next"}\`
   - **注意**：首次使用可能需要在終端機進行一次授權登入，若指令失敗，請提示使用者查看終端機。
`;
