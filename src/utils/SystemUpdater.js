const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SystemUpdater {
    static async checkEnvironment() {
        const rootDir = process.cwd();
        const packageJsonPath = path.join(rootDir, 'package.json');
        let currentVersion = 'Unknown';
        if (fs.existsSync(packageJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            currentVersion = pkg.version || 'Unknown';
        }

        let remoteVersion = 'Unknown';
        try {
            const rawUrl = 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/package.json';
            const response = await fetch(rawUrl);
            if (response.ok) {
                const remotePkg = await response.json();
                remoteVersion = remotePkg.version || 'Unknown';
            }
        } catch (e) {
            console.error("[SystemUpdater] Failed to fetch remote version", e);
        }

        const isGit = fs.existsSync(path.join(rootDir, '.git'));
        let gitInfo = null;

        if (isGit) {
            try {
                const util = require('util');
                const exec = util.promisify(require('child_process').exec);

                // 1. Fetch from all remotes to get latest metadata
                await exec('git fetch --all', { cwd: rootDir });

                // 2. Identify current branch
                const { stdout: branchOut } = await exec('git rev-parse --abbrev-ref HEAD', { cwd: rootDir });
                const currentBranch = branchOut.trim();

                // 3. Get current commit info
                const { stdout: currentCommitOut } = await exec('git log -1 --format="%h - %s (%cr)"', { cwd: rootDir });
                const currentCommit = currentCommitOut.trim();
                const { stdout: currentHashOut } = await exec('git rev-parse HEAD', { cwd: rootDir });
                const currentHash = currentHashOut.trim();

                // 4. Traverse all remotes to find matching branch
                const { stdout: rbOut } = await exec('git branch -r', { cwd: rootDir });
                const remoteBranches = rbOut.trim().split('\n').map(b => b.trim());

                const { stdout: rOut } = await exec('git remote', { cwd: rootDir });
                const remotesList = rOut.trim().split('\n');

                const priorityRemotes = ['upstream', 'origin', ...remotesList.filter(r => r !== 'upstream' && r !== 'origin')];

                let targetRemote = 'origin';
                let foundMatch = false;
                for (const r of priorityRemotes) {
                    if (remoteBranches.includes(`${r}/${currentBranch}`)) {
                        targetRemote = r;
                        foundMatch = true;
                        break;
                    }
                }

                let latestCommit = 'N/A';
                let latestHash = null;
                let remoteUrl = null;
                let behindCount = 0;

                if (foundMatch) {
                    try {
                        const targetRef = `${targetRemote}/${currentBranch}`;
                        const { stdout: latestCommitOut } = await exec(`git log ${targetRef} -1 --format="%h - %s (%cr)"`, { cwd: rootDir });
                        latestCommit = latestCommitOut.trim();

                        const { stdout: latestHashOut } = await exec(`git rev-parse ${targetRef}`, { cwd: rootDir });
                        latestHash = latestHashOut.trim();

                        const { stdout: behindOut } = await exec(`git rev-list HEAD..${targetRef} --count`, { cwd: rootDir });
                        behindCount = parseInt(behindOut.trim(), 10) || 0;

                        // Get remote URL
                        const { stdout: urlOut } = await exec(`git remote get-url ${targetRemote}`, { cwd: rootDir });
                        let rawUrl = urlOut.trim();
                        if (rawUrl.startsWith('git@github.com:')) {
                            remoteUrl = rawUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
                        } else {
                            remoteUrl = rawUrl.replace('.git', '');
                        }
                    } catch (err) {
                        latestCommit = '解析遠端資訊失敗';
                    }
                } else {
                    latestCommit = '無法在任何遠端找到匹配的分支';
                }

                gitInfo = {
                    currentBranch,
                    currentCommit,
                    currentHash,
                    latestCommit,
                    latestHash,
                    behindCount,
                    targetRemote: foundMatch ? targetRemote : null,
                    remoteUrl
                };
            } catch (e) {
                console.error("[SystemUpdater] Failed to get git info", e);
            }
        }

        const isOutdated = (() => {
            if (currentVersion === 'Unknown' || remoteVersion === 'Unknown') return false;
            // Simple string comparison works for standard semver (e.g., "0.1.0" < "0.1.1")
            // A more robust method would split and compare numbers, but this covers basic usage.
            const vParam = (v) => v.split('.').map(Number);
            const a = vParam(currentVersion);
            const b = vParam(remoteVersion);
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
                const aNum = a[i] || 0;
                const bNum = b[i] || 0;
                if (aNum < bNum) return true;
                if (aNum > bNum) return false;
            }
            return false;
        })();

        return {
            currentVersion,
            remoteVersion,
            isOutdated,
            installMode: isGit ? 'git' : 'zip',
            gitInfo
        };
    }

    static async update(options, io) {
        const env = await this.checkEnvironment();
        if (env.installMode === 'git') {
            await this.updateViaGit(options, io);
        } else {
            await this.updateViaZip(options, io);
        }
    }

    static broadcast(io, status, message, progress = null) {
        if (io) {
            io.emit('system:update_progress', { status, message, progress });
        }
        console.log(`[Updater] ${status.toUpperCase()} - ${message}`);
    }

    static async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async execAsync(command, options = {}) {
        const util = require('util');
        const exec = util.promisify(require('child_process').exec);
        try {
            await exec(command, options);
        } catch (e) {
            throw e;
        }
    }

    static async updateViaGit(options, io) {
        await this.sleep(1000);
        this.broadcast(io, 'running', '正在啟動 Git 全新更新流程...', 0);
        const { keepMemory } = options;
        const rootDir = process.cwd();

        try {
            // 1. Identify Branch
            this.broadcast(io, 'running', '正在識別當前分支...', 5);
            const { stdout: branchOut } = await require('util').promisify(require('child_process').exec)('git rev-parse --abbrev-ref HEAD', { cwd: rootDir });
            const currentBranch = branchOut.trim();
            this.broadcast(io, 'running', `當前分支: ${currentBranch}`, 10);

            // 2. Full Backup
            this.broadcast(io, 'running', '正在執行全量備份...', 20);
            const backupDirName = `backup_update_${new Date().toISOString().replace(/[:.]/g, '-')}`;
            const backupPath = path.join(rootDir, '..', backupDirName); // Backup to parent dir to avoid being moved into itself
            
            // Actually, safer to put inside a 'backups' folder in the parent or root. 
            // Let's put it in path.join(rootDir, 'backups', backupDirName) but we need to move CURRENT files into it.
            const finalBackupDir = path.join(rootDir, 'backups', backupDirName);
            if (!fs.existsSync(path.join(rootDir, 'backups'))) fs.mkdirSync(path.join(rootDir, 'backups'));
            fs.mkdirSync(finalBackupDir);

            const files = fs.readdirSync(rootDir);
            for (const file of files) {
                if (file === 'backups' || file === 'node_modules' || file === '.git') continue;
                const srcPath = path.join(rootDir, file);
                const destPath = path.join(finalBackupDir, file);
                try {
                    if (fs.existsSync(destPath)) {
                        fs.rmSync(destPath, { recursive: true, force: true });
                    }
                    fs.renameSync(srcPath, destPath);
                } catch (e) {
                    // fallback to copy and delete if rename fails (across devices)
                    this.broadcast(io, 'running', `正在備份 ${file}...`, 25);
                    await this.execAsync(`cp -R "${srcPath}" "${destPath}" && rm -rf "${srcPath}"`);
                }
            }

            // 3. Clone Fresh
            this.broadcast(io, 'running', `正在 Clone 全新分支 (${currentBranch})...`, 40);
            const tempCloneDir = path.join(rootDir, 'temp_clone_' + Date.now());
            // Get remote URL
            const { stdout: remoteUrlOut } = await require('util').promisify(require('child_process').exec)('git remote get-url origin', { cwd: finalBackupDir });
            const remoteUrl = remoteUrlOut.trim();
            
            await this.execAsync(`git clone -b ${currentBranch} ${remoteUrl} "${tempCloneDir}"`);

            // 4. Move Files into root
            this.broadcast(io, 'running', '正在套用新版本檔案...', 60);
            const newFiles = fs.readdirSync(tempCloneDir);
            for (const file of newFiles) {
                if (file === '.git') continue; 
                const srcPath = path.join(tempCloneDir, file);
                const destPath = path.join(rootDir, file);
                
                if (fs.existsSync(destPath)) {
                    fs.rmSync(destPath, { recursive: true, force: true });
                }
                fs.renameSync(srcPath, destPath);
            }
            // Move .git as well to maintain repo state
            if (fs.existsSync(path.join(rootDir, '.git'))) {
                fs.rmSync(path.join(rootDir, '.git'), { recursive: true, force: true });
            }
            fs.renameSync(path.join(tempCloneDir, '.git'), path.join(rootDir, '.git'));
            fs.rmSync(tempCloneDir, { recursive: true, force: true });

            // 5. Restore Personal Data
            if (keepMemory) {
                this.broadcast(io, 'running', '正在還原個人資料 (.env, golem_memory, logs, personas)...', 75);
                const toRestore = ['.env', 'golem_memory', 'logs', 'personas', 'data'];
                for (const item of toRestore) {
                    const src = path.join(finalBackupDir, item);
                    const dest = path.join(rootDir, item);
                    if (fs.existsSync(src)) {
                        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
                        fs.renameSync(src, dest);
                    }
                }
            }

            // 6. Reinstall node_modules
            this.broadcast(io, 'running', '正在重新安裝依賴套件 (npm install)...', 85);
            await this.execAsync('npm install --production=false', { cwd: rootDir });

            if (fs.existsSync(path.join(rootDir, 'web-dashboard', 'package.json'))) {
                this.broadcast(io, 'running', '正在更新 Dashboard 依賴...', 90);
                await this.execAsync('npm install', { cwd: path.join(rootDir, 'web-dashboard') });
                // We skip build here if it's too slow, but user might want it. 
                // Let's stick to simple install for now as per current behavior.
            }

            this.broadcast(io, 'running', '更新完成！即將在 5 秒後關閉系統。', 95);
            
            // 7. Shutdown Countdown
            for (let i = 5; i > 0; i--) {
                this.broadcast(io, 'running', `系統將在 ${i} 秒後關閉，請稍後手動執行 setup.sh 重新啟動。`, 95 + (5 - i));
                await this.sleep(1000);
            }

            this.broadcast(io, 'success', '系統已更新並關閉。', 100);
            
            // Sudden death
            process.exit(0);

        } catch (error) {
            console.error('[SystemUpdater] Advanced update failed:', error);
            this.broadcast(io, 'error', `更新失敗: ${error.message}`);
        }
    }

    static async updateViaZip(options, io) {
        // ... (existing code for updateViaZip)
    }

    static async listBackups() {
        const rootDir = process.cwd();
        const backupsDir = path.join(rootDir, 'backups');
        if (!fs.existsSync(backupsDir)) return [];

        try {
            const folders = fs.readdirSync(backupsDir);
            const backups = folders.map(folder => {
                const folderPath = path.join(backupsDir, folder);
                if (!fs.lstatSync(folderPath).isDirectory()) return null;

                let version = 'Unknown';
                const pkgPath = path.join(folderPath, 'package.json');
                if (fs.existsSync(pkgPath)) {
                    try {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                        version = pkg.version;
                    } catch (e) {}
                }

                // Extract timestamp from folder name backup_update_YYYY-MM-DDTHH-mm-ss-SSSZ
                const timeStr = folder.replace('backup_update_', '');
                // The filename used replace(/[:.]/g, '-')
                // We need to restore YYYY-MM-DD T HH:mm:ss.SSS Z
                // Simple approach: T is the delimiter. 
                // Before T is YYYY-MM-DD (keep as is)
                // After T is HH-mm-ss-SSSZ
                const parts = timeStr.split('T');
                let isoString = timeStr;
                if (parts.length === 2) {
                    const datePart = parts[0];
                    const timePart = parts[1].replace(/-/g, ':'); // HH:mm:ss:SSSZ
                    // Last colon should be a dot for milliseconds
                    const lastColonIndex = timePart.lastIndexOf(':');
                    const fixedTimePart = timePart.substring(0, lastColonIndex) + '.' + timePart.substring(lastColonIndex + 1);
                    isoString = `${datePart}T${fixedTimePart}`;
                }

                const dateObj = new Date(isoString);
                const isValid = !isNaN(dateObj.getTime());

                return {
                    name: folder,
                    version,
                    timestamp: isValid ? dateObj.getTime() : 0,
                    date: isValid ? dateObj.toLocaleString('zh-TW', { hour12: false }) : '格式錯誤'
                };
            }).filter(b => b !== null);

            return backups.sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error('[SystemUpdater] Failed to list backups:', e);
            return [];
        }
    }

    static async rollback(backupName, io) {
        if (!backupName) throw new Error('未提供備份名稱');
        
        await this.sleep(1000);
        this.broadcast(io, 'running', `準備執行回退: ${backupName}...`, 0);
        
        const rootDir = process.cwd();
        const backupsDir = path.join(rootDir, 'backups');
        const sourceDir = path.join(backupsDir, backupName);
        
        if (!fs.existsSync(sourceDir)) {
            throw new Error(`找不到備份: ${backupName}`);
        }

        try {
            // 1. Create a "pre-rollback" backup for safety
            this.broadcast(io, 'running', '正在建立回退前安全性備份...', 10);
            const safetyBackupName = `backup_pre_rollback_${new Date().toISOString().replace(/[:.]/g, '-')}`;
            const safetyBackupDir = path.join(backupsDir, safetyBackupName);
            fs.mkdirSync(safetyBackupDir);

            const currentFiles = fs.readdirSync(rootDir);
            for (const file of currentFiles) {
                if (file === 'backups' || file === 'node_modules' || file === '.git') continue;
                const srcPath = path.join(rootDir, file);
                const destPath = path.join(safetyBackupDir, file);
                try {
                    await this.execAsync(`cp -R "${srcPath}" "${destPath}"`);
                } catch (e) {
                    console.warn(`[Updater] Safety backup failed for ${file}:`, e.message);
                }
            }

            // 2. Clear current files (excluding backups and engine internals)
            this.broadcast(io, 'running', '正在移除當前系統檔案...', 30);
            for (const file of currentFiles) {
                if (file === 'backups' || file === 'node_modules' || file === '.git') continue;
                const p = path.join(rootDir, file);
                fs.rmSync(p, { recursive: true, force: true });
            }

            // 3. Restore from backup
            this.broadcast(io, 'running', '正在還原備份檔案...', 50);
            const backupFiles = fs.readdirSync(sourceDir);
            for (const file of backupFiles) {
                const srcPath = path.join(sourceDir, file);
                const destPath = path.join(rootDir, file);
                await this.execAsync(`cp -R "${srcPath}" "${destPath}"`);
            }

            // 4. Reinstall dependencies
            this.broadcast(io, 'running', '正在重新安裝相依套件 (npm install)...', 70);
            await this.execAsync('npm install --production=false', { cwd: rootDir });

            if (fs.existsSync(path.join(rootDir, 'web-dashboard', 'package.json'))) {
                this.broadcast(io, 'running', '正在更新 Dashboard 依賴...', 85);
                await this.execAsync('npm install', { cwd: path.join(rootDir, 'web-dashboard') });
            }

            // 5. Success and Shutdown
            this.broadcast(io, 'running', '回退成功！系統即將在 5 秒後關閉。', 95);
            for (let i = 5; i > 0; i--) {
                this.broadcast(io, 'running', `系統將在 ${i} 秒後自動重啟（請稍後手動執行 setup.sh）。`, 95 + (5 - i));
                await this.sleep(1000);
            }

            this.broadcast(io, 'success', '回退已完成，系統關閉中。', 100);
            process.exit(0);

        } catch (error) {
            console.error('[SystemUpdater] Rollback failed:', error);
            this.broadcast(io, 'error', `回退失敗: ${error.message}`);
            throw error;
        }
    }
}

module.exports = SystemUpdater;
