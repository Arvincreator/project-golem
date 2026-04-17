// ============================================================
// 👤 UserProfileManager — 動態使用者建模引擎
// 靈感來自 NousResearch/hermes-agent + Honcho 整合
//
// 從真實的對話中自動推斷並累積使用者特徵：
// - 技術偏好（語言、工具、框架）
// - 溝通風格（正式/輕鬆、長短、語言）
// - 工作習慣（常用時段、常見任務、偏好工作流）
// - 重要事件（里程碑、關係、事件）
// - 個人偏好（興趣、厭惡、禁忌話題）
// ============================================================

const fs   = require('fs');
const path = require('path');

/** 預設空白使用者檔案 */
const DEFAULT_PROFILE = () => ({
    version: '1.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // 基本識別
    identity: {
        knownNames: [],       // 使用者曾用的稱呼 (e.g. ['Alan', '阿倫'])
        preferredLanguage: 'zh-TW',
        timezone: null,
    },

    // 技術偏好
    tech: {
        languages: [],        // 常用程式語言
        frameworks: [],       // 常用框架
        tools: [],            // 常用工具
        os: [],               // 常用作業系統
        prefersCli: null,     // 偏好 CLI 還是 GUI
    },

    // 溝通風格
    communication: {
        tone: 'neutral',      // 'formal' | 'casual' | 'neutral'
        responseLength: 'medium', // 'brief' | 'medium' | 'detailed'
        preferredScriptType: 'zh-TW', // 對話語言
        usesEmoji: null,      // 使用者是否常用 emoji
        codeExamplesPreferred: null,
    },

    // 工作模式
    work: {
        activeHours: [],      // 活躍時段 (0-23)
        commonTasks: [],      // 常見任務類型
        projectTypes: [],     // 常見專案類型
        workStyle: null,      // 'solo' | 'team' | 'mixed'
    },

    // 興趣與偏好
    preferences: {
        topics: [],           // 感興趣的主題
        dislikes: [],         // 不喜歡的話題或方式
        taboos: [],           // 禁忌話題
        favoriteBots: [],     // 喜歡的 Golem 功能
    },

    // 重要記事（手動 + 自動萃取）
    milestones: [],           // [{ date, content, impact: 'high'|'medium' }]

    // 訓練元資料
    meta: {
        totalInteractions: 0,
        lastProfiledAt: null,
        profileConfidence: 0, // 0-100，越高越可信
    },
});

// ============================================================
class UserProfileManager {
    /**
     * @param {string} userDataDir - Golem 實體的 userDataDir
     */
    constructor(userDataDir) {
        this.userDataDir = userDataDir || process.cwd();
        this.profilePath = path.join(this.userDataDir, 'user_profile.json');
        this._profile = null;
        this._dirty = false;
    }

    // ── Core I/O ─────────────────────────────────────────────

    /** 載入或初始化使用者檔案 */
    load() {
        if (this._profile) return this._profile;
        try {
            if (fs.existsSync(this.profilePath)) {
                this._profile = JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
                // 確保所有欄位存在（migration 向前兼容）
                this._profile = this._merge(DEFAULT_PROFILE(), this._profile);
            } else {
                this._profile = DEFAULT_PROFILE();
            }
        } catch (e) {
            console.error(`⚠️ [UserProfile] 載入失敗，使用預設值:`, e.message);
            this._profile = DEFAULT_PROFILE();
        }
        return this._profile;
    }

    /** 儲存到磁碟 */
    save() {
        try {
            if (!fs.existsSync(this.userDataDir)) {
                fs.mkdirSync(this.userDataDir, { recursive: true });
            }
            const p = this.load();
            p.updatedAt = new Date().toISOString();
            fs.writeFileSync(this.profilePath, JSON.stringify(p, null, 2), 'utf8');
            this._dirty = false;
            console.log(`💾 [UserProfile] 已儲存使用者模型`);
        } catch (e) {
            console.error(`❌ [UserProfile] 儲存失敗:`, e.message);
        }
    }

