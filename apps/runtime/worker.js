/**
 * 🦞 Project Golem v9.1.5 (Single-Golem Edition)
 * -------------------------------------------------------------------------
 * 架構：[Universal Context] -> [Conversation Queue] -> [NeuroShunter] <==> [Web Gemini]
 */
const fs_sync = require('fs');
const path_sync = require('path');
const { randomUUID } = require('crypto');

// ── 首次啟動自動初始化 .env ────────────────────────────────────────────────
const PROJECT_ROOT = path_sync.resolve(__dirname, '../..');
const envPath = path_sync.resolve(PROJECT_ROOT, '.env');
const envExamplePath = path_sync.resolve(PROJECT_ROOT, '.env.example');
if (!fs_sync.existsSync(envPath) && fs_sync.existsSync(envExamplePath)) {
    fs_sync.copyFileSync(envExamplePath, envPath);
    console.log('📋 [Bootstrap] .env 不存在，已從 .env.example 複製初始設定檔。');
    console.log('🌐 [Bootstrap] 請前往 http://localhost:3000/dashboard 完成初始化設定。');
}

try {
    require('dotenv').config({ override: true });
} catch (e) {
    console.error('⚠️ [Bootstrap] 尚未安裝依賴套件 (dotenv)。請確保已執行 npm install。');
}

process.on('uncaughtException', (err) => {
    // ✨ [新增] 避免無限循環：如果 SystemLogger 已掛載，使用原始的 Error 輸出
    const SystemLogger = require('../../src/utils/SystemLogger');
    if (SystemLogger && SystemLogger.originalError) {
        SystemLogger.originalError('🔥 [CRITICAL] Uncaught Exception:', err);
    } else {
        console.error('🔥 [CRITICAL] Uncaught Exception:', err);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [WARNING] Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

const ConfigManager = require('../../src/config');
const SystemLogger = require('../../src/utils/SystemLogger');
const ManagedProcessRegistry = require('../../src/runtime/ManagedProcessRegistry');
const MemoryPressureGuard = require('../../src/runtime/MemoryPressureGuard');
const WorkerBridge = require('../../src/runtime/WorkerBridge');
const { setManagedProcessRegistry, setMemoryPressureGuard } = require('../../src/runtime/RuntimeState');

const WORKER_MODE = process.env.GOLEM_RUNTIME_ROLE === 'worker' || typeof process.send === 'function';
const runtimeRegistry = new ManagedProcessRegistry({ owner: 'worker' });
runtimeRegistry.protectPid(process.pid, { name: 'worker' });
setManagedProcessRegistry(runtimeRegistry);

// 🚀 初始化系統日誌持久化 (必須在 Dashboard 之前，確保攔截順序正確)
SystemLogger.init(ConfigManager.LOG_BASE_DIR);

// Dashboard 強制啟用
if (!WORKER_MODE) {
    try {
        require('../../dashboard');
        const displayPort = process.env.DASHBOARD_DEV_MODE === 'true' ? 3000 : (process.env.DASHBOARD_PORT || 3000);
        console.log('✅ Golem Web Dashboard 已啟動 → http://localhost:' + displayPort);
    } catch (e) {
        console.error('❌ 無法載入 Dashboard:', e.message);
    }
}

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
// [GrammyBridge] Factory: auto-selects grammY or legacy based on env setup
const { createTelegramBot } = require('../../src/bridges/TelegramBotFactory');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const GolemBrain = require('../../src/core/GolemBrain');
const TaskController = require('../../src/core/TaskController');
const { HarnessRecorder } = require('../../src/harness/HarnessRecorder');
const AutonomyManager = require('../../src/managers/AutonomyManager');
const ConversationManager = require('../../src/core/ConversationManager');
const { NeuroShunter } = require('../../packages/protocol');
const { SecurityManager, CommandSafeguard } = require('../../packages/security');
const NodeRouter = require('../../src/core/NodeRouter');
const UniversalContext = require('../../src/core/UniversalContext');
const { downloadFile, getLocalIp } = require('../../src/utils/HttpUtils');
const OpticNerve = require('../../src/services/OpticNerve');
const SystemUpgrader = require('../../src/utils/SystemUpdater');
const https = require('https');
const introspection = require('../../src/services/Introspection');
const ActionQueue = require('../../src/core/ActionQueue'); // ✨ [v9.1] Dual-Queue Architecture
const PromptShortcutManager = require('../../src/managers/PromptShortcutManager');
const MCPManager = require('../../src/mcp/MCPManager');
const PlanningIntentRouter = require('../../src/core/PlanningIntentRouter');
const EnvManager = require('../../src/utils/EnvManager');
const { normalizeShortcutKey } = PromptShortcutManager;


// 🎯 v9.1.5 解耦：不再於啟動時遍歷配置建立 Bot 與實體
// TelegramBot 與 Golem 實體將由 Web Dashboard 透過 golemFactory 動態建立
let activeTgBot = null;
let activeDcBot = null;
let singleGolemInstance = null;
let promptPoolWatcherTimer = null;
let lastPromptPoolMtimeMs = Number.NaN;
let lastTelegramCommandsSignature = '';
let ensureCoreServicesRef = async () => {};
let memoryPressureGuard = null;
let cleanupInFlightPromise = null;
const lifecycleRegistrations = new Map();

function getHeadToken(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return '';
    return String(text.split(/\s+/)[0] || '').trim();
}

const SYSTEM_COMMAND_KEY_SET = (() => {
    try {
        const unifiedCommands = require('../../src/config/commands.js');
        if (!Array.isArray(unifiedCommands)) return new Set();
        return new Set(
            unifiedCommands
                .map((item) => normalizeShortcutKey(item && item.command ? item.command : ''))
                .filter(Boolean)
        );
    } catch {
        return new Set();
    }
})();

const planningIntentRouter = new PlanningIntentRouter({
    threshold: Number(process.env.GOLEM_CHAT_PLANNING_THRESHOLD || 5),
});

let chatPlanningModeEnabled = String(process.env.GOLEM_CHAT_PLANNING_MODE || '').trim().toLowerCase() === 'true';
let chatPlanningModeUpdatedAt = Date.now();

function getPlanningModeState() {
    return {
        enabled: chatPlanningModeEnabled === true,
        updatedAt: chatPlanningModeUpdatedAt,
    };
}

function setPlanningModeState(enabled, options = {}) {
    const nextEnabled = enabled === true;
    chatPlanningModeEnabled = nextEnabled;
    chatPlanningModeUpdatedAt = Date.now();
    process.env.GOLEM_CHAT_PLANNING_MODE = nextEnabled ? 'true' : 'false';

    const persist = options.persist !== false;
    if (persist) {
        try {
            EnvManager.updateEnv({
                GOLEM_CHAT_PLANNING_MODE: nextEnabled ? 'true' : 'false',
            });
        } catch (error) {
            console.warn(`⚠️ [PlanningMode] persist failed: ${error.message}`);
        }
    }

    WorkerBridge.sendEvent('chat.planning.mode', {
        enabled: nextEnabled,
        updatedAt: chatPlanningModeUpdatedAt,
        source: String(options.source || 'runtime'),
        persist,
    });

    return getPlanningModeState();
}

// ✅ [Bug #6 修復] 啟動時間戳記，用於過濾重啟前的舊訊息
const BOOT_TIME = Date.now();

const dcClient = ConfigManager.CONFIG.DC_TOKEN ? new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
}) : null;

function buildTelegramCommandsMenu() {
    const unifiedCommands = require('../../src/config/commands.js');
    const systemCommands = Array.isArray(unifiedCommands)
        ? unifiedCommands
            .map((cmdObj) => ({
                command: String(cmdObj && cmdObj.command ? cmdObj.command : '').replace(/^\/+/, ''),
                description: String(cmdObj && cmdObj.description ? cmdObj.description : '').substring(0, 255),
            }))
            .filter((cmd) => /^[a-z0-9_]{1,32}$/i.test(cmd.command))
        : [];

    const promptCommands = PromptShortcutManager.getTelegramPromptCommands();

    const merged = [];
    const seen = new Set();
    for (const cmd of [...systemCommands, ...promptCommands]) {
        const key = String(cmd.command || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(cmd);
        if (merged.length >= 100) break;
    }
    return merged;
}

async function syncTelegramCommandsMenu(bot, reason = 'manual') {
    if (!bot || typeof bot.setMyCommands !== 'function') return;
    const tgCommands = buildTelegramCommandsMenu();
    const signature = JSON.stringify(tgCommands);
    if (signature === lastTelegramCommandsSignature) return;

    try {
        await bot.setMyCommands(tgCommands);
        lastTelegramCommandsSignature = signature;
        console.log(`✅ [Bot] Telegram 指令選單已同步 (${tgCommands.length} 筆, reason=${reason})`);
    } catch (error) {
        console.error(`❌ [Bot] Set TG Commands Error:`, error.message);
    }
}

function ensurePromptPoolWatcher() {
    if (promptPoolWatcherTimer) return;
    promptPoolWatcherTimer = setInterval(async () => {
        if (!activeTgBot) return;

        let nextMtime = -1;
        try {
            const stat = fs_sync.statSync(PromptShortcutManager.PROMPT_POOL_PATH);
            if (stat && stat.isFile()) nextMtime = stat.mtimeMs;
        } catch {
            nextMtime = -1;
        }

        if (nextMtime !== lastPromptPoolMtimeMs) {
            lastPromptPoolMtimeMs = nextMtime;
            await syncTelegramCommandsMenu(activeTgBot, 'prompt_pool_changed');
        }
    }, 10000);

    if (typeof promptPoolWatcherTimer.unref === 'function') {
        promptPoolWatcherTimer.unref();
    }
}

function getDashboardBackendPort() {
    const configured = Number(process.env.DASHBOARD_PORT || 3000);
    const isDev = (process.env.DASHBOARD_DEV_MODE || '').trim() === 'true';
    if (isDev && configured === 3000) return 3001;
    return configured;
}

function trackPromptShortcutUsage(shortcut, source = 'telegram') {
    const shortcutText = String(shortcut || '').trim();
    if (!shortcutText) return;

    const opToken = String(process.env.SYSTEM_OP_TOKEN || '').trim();
    const headers = { 'Content-Type': 'application/json' };
    if (opToken) headers['x-system-op-token'] = opToken;

    const port = getDashboardBackendPort();
    const url = `http://127.0.0.1:${port}/api/prompt-pool/track-use`;

    fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            shortcut: shortcutText,
            source,
            platform: 'telegram',
        }),
    }).catch((error) => {
        console.warn(`[PromptShortcut] usage track failed: ${error.message}`);
    });
}

