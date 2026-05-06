describe('RPG generateContent route helpers', () => {
    test('normalizeRpgOutput extracts JSON from Golem protocol replies', () => {
        const { normalizeRpgOutput } = require('../web-dashboard/routes/lib/rpgOutputNormalizer');

        const raw = `[[BEGIN:v5mz]]
[GOLEM_MEMORY]
{
  "task": "Generate 3 Wuxia text RPG concepts"
}
[GOLEM_REPLY]
[
  {
    "id": "shadow-of-the-jade-emperor",
    "genre": "武俠",
    "icon": "ph-duotone ph-crown",
    "title": { "zh-TW": "玉皇影衛", "en": "Shadow of the Jade Emperor", "ja": "玉皇の影" },
    "description": { "zh-TW": "你奉命潛入禁城。", "en": "You infiltrate the forbidden city.", "ja": "あなたは禁城に潜入する。" }
  }
]
[[END:v5mz]]`;

        const output = normalizeRpgOutput(raw);

        expect(output.trim().startsWith('[')).toBe(true);
        expect(output).not.toContain('[GOLEM_MEMORY]');
        expect(output).not.toContain('[GOLEM_REPLY]');
        expect(JSON.parse(output)[0].id).toBe('shadow-of-the-jade-emperor');
    });

    test('normalizeRpgOutput recovers JSON mistakenly emitted as GOLEM_ACTION', () => {
        const { normalizeRpgOutput } = require('../web-dashboard/routes/lib/rpgOutputNormalizer');

        const raw = `[GOLEM_MEMORY]
- 已根據背景初始化角色卡。
[GOLEM_REPLY]
正在執行相關指令，生成角色數據中...
[GOLEM_ACTION]
\`\`\`JSON
{
  "name": "青衣無名",
  "attributes": { "strength": 14, "vitality": 12, "dexterity": 18 },
  "traits": [{ "name": "青玉共鳴", "logic": "被敵意鎖定時閃避提高。" }],
  "skills": [{ "name": "踏雪無痕", "type": "active", "cost": "8 SP", "description": "短距離身法。" }],
  "equipment": { "weapon": "青玉劍 (+5)", "armor": "夜行衣 (+2)", "accessory": "密探令牌 (+1)", "items": ["乾糧"] },
  "scenario": "你在破廟醒來。"
}
\`\`\``;

        const output = normalizeRpgOutput(raw);

        expect(output.trim().startsWith('{')).toBe(true);
        expect(output).not.toContain('[GOLEM_ACTION]');
        expect(JSON.parse(output).name).toBe('青衣無名');
    });

    test('normalizeRpgOutput unwraps fenced JSON without Golem tags', () => {
        const { normalizeRpgOutput } = require('../web-dashboard/routes/lib/rpgOutputNormalizer');

        const raw = `[[BEGIN:fb6y]]
\`\`\`json
{
  "narrative": "深夜的拉巴納斯塔地下道。",
  "story_roadmap": ["第一階段", "第二階段"],
  "player_status": {
    "name": "梵恩",
    "attributes": { "strength": 12, "vitality": 10, "dexterity": 14 }
  },
  "is_dead": false
}
\`\`\`
[[END:fb6y]]`;

        const output = normalizeRpgOutput(raw);

        expect(output.trim().startsWith('{')).toBe(true);
        expect(output).not.toContain('```');
        expect(JSON.parse(output).player_status.name).toBe('梵恩');
    });

    test('buildRpgPrompt adds a hard boundary against normal chat protocol', () => {
        const { _private } = require('../web-dashboard/routes/api.rpg');

        const prompt = _private.buildRpgPrompt('Return a character JSON object.');

        expect(prompt).toContain('Text RPG web app');
        expect(prompt).toContain('Do NOT use Project Golem protocol tags');
        expect(prompt).toContain('Return a character JSON object.');
    });
});
