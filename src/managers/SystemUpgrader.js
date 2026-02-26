const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { CONFIG } = require('../config');
const PatchManager = require('./PatchManager');

// ============================================================
// ☁️ System Upgrader (OTA 空中升級)
// ============================================================
class SystemUpgrader {
    static async performUpdate(ctx) {
        if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
            return ctx.reply("❌ 系統非 Git 存儲庫，無法進行全量更新。");
        }

        await ctx.reply("☁️ 連線至 GitHub 母體，開始下載最新核心...");
        await ctx.sendTyping();

        try {
            // 0. Backup existing project
            await ctx.reply("📦 正在打包目前版本備份 (排除 node_modules)...");
            const backupDir = path.join(process.cwd(), 'backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const currentBackup = path.join(backupDir, `golem-backup-${timestamp}`);

            try {
                // Use rsync to efficiently copy while excluding node_modules, backups, and .git
                execSync(`rsync -aq --exclude='node_modules' --exclude='backups' --exclude='.git' . "${currentBackup}"`, { stdio: 'pipe' });
                console.log(`✅ 備份已儲存至 ${currentBackup}`);
            } catch (backupErr) {
                // Fallback to cp if rsync is missing (rare on Mac/Linux)
                console.warn("⚠️ rsync 失敗，嘗試使用傳統複製模式...");
                try {
                    execSync(`mkdir -p "${currentBackup}" && cp -R [!n]* "${currentBackup}"`, { stdio: 'pipe', shell: '/bin/bash' });
                } catch (cpErr) {
                    console.error("❌ 備份失敗:", cpErr.message);
                }
            }

            // 1. Git Pull / Reset
            await ctx.reply("📥 正在從 GitHub 同步最新源碼...");
            execSync('git fetch --all', { cwd: process.cwd() });
            execSync('git reset --hard origin/main', { cwd: process.cwd() });
            console.log("✅ Git 同步完成");

            // 2. Clean Install dependencies
            await ctx.reply("📦 正在重新安裝依賴套件 (全乾淨安裝)...");

            const nmPath = path.join(process.cwd(), 'node_modules');
            const nmBakPath = `${nmPath}.bak`;

            // Backup existing node_modules locally for faster recovery
            if (fs.existsSync(nmPath)) {
                if (fs.existsSync(nmBakPath)) execSync(`rm -rf "${nmBakPath}"`);
                fs.renameSync(nmPath, nmBakPath);
            }

            try {
                execSync('npm install --no-fund --no-audit', { cwd: process.cwd(), stdio: 'pipe' });
                console.log("✅ 核心依賴安裝完成");
                if (fs.existsSync(nmBakPath)) execSync(`rm -rf "${nmBakPath}"`); // Cleanup backup if success
            } catch (npmErr) {
                console.error("❌ npm install 失敗:", npmErr.message);
                if (fs.existsSync(nmBakPath)) {
                    await ctx.reply("⚠️ npm install 失敗，正在從 .bak 還原舊依賴套件...");
                    fs.renameSync(nmBakPath, nmPath);
                }
                throw new Error(`依賴安裝失敗: ${npmErr.message}`);
            }

            // 3. Update Dashboard if enabled
            if (CONFIG.ENABLE_WEB_DASHBOARD === 'true' || process.env.ENABLE_WEB_DASHBOARD === 'true') {
                const dashPath = path.join(process.cwd(), 'web-dashboard');
                if (fs.existsSync(dashPath)) {
                    await ctx.reply("🌐 正在重新建置 Web Dashboard...");
                    const dashNmPath = path.join(dashPath, 'node_modules');
                    if (fs.existsSync(dashNmPath)) execSync(`rm -rf "${dashNmPath}"`);
                    execSync('npm install --no-fund --no-audit && npm run build', { cwd: dashPath, stdio: 'pipe' });
                    console.log("✅ Dashboard 更新完成");
                }
            }

            await ctx.reply("🚀 系統更新完成！正在進行神經系統重啟...");

            // Use a slight timeout to let message send
            setTimeout(() => {
                const subprocess = spawn(process.argv[0], process.argv.slice(1), {
                    detached: true,
                    stdio: 'ignore',
                    cwd: process.cwd(),
                    env: { ...process.env, GOLEM_RESTARTED: 'true' }
                });
                subprocess.unref();
                process.exit(0);
            }, 1500);

        } catch (e) {
            console.error("❌ 全量更新失敗:", e);
            await ctx.reply(`❌ 更新失敗：${e.message}`);
        }
    }
}

module.exports = SystemUpgrader;
