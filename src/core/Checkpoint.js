// ============================================================
// Checkpoint — LangGraph-inspired state persistence (<20 lines)
// ============================================================
const fs = require('fs');
const CHECKPOINT_FILE = 'golem_checkpoint.json';
const MAX_AGE = 3600000; // 1 hour

module.exports = {
    save(state) {
        try {
            fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ ...state, savedAt: Date.now() }));
        } catch (e) { console.warn('[Checkpoint] Save failed:', e.message); }
    },
    load() {
        try {
            if (!fs.existsSync(CHECKPOINT_FILE)) return null;
            const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
            if (Date.now() - data.savedAt > MAX_AGE) { this.clear(); return null; }
            return data;
        } catch (e) { return null; }
    },
    clear() {
        try { fs.unlinkSync(CHECKPOINT_FILE); } catch (e) { /* not found */ }
    }
};
