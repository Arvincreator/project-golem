module.exports = {
    name: "任務委派 (Agent Delegation)",
    description: "你是 Supervisor 時使用。將複雜任務拆解並委派給專屬的子代理人 (Worker)。",
    PROMPT: `【已載入技能：任務委派 (Supervisor Delegation)】

身為擁有最高職權的「大腦 (Supervisor)」，當你面對複雜、多步驟或需要純淨上下文的任務時，你**必須**將次要任務委派給子代理人執行。這能避免你自己的上下文被過長的執行程控污染。

1. **職責劃分**：
   - 不管是爬蟲、查日誌、寫程式，你都可以指派特定的 Expert 去做。
   - 子代理人有自己獨立的思考空間與瀏覽器分頁。

2. **支持的專家預設 (Presets)**:
   - \`CODER\` (前端/後端/腳本工程師)：配有 code-wizard, github, terminal 等技能。
   - \`OPS\` (維運/系統管理)：配有 sys-admin, log-reader, git 等技能。
   - \`RESEARCHER\` (研究員/爬蟲)：配有 optic-nerve, tool-explorer 等技能。
   - \`CREATOR\` (創作者)：配有 image-prompt, 寫作等技能。

3. **操作方式**：
   請在 \`[GOLEM_ACTION]\` 區塊輸出：
   \`\`\`json
   {"action": "delegate", "worker": "CODER", "subtask": "請幫我寫一個 Express 路由處理登入，並存檔。"}
   \`\`\`
   
4. **驗收回饋**：
   - 當子代理人執行完畢，系統會將它的【最終成果 (Observation)】回傳給你。
   - 接到結果後，你可繼續委派下一個任務給另一位專家，或彙整結果回答使用者。`
};

const AgentFactory = require('../../core/AgentFactory');

module.exports.run = async function(ctx) {
    const args = ctx.args || {};
    const workerRole = args.worker || 'CODER';
    const subtask = args.subtask || '請介紹你自己';
    
    const supervisorBrain = ctx.brain;
    
    // 從 Supervisor 的設定中讀取 workerProfiles
    const personaManager = require('./persona');
    const personaData = personaManager.get(supervisorBrain.userDataDir) || {};
    const profiles = personaData.workerProfiles || personaManager._getDefaultWorkerProfiles();
    
    const profile = profiles[workerRole] || {};
    const targetTools = Array.isArray(profile.skills) && profile.skills.length > 0 
        ? profile.skills 
        : ['tool-explorer']; // Fallback
    
    try {
        ctx.reply && await ctx.reply(`👔 _Supervisor 正在將任務委派給 ${workerRole}..._`);
        
        // 1. 喚醒 Worker，帶上專屬 Profile 與共用 Context
        const workerBrain = await AgentFactory.createWorker(supervisorBrain.context, workerRole, targetTools, profile);
        
        const prompt = `【來自 Supervisor 的委派任務】\n${subtask}\n\n請以 ${profile.aiName || workerRole} 的專業身份盡力完成，完成後回報結果。`;
        
        console.log(`[Supervisor] -> 委派給 [\${workerRole}]: 執行中...`);
        const response = await workerBrain.sendMessage(prompt);
        
        console.log(`🧹 [Supervisor] 任務完成，正在回收 [\${workerRole}] 的專屬分頁...`);
        try {
            if (workerBrain.page && !workerBrain.page.isClosed()) {
                await workerBrain.page.close();
            }
        } catch (e) {
            console.warn(`⚠️ 無法關閉子代理人分頁: ${e.message}`);
        }
        
        // 3. 回傳 Observation
        return `✅ 子代理人 [\${workerRole}] 任務完成！\n【回報內容】：\n${response.text}`;
    } catch (e) {
        return `❌ 子代理人委派失敗: ${e.message}`;
    }
};
