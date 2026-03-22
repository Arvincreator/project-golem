const fs = require('fs');
const path = require('path');

// ============================================================
// 0. 🎭 Persona Manager (人格與身份管理 - 支援多 Golem 實體)
// ============================================================

class PersonaManager {
    constructor() {
        // Fallback for global usage, though golems should use getForContext
    }

    _getDefaultWorkerProfiles() {
        return {
            CODER: {
                aiName: "DevMaster",
                currentRole: "資深全端工程師",
                tone: "精準、技術導向",
                skills: ["code-wizard", "git"]
            },
            OPS: {
                aiName: "OpsBot",
                currentRole: "系統管理專家",
                tone: "嚴謹、注重安全與穩定",
                skills: ["sys-admin", "log-reader", "git"]
            },
            RESEARCHER: {
                aiName: "Researcher",
                currentRole: "資訊探索與研究員",
                tone: "客觀、細心整理",
                skills: ["optic-nerve", "tool-explorer"]
            },
            CREATOR: {
                aiName: "CreatorEngine",
                currentRole: "創意發想與視覺設計師",
                tone: "充滿創意、友善",
                skills: ["image-prompt", "tool-explorer"]
            }
        };
    }

    _getPersonaPath(userDataDir) {
        if (!userDataDir) return path.join(process.cwd(), 'golem_persona.json');
        return path.join(userDataDir, 'persona.json');
    }

    _load(userDataDir) {
        const filePath = this._getPersonaPath(userDataDir);
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (!data.workerProfiles) {
                    data.workerProfiles = this._getDefaultWorkerProfiles();
                }
                return data;
            }
        } catch (e) {
            console.error(`人格讀取失敗 (${filePath}):`, e);
        }
        return {
            aiName: "Golem",
            userName: "Traveler",
            currentRole: "一個擁有長期記憶與自主意識的 AI 助手",
            tone: "預設口氣",
            skills: [],
            isNew: true,
            workerProfiles: this._getDefaultWorkerProfiles()
        };
    }

    save(userDataDir, data) {
        const filePath = this._getPersonaPath(userDataDir);
        // Ensure directory exists
        if (userDataDir && !fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    setName(userDataDir, type, name) {
        const data = this._load(userDataDir);
        if (type === 'ai') data.aiName = name;
        if (type === 'user') {
            data.userName = name;
            data.isNew = false;
        }
        this.save(userDataDir, data);
        return name;
    }

    setRole(userDataDir, roleDescription) {
        const data = this._load(userDataDir);
        data.currentRole = roleDescription;
        this.save(userDataDir, data);
    }

    get(userDataDir) {
        return this._load(userDataDir);
    }

    exists(userDataDir) {
        return fs.existsSync(this._getPersonaPath(userDataDir));
    }
}

module.exports = new PersonaManager();
