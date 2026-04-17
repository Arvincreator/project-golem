const { toolsetManager } = require('../../managers/ToolsetManager');
const GolemBrain = require('../../core/GolemBrain');

module.exports = {
    PROMPT: require('fs').readFileSync(require('path').join(__dirname, '../lib/delegate-task.md'), 'utf8'),
    
    /**
     * @param {object} param0 
     * @param {object} param0.args
     * @param {string} param0.args.subtask
     * @param {string} param0.args.toolset
     * @param {string} [param0.args.context]
     * @param {object} param0.brain
     */
    run: async ({ args, brain }) => {
        const { subtask, toolset = 'assistant', context = '' } = args;

        if (!subtask) {
            return "❌ [DelegateTask] 缺失必要參數: subtask。";
        }

        // 確認 toolset 合法性
        const switchResult = toolsetManager.switchScene(toolset);
        if (!switchResult.success) {
            return switchResult.message;
        }

        const delegateId = `delegate_${Date.now().toString().slice(-6)}`;
        console.log(`🤖 [DelegateTask] 正在生成子智能體: ${delegateId} (工具集: ${toolset})`);

        try {
            // 建立隔離的 GolemBrain 實體
            const subBrain = new GolemBrain({
                golemId: delegateId,
                // 選項：若要完全無痕，可傳入臨時的 userDataDir
            });

            // 初始化子大腦
            await subBrain.init();

            // 如果有特定場景，我們可以透過 ToolsetManager 限制子智能體的能力
            // 由於子大腦也是共用 NodeRouter 內的 toolsetManager，
            // 這裡 switchScene 已經影響了全域，最好我們能將 toolset 隔離進 Brain，
            // 但目前的實現下，先發送一個系統指令設定子智能體的職責。
            
            const systemPrompt = `【子任務委派協議】
你現在是一個獨立運作的任務代理，標識符為 ${delegateId}。
主系統委派了以下任務給你，請運用你現有的 [${toolset}] 模式工具集來完成：

[任務描述]
${subtask}

[任務背景]
${context || '無附加背景'}

請一步步完成任務，並在最終結果出來時，以清晰的報告總結你的工作。請注意你是一個「無狀態」的代理，你必須在這次對話內完成。開始執行：`;

            // 傳送指令給子大腦，並等待結果
            console.log(`🤖 [DelegateTask] 子智能體 ${delegateId} 正在執行任務...`);
            const rawResponse = await subBrain.sendMessage(systemPrompt);
            const responseText = typeof rawResponse === 'string' ? rawResponse : rawResponse.text;

            // 如果需要，可以在這裡銷毀 subBrain 的資源，例如關閉頁面
            if (subBrain.page && !subBrain.backend !== 'ollama') {
                // 不直接關閉 page 以免影響主大腦重用，但也許該清理
                // GolemBrain v9 沒有明確的 close 方法，依賴 BrowserLauncher GC
            }

            console.log(`🤖 [DelegateTask] 子智能體 ${delegateId} 任務完成`);

            return `✅ [任務委派完成 - 來自 ${delegateId}]\n\n【子智能體報告】\n${responseText}\n\n(提示：你可以將上述重要發現透過記憶系統儲存，或者繼續你的下一步行動)`;

        } catch (e) {
            console.error(`❌ [DelegateTask] 子智能體執行失敗:`, e.message);
            return `❌ [DelegateTask] 子任務執行期間發生崩潰: ${e.message}\n你可以選擇重試或使用其它策略。`;
        }
    }
};