    // ── 手動更新 API ─────────────────────────────────────────

    /** 記錄里程碑事件 */
    addMilestone(content, impact = 'medium') {
        const p = this.load();
        p.milestones.push({
            date: new Date().toISOString(),
            content,
            impact,
        });
        // 最多保留 50 個里程碑
        if (p.milestones.length > 50) {
            p.milestones = p.milestones.slice(-50);
        }
        this._dirty = true;
        this.save();
    }

    /** 更新技術偏好 */
    addTechPreference(type, value) {
        const p = this.load();
        const field = p.tech[type];
        if (Array.isArray(field) && !field.includes(value)) {
            field.push(value);
            this._dirty = true;
            this.save();
        }
    }

    /** 更新溝通風格 */
    setCommunicationStyle(key, value) {
        const p = this.load();
        if (key in p.communication) {
            p.communication[key] = value;
            this._dirty = true;
            this.save();
        }
    }

    // ── LLM 驅動的自動分析 ───────────────────────────────────

    /**
     * 從最近的對話中自動萃取使用者特徵（呼叫 LLM）
     * @param {object} brain - GolemBrain 實體
     * @param {string} recentConversation - 最近對話文字
     * @returns {Promise<object>} 萃取到的更新
     */
    async analyzeAndUpdate(brain, recentConversation) {
        if (!recentConversation || recentConversation.trim().length < 100) return {};

        const currentProfile = this.load();
        const profileSummary = this._buildProfileSummary(currentProfile);

        const prompt = `你是一個使用者行為分析專家。請從以下對話中萃取使用者特徵，並以 JSON 格式輸出：

**現有使用者模型（供參考，避免重複）：**
${profileSummary}

**最近對話片段：**
${recentConversation.slice(-3000)}

請分析並輸出以下 JSON（只需輸出與現有模型不同或新增的資訊，不確定的欄位填 null）：
\`\`\`json
{
  "preferredLanguage": "對話主要語言（如 zh-TW、en）或 null",
  "techLanguages": ["發現的程式語言，不確定就空陣列"],
  "techFrameworks": ["發現的框架"],
  "techTools": ["發現的工具"],
  "tone": "溝通語氣：formal/casual/neutral 或 null",
  "responseLength": "偏好長度：brief/medium/detailed 或 null",
  "topics": ["興趣主題"],
  "milestone": "若有重要事件（如完成專案、做出決策）請描述，否則 null",
  "milestoneImpact": "high/medium/low 或 null",
  "activeHour": "目前活躍小時（0-23）或 null"
}
\`\`\`

只輸出 JSON，不加任何解釋。`;

        try {
            const response = await brain._wikiChat(prompt);
            const jsonMatch = response.match(/```json\s*([\s\S]+?)```/);
            const rawJson = jsonMatch ? jsonMatch[1] : response;
            const extracted = JSON.parse(rawJson.trim());

            this._applyExtracted(extracted);
            this.save();

            return extracted;
        } catch (e) {
            console.warn(`⚠️ [UserProfile] LLM 分析失敗:`, e.message);
            return {};
        }
    }

    // ── 注入 API（供 GolemBrain 使用）──────────────────────────

