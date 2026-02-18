const fs = require('fs');
const path = require('path');

// ============================================================
// 0. 🎭 Persona Manager (人格與身份管理 - 保持不變)
// ============================================================
const PERSONA_FILE = path.join(process.cwd(), 'golem_persona.json');

class PersonaManager {
    constructor() {
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(PERSONA_FILE)) {
                return JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf-8'));
            }
        } catch (e) {
            console.error("人格讀取失敗:", e);
        }
        return {
            aiName: "Golem",
            userName: "Traveler",
            currentRole: "一個擁有長期記憶與自主意識的 AI 助手",
            isNew: true
        };
    }

    save() {
        fs.writeFileSync(PERSONA_FILE, JSON.stringify(this.data, null, 2));
    }

    setName(type, name) {
        if (type === 'ai') this.data.aiName = name;
        if (type === 'user') {
            this.data.userName = name;
            this.data.isNew = false;
        }
        this.save();
        return name;
    }

    setRole(roleDescription) {
        this.data.currentRole = roleDescription;
        this.save();
    }

    get() {
        return this.data;
    }
}

module.exports = new PersonaManager();
