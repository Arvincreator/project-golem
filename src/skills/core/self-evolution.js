// src/skills/core/self-evolution.js
// 熱修復工具：透過 Find & Replace 或是 Content 覆寫修改本地源碼

const fs = require('fs');
const path = require('path');

async function run(ctx) {
    const args = ctx.args || {};
    try {
        const file = args.file;
        const findStr = args.find;
        const replaceStr = args.replace;
        const newContent = args.content;

        if (!file) {
            return "❌ 錯誤：缺少 `file` 參數 (欲修改的相對路徑)。";
        }

        // 以 process.cwd() 為基準解析實體路徑，防止超出目錄
        // 注意：必須加上 path.sep，否則 /app 開頭的判斷可能誤放行 /app-extra 之類的路徑
        const cwd = process.cwd();
        const absPath = path.resolve(cwd, file);
        const cwdWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
        if (!absPath.startsWith(cwdWithSep) && absPath !== cwd) {
            return `❌ 錯誤：安全攔截，禁止操作專案目錄外的檔案 (${file})。`;
        }

        let isNewFile = false;
        if (!fs.existsSync(absPath)) {
            // 如果是純粹的替換模式但檔案不存在，則必須報錯。若為整檔覆寫，則視為建立新檔
            if (findStr) {
                return `❌ 錯誤：找不到欲修改的檔案 (${file})。`;
            }
            isNewFile = true;

            // 確保父目錄存在
            const dir = path.dirname(absPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        let fileContent = isNewFile ? "" : fs.readFileSync(absPath, 'utf8');

        if (findStr !== undefined && replaceStr !== undefined) {
            // Find & Replace Mode
            if (!fileContent.includes(findStr)) {
                return `❌ 錯誤：在目標檔案中找不到指定的 \`find\` 內容，替換失敗。請確保空白與縮排完全精確。`;
            }
            // 使用全域字串替換（split/join 確保所有符合處皆替換）
            const count = fileContent.split(findStr).length - 1;
            fileContent = fileContent.split(findStr).join(replaceStr);
            fs.writeFileSync(absPath, fileContent, 'utf8');
            return `✅ 成功：已在 ${file} 中替換了 ${count} 處內容。`;
        } else if (newContent !== undefined) {
            // Overwrite Mode
            fs.writeFileSync(absPath, newContent, 'utf8');
            return `✅ 成功：已 ${isNewFile ? '建立' : '覆寫'} ${file} (共 ${newContent.length} bytes)。`;
        } else {
            return "❌ 錯誤：必須提供 `find`/`replace` 或是 `content` 參數。";
        }

    } catch (e) {
        console.error("❌ [Self-Evolution 錯誤]:", e);
        return `❌ Evolution 失敗: ${e.message}`;
    }
}

module.exports = {
    name: "self-evolution",
    description: "熱修復與代碼修改工具",
    run: run
};

// --- ✨ CLI Entry Point ---
if (require.main === module) {
    const rawArgs = process.argv[2];
    if (!rawArgs) process.exit(1);
    try {
        const parsed = JSON.parse(rawArgs);
        const finalArgs = parsed.args || parsed;
        run({ args: finalArgs }).then(console.log).catch(console.error);
    } catch (e) {
        console.error(`❌ CLI Parse Error: ${e.message}`);
    }
}
