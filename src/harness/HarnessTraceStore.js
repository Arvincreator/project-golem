const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalizeText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function safeReadJson(filePath, fallbackValue) {
    try {
        const text = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : fallbackValue;
    } catch (_error) {
        return fallbackValue;
    }
}

function makeTraceId() {
    return `trace_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

class HarnessTraceStore {
    constructor(options = {}) {
        this.golemId = normalizeText(options.golemId) || 'golem_A';
        this.baseDir = normalizeText(options.baseDir)
            || path.join(process.cwd(), 'logs', 'harness', 'agent-traces');
        this.rootDir = path.join(this.baseDir, this.golemId);
        this.mapPath = path.join(this.rootDir, 'trace-map.json');

        fs.mkdirSync(this.rootDir, { recursive: true });
        this.traceMap = safeReadJson(this.mapPath, {});
    }

    _persistTraceMap() {
        fs.writeFileSync(this.mapPath, JSON.stringify(this.traceMap, null, 2), 'utf8');
    }

    ensureTraceId(sessionId) {
        const key = normalizeText(sessionId);
        if (!key) {
            throw new Error('sessionId is required');
        }

        const existing = normalizeText(this.traceMap[key]);
        if (existing) {
            return existing;
        }

        const nextTraceId = makeTraceId();
        this.traceMap[key] = nextTraceId;
        this._persistTraceMap();
        return nextTraceId;
    }

    _traceFile(traceId) {
        const id = normalizeText(traceId);
        if (!id) {
            throw new Error('traceId is required');
        }

        const day = new Date().toISOString().slice(0, 10);
        const dayDir = path.join(this.rootDir, day);
        fs.mkdirSync(dayDir, { recursive: true });
        return path.join(dayDir, `${id}.jsonl`);
    }

    appendEvent(traceId, event = {}) {
        const filePath = this._traceFile(traceId);
        fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
        return filePath;
    }

    readTrace(traceId) {
        const id = normalizeText(traceId);
        if (!id) {
            return [];
        }

        const traceFileName = `${id}.jsonl`;
        const dayDirs = fs.readdirSync(this.rootDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a));

        for (const dayDir of dayDirs) {
            const candidate = path.join(this.rootDir, dayDir, traceFileName);
            if (!fs.existsSync(candidate)) {
                continue;
            }

            const lines = fs.readFileSync(candidate, 'utf8').split('\n').filter(Boolean);
            const events = [];
            for (const line of lines) {
                try {
                    events.push(JSON.parse(line));
                } catch (_error) {
                    // Skip malformed JSONL entries to keep replay robust.
                }
            }
            return events;
        }

        return [];
    }
}

module.exports = {
    HarnessTraceStore
};