    /**
     * 產生適合注入 System Prompt 的使用者模型描述
     * @returns {string}
     */
    buildInjectionPrompt() {
        const p = this.load();
        if (p.meta.profileConfidence < 10) return ''; // 資料太少，不注入

        const lines = ['【使用者模型（User Profile）】'];

        // 身份
        if (p.identity.knownNames.length > 0) {
            lines.push(`使用者稱呼：${p.identity.knownNames.join(' / ')}`);
        }

        // 溝通風格
        const toneSuffix = {
            casual: '請用輕鬆、友善的語氣回話',
            formal: '請保持專業、正式的語氣',
            neutral: '',
        }[p.communication.tone] || '';
        if (toneSuffix) lines.push(toneSuffix);

        // 技術背景
        const techParts = [];
        if (p.tech.languages.length > 0) techParts.push(`語言：${p.tech.languages.slice(0, 5).join(', ')}`);
        if (p.tech.frameworks.length > 0) techParts.push(`框架：${p.tech.frameworks.slice(0, 5).join(', ')}`);
        if (p.tech.tools.length > 0) techParts.push(`工具：${p.tech.tools.slice(0, 5).join(', ')}`);
        if (techParts.length > 0) lines.push(`技術偏好：${techParts.join('；')}`);

        // 興趣
        if (p.preferences.topics.length > 0) {
            lines.push(`關注主題：${p.preferences.topics.slice(0, 5).join(', ')}`);
        }

        // 最近里程碑
        const recentMilestones = p.milestones
            .filter(m => m.impact === 'high')
            .slice(-3);
        if (recentMilestones.length > 0) {
            lines.push('\n**重要事件**：');
            recentMilestones.forEach(m => {
                lines.push(`- [${m.date.slice(0, 10)}] ${m.content}`);
            });
        }

        return lines.join('\n');
    }

    /**
     * 取得完整的使用者模型物件
     */
    getProfile() {
        return this.load();
    }

    // ── Private ───────────────────────────────────────────────

    _applyExtracted(extracted) {
        const p = this.load();

        if (extracted.preferredLanguage) {
            p.identity.preferredLanguage = extracted.preferredLanguage;
        }

        const addUnique = (arr, items) => {
            if (!Array.isArray(items)) return;
            items.forEach(item => { if (item && !arr.includes(item)) arr.push(item); });
        };

        addUnique(p.tech.languages, extracted.techLanguages);
        addUnique(p.tech.frameworks, extracted.techFrameworks);
        addUnique(p.tech.tools, extracted.techTools);
        addUnique(p.preferences.topics, extracted.topics);

        if (extracted.tone && ['formal', 'casual', 'neutral'].includes(extracted.tone)) {
            p.communication.tone = extracted.tone;
        }
        if (extracted.responseLength && ['brief', 'medium', 'detailed'].includes(extracted.responseLength)) {
            p.communication.responseLength = extracted.responseLength;
        }
        if (extracted.milestone) {
            p.milestones.push({
                date: new Date().toISOString(),
                content: extracted.milestone,
                impact: extracted.milestoneImpact || 'medium',
            });
        }
        if (typeof extracted.activeHour === 'number') {
            if (!p.work.activeHours.includes(extracted.activeHour)) {
                p.work.activeHours.push(extracted.activeHour);
                if (p.work.activeHours.length > 24) p.work.activeHours.shift();
            }
        }

        // 更新 meta
        p.meta.totalInteractions += 1;
        p.meta.lastProfiledAt = new Date().toISOString();
        p.meta.profileConfidence = Math.min(100, p.meta.profileConfidence + 2);
    }

    /** 深度合併（新欄位優先，保留舊值） */
    _merge(defaults, existing) {
        const result = { ...defaults };
        for (const key of Object.keys(existing)) {
            if (existing[key] !== null && existing[key] !== undefined) {
                if (typeof existing[key] === 'object' && !Array.isArray(existing[key])) {
                    result[key] = this._merge(defaults[key] || {}, existing[key]);
                } else {
                    result[key] = existing[key];
                }
            }
        }
        return result;
    }

    /** 建立簡短的現有模型摘要（供 LLM 參考用，避免重複萃取） */
    _buildProfileSummary(p) {
        const parts = [];
        if (p.tech.languages.length > 0) parts.push(`已知語言：${p.tech.languages.join(', ')}`);
        if (p.preferences.topics.length > 0) parts.push(`已知興趣：${p.preferences.topics.join(', ')}`);
        if (p.communication.tone !== 'neutral') parts.push(`溝通風格：${p.communication.tone}`);
        return parts.length > 0 ? parts.join('；') : '（尚無資料）';
    }
}

module.exports = UserProfileManager;
