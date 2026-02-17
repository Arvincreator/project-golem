const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// 🩹 Patch Manager (神經補丁 - Fix Edition)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class PatchManager {
    static apply(originalCode, patch) {
        const protectedPattern = /\/\/ =+ \[KERNEL PROTECTED START\] =+([\s\S]*?)\/\/ =+ \[KERNEL PROTECTED END\] =+/g;
        let match;
        while ((match = protectedPattern.exec(originalCode)) !== null) {
            if (match[1].includes(patch.search)) throw new Error(`⛔ 權限拒絕：試圖修改系統核心禁區。`);
        }
        if (originalCode.includes(patch.search)) return originalCode.replace(patch.search, patch.replace);
        try {
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const fuzzySearch = escapeRegExp(patch.search).replace(/\s+/g, '[\\s\\n]*');
            const regex = new RegExp(fuzzySearch);
            if (regex.test(originalCode)) {
                console.log("⚠️ [PatchManager] 啟用模糊匹配模式。");
                return originalCode.replace(regex, patch.replace);
            }
        } catch (e) { console.warn("模糊匹配失敗:", e); }
        throw new Error(`❌ 找不到匹配代碼段落`);
    }
    static createTestClone(originalPath, patchContent) {
        try {
            const originalCode = fs.readFileSync(originalPath, 'utf-8');
            let patchedCode = originalCode;
            const patches = Array.isArray(patchContent) ? patchContent : [patchContent];
            patches.forEach(p => { patchedCode = this.apply(patchedCode, p); });
            const ext = path.extname(originalPath);
            const name = path.basename(originalPath, ext);
            const testFile = `${name}.test${ext}`;
            fs.writeFileSync(testFile, patchedCode, 'utf-8');
            return testFile;
        } catch (e) { throw new Error(`補丁應用失敗: ${e.message}`); }
    }
    static verify(filePath) {
        try {
            execSync(`node -c "${filePath}"`);
            if (filePath.includes('index.test.js')) {
                execSync(`node "${filePath}"`, { env: { ...process.env, GOLEM_TEST_MODE: 'true' }, timeout: 5000, stdio: 'pipe' });
            }
            console.log(`✅ [PatchManager] ${filePath} 驗證通過`);
            return true;
        } catch (e) {
            console.error(`❌ [PatchManager] 驗證失敗: ${e.message}`);
            try { fs.unlinkSync(filePath); console.log("🧹 已清理失效的測試檔案"); } catch (delErr) { }
            return false;
        }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

module.exports = PatchManager;
