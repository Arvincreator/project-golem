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
                // 跨平台備份: 使用 Node.js fs API (不依賴 rsync/cp)
                const EXCLUDE = new Set(['node_modules', 'backups', '.git', '.next']);
                const copyDirRecursive = (src, dest) => {
                    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                    for (const item of fs.readdirSync(src)) {
                        if (EXCLUDE.has(item)) continue;
                        const srcPath = path.join(src, item);
                        const destPath = path.join(dest, item);
                        const stat = fs.statSync(srcPath);
                        if (stat.isDirectory()) {
                            copyDirRecursive(srcPath, destPath);
                        } else {
                            fs.copyFileSync(srcPath, destPath);
                        }
                    }
                };
                copyDirRecursive(process.cwd(), currentBackup);
                console.log(`[Upgrader] 備份已儲存至 ${currentBackup}`);
            } catch (backupErr) {
                console.error("[Upgrader] 備份失敗:", backupErr.message);
            }

            // 1. Git Pull / Reset
            await ctx.reply("📥 正在從 GitHub 同步最新源碼...");

            execSync('git fetch --all', { cwd: process.cwd() });

            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: process.cwd() }).toString().trim();
            const remoteBranches = execSync('git branch -r', { cwd: process.cwd() }).toString().trim().split('\n').map(b => b.trim());
            const remotes = execSync('git remote', { cwd: process.cwd() }).toString().trim().split('\n');

            let targetRemote = remotes.includes('upstream') ? 'upstream' : 'origin';
            let targetRef = `${targetRemote}/${currentBranch}`;

            // 尋找最佳匹配 (Priority: upstream > origin > others)
            const priorityRemotes = ['upstream', 'origin', ...remotes.filter(r => r !== 'upstream' && r !== 'origin')];
            let foundMatch = false;
            for (const r of priorityRemotes) {
                if (remoteBranches.includes(`${r}/${currentBranch}`)) {
                    targetRemote = r;
                    targetRef = `${r}/${currentBranch}`;
                    foundMatch = true;
                    break;
                }
            }

            if (!foundMatch) {
                console.warn(`⚠️ 找不到與目前分支 ${currentBranch} 匹配的遠端分支，嘗試使用 ${targetRemote}/main`);
                if (remoteBranches.includes(`${targetRemote}/main`)) {
                    targetRef = `${targetRemote}/main`;
                }
            }

            console.log(`🎯 [Upgrader] Target Ref: ${targetRef}`);
            execSync(`git reset --hard ${targetRef}`, { cwd: process.cwd() });
            console.log(`✅ Git 動態同步完成 (${targetRef})`);

            // 2. Clean Install dependencies
            await ctx.reply("📦 正在重新安裝依賴套件 (全乾淨安裝)...");

            const nmPath = path.join(process.cwd(), 'node_modules');
            const nmBakPath = `${nmPath}.bak`;

            // Backup existing node_modules locally for faster recovery
            if (fs.existsSync(nmPath)) {
                if (fs.existsSync(nmBakPath)) fs.rmSync(nmBakPath, { recursive: true, force: true });
                fs.renameSync(nmPath, nmBakPath);
            }

            try {
                execSync('npm install --no-fund --no-audit', { cwd: process.cwd(), stdio: 'pipe' });
                console.log("✅ 核心依賴安裝完成");
                if (fs.existsSync(nmBakPath)) fs.rmSync(nmBakPath, { recursive: true, force: true });
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
                    if (fs.existsSync(dashNmPath)) fs.rmSync(dashNmPath, { recursive: true, force: true });
                    execSync('npm install --no-fund --no-audit && npm run build', { cwd: dashPath, stdio: 'pipe' });
                    console.log("✅ Dashboard 更新完成");
                }
            }

            await ctx.reply("🚀 系統更新完成！\n\n⚠️ 由於環境相容性考量，\n請您手動重新執行 `./setup.sh` 以套用最新變更。");
            console.log("✅ Update complete. Manual restart required by user.");

        } catch (e) {
            console.error("❌ 全量更新失敗:", e);
            await ctx.reply(`❌ 更新失敗：${e.message}`);
        }
    }
}

module.exports = SystemUpgrader;
