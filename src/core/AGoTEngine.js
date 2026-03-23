const { v4: uuidv4 } = require('uuid');

/**
 * AGoTEngine - Adaptive Graph of Thoughts 核心引擎
 * 負責將複雜問題分解成 DAG 子問題並行/依序求解，再合成最終答案。
 */
class AGoTEngine {
    constructor(brain) {
        this.brain = brain;
        this.MAX_DEPTH = 1; // 預設最大遞迴深度 (避免發散過大)
        this.MAX_CHILDREN = 3; // 預設最多拆成 3 個子問題
    }

    /**
     * 主入口，執行 AGoT
     * @param {string} originalQuery 原始提問
     * @param {object} ctx UniversalContext (用於回報進度)
     */
    async run(originalQuery, ctx = null) {
        console.log("🕸️ [AGoT] 啟動 DAG 推理引擎");

        if (ctx) {
            await ctx.reply("🕸️ **[系統推論]** 偵測到複雜問題，正在展開自我思考網絡 (DAG)...\n*(請稍候，AGoT 分析中)*", { parse_mode: 'Markdown' });
        }

        const rootNode = {
            id: 'root',
            query: originalQuery,
            depth: 0,
            status: 'RUNNING' // PENDING | RUNNING | DONE
        };

        const result = await this._executeNode(rootNode, ctx);

        console.log("🕸️ [AGoT] DAG 推理完成！");
        return result;
    }

    /**
     * 執行單一節點：先判斷是否需繼續拆分，若是則平行拆分，最終匯總。
     */
    async _executeNode(node, ctx) {
        // 如果超過深度，或者此節點不被判斷為複雜，則直接求解 (Leaf)
        let subQueries = [];
        if (node.depth < this.MAX_DEPTH) {
            subQueries = await this._decompose(node.query);
        }

        if (subQueries.length === 0) {
            // Leaf Node: 直接求解
            console.log(`[AGoT | Depth ${node.depth}] 葉節點直接求解: ${node.query.substring(0, 30)}...`);
            const response = await this.brain.sendMessage(`【系統排程任務：分析子問題】\n${node.query}`, false);
            return response.text || response.reply || "";
        }

        // Branch Node: 開始平行求解子節點
        console.log(`[AGoT | Depth ${node.depth}] 節點拆解為 ${subQueries.length} 個子問題，準備平行/依序執行...`);
        
        let progressMsgId = null;
        if (ctx && ctx.platform === 'telegram') {
            try {
                const msg = await ctx.reply(`🕸️ 正在拆解並平行運算 ${subQueries.length} 個子問題...`);
                progressMsgId = msg.message_id;
            } catch (e) {
                // ignore
            }
        }

        const childPromises = subQueries.map((subQuery, index) => {
            const childNode = {
                id: `${node.id}_${index}`,
                query: subQuery,
                depth: node.depth + 1,
                status: 'RUNNING'
            };
            return this._executeNode(childNode, ctx).then(res => ({
                query: subQuery,
                answer: res
            }));
        });

        // 等待所有子節點完成
        const childResults = await Promise.all(childPromises);

        if (progressMsgId && ctx && ctx.platform === 'telegram') {
            try {
                await ctx.instance.editMessageText(`🕸️ 子節點運算完畢！正在聚合合成最終答案...`, {
                    chat_id: ctx.chatId,
                    message_id: progressMsgId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [] }
                });
            } catch (e) {
                // ignore
            }
        }

        // Aggregate
        console.log(`[AGoT | Depth ${node.depth}] 所有子問題已解答，進行答案聚合...`);
        const finalAnswer = await this._aggregate(node.query, childResults);
        return finalAnswer;
    }

    /**
     * 呼叫 LLM 進行問題分解。
     * @param {string} query 
     * @returns {Promise<string[]>} 子問題字串陣列 (空陣列代表不需分解)
     */
    async _decompose(query) {
        const prompt = `【系統指令：思維網絡分解器 (AGoT Decomposer)】
你需要判斷以下複雜問題是否適合切分成多個子問題。
1. 若問題足夠單純，不需分解，請直接回覆 "SIMPLE"。
2. 若問題複雜，請將其拆解為最多 ${this.MAX_CHILDREN} 個子問題 (請採用 JSON 陣列格式)。這些子問題應該要能涵蓋原始問題的核心。

問題：「${query}」

請確保你只回覆 JSON 陣列或 "SIMPLE"，不要夾雜任何 Markdown 標記，例如 \`\`\`json 等。
範例輸出:
["台灣半導體產業的核心技術優勢是什麼？", "全球地緣政治對台灣供應鏈有何影響？"]`;

        try {
            const response = await this.brain.sendMessage(prompt, false);
            let rawText = response.text || response.reply || "";
            
            // 清理可能的 Markdown 標籤
            rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

            if (rawText.toUpperCase().includes('SIMPLE') && !rawText.includes('[')) {
                return [];
            }

            // 嘗試智能提取 JSON 陣列，忽略前後對話廢話
            const startIndex = rawText.indexOf('[');
            const endIndex = rawText.lastIndexOf(']');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                rawText = rawText.substring(startIndex, endIndex + 1);
            }

            const parsed = JSON.parse(rawText);
            if (Array.isArray(parsed)) {
                return parsed.slice(0, this.MAX_CHILDREN);
            }
            return [];
        } catch (e) {
            console.warn(`⚠️ [AGoT] Decompose 解析失敗，退化至單節點執行: ${e.message}`);
            return [];
        }
    }

    /**
     * 將多個子問題的答案合成最終答案。
     */
    async _aggregate(originalQuery, childResults) {
        let resultsContext = "";
        childResults.forEach((child, idx) => {
            resultsContext += `[子問題 ${idx + 1}] ${child.query}\n回報：${child.answer}\n\n`;
        });

        const prompt = `【系統指令：多模態網絡聚合器 (AGoT Aggregator)】
你已經透過網絡拆解並解決了若干子問題。現在，請利用這些子問題提供的資訊，來回答使用者的【原始複雜提問】。
請將資訊去蕪存菁，撰寫出一篇完整、具備深度且連貫的最終回覆。若子問題答案內容有矛盾，請幫忙分析釐清。

【子問題回報清單】
${resultsContext}

【原始複雜提問】
${originalQuery}

請根據上述材料產出你的最終回覆：`;

        try {
            const response = await this.brain.sendMessage(prompt, false);
            return response.text || response.reply || "";
        } catch (e) {
            console.warn(`⚠️ [AGoT] 聚合失敗，回傳半成品: ${e.message}`);
            return "無法合成完整答案，底層推斷錯誤。";
        }
    }
}

module.exports = AGoTEngine;
