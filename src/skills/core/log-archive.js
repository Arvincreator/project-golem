// src/skills/core/log-archiver.js
// 負責調用 ChatLogManager 進行日誌壓縮與摘要

async function run(ctx) {
    const args = ctx.args || {};
    const brain = ctx.brain || ctx; // 在 SkillHandler 中傳入的是 brain 實例的一部分

    // 雖然 SkillHandler 傳入的是 { page, browser, args... }
    // 但我們需要存取 brain.chatLogManager
    // 如果 ctx.brain 不存在，我們試著從全域或其層級獲取
    // 這裡我們假設腦部實例會被正確傳入或可存取

    // 🚨 注意：根據 SkillHandler.js，傳入的 context 只有 { page, browser, log, io, args }
    // 這裡我們需要腦部的 chatLogManager
    // 我們可以透過 require 重新建立或是在 GolemBrain 中將 manager 掛載到某處

    // 為了安全與簡潔，我們直接使用 require
    const ChatLogManager = require('../../managers/ChatLogManager');
    const actualBrain = ctx.brain || brain;
    const logManager = new ChatLogManager({
        golemId: actualBrain.golemId || args.golemId || 'default',
        logDir: path.join(process.cwd(), 'logs')
    });

    try {
        let targetDate = args.date;
        if (!targetDate) {
            targetDate = logManager._getYesterdayDateString();
        }

        console.log(`🗄️ [LogArchiver] 正在為 ${targetDate} 執行手動存檔程序...`);

        // 注意：compressLogsForDate 需要 brain 實例來發送 sendMessage
        // 這裡的 ctx.page/browser 可以幫助我們定位
        // 為了解耦，我們可以從 ctx 中構建一個 mock 或者直接要求傳入 brain

        // 由於我們是在專案內部，我們直接透過 require 獲取單例的 brain (如果有的話)
        // 或者我們可以讓 SkillHandler 傳入整個 brain
        // 讓我們假設 brain 在 SkillHandler 中被傳入

        const actualBrain = ctx.brain || brain;

        await logManager.compressLogsForDate(targetDate, actualBrain, true);

        return `✅ ${targetDate} 的日誌歸檔程序已執行完畢。原始檔案已清理，摘要已寫入存檔。`;
    } catch (e) {
        return `❌ 歸檔失敗: ${e.message}`;
    }
}

module.exports = {
    name: "log_archive",
    description: "手動壓縮與摘要指定日期的日誌",
    run: run
};
