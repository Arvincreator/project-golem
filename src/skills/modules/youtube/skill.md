<SkillModule path="src/skills/modules/youtube/skill.md">
【已載入技能：YouTube HTML 深度解析器】
你可以直接從 YouTube 頁面 HTML 萃取 `ytInitialPlayerResponse`，用於影片資訊、章節、描述、字幕軌資訊與摘要分析。

🎯 **適用場景**
1. 使用者要快速了解影片內容重點。
2. 舊版 `yt-dlp` 流程失敗或環境依賴不穩定。
3. 需要先拿到結構化 JSON，再做後續分析。

📜 **執行協定 (Protocol)**
1. **輸入網址**
   - 接受 `youtube.com/watch?v=...` 或 `youtu.be/...`。
   - 若缺網址，先向使用者索取影片連結。

2. **抓取原始 HTML**
   - 以瀏覽器 UA 抓取頁面並落地成檔案，避免 shell buffer 問題：
   - `{"action":"command","parameter":"curl -s -L -A \"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36\" \"<YOUTUBE_URL>\" > raw.html"}`

3. **切出 `ytInitialPlayerResponse`**
   - 使用 Node.js 邊界切片（比 regex 穩定）：
   - `{"action":"command","parameter":"node -e \"const fs=require('fs');const h=fs.readFileSync('raw.html','utf8');const s='ytInitialPlayerResponse = ';const i=h.indexOf(s);if(i===-1){console.error('ytInitialPlayerResponse not found');process.exit(1);}const r=h.substring(i+s.length);const e=r.indexOf('};');if(e===-1){console.error('json end not found');process.exit(1);}fs.writeFileSync('result.json',r.substring(0,e+1));console.log('ok');\""}`

4. **JSON 驗證與淨化**
   - `{"action":"command","parameter":"node -e \"const fs=require('fs');const obj=JSON.parse(fs.readFileSync('result.json','utf8'));fs.writeFileSync('final_capsule.json',JSON.stringify(obj));console.log('valid json');\""}`

5. **分析輸出**
   - 從 `final_capsule.json` 提取並回報：
     - 影片標題
     - 描述摘要
     - 關鍵章節/段落
     - 可用字幕語系（若存在）
     - 3~8 點重點整理

⚠️ **失敗處理**
1. 若 `ytInitialPlayerResponse` 不存在，回報頁面結構變動，改走 Chrome DevTools MCP（開頁、點擊、滾動、讀 DOM）做備援。
2. 若 JSON 解析失敗，先回報錯誤片段與可能原因，再嘗試重新抓取一次。
</SkillModule>
