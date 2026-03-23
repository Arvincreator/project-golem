/**
 * AGoTRouter - Adaptive Graph of Thoughts 路由器
 * 負責在 O(1) 時間內，根據問題長度與特徵關鍵字，
 * 決定是否需要啟動昂貴但強大的 DAG 分解推理引擎。
 */
class AGoTRouter {
    constructor(options = {}) {
        // 設定最小長度門檻 (過短的問題通常不複雜，調降為 10 以覆蓋更多中短程複雜問句)
        this.minLengthThreshold = options.minLengthThreshold || 10;

        // 觸發深度思考的關鍵字 (正向表列)
        this.triggerKeywords = [
            '分析', '比較', '原因', '計畫', '為什麼', '推薦', 
            '評估', '優劣', '說明', '規劃', '差異', '探討',
            '利弊', '如何解決', '策略', '架構', '設計'
        ];

        // 絕對不觸發的關鍵字 (反向表列，例如打招呼、簡答題)
        this.ignoreKeywords = [
            '你好', '哈囉', '安安', '早安', '午安', '晚安',
            '今天天氣', '現在幾點', '你是誰', '謝謝', '掰掰'
        ];
    }

    /**
     * 判斷給定問題是否需要 AGoT 分解
     * @param {string} query 用戶提問
     * @returns {boolean} true 表示需要分解
     */
    shouldDecompose(query) {
        if (!query || typeof query !== 'string') return false;

        const cleanQuery = query.trim().toLowerCase();
        const length = cleanQuery.length;

        // 1. 如果有反向關鍵字，直接判定不複雜
        if (this.ignoreKeywords.some(kw => cleanQuery.includes(kw))) {
            return false;
        }

        // 2. 如果問題很長 (> 100 字)，通常隱含複雜背景，直接觸發
        if (length > 100) {
            return true;
        }

        // 3. 長度在門檻之上，且包含至少一個複雜特徵詞
        if (length >= this.minLengthThreshold) {
            for (const kw of this.triggerKeywords) {
                if (cleanQuery.includes(kw)) {
                    return true;
                }
            }
        }

        // 預設不觸發，保留算力給普通對話
        return false;
    }
}

module.exports = AGoTRouter;
