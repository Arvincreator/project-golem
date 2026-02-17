const { CONFIG } = require('../config');
const HelpManager = require('../managers/HelpManager');
const skills = require('../../skills');
const SkillArchitect = require('../../skills/lib/skill-architect');
const skillManager = require('../../skills/lib/skill-manager');

// ✨ [v9.0 Addon] 初始化技能架構師 (Web Gemini Mode)
// 注意：這裡不傳入 Model，因為我們將在 NodeRouter 中傳入 Web Brain
const architect = new SkillArchitect();
console.log("🏗️ [SkillArchitect] 技能架構師已就緒 (Web Mode)");

// ============================================================
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
    static async handle(ctx, brain) {
        const text = (ctx.text || "").trim();
        if (text.match(/^\/(help|menu|指令|功能)/)) { await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' }); return true; }
        if (text === '/donate' || text === '/support' || text === '贊助') {
            await ctx.reply(`☕ **感謝您的支持！**\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
            return true;
        }
        if (text === '/update' || text === '/reset') {
            await ctx.reply("⚠️ **系統更新警告**\n這將強制覆蓋本地代碼。", {
                reply_markup: { inline_keyboard: [[{ text: '🔥 確認', callback_data: 'SYSTEM_FORCE_UPDATE' }, { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }]] }
            });
            return true;
        }
        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                skills.persona.setName('user', newName);
                await brain.init(true); // forceReload
                await ctx.reply(`👌 沒問題，以後稱呼您為 **${newName}**。`);
                return true;
            }
        }

        // ✨ [v9.0 Feature] 學習新技能 (Web Gemini Mode)
        if (text.startsWith('/learn ')) {
            const intent = text.replace('/learn ', '').trim();
            await ctx.reply(`🏗️ **Web 技能架構師啟動...**\n正在使用網頁算力為您設計：\`${intent}\``);
            await ctx.sendTyping();

            try {
                // 傳入 brain (Web Session) 讓 Architect 使用
                const existingSkills = skillManager.listSkills();
                const result = await architect.designSkill(brain, intent, existingSkills);

                if (result.success) {
                    skillManager.refresh(); // 熱重載
                    await ctx.reply(
                        `✅ **新技能編寫完成！**\n` +
                        `📜 **名稱**: \`${result.name}\`\n` +
                        `📝 **描述**: ${result.preview}\n` +
                        `📂 **檔案**: \`${path.basename(result.path)}\`\n` +
                        `_現在可以直接命令我使用此功能。_`
                    );
                } else {
                    await ctx.reply(`❌ **學習失敗**: ${result.error}`);
                }
            } catch (e) {
                console.error(e);
                await ctx.reply(`❌ **致命錯誤**: ${e.message}`);
            }
            return true;
        }

        // ✨ [v9.0 Feature] 匯出/匯入/列表
        if (text.startsWith('/export ')) {
            try {
                const token = skillManager.exportSkill(text.replace('/export ', '').trim());
                await ctx.reply(`📦 **技能膠囊**:\n\`${token}\``);
            } catch (e) { await ctx.reply(`❌ ${e.message}`); }
            return true;
        }
        if (text.startsWith('GOLEM_SKILL::')) {
            const res = skillManager.importSkill(text.trim());
            await ctx.reply(res.success ? `✅ 安裝成功: ${res.name}` : `⚠️ ${res.error}`);
            return true;
        }
        if (text === '/skills') {
            const skills = skillManager.listSkills();
            await ctx.reply(skills.length ? `📚 **已安裝**:\n${skills.map(s => `• ${s.name}`).join('\n')}` : "無自定義技能。");
            return true;
        }

        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

module.exports = NodeRouter;
