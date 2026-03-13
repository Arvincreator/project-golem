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

        const isGit = fs.existsSync(path.join(rootDir, '.git'));
        let currentBranch = 'main';
        let gitInfo = null;

        if (isGit) {
            try {
                const util = require('util');
                const exec = util.promisify(require('child_process').exec);

                // 1. Fetch from all remotes to get latest metadata
                try { await exec('git fetch --all', { cwd: rootDir }); } catch (e) { }

                // 2. Identify current branch
                const { stdout: branchOut } = await exec('git rev-parse --abbrev-ref HEAD', { cwd: rootDir });
                currentBranch = branchOut.trim();

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

        let remoteVersion = 'Unknown';
        try {
            // Use currentBranch for checking remote version
            const rawUrl = `https://raw.githubusercontent.com/Arvincreator/project-golem/${currentBranch}/package.json`;
            const response = await fetch(rawUrl);
            if (response.ok) {
                const remotePkg = await response.json();
                remoteVersion = remotePkg.version || 'Unknown';
            } else if (currentBranch !== 'main') {
                // Fallback to main if branch specific package.json not found
                const fallbackRes = await fetch(`https://raw.githubusercontent.com/Arvincreator/project-golem/main/package.json`);
                if (fallbackRes.ok) {
                    const fallbackPkg = await fallbackRes.json();
                    remoteVersion = fallbackPkg.version || 'Unknown';
                }
            }
        } catch (e) {
            console.error("[SystemUpdater] Failed to fetch remote version", e);
        }

        const isOutdated = (() => {
            if (currentVersion === 'Unknown' || remoteVersion === 'Unknown') return false;
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
            currentBranch,
            gitInfo
        };
    }

    static async update(options, io) {
        const env = await this.checkEnvironment();
        if (env.installMode === 'git') {
            await this.updateViaGit(options, io, env);
        } else {
            await this.updateViaZip(options, io, env);
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

    static async updateViaGit(options, io, env = {}) {
        // Wait briefly so the frontend socket has time to connect
        await this.sleep(1000);
        this.broadcast(io, 'running', '開始執行 Git 備份與更新流程...', 0);

        try {
            const rootDir = process.cwd();
            const { keepMemory = true } = options;

            // 1. Create Backup
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDirName = `backup_git_${timestamp}`;
            const backupPath = path.join(rootDir, backupDirName);

            this.broadcast(io, 'running', `建立系統備份 (${backupDirName})...`, 10);
            fs.mkdirSync(backupPath, { recursive: true });

            const filesToBackup = fs.readdirSync(rootDir);
            for (const file of filesToBackup) {
                // Exclude heavy or irrelevant folders
                if (file.startsWith('backup_') || file.startsWith('temp_') || file === 'node_modules' || file === '.git' || file === '.DS_Store' || file === backupDirName) {
                    continue;
                }

                // Copy for safety (renaming in Git mode is risky before reset)
                const src = path.join(rootDir, file);
                const dest = path.join(backupPath, file);

                try {
                    // Using exec cp -R for speed and cross-platform simplicity if possible, 
                    // or recursive manual copy. For simplicity in this script:
                    if (fs.lstatSync(src).isDirectory()) {
                        this.execSyncRecursive(`cp -R "${src}" "${backupPath}/"`);
                    } else {
                        fs.copyFileSync(src, dest);
                    }
                } catch (e) {
                    console.warn(`[SystemUpdater] Backup failed for ${file}: ${e.message}`);
                }
            }

            this.broadcast(io, 'running', '清理本地變更以避免衝突 (git reset --hard)...', 40);
            await this.execAsync('git reset --hard', { cwd: rootDir });
            await this.execAsync('git clean -fd', { cwd: rootDir });

            this.broadcast(io, 'running', '執行 git fetch --all 同步資訊...', 50);
            await this.execAsync('git fetch --all', { cwd: rootDir });

            let currentBranch = env.currentBranch || 'main';
            let targetRemote = (env.gitInfo && env.gitInfo.targetRemote) || 'origin';

            if (!env.gitInfo) {
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
                } catch (e) {
                    console.warn("[SystemUpdater] Git detection failed, using defaults");
                }
            }

            this.broadcast(io, 'running', `從遠端拉取代碼 (git pull ${targetRemote} ${currentBranch})...`, 60);
            await this.execAsync(`git pull ${targetRemote} ${currentBranch}`, { cwd: rootDir });

            this.broadcast(io, 'running', '安裝主專案依賴套件 (npm install)...', 80);
            await this.execAsync('npm install --production=false', { cwd: rootDir });

            if (fs.existsSync(path.join(rootDir, 'web-dashboard', 'package.json'))) {
                this.broadcast(io, 'running', '更新 Dashboard 模組與依賴...', 90);
                await this.execAsync('npm install', { cwd: path.join(rootDir, 'web-dashboard') });
                try { await this.execAsync('npm run build', { cwd: path.join(rootDir, 'web-dashboard') }); } catch (e) { }
            }

            this.broadcast(io, 'requires_restart', `✨ 更新完成！您的舊檔案已備份至 ${backupDirName}。`, 100);
        } catch (error) {
            console.error('[SystemUpdater] Git update failed:', error);
            this.broadcast(io, 'error', `更新失敗: ${error.message}`);
        }
    }

    static execSyncRecursive(command) {
        try {
            const { execSync } = require('child_process');
            execSync(command);
        } catch (e) {
            // Silently fail or log
        }
    }

    static async updateViaZip(options, io, env = {}) {
        await this.sleep(1000);
        this.broadcast(io, 'running', '開始執行 ZIP 備份與更新流程...', 0);
        const { keepMemory = true } = options;
        const AdmZip = require('adm-zip');
        const rootDir = process.cwd();

        try {
            // 1. Download
            const branch = env.currentBranch || 'main';
            this.broadcast(io, 'running', `從 GitHub 下載最新版本 (${branch})...`, 10);
            const repoUrl = `https://github.com/Arvincreator/project-golem/archive/refs/heads/${branch}.zip`;
            const response = await fetch(repoUrl);
            if (!response.ok) throw new Error(`下載 ZIP 失敗: HTTP ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // 2. Backup EVERYTHING current (Incremental backup)
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDirName = `backup_zip_${timestamp}`;
            const backupPath = path.join(rootDir, backupDirName);

            this.broadcast(io, 'running', `執行全系統預防性備份 (${backupDirName})...`, 30);
            fs.mkdirSync(backupPath, { recursive: true });

            const currentFiles = fs.readdirSync(rootDir);
            for (const file of currentFiles) {
                if (file.startsWith('backup_') || file.startsWith('temp_') || file === 'node_modules' || file === '.git' || file === '.DS_Store' || file === backupDirName) {
                    continue;
                }

                const src = path.join(rootDir, file);
                const dest = path.join(backupPath, file);

                // For zip mode, we MOVE the files to the backup folder to ensure a clean root
                // BUT we keep memory and env if keepMemory is true (copy them to backup instead of move)
                const isCritical = (keepMemory && (file === 'golem_memory' || file === '.env' || file === '.env.example' || file === 'personas'));

                try {
                    if (isCritical) {
                        if (fs.lstatSync(src).isDirectory()) {
                            this.execSyncRecursive(`cp -R "${src}" "${backupPath}/"`);
                        } else {
                            fs.copyFileSync(src, dest);
                        }
                    } else {
                        fs.renameSync(src, dest);
                    }
                } catch (e) {
                    console.warn(`[SystemUpdater] ZIP Backup/Move failed for ${file}: ${e.message}`);
                }
            }

            // 3. Extract to root directly
            this.broadcast(io, 'running', '解壓縮並套用新版本檔案...', 60);
            const tempDir = path.join(rootDir, 'temp_zip_' + Date.now());
            fs.mkdirSync(tempDir, { recursive: true });
            const zip = new AdmZip(buffer);
            zip.extractAllTo(tempDir, true);

            const extractedFolders = fs.readdirSync(tempDir);
            if (extractedFolders.length === 0) throw new Error('ZIP 包內沒有檔案');
            const sourceDir = path.join(tempDir, extractedFolders[0]);

            const newFiles = fs.readdirSync(sourceDir);
            for (const file of newFiles) {
                const srcPath = path.join(sourceDir, file);
                const destPath = path.join(rootDir, file);

                // If it's a critical file we kept in root, don't overwrite it with the default from ZIP
                if (fs.existsSync(destPath) && keepMemory && (file === 'golem_memory' || file === '.env' || file === 'personas')) {
                    continue;
                }

                if (fs.existsSync(destPath)) {
                    fs.rmSync(destPath, { recursive: true, force: true });
                }
                fs.renameSync(srcPath, destPath);
            }

            // Cleanup temp
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }

            // 4. Npm install
            this.broadcast(io, 'running', '安裝依賴套件 (npm install)...', 85);
            await this.execAsync('npm install --production=false', { cwd: rootDir });

            if (fs.existsSync(path.join(rootDir, 'web-dashboard', 'package.json'))) {
                this.broadcast(io, 'running', '更新 Dashboard 相依套件...', 90);
                await this.execAsync('npm install', { cwd: path.join(rootDir, 'web-dashboard') });
            }

            this.broadcast(io, 'requires_restart', `✨ 更新完成！所有舊檔案已移至 ${backupDirName}。`, 100);
        } catch (error) {
            console.error('[SystemUpdater] ZIP update failed:', error);
            this.broadcast(io, 'error', `更新失敗: ${error.message}`);
        }
    }
}

module.exports = SystemUpdater;
