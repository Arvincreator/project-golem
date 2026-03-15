const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ============================================================
// 👁️ OpticNerve (視神經 - Gemini 2.5 Flash Bridge)
// ============================================================
class OpticNerve {
    static async analyze(fileUrl, mimeType, apiKey) {
        console.log(`👁️ [OpticNerve] 正在透過 Gemini 2.5 Flash 分析檔案 (${mimeType})...`);
        try {
            const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB 上限
            const buffer = await new Promise((resolve, reject) => {
                const req = https.get(fileUrl, (res) => {
                    // 檢查 Content-Length
                    const contentLength = parseInt(res.headers['content-length'] || '0', 10);
                    if (contentLength > MAX_FILE_SIZE) {
                        req.destroy();
                        reject(new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max 20MB)`));
                        return;
                    }
                    const data = [];
                    let totalSize = 0;
                    res.on('data', (chunk) => {
                        totalSize += chunk.length;
                        if (totalSize > MAX_FILE_SIZE) {
                            req.destroy();
                            reject(new Error('File exceeded 20MB during download'));
                            return;
                        }
                        data.push(chunk);
                    });
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
                // 下載 timeout: 30 秒
                req.setTimeout(30000, () => {
                    req.destroy();
                    reject(new Error('Download timeout (30s)'));
                });
                req.on('error', reject);
            });
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
