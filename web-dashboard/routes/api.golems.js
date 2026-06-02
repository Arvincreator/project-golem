const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildOperationGuard } = require('../server/security');

module.exports = function registerGolemRoutes(server) {
    const router = express.Router();
    const requireGolemOps = buildOperationGuard(server, 'golem_admin_operation');

    function ensureLocalFileAccess(req, res) {
        if (server.isLocalRequest(req)) return true;
        res.status(403).json({
            error: 'Memory reincarnation is only available from the local dashboard.'
        });
        return false;
    }

    function isDirectory(targetPath) {
        try {
            return fs.statSync(targetPath).isDirectory();
        } catch {
            return false;
        }
    }

    function isDirectoryEmpty(targetPath) {
        try {
            return !fs.existsSync(targetPath) || fs.readdirSync(targetPath).length === 0;
        } catch {
            return true;
        }
    }

    function resolveMemorySource(inputPath) {
        const rawPath = String(inputPath || '').trim();
        if (!rawPath) return null;

        const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));
        const basename = path.basename(resolved);
        const memoryDir = basename === 'golem_memory'
            ? resolved
            : path.join(resolved, 'golem_memory');

        return { projectDir: basename === 'golem_memory' ? path.dirname(resolved) : resolved, memoryDir };
    }

    function countMemoryFiles(memoryDir) {
        const summary = { files: 0, directories: 0, bytes: 0 };
        const stack = [memoryDir];

        while (stack.length > 0) {
            const current = stack.pop();
            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const entryPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    summary.directories += 1;
                    stack.push(entryPath);
                } else if (entry.isFile()) {
                    summary.files += 1;
                    try {
                        summary.bytes += fs.statSync(entryPath).size;
                    } catch {
                        // Ignore files that disappear during import.
                    }
                }
            }
        }

        return summary;
    }

    function toRelativeMemoryPath(sourceRoot, entryPath) {
        const rel = path.relative(sourceRoot, entryPath);
        return rel || '.';
    }

    function copyMemoryDirectoryBestEffort(sourceRoot, targetRoot) {
        const summary = { files: 0, directories: 0, bytes: 0, skipped: [] };
        const maxSkippedDetails = 25;

        function recordSkip(entryPath, error) {
            const relativePath = toRelativeMemoryPath(sourceRoot, entryPath);
            const reason = error && error.code ? error.code : (error && error.message) || 'UNKNOWN';
            if (summary.skipped.length < maxSkippedDetails) {
                summary.skipped.push({ path: relativePath, reason });
            }
            console.warn(`[WebServer] Memory reincarnation skipped ${relativePath}: ${reason}`);
        }

        function copyEntry(sourcePath, targetPath) {
            let stat;
            try {
                stat = fs.lstatSync(sourcePath);
            } catch (error) {
                recordSkip(sourcePath, error);
                return;
            }

            if (stat.isSymbolicLink()) {
                recordSkip(sourcePath, { code: 'SYMLINK_SKIPPED' });
                return;
            }

            if (stat.isDirectory()) {
                try {
                    fs.mkdirSync(targetPath, { recursive: true });
                    summary.directories += 1;
                } catch (error) {
                    recordSkip(sourcePath, error);
                    return;
                }

                let entries;
                try {
                    entries = fs.readdirSync(sourcePath, { withFileTypes: true });
                } catch (error) {
                    recordSkip(sourcePath, error);
                    return;
                }

                for (const entry of entries) {
                    copyEntry(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
                }
                return;
            }

            if (!stat.isFile()) {
                recordSkip(sourcePath, { code: 'UNSUPPORTED_ENTRY' });
                return;
            }

            try {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.copyFileSync(sourcePath, targetPath);
                try {
                    fs.chmodSync(targetPath, stat.mode);
                } catch {
                    // Permissions are best-effort; copied content matters more.
                }
                summary.files += 1;
                summary.bytes += stat.size;
            } catch (error) {
                recordSkip(sourcePath, error);
            }
        }

        copyEntry(sourceRoot, targetRoot);
        return summary;
    }

    function mergeMemoryDirectoryBestEffort(sourceRoot, targetRoot) {
        const summary = { files: 0, directories: 0, bytes: 0, skipped: [] };
        const maxSkippedDetails = 50;

        function recordSkip(entryPath, error) {
            const relativePath = toRelativeMemoryPath(sourceRoot, entryPath);
            const reason = error && error.code ? error.code : (error && error.message) || 'UNKNOWN';
            if (summary.skipped.length < maxSkippedDetails) {
                summary.skipped.push({ path: relativePath, reason });
            }
            console.warn(`[WebServer] Memory merge skipped ${relativePath}: ${reason}`);
        }

        function mergeEntry(sourcePath, targetPath) {
            let stat;
            try {
                stat = fs.lstatSync(sourcePath);
            } catch (error) {
                recordSkip(sourcePath, error);
                return;
            }

            if (stat.isSymbolicLink()) {
                recordSkip(sourcePath, { code: 'SYMLINK_SKIPPED' });
                return;
            }

            if (stat.isDirectory()) {
                try {
                    fs.mkdirSync(targetPath, { recursive: true });
                    summary.directories += 1;
                } catch (error) {
                    recordSkip(sourcePath, error);
                    return;
                }

                let entries = [];
                try {
                    entries = fs.readdirSync(sourcePath, { withFileTypes: true });
                } catch (error) {
                    recordSkip(sourcePath, error);
                    return;
                }

                for (const entry of entries) {
                    mergeEntry(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
                }
                return;
            }

            if (!stat.isFile()) {
                recordSkip(sourcePath, { code: 'UNSUPPORTED_ENTRY' });
                return;
            }

            try {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.copyFileSync(sourcePath, targetPath);
                summary.files += 1;
                summary.bytes += stat.size;
            } catch (error) {
                recordSkip(sourcePath, error);
            }
        }

        mergeEntry(sourceRoot, targetRoot);
        return summary;
    }

    function isWindowsPathLockedError(error) {
        return process.platform === 'win32'
            && error
            && (error.code === 'EPERM' || error.code === 'EBUSY')
            && (error.syscall === 'rename' || error.syscall === 'rmdir' || error.syscall === 'unlink');
    }

    function buildMemoryReplaceError(error, targetMemoryDir) {
        if (isWindowsPathLockedError(error)) {
            return {
                status: 409,
                body: {
                    error: '目前新專案的 golem_memory 正被 Windows 或瀏覽器程序占用，無法替換記憶資料夾。請先關閉 Golem、Dashboard、Chrome/Chromium 視窗後再重試。',
                    code: error.code,
                    detail: error.message,
                    targetPath: targetMemoryDir,
                    suggestion: '若仍失敗，請重新開機後先不要啟動 Golem，直接執行記憶轉生。',
                },
            };
        }

        return null;
    }

    function detectMemoryLockHints(memoryDir) {
        const root = path.resolve(memoryDir);
        const candidates = [
            'SingletonLock',
            'SingletonSocket',
            'SingletonCookie',
            'RunningChromeVersion',
            path.join('Default', 'LOCK'),
            path.join('Default', 'Network', 'Cookies'),
        ];

        const hits = [];
        for (const rel of candidates) {
            const full = path.join(root, rel);
            try {
                if (fs.existsSync(full)) hits.push(full);
            } catch {
                // ignore
            }
        }
        return hits;
    }

    async function startTelegramPollingIfAvailable(instance, golemId, reason) {
        const bot = instance && instance.brain && instance.brain.tgBot;
        if (!bot || typeof bot.startPolling !== 'function') return;
        if (typeof bot.isPolling === 'function' && bot.isPolling()) return;

        try {
            await bot.startPolling({ restart: true });
            console.log(`🤖 [Bot] ${golemId} Telegram polling started (${reason}).`);
        } catch (botErr) {
            console.warn(`⚠️ [Bot] ${golemId} Polling failed (${reason}):`, botErr.message);
        }
    }

    async function quiesceContextsForMemoryReincarnation(targetMemoryDir) {
        const report = {
            attempted: 0,
            paused: [],
            failed: [],
        };
        const normalizedTarget = path.resolve(targetMemoryDir);

        for (const [golemId, instance] of server.contexts.entries()) {
            const brain = instance && instance.brain;
            if (!brain) continue;

            const brainDir = path.resolve(String(brain.userDataDir || ''));
            if (!brainDir || brainDir !== normalizedTarget) continue;

            report.attempted += 1;
            try {
                if (instance.autonomy && typeof instance.autonomy.stop === 'function') {
                    await instance.autonomy.stop();
                }

                const bot = brain.tgBot;
                if (bot && typeof bot.stopPolling === 'function') {
                    await bot.stopPolling().catch(() => {});
                }

                if (typeof brain.dispose === 'function') {
                    await brain.dispose({ closeContext: true });
                } else if (brain.browser && typeof brain.browser.close === 'function') {
                    await brain.browser.close().catch(() => {});
                }

                brain.status = 'not_started';
                report.paused.push(golemId);
                console.log(`🧊 [WebServer] Quiesced Golem context for memory reincarnation: ${golemId}`);
            } catch (error) {
                const message = error && error.message ? error.message : String(error);
                report.failed.push({ golemId, message });
                console.warn(`⚠️ [WebServer] Failed to quiesce ${golemId} before memory reincarnation: ${message}`);
            }
        }

        return report;
    }

    router.get('/api/golems', (req, res) => {
        try {
            const EnvManager = require('../../src/utils/EnvManager');
            const envVars = EnvManager.readEnv();

            const golemsData = [];
            const isSingleMode = envVars.GOLEM_MODE === 'SINGLE' || !envVars.GOLEM_MODE;
            const hasToken = envVars.TELEGRAM_TOKEN || envVars.DISCORD_TOKEN;

            if (hasToken || isSingleMode) {
                const id = 'golem_A';
                const context = server.contexts.get(id);
                let status = 'not_started';

                if (context && context.brain) {
                    status = context.brain.status || 'running';
                }
                golemsData.push({ id, status });
            }

            server.contexts.forEach((ctx, id) => {
                if (!golemsData.find((g) => g.id === id)) {
                    golemsData.push({ id, status: (ctx.brain && ctx.brain.status) || 'running' });
                }
            });

            return res.json({ golems: golemsData });
        } catch (e) {
            console.error('[WebServer] Failed to fetch golems list:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/create', requireGolemOps, async (req, res) => {
        try {
            const {
                id,
                tgToken,
                tgAuthMode,
                tgAdminId,
                tgChatId,
                dcToken,
                dcAuthMode,
                dcChatId,
                dcAdminId
            } = req.body;

            const EnvManager = require('../../src/utils/EnvManager');
            const ConfigManager = require('../../src/config/index');

            if (!id) {
                return res.status(400).json({ error: 'Missing required fields: id' });
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                return res.status(400).json({ error: 'Invalid Golem ID: only alphanumeric, _ and - allowed' });
            }

            console.log('📝 [API] System in SINGLE mode. Writing Golem config to .env');
            const updates = {};
            if (tgToken) {
                updates.TELEGRAM_TOKEN = tgToken;
                updates.TG_AUTH_MODE = tgAuthMode || 'ADMIN';
                if (tgAuthMode === 'CHAT' && tgChatId) updates.TG_CHAT_ID = tgChatId;
                if ((!tgAuthMode || tgAuthMode === 'ADMIN') && tgAdminId) updates.ADMIN_ID = tgAdminId;
            }
            if (dcToken) {
                updates.DISCORD_TOKEN = dcToken;
                updates.DISCORD_AUTH_MODE = dcAuthMode || 'ADMIN';
                updates.DISCORD_CHAT_ID = dcAuthMode === 'CHAT' ? (dcChatId || '') : '';
                updates.DISCORD_ADMIN_ID = (!dcAuthMode || dcAuthMode === 'ADMIN') ? (dcAdminId || '') : '';
            }

            EnvManager.updateEnv(updates);
            console.log('✅ [WebServer] Single Mode config updated in .env. Triggering reload...');
            ConfigManager.reloadConfig();

            if (typeof server.golemFactory === 'function') {
                const { GOLEMS_CONFIG: freshGolemsConfig } = ConfigManager;
                const singleGolemConfig = freshGolemsConfig.find((g) => g.id === 'golem_A') || {
                    id: 'golem_A',
                    tgToken,
                    tgAuthMode: tgAuthMode || 'ADMIN',
                    adminId: tgAdminId,
                    chatId: tgChatId,
                    dcToken,
                    dcAuthMode: dcAuthMode || 'ADMIN',
                    dcChatId,
                    dcAdminId,
                };

                try {
                    await server.golemFactory(singleGolemConfig);
                } catch (factoryErr) {
                    console.error('❌ [WebServer] Single Mode golem_A factory failed:', factoryErr.message);
                }
            }

            return res.json({
                success: true,
                mode: 'SINGLE',
                id: 'golem_A',
                message: 'Single Mode configuration updated successfully.'
            });
        } catch (e) {
            console.error('[WebServer] Failed to create Golem:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/start', requireGolemOps, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing Golem ID' });

            let instance = server.contexts.get(id);
            if (!instance) {
                if (typeof server.golemFactory === 'function') {
                    console.log(`🧬 [WebServer] Golem '${id}' not in memory. Triggering lazy gestation (Single Mode)...`);
                    const ConfigManager = require('../../src/config/index');
                    const targetConfig = ConfigManager.GOLEMS_CONFIG.find((g) => g.id === id);
                    if (!targetConfig) return res.status(404).json({ error: `Config for '${id}' not found in internal config.` });

                    await server.golemFactory(targetConfig);
                    instance = server.contexts.get(id);
                }
                if (!instance) return res.status(404).json({ error: `Golem '${id}' failed to gestate.` });
            }

            if (instance.brain.status === 'running') {
                return res.json({ success: true, message: 'Golem is already running.' });
            }

            console.log(`🎬 [WebServer] Explicitly starting Golem: ${id}`);
            server.isBooting = true;
            try {
                try {
                    await instance.brain.init();
                    instance.brain.status = 'running';
                } catch (initErr) {
                    instance.brain.status = 'error';
                    console.error(`[WebServer] Golem '${id}' brain init failed; keeping Telegram polling alive:`, initErr.message);
                }
            } finally {
                await startTelegramPollingIfAvailable(instance, id, 'manual_start');
                server.isBooting = false;
            }

            if (instance.autonomy && typeof instance.autonomy.start === 'function') {
                instance.autonomy.start();
            }

            return res.json({ success: true, message: `Golem '${id}' started successfully.` });
        } catch (e) {
            console.error('[WebServer] Failed to start Golem:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/golems/memory-reincarnation/browse', requireGolemOps, (req, res) => {
        if (!ensureLocalFileAccess(req, res)) return;

        try {
            const requestedPath = String(req.query.path || '').trim();
            const currentPath = requestedPath
                ? path.resolve(requestedPath.replace(/^~/, os.homedir()))
                : os.homedir();

            if (!isDirectory(currentPath)) {
                return res.status(400).json({ error: 'Selected path is not a readable directory.' });
            }

            const entries = fs.readdirSync(currentPath, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
                .slice(0, 250)
                .map((entry) => {
                    const fullPath = path.join(currentPath, entry.name);
                    return {
                        name: entry.name,
                        path: fullPath,
                        hasMemory: isDirectory(path.join(fullPath, 'golem_memory')) || entry.name === 'golem_memory',
                    };
                })
                .sort((a, b) => Number(b.hasMemory) - Number(a.hasMemory) || a.name.localeCompare(b.name));

            const source = resolveMemorySource(currentPath);
            const hasMemory = !!source && isDirectory(source.memoryDir);

            return res.json({
                currentPath,
                parentPath: path.dirname(currentPath) !== currentPath ? path.dirname(currentPath) : null,
                entries,
                hasMemory,
                memoryPath: hasMemory ? source.memoryDir : null,
                roots: [
                    { label: 'Home', path: os.homedir() },
                    { label: 'Current Project', path: process.cwd() },
                    { label: 'Desktop', path: path.join(os.homedir(), 'Desktop') },
                    { label: 'Downloads', path: path.join(os.homedir(), 'Downloads') },
                ].filter((root) => isDirectory(root.path)),
            });
        } catch (e) {
            console.error('[WebServer] Failed to browse memory reincarnation folders:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/memory-reincarnation/import', requireGolemOps, async (req, res) => {
        if (!ensureLocalFileAccess(req, res)) return;

        try {
            const source = resolveMemorySource(req.body && req.body.sourcePath);
            if (!source || !isDirectory(source.memoryDir)) {
                return res.status(400).json({ error: '找不到舊專案的 golem_memory 資料夾。' });
            }

            const ConfigManager = require('../../src/config/index');
            const targetMemoryDir = path.resolve(ConfigManager.MEMORY_BASE_DIR);
            const sourceMemoryDir = path.resolve(source.memoryDir);
            const quiesceReport = await quiesceContextsForMemoryReincarnation(targetMemoryDir);
            if (quiesceReport.failed.length > 0) {
                return res.status(409).json({
                    error: '記憶轉生前無法暫停目前執行中的 Golem，已中止替換以避免資料不一致。',
                    detail: '請先停止相關 Golem 或重啟後先不要啟動，再重試記憶轉生。',
                    quiesceReport,
                });
            }

            if (sourceMemoryDir === targetMemoryDir) {
                return res.status(400).json({ error: '來源與目前記憶資料夾相同，不需要轉生。' });
            }

            const targetParent = path.dirname(targetMemoryDir);
            if (!fs.existsSync(targetParent)) fs.mkdirSync(targetParent, { recursive: true });

            const tempTargetDir = fs.mkdtempSync(path.join(targetParent, '.golem-memory-reincarnation-'));
            const summary = copyMemoryDirectoryBestEffort(sourceMemoryDir, tempTargetDir);

            if (summary.files === 0 && summary.directories <= 1) {
                fs.rmSync(tempTargetDir, { recursive: true, force: true });
                return res.status(400).json({
                    error: '舊記憶資料夾無法讀取，沒有任何記憶檔案被複製。',
                    skipped: summary.skipped,
                });
            }

            let backupPath = null;
            let mergeFallbackUsed = false;
            let mergeSummary = null;
            if (fs.existsSync(targetMemoryDir) && !isDirectoryEmpty(targetMemoryDir)) {
                backupPath = `${targetMemoryDir}.before-reincarnation-${Date.now()}`;
                try {
                    fs.renameSync(targetMemoryDir, backupPath);
                } catch (error) {
                    const friendly = buildMemoryReplaceError(error, targetMemoryDir);
                    if (friendly) {
                        console.warn('⚠️ [WebServer] Replace blocked by lock; fallback to in-place merge mode.');
                        mergeFallbackUsed = true;
                        mergeSummary = mergeMemoryDirectoryBestEffort(sourceMemoryDir, targetMemoryDir);
                        fs.rmSync(tempTargetDir, { recursive: true, force: true });
                    } else {
                        fs.rmSync(tempTargetDir, { recursive: true, force: true });
                        throw error;
                    }
                }
            } else if (fs.existsSync(targetMemoryDir)) {
                try {
                    fs.rmSync(targetMemoryDir, { recursive: true, force: true });
                } catch (error) {
                    const friendly = buildMemoryReplaceError(error, targetMemoryDir);
                    if (friendly) {
                        console.warn('⚠️ [WebServer] Empty-dir cleanup blocked by lock; fallback to in-place merge mode.');
                        mergeFallbackUsed = true;
                        mergeSummary = mergeMemoryDirectoryBestEffort(sourceMemoryDir, targetMemoryDir);
                        fs.rmSync(tempTargetDir, { recursive: true, force: true });
                    } else {
                        fs.rmSync(tempTargetDir, { recursive: true, force: true });
                        throw error;
                    }
                }
            }

            if (!mergeFallbackUsed) {
                try {
                    fs.renameSync(tempTargetDir, targetMemoryDir);
                } catch (error) {
                    const friendly = buildMemoryReplaceError(error, targetMemoryDir);
                    if (friendly) {
                        console.warn('⚠️ [WebServer] Final rename blocked by lock; fallback to in-place merge mode.');
                        mergeFallbackUsed = true;
                        mergeSummary = mergeMemoryDirectoryBestEffort(sourceMemoryDir, targetMemoryDir);
                        fs.rmSync(tempTargetDir, { recursive: true, force: true });
                    } else {
                        throw error;
                    }
                }
            }
            console.log(`🧬 [WebServer] Memory reincarnated from ${sourceMemoryDir} to ${targetMemoryDir}`);

            const lockHints = detectMemoryLockHints(targetMemoryDir);
            const effectiveSummary = mergeFallbackUsed && mergeSummary
                ? {
                    mode: 'merge-fallback',
                    copiedFromTemp: summary,
                    mergedInPlace: mergeSummary,
                    skipped: [...summary.skipped, ...mergeSummary.skipped].slice(0, 50),
                }
                : {
                    mode: 'replace',
                    ...summary,
                };

            return res.json({
                success: true,
                sourcePath: sourceMemoryDir,
                targetPath: targetMemoryDir,
                backupPath,
                quiesceReport,
                summary: effectiveSummary,
                lockHints,
                warning: mergeFallbackUsed
                    ? '偵測到 Windows/瀏覽器鎖定，已改用就地合併模式完成轉生；少數被鎖檔案可能略過，可關閉瀏覽器後再重試以補齊。'
                    : summary.skipped.length > 0
                        ? '部分檔案因權限或特殊檔案類型無法複製，已跳過；可讀取的記憶已完成轉生。'
                        : '部分舊版技能、腳本或瀏覽器狀態可能無法完全相容新專案。'
            });
        } catch (e) {
            console.error('[WebServer] Failed to import reincarnated memory:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/stop', requireGolemOps, async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing Golem ID' });

            console.log(`🛑 [WebServer] Stopping Golem: ${id}`);

            if (typeof global.stopGolem === 'function') {
                await global.stopGolem(id);
                server.removeContext(id);
                return res.json({ success: true, message: `Golem ${id} stopped.` });
            }

            const instance = server.contexts.get(id);
            if (instance && instance.brain && instance.brain.browser) {
                await instance.brain.browser.close();
                instance.brain.status = 'not_started';
                return res.json({ success: true, message: `Golem ${id} browser closed (fallback).` });
            }
            return res.status(404).json({ error: 'Stop helper not found and Golem not in memory.' });
        } catch (e) {
            console.error('❌ [WebServer] Stop failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/golems/setup', requireGolemOps, async (req, res) => {
        const { golemId, aiName, userName, currentRole, tone, skills, operationId } = req.body;
        if (!golemId) return res.status(400).json({ error: 'Missing golemId' });
        const emitSetupProgress = (payload = {}) => {
            try {
                if (server && server.io && typeof server.io.emit === 'function') {
                    server.io.emit('setup:inject_progress', {
                        golemId,
                        operationId: operationId || null,
                        ts: Date.now(),
                        ...payload,
                    });
                }
            } catch (_) {}
        };

        let context = server.contexts.get(golemId);

        if (!context || !context.brain) {
            console.log(`🏗️ [WebServer] Golem context [${golemId}] not found for setup. Attempting on-demand initialization...`);
            const ConfigManager = require('../../src/config/index');
            const golemConfig = ConfigManager.GOLEMS_CONFIG.find((g) => g.id === golemId);

            if (!golemConfig) return res.status(404).json({ error: 'Golem configuration not found' });
            if (!server.golemFactory) return res.status(500).json({ error: 'golemFactory not available' });

            try {
                const newInstance = await server.golemFactory(golemConfig);
                server.contexts.set(golemId, newInstance);
                context = server.contexts.get(golemId);
                console.log(`✅ [WebServer] Full context created for [${golemId}] via factory.`);
            } catch (e) {
                console.error(`❌ [WebServer] Failed to create context for [${golemId}]:`, e);
                return res.status(500).json({ error: 'Failed to initialize golem context' });
            }
        }

        try {
            emitSetupProgress({ phase: 'setup_start', progress: 5, message: '初始化啟動流程...' });
            const personaManager = require('../../src/skills/core/persona');
            personaManager.save(context.brain.userDataDir, {
                aiName: aiName || 'Golem',
                userName: userName || 'Traveler',
                currentRole: currentRole || '一個擁有長期記憶與自主意識的 AI 助手',
                tone: tone || '預設口氣',
                skills: skills || [],
                defaultPersona: {
                    aiName: aiName || 'Golem',
                    userName: userName || 'Traveler',
                    currentRole: currentRole || '一個擁有長期記憶與自主意識的 AI 助手',
                    tone: tone || '預設口氣',
                },
                isNew: false
            });

            context.brain.status = 'running';
            server.isBooting = true;
            context.brain._startupProgressReporter = async (progressPayload = {}) => {
                emitSetupProgress({
                    phase: progressPayload.phase || 'injecting',
                    progress: Number(progressPayload.progress || 0),
                    message: progressPayload.message || '初始提示詞注入中...',
                    segmentIndex: progressPayload.segmentIndex || null,
                    segmentTotal: progressPayload.segmentTotal || null,
                });
            };

            (async () => {
                try {
                    try {
                        emitSetupProgress({ phase: 'brain_init', progress: 15, message: '啟動核心與瀏覽器...' });
                        await context.brain.init();
                        emitSetupProgress({ phase: 'brain_init_done', progress: 96, message: '核心啟動完成，收尾中...' });
                    } catch (err) {
                        console.error(`Failed to initialize Golem [${golemId}] after setup; keeping Telegram polling alive:`, err);
                        context.brain.status = 'error';
                        emitSetupProgress({ phase: 'error', progress: 100, message: `啟動失敗：${err.message || String(err)}` });
                    }
                    await startTelegramPollingIfAvailable(context, golemId, 'setup');

                    if (context.autonomy && typeof context.autonomy.start === 'function') {
                        context.autonomy.start();
                    }
                    emitSetupProgress({ phase: 'done', progress: 100, message: '初始提示詞注入完成，Golem 已可使用。' });
                } finally {
                    server.isBooting = false;
                    context.brain._startupProgressReporter = null;
                    console.log(`✅ [WebServer] Setup complete for ${golemId}. Dashboard is ready.`);
                }
            })();

            return res.json({ success: true, message: 'Golem setup initiated and starting...' });
        } catch (e) {
            console.error('Setup error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
