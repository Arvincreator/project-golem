const { SCENE_TOOLSETS } = require('../../managers/ToolsetManager');
const GolemBrain = require('../../core/GolemBrain');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

module.exports = {
    PROMPT: require('fs').readFileSync(require('path').join(__dirname, '../lib/delegate-task.md'), 'utf8'),
    
    /**
     * @param {object} param0 
     * @param {object} param0.args
     * @param {string} param0.args.subtask
     * @param {string} param0.args.toolset
     * @param {string} [param0.args.context]
     * @param {string} [param0.args.verify_cmd]
     * @param {number} [param0.args.max_retries]
     * @param {object} param0.brain
     */
    run: async ({ args, brain }) => {
        const { subtask, toolset = 'assistant', context = '', verify_cmd = null, max_retries = 3 } = args;
        const requestedToolset = String(toolset || 'assistant').toLowerCase();

        if (!subtask) {
            return "❌ [DelegateTask] 缺失必要參數: subtask。";
        }

        if (!SCENE_TOOLSETS[requestedToolset]) {
            const available = Object.keys(SCENE_TOOLSETS).join(', ');
            return `❌ 未知的場景「${requestedToolset}」。可用場景：${available}`;
        }

        const delegateId = `delegate_${Date.now().toString().slice(-6)}`;
        console.log(`🤖 [DelegateTask] 正在生成子智能體: ${delegateId} (工具集: ${requestedToolset})`);
        let subBrain = null;

        try {
            // 優先：由主腦建立同登入 context 的短生命週期 worker（新分頁）
            if (brain && typeof brain.createEphemeralWorker === 'function') {
                subBrain = await brain.createEphemeralWorker({
                    golemId: delegateId,
                    toolset: requestedToolset
                });
            } else {
                // 回退模式：建立獨立子腦（兼容舊呼叫端）
                subBrain = new GolemBrain({
                    golemId: delegateId,
                    userDataDir: brain ? brain.userDataDir : undefined,
                    toolsetScene: requestedToolset,
                    disableHistoricalMemoryInjection: true
                });
            }

            // 初始化子大腦
            await subBrain.init(true);

            const systemPrompt = `【子任務委派協議】
你現在是一個獨立運作的任務代理，標識符為 ${delegateId}。
主系統委派了以下任務給你，請運用你現有的 [${requestedToolset}] 模式工具集來完成：

[任務描述]
${subtask}

[任務背景]
${context || '無附加背景'}

請一步步完成任務，並在最終結果出來時，以清晰的報告總結你的工作。請注意你是一個「無狀態」的代理，你必須在這次對話內完成。開始執行：`;

            // 傳送指令給子大腦，並等待初步結果
            console.log(`🤖 [DelegateTask] 子智能體 ${delegateId} 正在執行任務...`);
            let rawResponse = await subBrain.sendMessage(systemPrompt);
            let responseText = typeof rawResponse === 'string' ? rawResponse : rawResponse.text;

            // 如果有設定驗證指令，進入 TDD 驗證與修復迴圈
            if (verify_cmd) {
                let attempts = 0;
                const maxAttempts = parseInt(max_retries) || 3;
                let passed = false;

                while (attempts < maxAttempts && !passed) {
                    console.log(`🧪 [DelegateTask] 子智能體 ${delegateId} 啟動自我驗證 (嘗試 ${attempts + 1}/${maxAttempts}): ${verify_cmd}`);
                    
                    try {
                        const { stdout, stderr } = await execAsync(verify_cmd, { cwd: process.cwd() });
                        console.log(`✅ [DelegateTask] 驗證成功!`);
                        responseText = responseText + `\n\n**[✅ TDD 自動驗證通過]**\n執行指令: \`${verify_cmd}\`\n未發現錯誤。`;
                        passed = true;
                    } catch (verifyError) {
                        attempts++;
                        console.warn(`⚠️ [DelegateTask] 驗證失敗 (嘗試 ${attempts}/${maxAttempts}):\n${verifyError.message}\n${verifyError.stderr}`);
                        
                        if (attempts >= maxAttempts) {
                            responseText = responseText + `\n\n**[❌ TDD 自動驗證失敗 (已達上限 ${maxAttempts} 次)]**\n在此次任務的最後嘗試中，驗證腳本仍然拋出錯誤:\n\`\`\`\n${verifyError.message}\n${verifyError.stderr || ''}\n\`\`\``;
                            break;
                        }

                        // 將錯誤拋回給子智能體要求修正
                        const fixPrompt = `【安全攔截：自動驗證失敗】\n你剛才產生的變更並未通過系統指定的驗證指令 \`${verify_cmd}\`！\n\n【錯誤日誌】:\n${verifyError.message}\n${verifyError.stderr || ''}\n\n請以這個錯誤訊息為線索，思考失敗原因並立即進行修正，完成後再次回報。`;
                        console.log(`🤖 [DelegateTask] 正在將錯誤日誌反饋給子智能體 ${delegateId} 進行自我修正...`);
                        rawResponse = await subBrain.sendMessage(fixPrompt);
                        responseText = typeof rawResponse === 'string' ? rawResponse : rawResponse.text;
                    }
                }
            }

            console.log(`🤖 [DelegateTask] 子智能體 ${delegateId} 任務結束`);

            return `✅ [任務委派完成 - 來自 ${delegateId}]\n\n【子智能體報告】\n${responseText}\n\n(提示：你可以將上述重要發現透過記憶系統儲存，或者繼續你的下一步行動)`;

        } catch (e) {
            console.error(`❌ [DelegateTask] 子智能體執行失敗:`, e.message);
            return `❌ [DelegateTask] 子任務執行期間發生崩潰: ${e.message}\n你可以選擇重試或使用其它策略。`;
        } finally {
            if (subBrain) {
                try {
                    if (typeof subBrain.dispose === 'function') {
                        await subBrain.dispose({ closeContext: false });
                    } else if (subBrain.page && typeof subBrain.page.close === 'function') {
                        await subBrain.page.close().catch(() => {});
                    }
                } catch (closeErr) {
                    console.warn(`⚠️ [DelegateTask] 子智能體 ${delegateId} 清理失敗: ${closeErr.message}`);
                }
            }
        }
    }
};
