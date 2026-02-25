// src/skills/schedule.js
// 負責將 Golem 吐出的排程指令，真實寫入到 schedules.json 檔案中

const fs = require('fs');
const path = require('path');

async function run(ctx) {
    const args = ctx.args || {};
    try {
        const { task, time } = args;

        if (!task || !time) {
            return "❌ 排程失敗：缺少任務內容或時間。";
        }

        const scheduleFile = path.join(process.cwd(), 'schedules.json');
        let schedules = [];

        // 如果檔案存在，先讀取舊的排程
        if (fs.existsSync(scheduleFile)) {
            const rawData = fs.readFileSync(scheduleFile, 'utf-8');
            if (rawData.trim()) {
                schedules = JSON.parse(rawData);
            }
        }

        // 加入新排程
        schedules.push({
            task: task,
            time: time,
            createdAt: new Date().toISOString()
        });

        // 寫回檔案
        fs.writeFileSync(scheduleFile, JSON.stringify(schedules, null, 2));

        console.log(`📝 [排程紀錄] 已將任務寫入資料庫: ${task} at ${time}`);

        // 回報給 Golem 知道寫入成功了
        return `✅ 排程已成功建立！將於 ${time} 提醒主人：「${task}」。`;

    } catch (e) {
        console.error("❌ [排程紀錄錯誤]:", e);
        return `❌ 排程寫入失敗: ${e.message}`;
    }
}

module.exports = {
    name: "CHRONOS",
    description: "時間排程器",
    run: run
};
