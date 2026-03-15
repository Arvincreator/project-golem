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
                let behindCount = 0;

                if (foundMatch) {
                    try {
                        const targetRef = `${targetRemote}/${currentBranch}`;
                        const { stdout: latestCommitOut } = await exec(`git log ${targetRef} -1 --format="%h - %s (%cr)"`, { cwd: rootDir });
                        latestCommit = latestCommitOut.trim();

                        const { stdout: behindOut } = await exec(`git rev-list HEAD..${targetRef} --count`, { cwd: rootDir });
                        behindCount = parseInt(behindOut.trim(), 10) || 0;
                    } catch (err) {
                        latestCommit = '解析遠端資訊失敗';
                    }
                } else {
                    latestCommit = '無法在任何遠端找到匹配的分支';
                }

                gitInfo = {
                    currentBranch,
                    currentCommit,
                    latestCommit,
                    behindCount,
                    targetRemote: foundMatch ? targetRemote : null
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
        // Wait briefly so the frontend socket has time to connect
        await this.sleep(1000);
        this.broadcast(io, 'running', '開始執行 Git 更新流程...', 0);
        try {
            const rootDir = process.cwd();
            // Git stash, pull, pop
            this.broadcast(io, 'running', '儲存本地暫存變更 (git stash)...', 10);
            try { await this.execAsync('git stash', { cwd: rootDir }); } catch (e) { console.warn('[SystemUpdater] git stash failed:', e.message); }

            this.broadcast(io, 'running', '執行 git fetch --all 同步所有遠端資訊...', 20);
            await this.execAsync('git fetch --all', { cwd: rootDir });

            let currentBranch = 'main';
            let targetRemote = 'origin';
            try {
                const util = require('util');
                const exec = util.promisify(require('child_process').exec);

                const { stdout: branchOut } = await exec('git rev-parse --abbrev-ref HEAD', { cwd: rootDir });
                currentBranch = branchOut.trim();

                const { stdout: rbOut } = await exec('git branch -r', { cwd: rootDir });
                const remoteBranches = rbOut.trim().split('\n').map(b => b.trim());

                const { stdout: rOut } = await exec('git remote', { cwd: rootDir });
                const remotes = rOut.trim().split('\n');

                const priorityRemotes = ['upstream', 'origin', ...remotes.filter(r => r !== 'upstream' && r !== 'origin')];
                let foundMatch = false;
                for (const r of priorityRemotes) {
                    if (remoteBranches.includes(`${r}/${currentBranch}`)) {
                        targetRemote = r;
                        foundMatch = true;
                        break;
                    }
                }

                if (!foundMatch) {
                    console.warn(`[SystemUpdater] No remote branch matches ${currentBranch}, fallback to ${targetRemote}`);
                }
            } catch (e) {
                console.warn("[SystemUpdater] Git detection failed, using defaults");
            }

            this.broadcast(io, 'running', `從遠端拉取代碼 (git pull ${targetRemote} ${currentBranch})...`, 30);
            try { await this.execAsync(`git pull ${targetRemote} ${currentBranch}`, { cwd: rootDir }); }
            catch (e) { throw new Error(`拉取遠端 ${targetRemote}/${currentBranch} 失敗。`); }

            this.broadcast(io, 'running', '回復本地變更 (git stash pop)...', 50);
            try { await this.execAsync('git stash pop', { cwd: rootDir }); } catch (e) { console.warn('[SystemUpdater] git stash pop failed:', e.message); }

            this.broadcast(io, 'running', '安裝主專案依賴套件 (npm install)...', 70);
            await this.execAsync('npm install --production=false', { cwd: rootDir });

            if (fs.existsSync(path.join(rootDir, 'web-dashboard', 'package.json'))) {
                this.broadcast(io, 'running', '更新 Dashboard 模組與依賴...', 90);
                await this.execAsync('npm install', { cwd: path.join(rootDir, 'web-dashboard') });
                try { await this.execAsync('npm run build', { cwd: path.join(rootDir, 'web-dashboard') }); } catch (e) { console.warn('[SystemUpdater] Dashboard build failed:', e.message); }
            }

            this.broadcast(io, 'requires_restart', '✨ 更新完成！請點擊重啟按鈕。', 100);
        } catch (error) {
            console.error('[SystemUpdater] Git update failed:', error);
            this.broadcast(io, 'error', `更新失敗: ${error.message}`);
        }
    }

    static async updateViaZip(options, io) {
        await this.sleep(1000);
        this.broadcast(io, 'running', '開始執行 ZIP 更新流程...', 0);
        const { keepOldData, keepMemory } = options;
        const AdmZip = require('adm-zip');
        const rootDir = process.cwd();

        try {
            // 1. Download
            this.broadcast(io, 'running', '從 GitHub 下載最新版本...', 10);
            const repoUrl = 'https://github.com/sz9751210/project-golem/archive/refs/heads/main.zip';
            const response = await fetch(repoUrl);
            if (!response.ok) throw new Error(`下載 ZIP 失敗: HTTP ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // 2. Extract to temp
            this.broadcast(io, 'running', '解壓縮更新檔...', 40);
            const tempDir = path.join(rootDir, 'temp_update_' + Date.now());
            const zip = new AdmZip(buffer);
            zip.extractAllTo(tempDir, true);

            // The unzipped folder will be like project-golem-main
            const extractedFolders = fs.readdirSync(tempDir);
            if (extractedFolders.length === 0) throw new Error('ZIP 包內沒有檔案');
            const sourceDir = path.join(tempDir, extractedFolders[0]);

            // 3. Backup old files
            this.broadcast(io, 'running', '備份現有資料並清理...', 60);
            await this.sleep(100); // let UI update
            const backupDir = path.join(rootDir, 'backup_' + new Date().toISOString().replace(/[:.]/g, '-'));
            if (keepOldData) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const currentFiles = fs.readdirSync(rootDir);
            for (const file of currentFiles) {
                // Skip critical / tmp paths
                if (file.startsWith('backup_') || file.startsWith('temp_update_') || file === 'node_modules' || file === '.git' || file === '.DS_Store' || file === 'web-dashboard') {
                    if (file === 'web-dashboard') {
                        // explicitly handle web-dashboard: just delete node_modules & .next inside it if not keeping?
                        // actually safer to backup or delete the whole thing so it upgrades perfectly.
                    } else {
                        continue;
                    }
                }

                // Keep memory
                if (keepMemory && (file === 'golem_memory' || file === '.env' || file === '.env.example' || file === 'personas')) {
                    continue; // Skip moving/deleting these
                }

                const srcPath = path.join(rootDir, file);

                if (keepOldData) {
                    const destPath = path.join(backupDir, file);
                    try { fs.renameSync(srcPath, destPath); } catch (e) {
                        try { fs.rmSync(srcPath, { recursive: true, force: true }); } catch (ignore) { console.warn('[SystemUpdater] Failed to remove file during backup fallback:', ignore.message); }
                    }
                } else {
                    try { fs.rmSync(srcPath, { recursive: true, force: true }); } catch (e) { console.warn('[SystemUpdater] Failed to remove old file:', e.message); }
                }
            }

            // 4. Move new files into root
            this.broadcast(io, 'running', '套用新版本檔案...', 75);
            await this.sleep(100);
            const newFiles = fs.readdirSync(sourceDir);
            for (const file of newFiles) {
                const srcPath = path.join(sourceDir, file);
                const destPath = path.join(rootDir, file);

                // If dest exists, we don't overwrite if it was kept
                if (fs.existsSync(destPath) && keepMemory && (file === 'golem_memory' || file === '.env' || file === 'personas')) {
                    continue;
                }

                try {
                    // if moving a directory that already exists, cp -r is better, but rename is atomic if on same drive.
                    // If dest exists and wasn't skipped above, we should delete it first
                    if (fs.existsSync(destPath)) {
                        fs.rmSync(destPath, { recursive: true, force: true });
                    }
                    fs.renameSync(srcPath, destPath);
                } catch (e) {
                    console.error(`Failed to move ${file}: ${e.message}`);
                }
            }

            // Cleanup temp
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { console.warn('[SystemUpdater] Failed to cleanup temp dir:', e.message); }

            // 5. Npm install
            this.broadcast(io, 'running', '安裝依賴套件 (npm install)...', 85);
            await this.execAsync('npm install --production=false', { cwd: rootDir });

            if (fs.existsSync(path.join(rootDir, 'web-dashboard', 'package.json'))) {
                this.broadcast(io, 'running', '更新 Dashboard 相依套件...', 90);
                await this.execAsync('npm install', { cwd: path.join(rootDir, 'web-dashboard') });
            }

            this.broadcast(io, 'requires_restart', '✨ 更新完成！舊檔案已備份。請點擊重啟按鈕。', 100);
        } catch (error) {
            console.error('[SystemUpdater] ZIP update failed:', error);
            this.broadcast(io, 'error', `更新失敗: ${error.message}`);
        }
    }
}

module.exports = SystemUpdater;
