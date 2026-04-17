// ============================================================
// 🎭 ToolsetManager — 場景化工具集系統
// 靈感來自 NousResearch/hermes-agent toolsets.py
//
// 讓 Golem 能依照使用情境（coding/research/safe/creative）
// 動態組合最適合的工具集，而非永遠載入全部技能。
// ============================================================

// ── 原子工具集定義（對齊 skillsConfig.js 的 id 命名）─────────────
const ATOMIC_TOOLS = {
    // 系統工具
    system:  ['actor', 'chronos', 'reincarnate', 'sys-admin'],
    // 記憶與學習
    memory:  ['memory', 'adaptive-learning', 'session-search', 'reflection'],
    // 知識管理
    knowledge: ['wiki', 'log-archive', 'log-reader'],
    // 程式與演化
    code:    ['evolution', 'code-wizard'],
    // 網路與搜尋
    search:  ['tool-explorer', 'optic-nerve', 'cloud'],
    // 多媒體
    media:   ['image-prompt', 'youtube', 'spotify'],
    // AI 協作
    agents:  ['multi-agent'],
    // MCP 整合
    mcp:     ['mcp'],
    // 社群整合
    social:  ['moltbot'],
};

// ── 場景工具集（Scene Toolsets）────────────────────────────────────
// 對應 Hermes 的 TOOLSETS['debugging'], TOOLSETS['safe'] 等
const SCENE_TOOLSETS = {
    /**
     * coding - 適合開發、debug、code review 場景
     */
    coding: {
        description: '程式開發模式：啟用程式碼修改、Git、系統診斷等工具',
        emoji: '💻',
        includes: [...ATOMIC_TOOLS.system, ...ATOMIC_TOOLS.code, ...ATOMIC_TOOLS.memory, ...ATOMIC_TOOLS.mcp, 'git'],
    },

    /**
     * research - 適合資料搜集、知識整理場景
     */
    research: {
        description: '研究模式：啟用網路搜尋、Wiki、記憶工具',
        emoji: '🔬',
        includes: [...ATOMIC_TOOLS.system, ...ATOMIC_TOOLS.search, ...ATOMIC_TOOLS.knowledge, ...ATOMIC_TOOLS.memory],
    },

    /**
     * creative - 適合創意、寫作、影像生成場景
     */
    creative: {
        description: '創意模式：啟用影像生成、音樂、知識工具',
        emoji: '🎨',
        includes: [...ATOMIC_TOOLS.system, ...ATOMIC_TOOLS.media, ...ATOMIC_TOOLS.knowledge, ...ATOMIC_TOOLS.memory],
    },

    /**
     * assistant - 日常助手模式（預設平衡組合）
     */
    assistant: {
        description: '助手模式：全方位平衡工具集（預設）',
        emoji: '🤖',
        includes: [
            ...ATOMIC_TOOLS.system, ...ATOMIC_TOOLS.memory, ...ATOMIC_TOOLS.knowledge,
            ...ATOMIC_TOOLS.search, ...ATOMIC_TOOLS.agents,
        ],
    },

    /**
     * safe - 安全模式：禁用任何程式碼修改、檔案寫入工具
     */
    safe: {
        description: '安全模式：移除所有可修改系統的工具（唯讀）',
        emoji: '🛡️',
        includes: [...ATOMIC_TOOLS.system, ...ATOMIC_TOOLS.knowledge, ...ATOMIC_TOOLS.memory],
        excludes: ['evolution', 'code-wizard', 'sys-admin', 'git'],
    },

    /**
     * autonomy - 自主模式：包含所有需要主動行動的工具
     */
    autonomy: {
        description: '自主模式：適合長時間自主任務執行',
        emoji: '🚀',
        includes: [
            ...ATOMIC_TOOLS.system, ...ATOMIC_TOOLS.memory, ...ATOMIC_TOOLS.knowledge,
            ...ATOMIC_TOOLS.search, ...ATOMIC_TOOLS.code, ...ATOMIC_TOOLS.agents, ...ATOMIC_TOOLS.mcp,
        ],
    },
};

// ── 平台工具集（Platform Toolsets）──────────────────────────────────
// 依據訊息平台自動調整（對齊 Hermes 的 hermes-telegram, hermes-cli...）
const PLATFORM_TOOLSETS = {
    telegram: {
        description: 'Telegram 最佳化：適合行動裝置上的對話互動',
        // Telegram 上避免輸出過多程式碼，聚焦在對話式工具
        preferScene: 'assistant',
        maxResultLength: 3800, // Telegram 4096 字元上限
    },
    discord: {
        description: 'Discord 最佳化：支援 Markdown，較長輸出',
        preferScene: 'assistant',
        maxResultLength: 1900,
    },
    cli: {
        description: 'CLI 模式：完整輸出，無長度限制',
        preferScene: 'coding',
        maxResultLength: Infinity,
    },
    web: {
        description: 'Web Dashboard 模式',
        preferScene: 'assistant',
        maxResultLength: 10000,
    },
};

