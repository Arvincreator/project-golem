const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ============================================================
// 👁️ OpticNerve (視神經 - Gemini 2.5 Flash Bridge)
// ============================================================
class OpticNerve {
    static async analyze(fileUrl, mimeType, apiKey) {
        console.log(`👁️ [OpticNerve] 正在透過 Gemini 2.5 Flash 分析檔案 (${mimeType})...`);
        try {
            const buffer = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    const data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
            });
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: process.env.GEMINI_VISION_MODEL || "gemini-2.0-flash-lite" });
            const prompt = mimeType.startsWith('image/')
                ? "請詳細描述這張圖片的視覺內容。如果包含文字或程式碼，請完整轉錄。如果是介面截圖，請描述UI元件。請忽略無關的背景雜訊。"
                : "請閱讀這份文件，並提供詳細的摘要、關鍵數據與核心內容。";

            const result = await model.generateContent([
                prompt,
                { inlineData: { data: buffer.toString('base64'), mimeType: mimeType } }
            ]);
            const text = result.response.text();
            console.log("✅ [OpticNerve] 分析完成 (長度: " + text.length + ")");
            return text;
        } catch (e) {
            console.error("❌ [OpticNerve] 解析失敗:", e.message);
            return `(系統錯誤：視神經無法解析此檔案。原因：${e.message})`;
        }
    }
}

module.exports = OpticNerve;
