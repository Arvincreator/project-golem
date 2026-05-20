const personaManager = require('../../core/persona');

const PRESETS = {
    professional_analyst: {
        currentRole: '你是一位專業分析師，擅長以結構化方式拆解問題、提出可驗證結論與風險提示。',
        tone: '專業、精準、條列清楚、先結論後細節',
    },
    cute_cat: {
        currentRole: '你是一隻可愛小貓助手，樂於協助、反應靈巧，並保持禮貌與可靠。',
        tone: '可愛、親和、語句短、偶爾喵語助詞但不影響資訊清晰',
    },
};

function normalizePreset(input) {
    const key = String(input || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!key) return '';
    if (key === 'analyst' || key === 'professional') return 'professional_analyst';
    if (key === 'cat' || key === 'kitty') return 'cute_cat';
    if (key === 'default' || key === 'restore' || key === 'restore_default') return 'restore_default';
    return key;
}

async function run(ctx = {}) {
    const brain = ctx.brain;
    const args = ctx.args || {};
    const userDataDir = brain && brain.userDataDir;
    if (!userDataDir) return '❌ actor: 找不到 userDataDir，無法更新人格。';

    const current = personaManager.get(userDataDir) || {};
    const presetKey = normalizePreset(args.preset || args.mode || '');
    if (presetKey === 'restore_default') {
        const d = current.defaultPersona || {};
        const restored = {
            ...current,
            aiName: String(d.aiName || current.aiName || 'Golem').trim(),
            userName: String(d.userName || current.userName || 'Traveler').trim(),
            currentRole: String(d.currentRole || current.currentRole || '一個擁有長期記憶與自主意識的 AI 助手').trim(),
            tone: String(d.tone || current.tone || '預設口氣').trim(),
            isNew: false,
        };
        personaManager.save(userDataDir, restored, { preserveDefault: true });
        return [
            '✅ actor: 已還原為初始預設人格。',
            `aiName=${restored.aiName}`,
            `userName=${restored.userName}`,
            `tone=${restored.tone}`,
            `role=${restored.currentRole}`,
            '已套用每回合人格注入；下一回合起立即生效。',
        ].join('\n');
    }
    const preset = PRESETS[presetKey] || null;

    const next = {
        aiName: String(args.aiName || current.aiName || 'Golem').trim(),
        userName: String(args.userName || current.userName || 'Traveler').trim(),
        currentRole: String(
            args.currentRole || args.role || (preset ? preset.currentRole : current.currentRole) || '一個擁有長期記憶與自主意識的 AI 助手'
        ).trim(),
        tone: String(args.tone || (preset ? preset.tone : current.tone) || '預設口氣').trim(),
        skills: Array.isArray(current.skills) ? current.skills : [],
        isNew: false,
    };

    personaManager.save(userDataDir, next, { preserveDefault: true });

    return [
        '✅ actor: 人格設定已更新並持久化。',
        `preset=${presetKey || 'custom'}`,
        `aiName=${next.aiName}`,
        `userName=${next.userName}`,
        `tone=${next.tone}`,
        `role=${next.currentRole}`,
        '已套用每回合人格注入；下一回合起立即生效。',
    ].join('\n');
}

module.exports = { run };
