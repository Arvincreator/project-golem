const path = require('path');
const GolemBrain = require('./GolemBrain');
const SkillIndexManager = require('../managers/SkillIndexManager');

class AgentFactory {
    /**
     * 鑄造 (實例化) 一個全新的子代理人 (Worker)
     * @param {import('playwright').BrowserContext} sharedContext - 監督者 (Supervisor) 的瀏覽器 Context，實現資源共享
     * @param {string} roleName - 代理人的角色名稱 (例如: FrontendBuilder)
     * @param {string[]} skillIds - 指派給此代理人的精確技能 ID 陣列 (例如: ['code-wizard', 'git'])
     * @param {Object} [workerProfile] - (可選) 自訂的人格設定 (aiName, currentRole, tone)
     * @returns {Promise<GolemBrain>}
     */
    static async createWorker(sharedContext, roleName, skillIds = [], workerProfile = null) {
        console.log(`🧞‍♂️ [AgentFactory] 正在召喚子代理人: ${roleName} (技能: ${skillIds.join(', ') || '無'})`);
        
        // 1. 取得指定的技能包 (靜態載入，繞過 Vector DB RAG)
        const tempIndex = new SkillIndexManager('./golem_memory');
        const assignedSkills = await tempIndex.getEnabledSkills(skillIds);
        
        const safeRoleName = roleName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        
        // 2. 實例化隔離的 GolemBrain
        const workerBrain = new GolemBrain({
            golemId: `worker_${safeRoleName}`,
            userDataDir: path.resolve(`./data/workers/${safeRoleName}`),
            sharedContext: sharedContext,
            isSubAgent: true,
            assignedSkills: assignedSkills,
            workerProfile: workerProfile
        });

        // 3. 啟動並初始化
        // 因為 isSubAgent = true，它會直接沿用 sharedContext 開新分頁 (newPage)
        await workerBrain.init();
        
        console.log(`✅ [AgentFactory] 子代理人 ${roleName} 就緒。`);
        return workerBrain;
    }
}

module.exports = AgentFactory;