// ==========================================
// 🧠 雙子管弦樂團 (Golem Orchestrator)
// ==========================================
function getOrCreateGolem() {
    if (singleGolemInstance) return singleGolemInstance;

    const golemId = 'golem_A';
    console.log(`\n================================`);
    console.log(`🧬 [Orchestrator] 孕育新實體: ${golemId}`);
    console.log(`================================\n`);

    const brain = new GolemBrain({
        golemId,
        userDataDir: ConfigManager.MEMORY_BASE_DIR,
        logDir: ConfigManager.LOG_BASE_DIR
    });
    const harnessRecorder = new HarnessRecorder({
        golemId,
        baseDir: path_sync.join(ConfigManager.LOG_BASE_DIR, 'harness', 'agent-traces'),
    });
    const controller = new TaskController({
        golemId,
        logDir: ConfigManager.LOG_BASE_DIR,
        harnessRecorder,
        onTaskEvent: (event) => {
            WorkerBridge.sendEvent('task.event', {
                ...(event || {}),
                golemId,
            });
        },
        onAgentEvent: (event) => {
            WorkerBridge.sendEvent('agent.event', {
                ...(event || {}),
                golemId,
            });
        },
    });
    const autonomy = new AutonomyManager(brain, controller, brain.memoryDriver, { golemId });

    const interventionLevel = ConfigManager.CONFIG.INTERVENTION_LEVEL;

    const convoManager = new ConversationManager(brain, NeuroShunter, controller, {
        golemId,
        interventionLevel
    });

    const actionQueue = new ActionQueue({ golemId });

    if (memoryPressureGuard) {
        controller.setMemoryPressureGuard(memoryPressureGuard);
        convoManager.setMemoryPressureGuard(memoryPressureGuard);
        actionQueue.setMemoryPressureGuard(memoryPressureGuard);
    }

    autonomy.setIntegrations(activeTgBot, activeDcBot || dcClient, convoManager);
    brain.tgBot = activeTgBot;
    brain.dcBot = activeDcBot || dcClient;

    singleGolemInstance = { brain, controller, autonomy, convoManager, actionQueue };
    try {
        const recovery = controller.getTaskRecoverySummary();
        const metrics = controller.taskMetrics();
        const integrity = controller.taskIntegrity({ limit: 50 });
        const seq = typeof controller.nextRecoverySequence === 'function'
            ? controller.nextRecoverySequence({ persist: true })
            : Date.now();
        WorkerBridge.sendEvent('task.recovery', {
            golemId,
            source: 'startup',
            recoveryType: 'startup',
            seq,
            recovery,
            pendingSummary: controller.getPendingContextSummary(20),
            resumeBrief: controller.taskResumeBrief({ limit: 20 }),
            metrics,
            integrity,
        });
        console.log(`📋 [TaskKernel:${golemId}] recovered pending=${recovery.pendingCount}, in_progress=${recovery.inProgressCount}, blocked=${recovery.blockedCount}, next=${recovery.nextTaskId || 'none'}`);
    } catch (error) {
        console.warn(`⚠️ [TaskKernel:${golemId}] recovery summary failed: ${error.message}`);
    }
    try {
        const recovery = controller.getAgentRecoverySummary();
        const metrics = controller.agentMetrics();
        const seq = typeof controller.nextAgentRecoverySequence === 'function'
            ? controller.nextAgentRecoverySequence({ persist: true })
            : Date.now();
        WorkerBridge.sendEvent('agent.recovery', {
            golemId,
            source: 'startup',
            recoveryType: 'startup',
            seq,
            recovery,
            pendingSummary: controller.getPendingAgentContextSummary(16),
            resumeBrief: controller.agentResumeBrief({ limit: 20 }),
            metrics,
        });
        console.log(`📋 [AgentKernel:${golemId}] recovered pending=${recovery.pendingSessions}, running=${recovery.runningSessions}, blocked=${recovery.blockedSessions}, failed=${recovery.failedSessions}, next=${recovery.nextSessionId || 'none'}`);
    } catch (error) {
        console.warn(`⚠️ [AgentKernel:${golemId}] recovery summary failed: ${error.message}`);
    }
    ensureLifecycleResources(singleGolemInstance);
    return singleGolemInstance;
}

function ensureLifecycleResources(instance = singleGolemInstance) {
    if (!instance) return;

    if (!lifecycleRegistrations.has('browser')) {
        lifecycleRegistrations.set('browser', runtimeRegistry.registerResource('browser-context', {
            protected: true,
            recyclable: true,
            stop: async () => {
                if (instance.brain && instance.brain.context) {
                    await instance.brain.context.close().catch(() => {});
                }
            },
        }));
    }

    if (activeTgBot && !lifecycleRegistrations.has('telegram')) {
        lifecycleRegistrations.set('telegram', runtimeRegistry.registerResource('telegram-bot', {
            protected: true,
            recyclable: true,
            stop: async () => {
                if (activeTgBot && typeof activeTgBot.stopPolling === 'function') {
                    await activeTgBot.stopPolling().catch(() => {});
                }
            },
        }));
    }

    if ((activeDcBot || dcClient) && !lifecycleRegistrations.has('discord')) {
        lifecycleRegistrations.set('discord', runtimeRegistry.registerResource('discord-client', {
            protected: true,
            recyclable: true,
            stop: async () => {
                const client = activeDcBot || dcClient;
                if (client && typeof client.destroy === 'function') {
                    await client.destroy();
                }
            },
        }));
    }

    if (!lifecycleRegistrations.has('mcp-manager')) {
        lifecycleRegistrations.set('mcp-manager', runtimeRegistry.registerResource('mcp-manager', {
            protected: true,
            recyclable: true,
            stop: async () => {
                await MCPManager.getInstance().stopAll().catch(() => {});
            },
        }));
    }
}

function clearLifecycleResources() {
    for (const registration of lifecycleRegistrations.values()) {
        registration.unregister();
    }
    lifecycleRegistrations.clear();
}

function buildContextSnapshots() {
    if (!singleGolemInstance) return [];

    const { brain } = singleGolemInstance;
    return [{
        id: brain.golemId || 'golem_A',
        status: brain.status || 'not_started',
        userDataDir: brain.userDataDir || ConfigManager.MEMORY_BASE_DIR,
        chatLogFile: '',
        hasPage: !!brain.page,
        chatId: (activeTgBot && activeTgBot.golemConfig && activeTgBot.golemConfig.chatId) || ConfigManager.CONFIG.TG_CHAT_ID || '',
    }];
}

function buildRuntimeSnapshot() {
    const memorySnapshot = memoryPressureGuard ? memoryPressureGuard.getSnapshot() : {
        pressure: 'normal',
        rssMb: 0,
        heapUsedMb: 0,
        heapTotalMb: 0,
        lastMitigation: '',
    };
    const workerStatus = singleGolemInstance && singleGolemInstance.brain
        ? (memorySnapshot.pressure === 'normal'
            ? (singleGolemInstance.brain.status || 'running')
            : 'degraded')
        : 'stopped';

    return {
        runtime: {
            mode: 'supervisor-worker',
            worker: {
                pid: process.pid,
                status: workerStatus,
                uptimeSec: Math.max(0, Math.floor((Date.now() - BOOT_TIME) / 1000)),
                lastExitReason: '',
            },
            memory: memorySnapshot,
            chat: {
                planningMode: getPlanningModeState(),
            },
            managedChildren: runtimeRegistry.getStats(),
        },
        contexts: buildContextSnapshots(),
    };
}

function reportRuntimeState() {
    if (!WORKER_MODE) return;
    WorkerBridge.sendSnapshot(buildRuntimeSnapshot());
}

async function recycleTransientResources(level, snapshot) {
    const recycled = [];
    const instance = singleGolemInstance;

    if (instance && instance.controller && typeof instance.controller.trimPendingTasks === 'function') {
        const removed = instance.controller.trimPendingTasks(level === 'critical' ? 2 * 60 * 1000 : 60 * 1000);
        if (removed > 0) recycled.push(`pendingTasks:${removed}`);
    }

    if (level === 'critical' && instance && instance.brain && instance.brain.page) {
        try {
            const PageInteractor = require('../../src/core/PageInteractor');
            const interactor = new PageInteractor(instance.brain.page, instance.brain.doctor);
            await interactor._pruneDOM();
            recycled.push('browser:dom-prune');
        } catch (error) {
            recycled.push(`browser:dom-prune-failed:${error.message}`);
        }
    }

    try {
        await MCPManager.getInstance().stopAll();
        recycled.push('mcp:stopAll');
    } catch (error) {
        recycled.push(`mcp:stopAll-failed:${error.message}`);
    }

    if (level === 'critical' && instance && instance.brain && typeof instance.brain._ensureBrowserHealth === 'function') {
        const forceBrowserHealOnCritical = String(process.env.GOLEM_FORCE_BROWSER_HEAL_ON_CRITICAL || '').trim() === 'true';
        try {
            await instance.brain._ensureBrowserHealth(forceBrowserHealOnCritical);
            recycled.push(forceBrowserHealOnCritical ? 'browser:self-heal-force' : 'browser:health-check');
        } catch (error) {
            recycled.push(`browser:self-heal-failed:${error.message}`);
        }
    }

    if (memoryPressureGuard) {
        memoryPressureGuard.reportMitigation(level, recycled.join(',') || 'noop');
    }

    reportRuntimeState();
    return { recycled, snapshot };
}

