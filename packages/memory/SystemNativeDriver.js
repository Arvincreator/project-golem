const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { KNOWLEDGE_BASE_DIR } = require('../../src/config');

class SystemNativeDriver {
    constructor() {
        this.baseDir = KNOWLEDGE_BASE_DIR;
    }
    async init() {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        console.log("🧠 [Memory:Native] 系統原生核心已啟動");
    }
    async recall(query) {
        try {
            const memories = await this.listMemories({ includeHidden: false, includeDeleted: false, limit: 10000 });
            const textQuery = String(query || '').trim().toLowerCase();
            if (!textQuery) return memories.slice(0, 3).map((m) => ({ text: m.text, score: 1, metadata: m.metadata }));
            const keywords = textQuery.split(/\s+/).filter(Boolean);
            const results = [];
            for (const memory of memories) {
                const haystack = `${memory.text}\n${JSON.stringify(memory.metadata || {})}`.toLowerCase();
                let score = 0;
                keywords.forEach(k => { if (haystack.includes(k)) score += 1; });
                if (score > 0) results.push({ text: memory.text, score: score / keywords.length, metadata: memory.metadata });
            }
            return results.sort((a, b) => b.score - a.score).slice(0, 3);
        } catch (e) { return []; }
    }
    async memorize(text, metadata) {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        const normalized = this._normalizeMetadata(metadata || {});
        const filename = `mem_${Date.now()}_${normalized.id.replace(/[^a-zA-Z0-9_-]/g, '')}.md`;
        const filepath = path.join(this.baseDir, filename);
        const frontMatter = this._buildFrontMatter(normalized);
        fs.writeFileSync(filepath, `${frontMatter}\n${text}`, 'utf8');
    }
    async clearMemory() {
        if (!fs.existsSync(this.baseDir)) return { cleared: 0 };
        let cleared = 0;
        const entries = fs.readdirSync(this.baseDir);
        for (const name of entries) {
            if (!/^mem_\d+\.md$/i.test(name)) continue;
            const target = path.join(this.baseDir, name);
            try {
                fs.rmSync(target, { force: true });
                cleared += 1;
            } catch (_) { }
        }
        console.log(`🗑️ [Memory:Native] Cleared ${cleared} memory files`);
        return { cleared };
    }
    async addSchedule(task, time) { console.warn("⚠️ Native 模式不支援排程"); }
    async checkDueTasks() { return []; }

    async listMemories(options = {}) {
        if (!fs.existsSync(this.baseDir)) return [];
        const includeHidden = options.includeHidden === true;
        const includeDeleted = options.includeDeleted === true;
        const q = String(options.q || '').trim().toLowerCase();
        const type = String(options.type || '').trim().toLowerCase();
        const source = String(options.source || '').trim().toLowerCase();
        const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 200;
        const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;

        const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith('.md') && /^mem_/i.test(f));
        const byId = new Map();
        for (const file of files) {
            const parsed = this._parseMemoryFile(path.join(this.baseDir, file), file);
            if (!parsed) continue;
            const prev = byId.get(parsed.id);
            if (!prev || this._toTime(parsed.updatedAt) >= this._toTime(prev.updatedAt)) {
                byId.set(parsed.id, parsed);
            }
        }

