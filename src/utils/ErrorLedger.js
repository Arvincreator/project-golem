class ErrorLedger {
    constructor(chatLogManager) {
        this.db = chatLogManager;
        this._initChecked = false;
    }

    async _ensureInit() {
        if (this._initChecked) return true;
        if (!this.db || !this.db.runAsync) return false;
        try {
            await this.db.runAsync(`
                CREATE TABLE IF NOT EXISTS system_errors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER,
                    category TEXT,
                    message TEXT,
                    context TEXT
                );
            `);
            this._initChecked = true;
            return true;
        } catch (e) { return false; }
    }

    async log(category, message, context = {}) {
        if (!(await this._ensureInit())) return;
        let safeMessage = message;
        if (safeMessage && safeMessage.length > 500) {
            safeMessage = safeMessage.substring(0, 500) + '...';
        }
        try {
            await this.db.runAsync(
                `INSERT INTO system_errors (timestamp, category, message, context) VALUES (?, ?, ?, ?)`,
                [Date.now(), category, safeMessage, JSON.stringify(context)]
            );
            console.log(`📉 [ErrorLedger] 已記錄錯誤: [${category}] ${safeMessage.substring(0, 50)}`);
        } catch (e) { console.error("ErrorLedger log error:", e.message); }
    }
}
module.exports = ErrorLedger;
