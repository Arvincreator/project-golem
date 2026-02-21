class ScheduleHandler {
    static async execute(ctx, act, brain) {
        if (brain.memoryDriver && brain.memoryDriver.addSchedule) {
            const safeTime = new Date(act.time).toISOString();
            console.log(`📅 [Chronos] 新增排程: ${act.task} @ ${safeTime}`);
            await brain.memoryDriver.addSchedule(act.task, safeTime);
            await ctx.reply(`⏰ 已設定排程：${act.task} (於 ${safeTime} 執行)`);
        } else {
            await ctx.reply("⚠️ 當前記憶模式不支援排程功能。");
        }
    }
}

module.exports = ScheduleHandler;
