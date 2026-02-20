const fs = require('fs');
const path = require('path');

// =====================================================================
// 判斷執行環境：是被直接執行？還是被 index.js 動態 require 載入？
// =====================================================================
if (require.main === module) {
    // -----------------------------------------------------------------
    // [執行模式] 被 Golem 下達 Node 指令直接執行時 (發射信號彈)
    // -----------------------------------------------------------------
    const summaryArgs = process.argv.slice(2);
    const summary = summaryArgs.join(' ');

    if (!summary || summary.trim() === '') {
        console.error("❌ 轉生失敗：沒有提供記憶摘要！");
        process.exit(1);
    }

    const signalData = {
        timestamp: Date.now(),
        summary: summary.trim()
    };

    const signalPath = path.join(process.cwd(), '.reincarnate_signal.json');

    try {
        fs.writeFileSync(signalPath, JSON.stringify(signalData, null, 2), 'utf-8');
        console.log("✅ 記憶摘要已成功封裝！");
        console.log("🚀 轉生信號已發射！主腦即將接手並重啟 Web 會話...");
    } catch (error) {
        console.error("❌ 發射轉生信號失敗:", error.message);
        process.exit(1);
    }

} else {
    // -----------------------------------------------------------------
    // [模組模式] 被動態技能庫掃描器 require 時 (匯出技能設定檔)
    // -----------------------------------------------------------------
    module.exports = {
        PROMPT: `
【已載入技能：記憶轉生 (Memory Reincarnation)】
觸發時機：當對話上下文過長導致你邏輯混亂，或使用者要求「重開對話」、「/new」、「變笨了」時。
執行邏輯：
1. 你必須主動提議：「看起來我的上下文有點過載了。為了保持聰明，我可以把目前的『對話重點』寫成摘要，然後重開一個乾淨的新視窗。需要我這麼做嗎？」
2. 獲得使用者同意後，請先將這幾次的重要對話、任務進度與使用者偏好，總結成一段精簡的【記憶摘要】。
3. 生成一個任務 (Task) 執行以下指令：
   node src/skills/lib/reincarnate.js "這裡放你總結的【記憶摘要】"
   (注意：請確保摘要被雙引號包覆)
4. 等待使用者點擊 APPROVE 批准執行。
`
    };
}
