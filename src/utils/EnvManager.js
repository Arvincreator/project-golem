const fs = require('fs');
const path = require('path');

/**
 * 負責安全讀寫 .env 檔案的服務
 */
class EnvManager {
    constructor() {
        this.envPath = path.resolve(process.cwd(), '.env');
        this.examplePath = path.resolve(process.cwd(), '.env.example');
    }

    /**
     * 讀取目前的 .env 環境變數，回傳 Object
     * 此處回傳的是原始字串，包含佔位符。
     */
    readEnv() {
        if (!fs.existsSync(this.envPath)) {
            return {};
        }

        const content = fs.readFileSync(this.envPath, 'utf8');
        const envObj = {};

        content.split('\n').forEach(line => {
            // 略過純註解或空行
            if (!line || line.trim().startsWith('#')) return;

            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();

                // 移除外圍雙引號/單引號 if any
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                envObj[key] = value;
            }
        });

        return envObj;
    }

    /**
     * 更新 .env 檔案中的一個或多個變數，保留原有的註解與格式。
     * 如果檔案不存在，嘗試從 .env.example 複製一份。
     * 如果 key 不存在，附加在檔案最後。
     * 
     * @param {Object} payload { KEY: "VALUE", ... }
     */
    updateEnv(payload) {
        if (!fs.existsSync(this.envPath)) {
            if (fs.existsSync(this.examplePath)) {
                fs.copyFileSync(this.examplePath, this.envPath);
            } else {
                fs.writeFileSync(this.envPath, '', 'utf8');
            }
        }

        let content = fs.readFileSync(this.envPath, 'utf8');
        let modifications = 0;

        for (const [key, value] of Object.entries(payload)) {
            // 安全: key 只允許英數字和底線
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                console.warn(`[EnvManager] Invalid key skipped: ${key}`);
                continue;
            }
            // 安全過濾 value，防止換行注入攻擊
            const safeValue = String(value).replace(/[\r\n]/g, '');

            // 安全: 用 escapeRegExp 處理 key 中可能的特殊字元
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`^\\s*${escapedKey}=.*$`, 'm');

            // 值含空格或特殊字元時自動加引號
            const needsQuote = /[\s"'#;]/.test(safeValue);
            const quotedValue = needsQuote ? `"${safeValue.replace(/"/g, '\\"')}"` : safeValue;

            if (regex.test(content)) {
                content = content.replace(regex, `${key}=${quotedValue}`);
                modifications++;
            } else {
                if (content && !content.endsWith('\n')) {
                    content += '\n';
                }
                content += `${key}=${quotedValue}\n`;
                modifications++;
            }

            // 更新 `process.env` 這個 Node 執行緒本身的環境變數
            process.env[key] = safeValue;
        }

        if (modifications > 0) {
            fs.writeFileSync(this.envPath, content, 'utf8');
            return true;
        }

        return false;
    }
}

module.exports = new EnvManager();