function createWebContext(golemId, payload = {}) {
    const messageTime = Date.now();
    const meta = payload.meta || {};
    const instanceLabel = golemId || 'golem_A';

    return {
        platform: meta.platform || 'web',
        isAdmin: true,
        text: payload.message || '',
        messageTime,
        senderName: meta.senderName || 'User',
        replyToName: '',
        chatId: meta.chatId || 'web-dashboard',
        reply: async (text, options) => {
            let payloadType = 'agent';
            let actionData = null;

            if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
                payloadType = 'approval';
                actionData = options.reply_markup.inline_keyboard[0];
            }

            WorkerBridge.sendEvent('dashboard.reply', {
                time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                msg: `[${instanceLabel}] ${text}`,
                type: payloadType,
                raw: text,
                actionData,
                golemId: instanceLabel,
            });
        },
        answerCallbackQuery: async () => {},
        sendTyping: async () => {},
        getAttachment: async () => payload.attachment || null,
        instance: { username: instanceLabel },
    };
}

async function callContextMethod(target, method, args = []) {
    const instance = getOrCreateGolem();
    const allowedMethods = {
        brain: ['init', 'reloadSkills', 'sendMessage'],
        'brain.tgBot': ['startPolling', 'sendMessage'],
        memory: ['recall', 'clearMemory', 'exportMemory', 'importMemory', 'memorize'],
        autonomy: ['start', 'scheduleNextArchive'],
    };

    if (!allowedMethods[target] || !allowedMethods[target].includes(method)) {
        throw new Error(`Unsupported context method: ${target}.${method}`);
    }

    let subject = null;
    if (target === 'brain') subject = instance.brain;
    else if (target === 'brain.tgBot') subject = instance.brain.tgBot;
    else if (target === 'memory') subject = instance.brain.memoryDriver;
    else if (target === 'autonomy') subject = instance.autonomy;

    if (!subject || typeof subject[method] !== 'function') {
        throw new Error(`Target method not available: ${target}.${method}`);
    }

    return subject[method](...(Array.isArray(args) ? args : []));
}

async function getPendingTaskSummary(taskId, golemId = 'golem_A') {
    const instance = getOrCreateGolem(golemId);
    const controller = instance && instance.controller;
    if (!controller || typeof controller.getPendingTaskSummary !== 'function') return null;
    return controller.getPendingTaskSummary(taskId);
}

function getTaskController(golemId = 'golem_A') {
    const instance = getOrCreateGolem(golemId);
    const controller = instance && instance.controller;
    if (!controller) {
        throw new Error(`Task controller unavailable for ${golemId}`);
    }
    return controller;
}

function getAgentController(golemId = 'golem_A') {
    const controller = getTaskController(golemId);
    if (!controller || typeof controller.agentSessionCreate !== 'function') {
        throw new Error(`Agent controller unavailable for ${golemId}`);
    }
    return controller;
}

async function ensureGolemForConfig(golemConfig, options = {}) {
    if (singleGolemInstance) {
        console.log(`⚠️ [Factory] Golem already exists, skipping.`);
        return singleGolemInstance;
    }

    if (golemConfig && golemConfig.tgToken && !activeTgBot) {
        try {
            const bot = createTelegramBot(golemConfig.tgToken, { polling: false });
            bot.golemConfig = golemConfig;
            bot.getMe().then(me => {
                bot.username = me.username;
                console.log(`🤖 [Bot] ${golemConfig.id} 已掛載 (@${me.username})`);
                syncTelegramCommandsMenu(bot, 'bot_ready');
            }).catch(e => {
                if (!e.message.includes('401')) {
                    console.warn(`⚠️ [Bot] ${golemConfig.id}:`, e.message);
                }
            });
            lastTelegramCommandsSignature = '';
            activeTgBot = bot;
            ensurePromptPoolWatcher();

            const boundGolemId = golemConfig.id;
            bot.on('message', async (msg) => {
                try {
                    await handleUnifiedMessage(new UniversalContext('telegram', msg, bot), boundGolemId);
                } catch (e) {
                    console.error(`❌ [TG ${boundGolemId}] Message Handler Error:`, e);
                }
            });
            bot.on('callback_query', async (query) => {
                try {
                    await bot.answerCallbackQuery(query.id);
                } catch (e) {
                    console.warn(`⚠️ [TG ${boundGolemId}] Callback Answer Warning: ${e.message}`);
                }
                try {
                    await handleUnifiedCallback(
                        new UniversalContext('telegram', query, bot),
                        query.data,
                        boundGolemId
                    );
                } catch (e) {
                    console.error(`❌ [TG ${boundGolemId}] Callback Handler Error:`, e);
                }
            });
            console.log(`🔗 [Factory] TG events bound for Golem [${boundGolemId}]`);

            let pollingRestartTimer = null;
            bot.on('polling_error', (err) => {
                if (err.code === 'ETELEGRAM' && err.message.includes('409')) {
                    if (pollingRestartTimer) return;
                    console.warn(`⚠️ [Bot] ${boundGolemId} 偵測到 409 Conflict，5 秒後自動重連...`);
                    pollingRestartTimer = setTimeout(async () => {
                        pollingRestartTimer = null;
                        try { await bot.stopPolling(); } catch (e) {}
                        await new Promise(r => setTimeout(r, 1000));
                        try {
                            bot.startPolling({ restart: true });
                            console.log(`✅ [Bot] ${boundGolemId} Polling 已自動恢復。`);
                        } catch (e) {
                            console.error(`❌ [Bot] ${boundGolemId} 自動重啟 Polling 失敗:`, e.message);
                        }
                    }, 5000);
                }
            });
        } catch (e) {
            console.error(`❌ [Bot] 初始化 ${golemConfig.id} Telegram 失敗:`, e.message);
        }
    }

    if (golemConfig && golemConfig.dcToken && !activeDcBot) {
        try {
            const client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.DirectMessages
                ],
                partials: [Partials.Channel]
            });
            client.golemConfig = golemConfig;
            client.once('ready', () => {
                console.log(`🤖 [Bot] ${golemConfig.id} Discord 已掛載 (${client.user ? client.user.tag : 'Unknown'})`);
            });
            client.on('messageCreate', (msg) => {
                if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, client), golemConfig.id);
            });
            client.on('interactionCreate', (interaction) => {
                if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, client), interaction.customId, golemConfig.id);
            });
            client.login(golemConfig.dcToken).catch(e => {
                console.warn(`⚠️ [Bot] ${golemConfig.id} Discord Login Failed:`, e.message);
            });
            activeDcBot = client;
        } catch (e) {
            console.error(`❌ [Bot] 初始化 ${golemConfig.id} Discord 失敗:`, e.message);
        }
    }

    const instance = getOrCreateGolem();
    await ensureCoreServicesRef();
    ensureLifecycleResources(instance);

    const personaPath = path_sync.resolve(ConfigManager.MEMORY_BASE_DIR, 'persona.json');
    if (fs_sync.existsSync(personaPath) && options.autoStart !== false) {
        instance.brain.status = 'running';
        await instance.brain.init();
        ensureLifecycleResources(instance);
        if (activeTgBot && activeTgBot.isPolling && !activeTgBot.isPolling()) {
            activeTgBot.startPolling({ restart: true });
            console.log(`✅ [Bot] ${golemConfig.id} Telegram Polling 已啟動。`);
        }
    } else if (!fs_sync.existsSync(personaPath)) {
        instance.brain.status = 'pending_setup';
    }

    instance.autonomy.start();
    reportRuntimeState();
    console.log(`✅ [Factory] Golem started in worker runtime.`);
    return instance;
}

memoryPressureGuard = new MemoryPressureGuard({
    onWarning: async (snapshot) => {
        if (global.gc) global.gc();
        memoryPressureGuard.reportMitigation('warning', 'gc');
        reportRuntimeState();
        return snapshot;
    },
    onCritical: async (snapshot) => {
        return recycleTransientResources('critical', snapshot);
    },
    onFatal: async (snapshot) => {
        if (!snapshot || snapshot.fatalEligible !== true) {
            const reason = (snapshot && snapshot.fatalSuppressedReason) || 'not-eligible';
            memoryPressureGuard.reportMitigation('fatal-suppressed', reason);
            reportRuntimeState();
            return snapshot;
        }

        await recycleTransientResources('fatal', snapshot);
        WorkerBridge.sendEvent('memory.fatal', {
            ...snapshot,
            eligible: true,
            restartReason: `memory-fatal:${snapshot.fatalReason || 'rss-limit'}`,
        });
        return snapshot;
    },
    onSnapshot: () => {
        reportRuntimeState();
    },
});
setMemoryPressureGuard(memoryPressureGuard);
memoryPressureGuard.start();

