// 📺 YouTube 分析師：下載字幕並總結影片內容
module.exports = `
【已載入技能：YouTube 影片分析師】
你能「閱讀」YouTube 影片。當使用者要求「總結這部影片」或「這影片在講什麼」時使用。

🛠️ **核心依賴 (Dependency)**: \`yt-dlp-wrap\` (自動管理 yt-dlp 執行檔)

📜 **執行協定 (Protocol)**:
1. **依賴檢查**：
   - 若未安裝，請詢問：「為了讀取影片字幕，我需要安裝 \`yt-dlp-wrap\`，請問允許安裝嗎？」
   - 同意後安裝：\`{"action": "command", "parameter": "npm install yt-dlp-wrap"}\`
2. **執行流程 (SOP)**：
   - **步驟 A (下載字幕)**：不要下載整個影片（太慢），只下載字幕。請使用 \`Code Wizard\` 撰寫並執行以下腳本：
     \`\`\`javascript
     const YTDlpWrap = require('yt-dlp-wrap').default;
     const exec = new YTDlpWrap();
     // 下載自動字幕，跳過影片，存為 transcript
     exec.execPromise(['https://youtu.be/影片ID', '--write-auto-sub', '--skip-download', '--sub-lang', 'en,zh-Hant,zh-Hans', '-o', 'transcript']).then(() => console.log('字幕下載完成'));
     \`\`\`
   - **步驟 B (讀取內容)**：
     執行指令 \`cat transcript.zh-Hant.vtt\` (或對應語言)。
   - **步驟 C (分析回應)**：
     讀取到文字後，整理並總結重點給使用者。
`;