// ============================================================
// ToolsetManager 主類別
// ============================================================
class ToolsetManager {
    constructor() {
        this._activeScene = 'assistant';
        this._customOverrides = new Set(); // 使用者手動新增的工具
        this._customExcludes = new Set();  // 使用者手動移除的工具
    }

    // ── 場景切換 ──────────────────────────────────────────────

    /**
     * 切換場景工具集
     * @param {string} sceneName - 'coding' | 'research' | 'creative' | 'assistant' | 'safe' | 'autonomy'
     * @returns {{ success: boolean, message: string, tools: string[] }}
     */
    switchScene(sceneName) {
        const scene = SCENE_TOOLSETS[sceneName];
        if (!scene) {
            const available = Object.keys(SCENE_TOOLSETS).join(', ');
            return {
                success: false,
                message: `❌ 未知的場景「${sceneName}」。可用場景：${available}`,
                tools: []
            };
        }

        this._activeScene = sceneName;
        this._customOverrides.clear();
        this._customExcludes.clear();

        const tools = this.getActiveTools();
        return {
            success: true,
            message: `${scene.emoji} **已切換至 ${sceneName} 模式**：${scene.description}\n📦 已啟用 ${tools.length} 個工具`,
            tools,
        };
    }

    /**
     * 取得目前場景名稱
     */
    getActiveScene() {
        return this._activeScene;
    }

    /**
     * 手動新增工具（不切換場景）
     * @param {string} toolId
     */
    addTool(toolId) {
        this._customOverrides.add(toolId);
        this._customExcludes.delete(toolId);
    }

    /**
     * 手動移除工具（不切換場景）
     * @param {string} toolId
     */
    removeTool(toolId) {
        this._customExcludes.add(toolId);
        this._customOverrides.delete(toolId);
    }

    // ── 工具集解析 ─────────────────────────────────────────────

    /**
     * 取得目前生效的工具 id 清單（去重、去除排除項）
     * @param {string} [platform] - 平台名稱（可選，用於取得平台限制）
     * @returns {string[]}
     */
    getActiveTools(platform = null) {
        const scene = SCENE_TOOLSETS[this._activeScene] || SCENE_TOOLSETS['assistant'];

        let tools = new Set(scene.includes || []);

        // 套用場景排除
        if (scene.excludes) {
            scene.excludes.forEach(t => tools.delete(t));
        }

        // 套用使用者自訂
        this._customOverrides.forEach(t => tools.add(t));
        this._customExcludes.forEach(t => tools.delete(t));

        return [...tools];
    }

    /**
     * 判斷特定工具是否在目前工具集中
     * @param {string} toolId
     * @returns {boolean}
     */
    hasTool(toolId) {
        return this.getActiveTools().includes(toolId);
    }

    /**
     * 取得所有可用場景的摘要
     * @returns {string}
     */
    listScenes() {
        let output = '🗂️ **可用場景工具集**\n\n';
        for (const [name, scene] of Object.entries(SCENE_TOOLSETS)) {
            const marker = name === this._activeScene ? ' ✅ **(目前)**' : '';
            output += `**${scene.emoji} ${name}**${marker}\n`;
            output += `　${scene.description}\n`;
            output += `　工具數：${scene.includes.length} 個`;
            if (scene.excludes) output += `（排除 ${scene.excludes.length} 個）`;
            output += '\n\n';
        }
        return output.trim();
    }

    /**
     * 依照平台取得建議的場景
     * @param {string} platform
     * @returns {string} 建議的場景名稱
     */
    getSuggestedScene(platform) {
        const platformConfig = PLATFORM_TOOLSETS[platform];
        return platformConfig ? platformConfig.preferScene : 'assistant';
    }

    /**
     * 依照平台取得最大輸出長度
     * @param {string} platform
     * @returns {number}
     */
    getMaxResultLength(platform) {
        const platformConfig = PLATFORM_TOOLSETS[platform];
        return platformConfig ? platformConfig.maxResultLength : 3800;
    }
}

// 單例
const _instance = new ToolsetManager();

module.exports = {
    ToolsetManager,
    SCENE_TOOLSETS,
    ATOMIC_TOOLS,
    PLATFORM_TOOLSETS,
    toolsetManager: _instance,  // 預設單例
};
