const fs = require('fs').promises;
const path = require('path');

// ============================================================
// 🪞 Introspection (內省模組)
// ============================================================

// ==================== [KERNEL PROTECTED START] ====================
// ⚠️ WARNING: This section is critical for the agent's self-awareness.
// Modification of this block may result in loss of introspection capabilities.

class Introspection {
    constructor() {
        // 定義忽略清單，避免 AI 讀取到系統垃圾或敏感設定檔
        this.ignoreList = [
            'node_modules', '.git', '.env'
        ];
    }

    /**
     * [CORE] 讀取 Golem 的核心原始碼
     * 這是 AI 理解自身架構的關鍵入口
     */
    async readCore() {
        try {
            // 定義核心檔案清單 (加入 Executor 以便讓 AI 理解自己的手腳)
            const coreFiles = ['index.js', 'skills.js', 'src/core/Executor.js'];

            let combinedSource = "";

            for (const file of coreFiles) {
                const filePath = path.join(process.cwd(), file);
                try {
                    let content = await fs.readFile(filePath, 'utf-8');

                    // 🛡️ [SECURITY] 動態遮蔽敏感資訊
                    // 防止 AI 在輸出日誌時意外洩漏 API Key
                    content = content
                        .replace(/(TOKEN|KEY|PASSWORD|SECRET)\s*[:=]\s*['"`][^'"`]+['"`]/gi, '$1: "[REDACTED]"');

                    combinedSource += `\n=== [FILE: ${file}] ===\n${content}\n`;
                } catch (err) {
                    // 檔案可能不存在 (例如還沒建立 skills.js)，跳過即可
                }
            }

            return combinedSource;
        } catch (e) {
            return `❌ [Introspection Error] 無法讀取核心代碼: ${e.message}`;
        }
    }

    /**
     * [CORE] 取得專案完整檔案結構
     * 讓 AI 知道除了核心檔案外，還有哪些工具可用
     */
    async getStructure(dir = process.cwd(), depth = 2) {
        if (depth < 0) return { type: '...' };

        const structure = {};
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (this.ignoreList.includes(entry.name)) continue;

                if (entry.isDirectory()) {
                    structure[entry.name] = await this.getStructure(path.join(dir, entry.name), depth - 1);
                } else {
                    structure[entry.name] = 'file';
                }
            }
            return structure;
        } catch (e) {
            return { error: e.message };
        }
    }

    /**
     * [CORE] 讀取任意指定檔案 (含安全檢查)
     * @param {string} relativePath 
     */
    async readFile(relativePath) {
        // 安全性檢查：禁止讀取上一層目錄 (..)
        if (relativePath.includes('..') || path.isAbsolute(relativePath)) {
            throw new Error("Access Denied: Illegal path traversal.");
        }

        const targetPath = path.join(process.cwd(), relativePath);

        // 再次檢查是否在忽略清單中
        if (this.ignoreList.some(ignore => targetPath.includes(ignore))) {
            throw new Error("Access Denied: File is in ignore list.");
        }

        try {
            return await fs.readFile(targetPath, 'utf-8');
        } catch (e) {
            throw new Error(`File not found: ${relativePath}`);
        }
    }

    /**
     * [CORE] 讀取路由代碼以提取指令
     */
    async readSelf() {
        const routerPath = path.join(process.cwd(), 'src', 'core', 'NodeRouter.js');
        try {
            return await fs.readFile(routerPath, 'utf-8');
        } catch (e) {
            return "";
        }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

module.exports = new Introspection();
