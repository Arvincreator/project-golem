const fs = require('fs');
const path = require('path');

// ============================================================
// 🪞 Introspection (內省模組)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class Introspection {
    static readSelf() {
        try {
            // Updated to point to the main entry point
            const mainPath = path.join(process.cwd(), 'index.js');
            let main = fs.readFileSync(mainPath, 'utf-8');
            main = main.replace(/TOKEN: .*,/, 'TOKEN: "HIDDEN",').replace(/API_KEYS: .*,/, 'API_KEYS: "HIDDEN",');
            let skills = "";
            try { skills = fs.readFileSync(path.join(process.cwd(), 'skills.js'), 'utf-8'); } catch (e) { }
            return `=== index.js ===\n${main}\n\n=== skills.js ===\n${skills}`;
        } catch (e) { return `無法讀取自身代碼: ${e.message}`; }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

module.exports = Introspection;
