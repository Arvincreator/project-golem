const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const PatchManager = require('./PatchManager');

// ============================================================
// ☁️ System Upgrader (OTA 空中升級)
// ============================================================
class SystemUpgrader {
    static async performUpdate(ctx) {
        if (!CONFIG.GITHUB_REPO) return ctx.reply("❌ 未設定 GitHub Repo，無法更新。");
        await ctx.reply("☁️ 連線至 GitHub 母體，開始下載最新核心...");
        await ctx.sendTyping();
        const filesToUpdate = ['index.js', 'skills.js'];
        const downloadedFiles = [];
        try {
            for (const file of filesToUpdate) {
                const url = `${CONFIG.GITHUB_REPO}${file}?t=${Date.now()}`;
                const tempPath = path.join(process.cwd(), `${file}.new`);
                console.log(`📥 Downloading ${file}...`);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`下載失敗 ${file} (${response.status})`);
                const code = await response.text();
                fs.writeFileSync(tempPath, code);
                downloadedFiles.push({ file, tempPath });
            }
            await ctx.reply("🛡️ 正在進行語法完整性掃描...");
            for (const item of downloadedFiles) {
                if (!PatchManager.verify(item.tempPath)) throw new Error(`檔案 ${item.file} 驗證失敗`);
            }
            await ctx.reply("🚀 系統更新成功！正在重啟...");
            for (const item of downloadedFiles) {
                const targetPath = path.join(process.cwd(), item.file);
                if (fs.existsSync(targetPath)) fs.copyFileSync(targetPath, `${targetPath}.bak`);
                fs.renameSync(item.tempPath, targetPath);
            }
            const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore', cwd: process.cwd() });
            subprocess.unref();
            process.exit(0);
        } catch (e) {
            downloadedFiles.forEach(item => { if (fs.existsSync(item.tempPath)) fs.unlinkSync(item.tempPath); });
            await ctx.reply(`❌ 更新失敗：${e.message}`);
        }
    }
}

module.exports = SystemUpgrader;