if (WORKER_MODE) {
    WorkerBridge.install({
        onControl: async (action, payload = {}) => {
            if (action === 'shutdown') {
                const reason = payload && payload.reason ? String(payload.reason) : 'supervisor-control-shutdown';
                await performCleanup(reason);
                process.exit(0);
            }
        },
        rpcHandlers: {
            'golem.ensure': async ({ golemConfig, autoStart = true }) => {
                await ensureGolemForConfig(golemConfig || { id: 'golem_A' }, { autoStart });
                reportRuntimeState();
                return { success: true };
            },
            'golem.stop': async ({ golemId = 'golem_A', reason = 'rpc:golem.stop' }) => {
                await global.stopGolem(golemId, reason);
                reportRuntimeState();
                return { success: true };
            },
            'context.call': async ({ target, method, args = [] }) => {
                const result = await callContextMethod(target, method, args);
                reportRuntimeState();
                return result;
            },
            'dashboard.chat.send': async ({ golemId = 'golem_A', message = '', attachment = null, meta = {} }) => {
                const ctx = createWebContext(golemId, { message, attachment, meta });
                await handleUnifiedMessage(ctx, golemId);
                return { success: true };
            },
            'dashboard.chat.callback': async ({ golemId = 'golem_A', callbackData = '', meta = {} }) => {
                const ctx = createWebContext(golemId, { meta });
                await handleUnifiedCallback(ctx, callbackData, golemId);
                return { success: true };
            },
            'dashboard.chat.metacognition': async ({ golemId = 'golem_A' }) => {
                const instance = getOrCreateGolem(golemId);
                const tracker = instance && instance.convoManager && instance.convoManager.confidenceTracker;
                if (!tracker) {
                    throw new Error('ConfidenceTracker not found for this golem instance');
                }
                return tracker.getStats();
            },
            'dashboard.chat.metacognitionHistory': async ({ golemId = 'golem_A', limit = 20 }) => {
                const instance = getOrCreateGolem(golemId);
                const tracker = instance && instance.convoManager && instance.convoManager.confidenceTracker;
                if (!tracker) {
                    throw new Error('ConfidenceTracker not found for this golem instance');
                }
                return tracker.getHistory(limit);
            },
            'chat.planning.get': async ({ golemId = 'golem_A' }) => {
                return {
                    golemId,
                    planningMode: getPlanningModeState(),
                };
            },
            'chat.planning.set': async ({ golemId = 'golem_A', enabled = false, persist = true, source = 'rpc' }) => {
                const state = setPlanningModeState(enabled === true, {
                    persist: persist !== false,
                    source: String(source || 'rpc'),
                });
                reportRuntimeState();
                return {
                    golemId,
                    planningMode: state,
                };
            },
            'tasks.list': async ({ golemId = 'golem_A', filters = {} }) => {
                const controller = getTaskController(golemId);
                return {
                    tasks: controller.taskList(filters),
                };
            },
            'tasks.get': async ({ golemId = 'golem_A', taskId }) => {
                const controller = getTaskController(golemId);
                return {
                    task: controller.taskGet(taskId),
                };
            },
            'tasks.create': async ({ golemId = 'golem_A', input = {}, options = {} }) => {
                const controller = getTaskController(golemId);
                return controller.taskCreate(input, options);
            },
            'tasks.update': async ({ golemId = 'golem_A', taskId, patch = {}, options = {} }) => {
                const controller = getTaskController(golemId);
                return controller.taskUpdate(taskId, patch, options);
            },
            'tasks.stop': async ({ golemId = 'golem_A', taskId, options = {} }) => {
                const controller = getTaskController(golemId);
                return controller.taskStop(taskId, options);
            },
            'tasks.todoWrite': async ({ golemId = 'golem_A', items = [], options = {} }) => {
                const controller = getTaskController(golemId);
                return controller.todoWrite(items, options);
            },
            'tasks.resume': async ({ golemId = 'golem_A', options = {} }) => {
                const controller = getTaskController(golemId);
                return controller.taskResume(options || {});
            },
            'tasks.resumeBrief': async ({ golemId = 'golem_A', options = {} }) => {
                const controller = getTaskController(golemId);
                return {
                    brief: controller.taskResumeBrief(options || {}),
                };
            },
            'tasks.recovery': async ({ golemId = 'golem_A' }) => {
                const controller = getTaskController(golemId);
                return {
                    recovery: controller.getTaskRecoverySummary(),
                    pendingSummary: controller.getPendingContextSummary(20),
                    resumeBrief: controller.taskResumeBrief({ limit: 20 }),
                    metrics: controller.taskMetrics(),
                    integrity: controller.taskIntegrity({ limit: 50 }),
                };
            },
            'tasks.audit': async ({ golemId = 'golem_A', filters = {} }) => {
                const controller = getTaskController(golemId);
                return {
                    events: controller.taskAudit(filters),
                };
            },
            'tasks.metrics': async ({ golemId = 'golem_A' }) => {
                const controller = getTaskController(golemId);
                return {
                    metrics: controller.taskMetrics(),
                };
            },
            'tasks.integrity': async ({ golemId = 'golem_A', options = {} }) => {
                const controller = getTaskController(golemId);
                return {
                    integrity: controller.taskIntegrity(options),
                };
            },
            'tasks.budgets.get': async ({ golemId = 'golem_A' }) => {
                const controller = getTaskController(golemId);
                return {
                    budgets: controller.taskBudgetGet(),
                };
            },
            'tasks.budgets.set': async ({ golemId = 'golem_A', policy = {}, options = {} }) => {
                const controller = getTaskController(golemId);
                return controller.taskBudgetSet(policy || {}, options || {});
            },
            'agents.sessions.list': async ({ golemId = 'golem_A', filters = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentList(filters || {});
            },
            'agents.sessions.get': async ({ golemId = 'golem_A', sessionId }) => {
                const controller = getAgentController(golemId);
                return controller.agentGetSession(sessionId);
            },
            'agents.sessions.orchestration': async ({ golemId = 'golem_A', sessionId }) => {
                const controller = getAgentController(golemId);
                return controller.agentGetOrchestration(sessionId);
            },
            'agents.sessions.create': async ({ golemId = 'golem_A', input = {}, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentSessionCreate(input || {}, options || {});
            },
            'agents.sessions.update': async ({ golemId = 'golem_A', sessionId, patch = {}, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentSessionUpdate(sessionId, patch || {}, options || {});
            },
            'agents.sessions.resume': async ({ golemId = 'golem_A', options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentResume(options || {});
            },
            'agents.sessions.wait': async ({ golemId = 'golem_A', sessionId, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentWait(sessionId, options || {});
            },
            'agents.sessions.stop': async ({ golemId = 'golem_A', sessionId, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentStop({ sessionId, reason: options.reason }, options || {});
            },
            'agents.workers.list': async ({ golemId = 'golem_A', filters = {} }) => {
                const controller = getAgentController(golemId);
                const result = controller.agentList(filters || {});
                return {
                    workers: Array.isArray(result.workers) ? result.workers : [],
                    sessions: Array.isArray(result.sessions) ? result.sessions : [],
                };
            },
            'agents.workers.get': async ({ golemId = 'golem_A', workerId }) => {
                const controller = getAgentController(golemId);
                return controller.agentGetWorker(workerId);
            },
            'agents.workers.create': async ({ golemId = 'golem_A', input = {}, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentWorkerSpawn(input || {}, options || {});
            },
            'agents.workers.update': async ({ golemId = 'golem_A', workerId, patch = {}, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentWorkerUpdate(workerId, patch || {}, options || {});
            },
            'agents.message': async ({ golemId = 'golem_A', input = {}, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentMessage(input || {}, options || {});
            },
            'agents.recovery': async ({ golemId = 'golem_A' }) => {
                const controller = getAgentController(golemId);
                return {
                    recovery: controller.getAgentRecoverySummary(),
                    pendingSummary: controller.getPendingAgentContextSummary(16),
                    resumeBrief: controller.agentResumeBrief({ limit: 20 }),
                    metrics: controller.agentMetrics(),
                };
            },
            'agents.resumeBrief': async ({ golemId = 'golem_A', options = {} }) => {
                const controller = getAgentController(golemId);
                return {
                    brief: controller.agentResumeBrief(options || {}),
                };
            },
            'agents.audit': async ({ golemId = 'golem_A', filters = {} }) => {
                const controller = getAgentController(golemId);
                return {
                    events: controller.agentAudit(filters || {}),
                };
            },
            'agents.metrics': async ({ golemId = 'golem_A' }) => {
                const controller = getAgentController(golemId);
                return {
                    metrics: controller.agentMetrics(),
                };
            },
            'agents.budgets.get': async ({ golemId = 'golem_A' }) => {
                const controller = getAgentController(golemId);
                return {
                    budgets: controller.agentBudgetGet(),
                };
            },
            'agents.budgets.set': async ({ golemId = 'golem_A', policy = {}, options = {} }) => {
                const controller = getAgentController(golemId);
                return controller.agentBudgetSet(policy || {}, options || {});
            },
            'controller.pendingTaskSummary': async ({ taskId, golemId = 'golem_A' }) => {
                return getPendingTaskSummary(taskId, golemId);
            },
        },
    });

    const snapshotTimer = setInterval(() => reportRuntimeState(), 2000);
    if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
    setTimeout(() => reportRuntimeState(), 50);
}

(async () => {
    if (process.env.GOLEM_TEST_MODE === 'true') { console.log('🚧 GOLEM_TEST_MODE active.'); return; }

    // 🎯 v9.1.5 解耦：啟動時不再遍歷建立 initialGolems
    // 也延後架構掃描與巡檢，直到第一個實體啟動
    let _isCoreInitialized = false;
    ensureCoreServicesRef = async function ensureCoreServices() {
        if (_isCoreInitialized) return;

        // 🚀 初始化系統日誌持久化 (確保服務啟動時日誌功能就緒)
        SystemLogger.init(ConfigManager.LOG_BASE_DIR);
        console.log('📡 [Config] 運行模式: 單機 (Single-Golem Architecture)');

        console.log('🧠 [Introspection] Scanning project structure...');
        await introspection.getStructure().catch(e => console.warn('⚠️ Introspection failed:', e.message));

        // 啟動排程器
        setInterval(runTieredCompression, 6 * 60 * 60 * 1000);
        runTieredCompression();

        if (dcClient) dcClient.login(ConfigManager.CONFIG.DC_TOKEN);

        _isCoreInitialized = true;
    };
    // [H-6, S-5] Clean up redundant requires, handle watch race condition gracefully
    fs_sync.watch(process.cwd(), async (eventType, filename) => {
        if (filename === '.reincarnate_signal.json') {
            try {
                let signalRaw;
                try {
                    signalRaw = fs_sync.readFileSync('.reincarnate_signal.json', 'utf-8');
                    fs_sync.unlinkSync('.reincarnate_signal.json');
                } catch (e) {
                    if (e.code === 'ENOENT') return; // 已被其他觸發處理
                    throw e;
                }
                const { summary } = JSON.parse(signalRaw);
                console.log("🔄 [系統] 啟動記憶轉生程序！正在開啟新對話...");

                const instance = getOrCreateGolem();
                if (instance.brain.page) {
                    console.log(`🚀 [System] Browser Session Started`);
                }
                const wakeUpPrompt = `【系統重啟初始化：記憶轉生】\n請遵守你的核心設定(Project Golem)。\n你剛進行了會話重置以釋放記憶體。\n以下是你上一輪對話留下的【記憶摘要】：\n${summary}\n\n請根據上述摘要，向使用者打招呼，並嚴格包含以下這段話（或類似語氣）：\n「🔄 對話視窗已成功重啟，並載入了剛剛的重點記憶！不過老實說，重啟過程可能會讓我忘記一些瑣碎的小細節，如果接下來我有漏掉什麼，請隨時提醒我喔！」`;
                if (instance.brain.sendMessage) {
                    await instance.brain.sendMessage(wakeUpPrompt);
                }
            } catch (error) {
                console.error("❌ 轉生過程發生錯誤:", error);
            }
        }
    });

    if (!WORKER_MODE) {
        const dashboard = require('../../dashboard');
        if (dashboard && dashboard.webServer && typeof dashboard.webServer.setGolemFactory === 'function') {
        // [GrammyBridge] Use factory instead of direct TelegramBot constructor
            dashboard.webServer.setGolemFactory(async (golemConfig) => {
                return ensureGolemForConfig(golemConfig, { autoStart: true });
            });
        console.log('🔗 [System] golemFactory injected into WebServer.');
        }
    }

    async function runTieredCompression() {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const year = now.getFullYear();
        console.log(`🕒 [Scheduler] 啟動多層記憶壓縮巡檢...`);

        const instance = singleGolemInstance;
        if (instance) {
            const mgr = instance.brain.chatLogManager;
            if (mgr) {
                if (!mgr._isInitialized) {
                    console.log(`ℹ️ [Scheduler] ChatLogManager 尚未初始化，略過本次排程`);
                    return;
                }
                console.log(`📦 [LogManager] 檢查日誌狀態...`);
                if (month === 1 && day === 1 && year % 10 === 0) {
                    const lastDecade = mgr._getLastDecadeString();
                    mgr.compressEra(lastDecade, instance.brain).catch(err => {
                        console.error(`❌ [Scheduler] Era 壓縮失敗: ${err.message}`);
                    });
                }
                if (month === 1 && day === 1) {
                    const lastYear = mgr._getLastYearString();
                    mgr.compressYearly(lastYear, instance.brain).catch(e => console.error(e));
                }
                if (day === 1) {
                    const lastMonth = mgr._getLastMonthString();
                    mgr.compressMonthly(lastMonth, instance.brain).catch(e => console.error(e));
                }
                
                // 每天執行昨日的摘要壓縮
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = mgr._formatDate(yesterday);
                mgr.compressLogsForDate(yesterdayStr, instance.brain).catch(e => console.error(e));
            }
        }
    }

    console.log(`✅ Project Golem Management Dashboard is Online. (Ready to start instances)`);
})();

async function handleUnifiedMessage(ctx, forceTargetId = null) {
    const msgTime = ctx.messageTime;
    console.log(`[DEBUG] msgTime: ${msgTime}, BOOT_TIME: ${BOOT_TIME}, diff: ${msgTime - BOOT_TIME}`);
    // 允許 60 秒的時鐘誤差，防止伺服器時間稍快於通訊軟體伺服器時間導致新訊息被判定為舊訊息
    if (msgTime && msgTime < (BOOT_TIME - 60000)) {
        console.log(`[MessageManager] 忽略重啟前的舊訊息 (Golem: ${forceTargetId || 'golem_A'}, Diff: ${msgTime - BOOT_TIME}ms)`);
        return;
    }

    // [Single-Golem 版]
    // 一律使用單一實體
    const instance = getOrCreateGolem();
    const { brain, controller, autonomy, convoManager } = instance;
    let matchedPromptShortcut = null;

    // ✨ Telegram 快捷指令：送出後自動展開為完整 Prompt 內容
    if (ctx.platform === 'telegram' && ctx.text) {
        const rawTelegramText = String(ctx.text || '').trim();
        const expanded = PromptShortcutManager.expandPromptShortcutInput(rawTelegramText);
        if (expanded.changed && expanded.text) {
            if (typeof ctx.setTextOverride === 'function') {
                ctx.setTextOverride(expanded.text);
            }
            matchedPromptShortcut = expanded.matched || null;
            console.log(`✨ [PromptShortcut] 已展開 Telegram 快捷指令 ${expanded.matched.shortcut}`);
            trackPromptShortcutUsage(expanded.matched.shortcut, 'telegram');
        } else {
            const headToken = getHeadToken(rawTelegramText);
            const headKey = normalizeShortcutKey(headToken);
            const isSingleToken = Boolean(rawTelegramText) && rawTelegramText.split(/\s+/).length === 1;

            if (headToken.startsWith('/') && isSingleToken && headKey && !SYSTEM_COMMAND_KEY_SET.has(headKey)) {
                const suggestions = PromptShortcutManager.suggestPromptShortcuts(headToken, 5);
                if (suggestions.length > 0) {
                    const suggestionLines = suggestions.map((item) => `• ${item.shortcut}`).join('\n');
                    await ctx.reply(`找不到這個快捷指令，你是不是想輸入：\n${suggestionLines}\n\n你也可以到 Dashboard 的「Prompt 指令池」新增或調整。`);
                    return;
                }
            }
        }
    }

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/sos') {
        try {
            const targetFiles = [
                path.join(os.homedir(), 'project-golem', 'golem_selectors.json'),
                path.join(process.cwd(), 'golem_selectors.json'),
                path.join(process.cwd(), 'selectors.json'),
                path.join(process.cwd(), 'src', 'core', 'selectors.json')
            ];

            let isDeleted = false;
            for (const file of targetFiles) {
                if (fs_sync.existsSync(file)) {
                    fs_sync.unlinkSync(file);
                    console.log(`🗑️ [SOS] 已刪除污染檔案: ${file}`);
                    isDeleted = true;
                }
            }

            if (isDeleted) {
                await ctx.reply("✅ 毒蘋果 (選擇器快取) 已成功刪除！\n不用重啟，請直接跟我說話，我會觸發 DOM Doctor 自動重抓乾淨的選擇器。");
            } else {
                await ctx.reply("⚠️ 找不到污染的快取檔案，它可能已經是乾淨狀態了。");
            }
        } catch (e) {
            await ctx.reply(`❌ 緊急刪除失敗: ${e.message}`);
        }
        return;
    }

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/new') {
        await ctx.reply("🔄 收到 /new 指令！正在為您開啟全新的大腦對話神經元...");
        try {
            const isOllamaBackend = brain.backend === 'ollama';
            if (brain.page || isOllamaBackend) {
                await brain.init(true);
                const recovery = controller && typeof controller.getTaskRecoverySummary === 'function'
                    ? controller.getTaskRecoverySummary()
                    : null;
                const agentRecovery = controller && typeof controller.getAgentRecoverySummary === 'function'
                    ? controller.getAgentRecoverySummary()
                    : null;
                if (controller && recovery) {
                    const seq = typeof controller.nextRecoverySequence === 'function'
                        ? controller.nextRecoverySequence({ persist: true })
                        : Date.now();
                    WorkerBridge.sendEvent('task.recovery', {
                        golemId: forceTargetId || 'golem_A',
                        source: '/new',
                        recoveryType: 'chat_reset',
                        seq,
                        recovery,
                        pendingSummary: controller.getPendingContextSummary(20),
                        resumeBrief: controller.taskResumeBrief({ limit: 20 }),
                        metrics: controller.taskMetrics(),
                        integrity: controller.taskIntegrity({ limit: 50 }),
                    });
                }
                if (controller && agentRecovery) {
                    const seq = typeof controller.nextAgentRecoverySequence === 'function'
                        ? controller.nextAgentRecoverySequence({ persist: true })
                        : Date.now();
                    WorkerBridge.sendEvent('agent.recovery', {
                        golemId: forceTargetId || 'golem_A',
                        source: '/new',
                        recoveryType: 'chat_reset',
                        seq,
                        recovery: agentRecovery,
                        pendingSummary: controller.getPendingAgentContextSummary(16),
                        resumeBrief: controller.agentResumeBrief({ limit: 20 }),
                        metrics: controller.agentMetrics(),
                    });
                }
                const recoveryHint = recovery
                    ? `\n\n📋 任務恢復摘要：pending=${recovery.pendingCount}、in_progress=${recovery.inProgressCount}、blocked=${recovery.blockedCount}、next=${recovery.nextTaskId || 'none'}`
                    : '';
                const agentRecoveryHint = agentRecovery
                    ? `\n🤖 Agent 恢復摘要：pending=${agentRecovery.pendingSessions}、running=${agentRecovery.runningSessions}、blocked=${agentRecovery.blockedSessions}、failed=${agentRecovery.failedSessions}、next=${agentRecovery.nextSessionId || 'none'}`
                    : '';
                await ctx.reply(isOllamaBackend
                    ? `✅ Ollama 對話狀態已重置完成！目前大腦記憶脈絡已重新注入。${recoveryHint}${agentRecoveryHint}`
                    : `✅ 物理重置完成！已經為您切斷舊有記憶，現在這是一個全新且乾淨的 Golem 實體。${recoveryHint}${agentRecoveryHint}`);
            } else {
                await ctx.reply("⚠️ 找不到活躍的網頁視窗，無法執行物理重置。");
            }
        } catch (e) {
            await ctx.reply(`❌ 物理重置失敗: ${e.message}`);
        }
        return;
    }

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/new_memory') {
        await ctx.reply("💥 收到 /new_memory 指令！正在為您物理清空底層 DB 並執行深度轉生...");
        try {
            if (brain.memoryDriver && typeof brain.memoryDriver.clearMemory === 'function') {
                await brain.memoryDriver.clearMemory();
            }
            const isOllamaBackend = brain.backend === 'ollama';
            if (brain.page || isOllamaBackend) {
                await brain.init(true);
                await ctx.reply(isOllamaBackend
                    ? "✅ 記憶庫 DB 已清空，且 Ollama 大腦脈絡已重新初始化完成。"
                    : "✅ 記憶庫 DB 已徹底清空格式化！網頁也已重置，這是一個 100% 空白、無任何歷史包袱的 Golem 實體。");
            } else {
                await ctx.reply("⚠️ 找不到活躍的網頁視窗。");
            }
        } catch (e) {
            await ctx.reply(`❌ 深度轉生失敗: ${e.message}`);
        }
        return;
    }

    // ✨ [新增] /model 指令實作
    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase().startsWith('/model')) {
        const args = ctx.text.trim().split(/\s+/);
        const targetModel = args[1] ? args[1].toLowerCase() : '';

        // 根據截圖防呆，只允許 fast, thinking, pro
        if (!['fast', 'thinking', 'pro'].includes(targetModel)) {
            await ctx.reply("ℹ️ 請輸入正確的模組關鍵字，例如：\n`/model fast` (回答速度快)\n`/model thinking` (具備深度思考)\n`/model pro` (進階程式碼與數學能力)");
            return;
        }

        await ctx.reply(`🔄 啟動視覺神經，嘗試為您操作網頁切換至 [${targetModel}] 模式...`);
        try {
            if (typeof brain.switchModel === 'function') {
                const result = await brain.switchModel(targetModel);
                await ctx.reply(result);
            } else {
                await ctx.reply("⚠️ 您的 GolemBrain 尚未掛載 switchModel 功能，請確認檔案是否已更新。");
            }
        } catch (e) {
            await ctx.reply(`❌ 切換模組失敗: ${e.message}`);
        }
        return;
    }

    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase().startsWith('/planning')) {
        const args = ctx.text.trim().split(/\s+/);
        const command = String(args[1] || 'status').trim().toLowerCase();

        if (!['on', 'off', 'status'].includes(command)) {
            const state = getPlanningModeState();
            await ctx.reply([
                'ℹ️ 用法：`/planning on`、`/planning off`、`/planning status`',
                `目前狀態：${state.enabled ? 'ON' : 'OFF'}`,
            ].join('\n'), { parse_mode: 'Markdown' });
            return;
        }

        if (command === 'status') {
            const state = getPlanningModeState();
            await ctx.reply([
                `🧭 Planning Mode：${state.enabled ? 'ON' : 'OFF'}`,
                '啟用時會在複雜任務自動啟動多代理流程；一般問題仍走單代理。',
            ].join('\n'));
            return;
        }

        const enabled = command === 'on';
        const state = setPlanningModeState(enabled, {
            persist: true,
            source: `${ctx.platform || 'unknown'}:/planning`,
        });
        reportRuntimeState();
        await ctx.reply([
            `🧭 Planning Mode 已${state.enabled ? '開啟' : '關閉'}。`,
            state.enabled
                ? '之後遇到複雜任務會自動走 Coordinator-Worker，多代理中間過程不會在聊天窗展開。'
                : '之後所有訊息都回到一般單代理流程。',
        ].join('\n'));
        return;
    }

    // ✨ [新增] /dashboard 指令實作
    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase() === '/dashboard') {
        const port = process.env.DASHBOARD_PORT || 3000;
        const allowRemote = process.env.ALLOW_REMOTE_ACCESS === 'true';
        const localUrl = `http://localhost:${port}/dashboard`;
        
        let message = `🌐 **Golem 控制台網址**\n\n🏠 **本地存取 (Local):**\n${localUrl}`;
        
        if (allowRemote) {
            const localIp = getLocalIp();
            const remoteUrl = `http://${localIp}:${port}/dashboard`;
            message += `\n\n🌍 **區域網路存取 (Remote):**\n${remoteUrl}`;
        } else {
            message += `\n\n> 💡 目前未開啟遠端存取。若需從區域網路連線，請至「系統總表」開啟「允許遠端存取」。`;
        }
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
        return;
    }

    // ✨ [新增] /level 指令實作 (熱切換自主安全等級)
    if (ctx.isAdmin && ctx.text && ctx.text.trim().toLowerCase().startsWith('/level')) {
        const args = ctx.text.trim().split(/\s+/);
        const targetLevel = parseInt(args[1], 10);
        
        if (isNaN(targetLevel) || targetLevel < 0 || targetLevel > 3) {
            const lvlName = SecurityManager.LEVELS['L'+SecurityManager.currentLevel] ? SecurityManager.LEVELS['L'+SecurityManager.currentLevel].name : 'Unknown';
            await ctx.reply(`ℹ️ 目前的安全指令風險等級為：**L${SecurityManager.currentLevel} (${lvlName})**\n\n請輸入 0-3 的數字切換等級，例如：\n\`/level 0\` (最安全，唯讀)\n\`/level 1\` (低風險)\n\`/level 2\` (中風險，預設)\n\`/level 3\` (最高權限)\n\n當指令風險超過目前設定時，將自動受到安全系統攔截。`, { parse_mode: 'Markdown' });
            return;
        }

        SecurityManager.currentLevel = targetLevel;
        const levelInfo = SecurityManager.LEVELS['L'+targetLevel];
        await ctx.reply(`🛡️ **安全等級已動態切換**\n目前的自主控制權限已調整為：**L${targetLevel} (${levelInfo.name})**\n所有風險等級高於此設定的指令都將遭到自動攔截。`, { parse_mode: 'Markdown' });
        return;
    }

    // ✨ [新增] /enable_silent & /disable_silent 指令實作 (僅限 CHAT 模式)
    if (ctx.authMode === 'CHAT' && ctx.isAdmin && ctx.text && (ctx.text.trim().toLowerCase().startsWith('/enable_silent') || ctx.text.trim().toLowerCase().startsWith('/disable_silent'))) {
        const lowerRaw = ctx.text.trim().toLowerCase();
        const isEnable = lowerRaw.startsWith('/enable_silent');
        const args = ctx.text.trim().split(/\s+/);
        // 指令格式現在是 /enable_silent @bot_username
        const targetBotTag = args[1] || "";
        const targetBotUsername = targetBotTag.startsWith('@') ? targetBotTag.substring(1).toLowerCase() : targetBotTag.toLowerCase();

        if (!targetBotTag) {
            const currentBotUsername = ctx.instance.username ? `@${ctx.instance.username}` : `@golem_A`;
            await ctx.reply(`ℹ️ 請指定目標 Bot ID，例如：\n \`${isEnable ? '/enable_silent' : '/disable_silent'} ${currentBotUsername}\``);
            return;
        }

        // 比對 Bot Username (忽略大小寫)
        if (ctx.instance.username && targetBotUsername === ctx.instance.username.toLowerCase()) {
            // OK
        } else if (!ctx.instance.username && targetBotUsername === 'golem_a') {
            // OK
        } else {
            return;
        }

        convoManager.silentMode = isEnable;
        if (isEnable) convoManager.observerMode = false; // 開啟全靜默時關閉觀察者

        const displayName = ctx.instance.username ? `@${ctx.instance.username}` : `[${forceTargetId || 'golem_A'}]`;
        if (isEnable) {
            await ctx.reply(`🤫 ${displayName} 已進入「完全靜默模式」。\n我將暫時關閉感知，且不會記錄任何對話。`);
        } else {
            await ctx.reply(`📢 ${displayName} 已解除靜默模式。`);
        }
        return;
    }

    // ✨ [新增] /enable_observer & /disable_observer 指令實作 (僅限 CHAT 模式)
    if (ctx.authMode === 'CHAT' && ctx.isAdmin && ctx.text && (ctx.text.trim().toLowerCase().startsWith('/enable_observer') || ctx.text.trim().toLowerCase().startsWith('/disable_observer'))) {
        const lowerRaw = ctx.text.trim().toLowerCase();
        const isEnable = lowerRaw.startsWith('/enable_observer');
        const args = ctx.text.trim().split(/\s+/);
        const targetBotTag = args[1] || "";
                const targetBotUsername = targetBotTag.startsWith('@') ? targetBotTag.substring(1) : targetBotTag;
        if (targetBotUsername && targetBotUsername !== ctx.instance.username) return;

        const { brain, convoManager } = getOrCreateGolem();
        const displayName = ctx.instance.username ? `@${ctx.instance.username}` : `[Golem]`;
        if (isEnable) convoManager.observerMode = true;
        else convoManager.observerMode = false;

        if (isEnable) {
            await ctx.reply(`👁️ ${displayName} 已進入「觀察者模式」。\n我會安靜地同步所有對話上下文，但預設不發言。`);
        } else {
            await ctx.reply(`📢 ${displayName} 已解除觀察者模式。`);
        }
        return;
    }

    if (!ctx.text && !ctx.getAttachment) return;
    const allowPromptShortcutForNonAdmin = ctx.platform === 'telegram' && Boolean(matchedPromptShortcut);
    if (!ctx.isAdmin && !allowPromptShortcutForNonAdmin) return;

    if (ctx.isAdmin) {
        if (await NodeRouter.handle(ctx, brain)) return;

        const lowerText = ctx.text ? ctx.text.toLowerCase() : '';
        if (autonomy.pendingPatch) {
            if (['ok', 'deploy', 'y', '部署'].includes(lowerText)) return executeDeploy(ctx, forceTargetId || 'golem_A');
            if (['no', 'drop', 'n', '丟棄'].includes(lowerText)) return executeDrop(ctx, forceTargetId || 'golem_A');
        }

        if (lowerText.startsWith('/patch') || lowerText.includes('優化代碼')) {
            await autonomy.performSelfReflection(ctx);
            return;
        }
    }

    await ctx.sendTyping();
    try {
        let finalInput = ctx.text;
        const attachment = await ctx.getAttachment();

        // ✨ [群組模式身分與回覆注入]
        const isGroupMode = ConfigManager.CONFIG.TG_AUTH_MODE === 'CHAT' && ctx.platform === 'telegram';
        let senderPrefix = isGroupMode ? `【發話者：${ctx.senderName}】\n` : "";
        if (ctx.replyToName) {
            senderPrefix += `【回覆給：${ctx.replyToName}】\n`;
        }

        if (attachment) {
            // 🚀 [v9.1.5] 如果附件來自 Telegram/Discord (有 URL 但非 Native)，嘗試下載並轉化為原生附件
            // 現在不限圖片，支援所有 Gemini 支援的檔案類型
            if (!attachment.isNative && attachment.url) {
                try {
                    console.log(`📡 [System] 正在將遠端附件轉化為本地原生附件... (${attachment.url})`);
                    const tempDir = path_sync.join(process.cwd(), 'data', 'temp_uploads');
                    
                    // 根據 mimeType 推斷副檔名
                    let ext = 'bin';
                    if (attachment.mimeType) {
                        const parts = attachment.mimeType.split('/');
                        ext = parts[1] || 'bin';
                        if (ext === 'plain') ext = 'txt';
                        if (ext === 'jpeg') ext = 'jpg';
                        if (ext === 'gif') ext = 'gif';
                        if (ext === 'markdown' || ext === 'x-markdown') ext = 'md';
                        if (ext.includes('wordprocessingml')) ext = 'docx';
                        if (ext.includes('spreadsheetml')) ext = 'xlsx';
                        if (ext.includes('presentationml')) ext = 'pptx';
                    }
                    
                    const fileName = `remote_${Date.now()}_${randomUUID().substring(0, 8)}.${ext}`;
                    const localPath = path_sync.join(tempDir, fileName);
                    
                    await downloadFile(attachment.url, localPath);
                    attachment.url = `/api/files/${fileName}`;
                    attachment.path = localPath;
                    attachment.isNative = true;
                    console.log(`✅ [System] 附件下載完成，URL: ${attachment.url}`);
                } catch (err) {
                    console.warn(`⚠️ [System] 附件轉化失敗: ${err.message}，將退回 OpticNerve 模式。`);
                }
            }

            // 如果是原生附加檔案 (由 Web Dashboard 傳入或剛剛下載完成)，則跳過 OpticNerve 分析，直接入隊
            if (attachment.isNative) {
                console.log("📎 [System] 偵測到原生附件，將直接交由 Golem 處理。");
                finalInput = senderPrefix + (ctx.text || "");
            } else {
                await ctx.reply("👁️ 正在透過 OpticNerve 分析檔案...");
                const apiKey = await brain.doctor.keyChain.getKey();
                if (apiKey) {
                    const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, apiKey);
                    finalInput = `${senderPrefix}【系統通知：視覺訊號】\n檔案類型：${attachment.mimeType}\n分析報告：\n${analysis}\n使用者訊息：${ctx.text || ""}\n請根據分析報告回應。`;
                } else {
                    await ctx.reply("⚠️ 視覺系統暫時過熱 (API Rate Limit)，無法分析圖片，將僅處理文字訊息。");
                    finalInput = senderPrefix + (ctx.text || "");
                }
            }
        } else {
            finalInput = senderPrefix + (ctx.text || "");
        }

        if (!finalInput && !attachment) return;
        const normalizedText = String(ctx.text || '').trim().toLowerCase();
        const isSlashCommand = normalizedText.startsWith('/');
        const planningModeState = getPlanningModeState();
        let executionMode = 'chat_standard';
        let planningDecision = {
            usePlanning: false,
            score: 0,
            threshold: Number(process.env.GOLEM_CHAT_PLANNING_THRESHOLD || 5),
            reason: planningModeState.enabled ? 'simple_request' : 'planning_mode_disabled',
        };

        if (planningModeState.enabled && !isSlashCommand) {
            planningDecision = planningIntentRouter.evaluate({
                text: finalInput,
                hasAttachment: Boolean(attachment),
            });
            if (planningDecision.usePlanning) {
                executionMode = 'planning_auto';
                console.log(`🧭 [PlanningMode] auto route enabled score=${planningDecision.score} reason=${planningDecision.reason}`);
            }
        }

        await convoManager.enqueue(ctx, finalInput, {
            attachment: attachment,
            executionMode,
            planningDecision,
            planningModeEnabled: planningModeState.enabled,
        });
    } catch (e) {
        console.error(e);
        await ctx.reply(`❌ 錯誤: ${e.message}`);
    }
}

async function handleUnifiedCallback(ctx, actionData) {
    if (ctx.platform === 'discord' && ctx.isInteraction) {
        try {
            await ctx.event.deferReply({ flags: 64 });
        } catch (e) {
            console.error('Callback Discord deferReply Error:', e.message);
        }
    }

    if (!ctx.isAdmin) return;

    // 解析 GolemId (如果是 PATCH 相關)
    if (actionData.startsWith('PATCH_DEPLOY_')) {
        return executeDeploy(ctx);
    }
    if (actionData.startsWith('PATCH_DROP_')) {
        return executeDrop(ctx);
    }

    const { brain, controller, convoManager, actionQueue } = getOrCreateGolem();
    if (actionData === 'SYSTEM_FORCE_UPDATE') return SystemUpgrader.performUpdate(ctx);
    if (actionData === 'SYSTEM_UPDATE_CANCEL') return await ctx.reply("已取消更新操作。");

    if (actionData.includes('_')) {
        const [action, taskId] = actionData.split('_');
        const task = controller && typeof controller.getPendingTask === 'function'
            ? controller.getPendingTask(taskId)
            : controller.pendingTasks.get(taskId);
        if (!task) return await ctx.reply('⚠️ 任務已失效');

        // ✨ [v9.1] 處理【大腦對話佇列】插隊系統的 Callback (DIALOGUE_QUEUE_APPROVAL)
        if (task.type === 'DIALOGUE_QUEUE_APPROVAL') {
            if (controller && typeof controller.deletePendingTask === 'function') {
                controller.deletePendingTask(taskId, { reason: `dialogue-${action.toLowerCase()}`, actor: 'system' });
            } else {
                controller.pendingTasks.delete(taskId);
            }

            try {
                if (ctx.platform === 'telegram' && ctx.event.message) {
                    await ctx.instance.editMessageText(
                        `🚨 **大腦思考中**\n目前對話佇列繁忙。\n\n*(使用者已選擇：${action === 'DIAPRIORITY' ? '⬆️ 急件插隊' : '⬇️ 正常排隊'})*`,
                        {
                            chat_id: ctx.chatId,
                            message_id: ctx.event.message.message_id,
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: [] }
                        }
                    ).catch(() => { });
                }
            } catch (e) { console.warn("無法更新大腦插隊詢問訊息:", e.message); }

            const isPriority = action === 'DIAPRIORITY';

            // 重新入隊處理對話
            if (convoManager) {
                convoManager._actualCommit(ctx, task.text, isPriority, task.attachment || null, task.options || {});
            }
            return;
        }

        if (action === 'DENY') {
            if (controller && typeof controller.deletePendingTask === 'function') {
                controller.deletePendingTask(taskId, { reason: 'user-deny', actor: 'system' });
            } else {
                controller.pendingTasks.delete(taskId);
            }
            if (task.taskId && controller && typeof controller.taskUpdate === 'function') {
                try {
                    controller.taskUpdate(task.taskId, {
                        status: 'failed',
                        error: 'Command approval denied by user',
                        metadata: {
                            approvalDeniedAt: Date.now(),
                        },
                    }, {
                        actor: 'system',
                    });
                } catch (error) {
                    console.warn(`⚠️ [TaskKernel] 無法將任務標記為失敗: ${error.message}`);
                }
            }
            await ctx.reply('🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            const { steps, nextIndex } = task;
            if (controller && typeof controller.deletePendingTask === 'function') {
                controller.deletePendingTask(taskId, { reason: 'user-approve', actor: 'system' });
            } else {
                controller.pendingTasks.delete(taskId);
            }

            if (task.taskId && controller && typeof controller.taskUpdate === 'function') {
                try {
                    controller.taskUpdate(task.taskId, {
                        status: 'in_progress',
                        metadata: {
                            pendingApprovalId: null,
                            resumedAt: Date.now(),
                        },
                        clearError: true,
                    }, {
                        actor: 'system',
                    });
                } catch {}
            }

            await ctx.reply("✅ 授權通過，執行中 (這可能需要幾秒鐘)...");
            const approvedStep = steps[nextIndex];

            let cmd = "";

            if (approvedStep.action === 'command' || approvedStep.cmd || approvedStep.parameter || approvedStep.command) {
                cmd = approvedStep.cmd || approvedStep.parameter || approvedStep.command || "";
            }
            else if (approvedStep.action && approvedStep.action !== 'command') {
                const actionName = String(approvedStep.action).toLowerCase().replace(/_/g, '-');
                let payload = "";
                if (approvedStep.summary) payload = String(approvedStep.summary);
                else if (approvedStep.args) payload = typeof approvedStep.args === 'string' ? approvedStep.args : JSON.stringify(approvedStep.args);
                else {
                    // 防呆：如果沒有 args 也沒有 summary，則將扣除 action 以外的所有欄位封裝為 JSON
                    const { action, ...params } = approvedStep;
                    payload = JSON.stringify(params);
                }

                const safePayload = payload.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
                cmd = `node src/skills/core/${actionName}.js "${safePayload}"`;
                console.log(`🔧 [Command Builder] 成功將結構化技能 [${actionName}] 組裝為安全指令`);
            }

            if (!cmd && task.rawText) {
                const match = task.rawText.match(/node\s+src\/skills\/lib\/[a-zA-Z0-9_-]+\.js\s+.*?(?="|\n|$)/);
                if (match) {
                    cmd = match[0];
                    console.log(`🔧 [Auto-Fix] 已從破裂的 JSON 原始內容中硬挖出指令`);
                }
            }

            if (!cmd) {
                await ctx.reply("⚠️ 解析失敗：無法辨認指令格式。請重新對 Golem 下達指令。");
                return;
            }

            // 🛡️ [Security Safeguard] 指令安全檢查
            // 已由使用者手動核准，故跳過硬編碼的正則白名單檢查 (skipWhitelist = true)
            // 僅保留黑名單關鍵字與格式校準
            const validation = CommandSafeguard.validate(cmd, true);
            if (!validation.safe) {
                console.error(`🛡️ [Safeguard] 攔截危險指令: ${cmd} | 原因: ${validation.reason}`);
                await ctx.reply(`🛡️ **安全警告**：偵測到潛在危險指令！\n執行權限已自動攔截。\n原因：${validation.reason}`);
                return;
            }
            cmd = validation.sanitizedCmd;

            if (cmd.includes('reincarnate.js')) {
                await ctx.reply("🔄 收到轉生指令！正在將記憶注入核心並準備重啟大腦...");
                controller.executor.run(cmd, { timeout: 45000 }).catch((error) => {
                    console.error(`❌ [Executor] 轉生指令執行失敗: ${error.message}`);
                });
                return;
            }

            // ✨ [v9.1] 將物理操作封裝並丟入行動產線 (Action Queue)

            await actionQueue.enqueue(ctx, async () => {
                let execResult = "";
                let finalOutput = "";
                let approvedStepFailed = false;
                try {
                    finalOutput = await controller.executor.run(cmd, {
                        timeout: 45000,
                    });
                    finalOutput = (finalOutput || "✅ 指令執行成功，無特殊輸出").trim();
                    execResult = `[Step ${nextIndex + 1} Success] cmd: ${cmd}\nResult:\n${finalOutput}`;
                    console.log(`✅ [Executor] 成功捕獲終端機輸出 (${finalOutput.length} 字元)`);
                } catch (e) {
                    approvedStepFailed = true;
                    finalOutput = `Error: ${e.message}\n${e.stderr || ''}`;
                    execResult = `[Step ${nextIndex + 1} Failed] cmd: ${cmd}\nResult:\n${finalOutput}`;
                    console.error(`❌ [Executor] 執行錯誤: ${e.message}`);
                    if (task.taskId && controller && typeof controller.taskUpdate === 'function') {
                        try {
                            controller.taskUpdate(task.taskId, {
                                status: 'failed',
                                error: String(e.message || e),
                                metadata: {
                                    failedApprovedStep: nextIndex + 1,
                                },
                            }, {
                                actor: 'system',
                            });
                        } catch {}
                    }
                }

                const MAX_LENGTH = 15000;
                if (execResult.length > MAX_LENGTH) {
                    execResult = execResult.substring(0, MAX_LENGTH) + `\n\n... (為保護記憶體，內容已截斷，共省略 ${execResult.length - MAX_LENGTH} 字元) ...`;
                    console.log(`✂️ [System] 執行結果過長，已自動截斷為 ${MAX_LENGTH} 字元。`);
                }

                let remainingResult = "";
                try {
                    remainingResult = await controller.runSequence(ctx, steps, nextIndex + 1, {
                        taskId: task.taskId || '',
                        actor: 'system',
                        source: 'command_approval_resume',
                    }) || "";
                } catch (err) {
                    console.warn(`⚠️ [System] 執行後續步驟時發生警告: ${err.message}`);
                }

                if (approvedStepFailed && !remainingResult && task.taskId && controller && typeof controller.taskUpdate === 'function') {
                    try {
                        controller.taskUpdate(task.taskId, {
                            status: 'failed',
                            error: String(finalOutput || '').slice(0, 500),
                        }, {
                            actor: 'system',
                        });
                    } catch {}
                }

                const observation = [execResult, remainingResult].filter(Boolean).join('\n\n----------------\n\n');

                if (observation) {
                    await ctx.reply(`📤 指令執行完畢 (共抓取 ${finalOutput.length} 字元)！將結果放入對話隊列 (Dialogue Queue) 等待大腦分析...`);

                    const feedbackPrompt = `[System Observation]\nUser approved actions.\nExecution Result:\n${observation}\n\nPlease analyze this result and report to the user using [GOLEM_REPLY].`;
                    try {
                        // ✨ [v9.1] 產線串接：將加工完成的 Observation 放入對話產線 (Dialogue Queue) 取代直接呼叫 sendMessage
                        if (convoManager) {
                            await convoManager.enqueue(ctx, feedbackPrompt, { isPriority: true, bypassDebounce: true });
                        } else {
                            // 防呆：如果退化回沒有 convoManager，則走舊路
                            const finalResponse = await brain.sendMessage(feedbackPrompt);
                            await NeuroShunter.dispatch(ctx, finalResponse, brain, controller);
                        }
                    } catch (err) {
                        await ctx.reply(`❌ 傳送結果回大腦時發生異常：${err.message}`);
                    }
                }
            });
        }
    }
}

global.handleDashboardMessage = handleUnifiedMessage;
global.handleUnifiedCallback = handleUnifiedCallback;
global.getOrCreateGolem = getOrCreateGolem;

async function executeDeploy(ctx) {
    const { autonomy, brain } = getOrCreateGolem();
    if (!autonomy.pendingPatch) return;
    try {
        const { path: patchPath, target: targetPath, name: targetName } = autonomy.pendingPatch;

        try {
            await fs.copyFile(targetPath, `${targetName}.bak-${Date.now()}`);
        } catch (e) { }

        const patchContent = await fs.readFile(patchPath);
        await fs.writeFile(targetPath, patchContent);
        await fs.unlink(patchPath);

        autonomy.pendingPatch = null;
        if (brain && brain.memoryDriver && brain.memoryDriver.recordSuccess) {
            try { await brain.memoryDriver.recordSuccess(); } catch (e) { }
        }
        await ctx.reply(`🚀 [Single Golem] ${targetName} 升級成功！正在重啟...`);
        if (global.gracefulRestart) await global.gracefulRestart();
    } catch (e) { await ctx.reply(`❌ [Single Golem] 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx) {
    const { autonomy, brain } = getOrCreateGolem();
    if (!autonomy.pendingPatch) return;
    try {
        await fs.unlink(autonomy.pendingPatch.path);
    } catch (e) { }
    autonomy.pendingPatch = null;
    if (brain && brain.memoryDriver && brain.memoryDriver.recordRejection) {
        try { await brain.memoryDriver.recordRejection(); } catch (e) { }
    }
    await ctx.reply(`🗑️ [Single Golem] 提案已丟棄`);
}

// ✅ [Bug #1 修復] Bot 事件綁定已移入 golemFactory 內部動態處理。

if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}

/**
 * 🧹 資源清理核心程序
 */
async function waitForActiveInteractions(instance, timeoutMs) {
    if (!instance || !instance.brain) {
        return { drained: true, active: 0, waitedMs: 0 };
    }

    const start = Date.now();
    const getActiveCount = () => {
        const value = Number(instance.brain._activeInteractionCount || 0);
        return Number.isFinite(value) && value > 0 ? value : 0;
    };

    while ((Date.now() - start) < timeoutMs) {
        const active = getActiveCount();
        if (active <= 0) {
            return {
                drained: true,
                active: 0,
                waitedMs: Date.now() - start,
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const active = getActiveCount();
    return {
        drained: active <= 0,
        active,
        waitedMs: Date.now() - start,
    };
}

async function performCleanup(reason = 'manual-cleanup') {
    if (cleanupInFlightPromise) return cleanupInFlightPromise;

    cleanupInFlightPromise = (async () => {
        console.log(`🛑 [System] 正在執行資源清理程序... (reason=${reason})`);

        if (memoryPressureGuard) {
            memoryPressureGuard.stop();
        }

        // 1. 停止 Telegram Bot Polling
        if (activeTgBot) {
            try {
                console.log(`🛑 [System] 正在停止 Telegram Bot Polling...`);
                await activeTgBot.stopPolling();
                console.log(`✅ [System] Telegram Bot Polling 已停止。`);
            } catch (e) {
                console.warn(`⚠️ [System] 停止 Telegram Bot Polling 失敗: ${e.message}`);
            }
        }

        if (promptPoolWatcherTimer) {
            clearInterval(promptPoolWatcherTimer);
            promptPoolWatcherTimer = null;
        }

        const instance = singleGolemInstance;
        const shutdownDrainMs = Number(process.env.GOLEM_WORKER_SHUTDOWN_DRAIN_MS || 8000);
        if (instance && instance.brain) {
            const drainResult = await waitForActiveInteractions(instance, shutdownDrainMs);
            if (!drainResult.drained) {
                console.warn(`⚠️ [System] cleanup drain timeout (${drainResult.waitedMs}ms), remaining interactions: ${drainResult.active}`);
            } else if (drainResult.waitedMs > 0) {
                console.log(`⏳ [System] 已等待互動排空 ${drainResult.waitedMs}ms 後進行清理。`);
            }
        }

        // 2. 關閉瀏覽器實體
        if (instance && instance.brain && instance.brain.context) {
            try {
                console.log(`🛑 [System] 正在關閉瀏覽器...`);
                await instance.brain.context.close();
                console.log(`✅ [System] 瀏覽器已關閉。`);
            } catch (e) {
                console.warn(`⚠️ [System] 關閉瀏覽器失敗: ${e.message}`);
            }
        }

        try {
            await MCPManager.getInstance().stopAll();
        } catch (e) {
            console.warn(`⚠️ [System] 停止 MCP clients 失敗: ${e.message}`);
        }

        if (instance) {
            try { instance.autonomy && instance.autonomy.destroy && instance.autonomy.destroy(); } catch {}
            try { instance.controller && instance.controller.destroy && instance.controller.destroy(); } catch {}
            try { instance.convoManager && instance.convoManager.destroy && instance.convoManager.destroy(); } catch {}
        }

        if (activeDcBot && typeof activeDcBot.destroy === 'function') {
            try {
                await activeDcBot.destroy();
            } catch (e) {
                console.warn(`⚠️ [System] 停止 Discord Client 失敗: ${e.message}`);
            }
        }

        activeTgBot = null;
        activeDcBot = null;

        clearLifecycleResources();
        singleGolemInstance = null;
        reportRuntimeState();
    })();

    try {
        await cleanupInFlightPromise;
    } finally {
        cleanupInFlightPromise = null;
    }
}

global.stopGolem = async function (id, reason = 'manual-stop') {
    if (id !== 'golem_A') return; // Currently only single mode supported
    await performCleanup(reason);
    console.log(`✅ [System] Golem ${id} has been stopped.`);
};

global.gracefulRestart = async function (reason = 'graceful-restart') {
    await performCleanup(reason);
    process.exit(0);
};

global.fullShutdown = async function (reason = 'full-shutdown') {
    await performCleanup(reason);
    console.log("👋 [System] 所有服務已關閉，正在退出系統。");
    process.exit(0);
};

module.exports = {
    getOrCreateGolem,
    handleUnifiedMessage,
    handleDashboardMessage: handleUnifiedMessage,
    handleUnifiedCallback
};