        let list = Array.from(byId.values());
        if (!includeDeleted) list = list.filter((m) => m.metadata.deleted !== true);
        if (!includeHidden) list = list.filter((m) => m.visible !== false);
        if (q) list = list.filter((m) => `${m.text}\n${JSON.stringify(m.metadata || {})}`.toLowerCase().includes(q));
        if (type) list = list.filter((m) => String(m.metadata?.type || '').toLowerCase() === type);
        if (source) list = list.filter((m) => String(m.metadata?.source || '').toLowerCase() === source);
        list.sort((a, b) => this._toTime(b.updatedAt || b.createdAt) - this._toTime(a.updatedAt || a.createdAt));
        return list.slice(offset, offset + Math.max(1, Math.min(limit, 5000)));
    }

    async updateMemory(id, patch = {}) {
        const targetId = String(id || '').trim();
        if (!targetId) return { success: false, error: 'id is required' };
        const memories = await this.listMemories({ includeHidden: true, includeDeleted: false, limit: 10000 });
        const current = memories.find((m) => m.id === targetId);
        if (!current) return { success: false, error: 'Memory not found' };

        const nextVisible = patch.visible === undefined ? current.visible !== false : patch.visible !== false;
        const nextText = typeof patch.text === 'string' ? patch.text : current.text;
        const nextMetadata = this._normalizeMetadata({
            ...current.metadata,
            ...(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}),
            id: targetId,
            visible: nextVisible,
            createdAt: current.createdAt || current.metadata.createdAt,
            updatedAt: new Date().toISOString(),
            deleted: false
        });
        await this.memorize(nextText, nextMetadata);
        return { success: true };
    }

    async deleteMemory(id) {
        const targetId = String(id || '').trim();
        if (!targetId) return { success: false, error: 'id is required' };
        const memories = await this.listMemories({ includeHidden: true, includeDeleted: false, limit: 10000 });
        const current = memories.find((m) => m.id === targetId);
        if (!current) return { success: false, error: 'Memory not found' };
        const nextMetadata = this._normalizeMetadata({
            ...current.metadata,
            id: targetId,
            visible: false,
            deleted: true,
            updatedAt: new Date().toISOString()
        });
        await this.memorize(current.text, nextMetadata);
        return { success: true };
    }

    _buildFrontMatter(metadata) {
        const pairs = Object.entries(metadata || {});
        const lines = ['---'];
        for (const [k, v] of pairs) {
            if (typeof v === 'object') {
                lines.push(`${k}: ${JSON.stringify(v)}`);
                continue;
            }
            lines.push(`${k}: ${String(v)}`);
        }
        lines.push('---');
        return `${lines.join('\n')}\n`;
    }

    _parseMemoryFile(filepath, filename) {
        try {
            const raw = fs.readFileSync(filepath, 'utf8');
            const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
            const metaRaw = match ? match[1] : '';
            const text = (match ? match[2] : raw).trim();
            const metadata = {};
            for (const line of metaRaw.split('\n')) {
                const idx = line.indexOf(':');
                if (idx === -1) continue;
                const key = line.slice(0, idx).trim();
                const valueRaw = line.slice(idx + 1).trim();
                if (!key) continue;
                metadata[key] = this._coerceValue(valueRaw);
            }
            const normalized = this._normalizeMetadata(
                { ...metadata, sourceFile: filename },
                { text, sourceFile: filename }
            );
            return {
                id: normalized.id,
                text,
                score: 1,
                metadata: normalized,
                visible: normalized.visible !== false && normalized.deleted !== true,
                createdAt: normalized.createdAt,
                updatedAt: normalized.updatedAt,
                timestamp: normalized.updatedAt || normalized.createdAt,
            };
        } catch (_) {
            return null;
        }
    }

    _normalizeMetadata(metadata = {}, hints = {}) {
        const raw = (metadata && typeof metadata === 'object') ? metadata : {};
        const nowIso = new Date().toISOString();
        const createdAt = raw.createdAt || raw.date || nowIso;
        const stableId = this._buildStableId(raw, hints);
        return {
            ...raw,
            id: String(raw.id || stableId || randomUUID()),
            type: typeof raw.type === 'string' && raw.type.trim() ? raw.type : 'general',
            source: typeof raw.source === 'string' && raw.source.trim() ? raw.source : 'memory',
            visible: raw.visible !== false,
            deleted: raw.deleted === true,
            createdAt,
            updatedAt: raw.updatedAt || nowIso
        };
    }

    _buildStableId(raw = {}, hints = {}) {
        const sourceFile = typeof raw.sourceFile === 'string' && raw.sourceFile.trim()
            ? raw.sourceFile.trim()
            : (typeof hints.sourceFile === 'string' ? hints.sourceFile.trim() : '');
        const createdAt = String(raw.createdAt || raw.date || hints.createdAt || '').trim();
        const text = String(hints.text || '').trim();
        if (!sourceFile && !createdAt && !text) return '';
        const seed = `${sourceFile}|${createdAt}|${text}`;
        return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24);
    }

    _coerceValue(input) {
        const value = String(input || '').trim();
        if (!value) return '';
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        if (!Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
        if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
            try { return JSON.parse(value); } catch (_) { }
        }
        return value;
    }

    _toTime(value) {
        if (!value) return 0;
        const n = Date.parse(String(value));
        return Number.isFinite(n) ? n : 0;
    }
}

module.exports = SystemNativeDriver;
