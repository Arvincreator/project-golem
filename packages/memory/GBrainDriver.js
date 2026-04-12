const fs = require('fs');
const path = require('path');
const { spawnSync, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { KNOWLEDGE_BASE_DIR } = require('../../src/config');
const os = require('os');

// GBrain is a bun-shebang script (#!/usr/bin/env bun).
// We must invoke it via the bun binary directly.
const BUN_BIN    = path.join(os.homedir(), '.bun', 'bin', 'bun');
const GBRAIN_BIN = path.join(os.homedir(), '.bun', 'bin', 'gbrain');

class GBrainDriver {
    constructor() {
        this.baseDir = KNOWLEDGE_BASE_DIR;
    }

    /** Build a shell command invoking gbrain via bun */
    _cmd(args) {
        return `"${BUN_BIN}" "${GBRAIN_BIN}" ${args}`;
    }

    /** Async exec helper with default timeout */
    async _exec(args, opts = {}) {
        return execAsync(this._cmd(args), { timeout: 15000, ...opts });
    }

    async init() {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
        try {
            await this._exec('init');
            console.log("🧠 [Memory:GBrain] GBrain 核心引擎已啟動 (PGLite)");
        } catch (e) {
            // gbrain init exits non-zero when already initialized — that's fine
            console.warn("⚠️ [Memory:GBrain] GBrain init: " + e.message.slice(0, 200));
        }
    }

    async recall(query, limit = 5) {
        try {
            const safeQ = query.replace(/"/g, '\\"');
            const { stdout } = await this._exec(`query "${safeQ}" --limit ${limit}`);

            if (!stdout || stdout.trim() === 'No results.') return [];

            // gbrain query text output format:
            //   [0.9123] slug -- chunk text  (stale)
            const results = [];
            for (const line of stdout.trim().split('\n')) {
                const m = line.match(/^\[([0-9.?]+)\]\s+(\S+)\s+--\s+(.*?)(\s+\(stale\))?$/);
                if (m) {
                    results.push({
                        text:     m[3].trim(),
                        score:    parseFloat(m[1]) || 1,
                        metadata: { source: m[2], stale: !!m[4] }
                    });
                }
            }
            return results.slice(0, limit);
        } catch (e) {
            console.warn("⚠️ [Memory:GBrain] Recall error:", e.message);
            return [];
        }
    }

    async memorize(text, metadata = {}) {
        try {
            const type = metadata.type || 'concept';
            const slug = `${type}/mem_${Date.now()}`;

            let md = `---\ntype: ${type}\ntitle: Auto-memorized content\ndate: ${new Date().toISOString()}\n`;
            if (metadata.source)   md += `source: ${metadata.source}\n`;
            if (metadata.category) md += `category: ${metadata.category}\n`;
            md += `---\n\n${text}\n`;

            // spawnSync passes stdin as buffer — no shell quoting issues
            const result = spawnSync(BUN_BIN, [GBRAIN_BIN, 'put', slug], {
                input:    md,
                encoding: 'utf8',
                timeout:  20000
            });

            if (result.status !== 0) {
                const out = (result.stdout || '') + (result.stderr || '');
                // bun shebang scripts may exit non-zero even on success;
                // treat as real error only if output doesn't look like success
                const isSuccess = out.includes('created') || out.includes('updated') || out.trim() === '';
                if (!isSuccess) {
                    throw new Error(out.slice(0, 300) || 'unknown error');
                }
            }
            console.log(`🧠 [Memory:GBrain] 已寫入記憶 → ${slug}`);
        } catch (e) {
            console.warn("⚠️ [Memory:GBrain] Memorize error:", e.message);
        }
    }
}

module.exports = GBrainDriver;
