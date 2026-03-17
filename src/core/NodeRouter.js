const { CONFIG } = require('../config');
const HelpManager = require('../managers/HelpManager');
const skills = require('../skills');
const skillManager = require('../managers/SkillManager');
const SkillArchitect = require('../managers/SkillArchitect');

// ✨ [v9.1 Addon] 初始化技能架構師 (Web Gemini Mode)
// 注意：這裡不傳入 Model，因為我們將在 NodeRouter 中傳入 Web Brain
const architect = new SkillArchitect();
console.log("🏗️ [SkillArchitect] 技能架構師已就緒 (Web Mode)");

// ============================================================
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
    static async handle(ctx, brain) {
        const text = (ctx.text || "").trim();
        const isWeb = !ctx.reply; // 判斷是否為網頁端 (無原生 reply 函數)

        // 輔助函式：統一回覆邏輯
        const reply = async (message, options = {}) => {
            if (!isWeb) {
                await ctx.reply(message, options);
            }
            return message; // 網頁端直接返回字串
        };

        if (text.match(/^\/(help|menu|指令|功能)/)) {
            return await reply(await HelpManager.getManual(), { parse_mode: 'Markdown' });
        }

        if (text === '/donate' || text === '/support' || text === '贊助') {
            return await reply(`☕ **感謝您的支持！**\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
        }

        if (text === '/update' || text === '/reset') {
            if (isWeb) return await reply("⚠️ **系統更新** 功能目前僅限於機器人終端使用。");
            await ctx.reply("⚠️ **系統更新警告**\n這將強制覆蓋本地代碼。", {
                reply_markup: { inline_keyboard: [[{ text: '🔥 確認', callback_data: 'SYSTEM_FORCE_UPDATE' }, { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }]] }
            });
            return true;
        }

        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                const persona = require('../skills/core/persona');
                persona.setName('user', newName, brain.userDataDir);
                await brain.init(true); // forceReload
                return await reply(`👌 沒問題，以後稱呼您為 **${newName}**。`);
            }
        }

        // ✨ [v9.1 Feature] 學習新技能 (Web Gemini Mode)
        if (text.startsWith('/learn ')) {
            const intent = text.replace('/learn ', '').trim();
            if (!isWeb) {
                await ctx.reply(`🏗️ **Web 技能架構師啟動...**\n正在使用網頁算力為您設計：\`${intent}\``);
                await ctx.sendTyping();
            }

            try {
                const result = await architect.designSkill(brain, intent, skillManager.listSkills());
                const response = result.success
                    ? `✅ **新技能編寫完成！**\n📜 **名稱**: \`${result.name}\`\n📝 **描述**: ${result.preview}\n📂 **檔案**: \`${require('path').basename(result.path)}\`\n_現在可以直接命令我使用此功能。_`
                    : `❌ **學習失敗**: ${result.error}`;

                return await reply(response);
            } catch (e) {
                console.error(e);
                return await reply(`❌ **致命錯誤**: ${e.message}`);
            }
        }

        // ✨ [v9.1 Feature] 匯出/匯入/列表
        if (text.startsWith('/export ')) {
            try {
                const token = skillManager.exportSkill(text.replace('/export ', '').trim());
                return await reply(`📦 **技能膠囊**:\n\`${token}\``);
            } catch (e) {
                return await reply(`❌ ${e.message}`);
            }
        }

        if (text.startsWith('GOLEM_SKILL::')) {
            const res = skillManager.importSkill(text.trim());
            return await reply(res.success ? `✅ 安裝成功: ${res.name}` : `⚠️ ${res.error}`);
        }

        if (text === '/skills') {
            try {
                const SkillIndexManager = require('../managers/SkillIndexManager');
                const index = new SkillIndexManager(brain.userDataDir);
                const allSkills = await index.listAllSkills();
                await index.close();

                if (allSkills.length === 0) {
                    return await reply("📭 目前尚未安裝或同步任何技能。");
                }

                let skillMsg = "📚 **Golem 已安裝系統能力清單**:\n";
                skillMsg += allSkills.map(s => `• **${s.id}**${s.name ? ` (${s.name})` : ''}`).join('\n');
                skillMsg += "\n\n_以上能力皆已由 SQLite 索引完成，隨時待命。_";

                return await reply(skillMsg);
            } catch (e) {
                console.error("Failed to list skills from SQLite:", e);
                return await reply(`❌ **讀取技能清單失敗**: ${e.message}`);
            }
        }

        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

module.exports = NodeRouter;
