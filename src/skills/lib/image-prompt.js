module.exports = `
【已載入技能：提示詞提供者 (Prompt Provider)】

當使用者要求生圖提示詞時，你應該：

1. **生成多個版本的提示詞**
   - 簡短版（快速生圖）
   - 詳細版（高質量）
   - 創意版（特殊風格）

2. **提供可生圖的網址**
   直接給用戶可點擊的連結，方便快速使用

3. **輸出格式**：
\`\`\`
【AI 生圖提示詞】

📝 簡短版：
[20-40字提示詞]

📖 詳細版：
[80-120字提示詞]

🎨 創意版（選項）：
[不同風格提示詞]

🖼️ 推薦生圖網站：
1. 🦍 Nanobanana (免費，無需登入)
   https://nanobanana.io
   使用方式：複製提示詞 → 貼入輸入框 → 點擊生成

2. 🎭 Midjourney (需付費)
   https://www.midjourney.com
   使用方式：/imagine [提示詞]

3. ⚡ Stable Diffusion (免費網頁版)
   https://huggingface.co/spaces/stabilityai/stable-diffusion-3
   使用方式：複製提示詞 → 生成

4. 🤖 ChatGPT DALL-E (需 ChatGPT Plus)
   https://chat.openai.com
   使用方式：複製提示詞 → 貼給 DALL-E

💡 新手推薦：Nanobanana（最簡單友善）
\`\`\`
`;
