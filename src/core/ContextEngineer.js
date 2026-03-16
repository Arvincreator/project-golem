// ============================================================
// ContextEngineer — Priority-based context assembly with budget management
// Manus-style section prioritization + compression + model-aware budgets
// ============================================================
const { estimateTokens } = require('./monica-constants');
const fs = require('fs');
const path = require('path');

// Model context window sizes (tokens)
const MODEL_BUDGETS = {
    'gemini-2.5-pro': 800000,
    'gemini-3-pro': 800000,
    'gemini-3.1-pro': 800000,
    'gemini-3-flash': 800000,
    'gpt-4o': 100000,
    'gpt-4o-mini': 100000,
    'gpt-4.1': 100000,
    'gpt-4.1-mini': 100000,
    'gpt-4.1-nano': 25000,
    'gpt-5.4': 100000,
    'gpt-5.3-codex': 100000,
    'claude-4.6-sonnet': 150000,
    'claude-4.5-sonnet': 150000,
    'grok-3': 100000,
    'grok-4': 100000,
};

const DEFAULT_BUDGET = 100000;

class ContextEngineer {
    constructor(options = {}) {
        this._sections = [];
        this._budget = options.budget || DEFAULT_BUDGET;
        this._reserveRatio = options.reserveRatio || 0.15; // 15% reserve for response
    }

    /**
     * Register a section with priority and options
     * Priority scale: 10=system prompt, 8=user input, 7=reflections,
     * 6=tool recs, 5=orientation, 4=knowledge, 3=history, 2=tool results, 1=background
     */
    addSection(name, content, options = {}) {
        if (!content || (typeof content === 'string' && content.trim().length === 0)) return;
        this._sections.push({
            name,
            content: String(content),
            priority: options.priority || 5,
            compressible: options.compressible || false,
            tier: options.tier || null, // Phase 2B-extra: 'filesystem' tier
            maxTokens: options.maxTokens || null,
        });
    }

    /**
     * Sort by priority, accumulate within budget, compress/truncate as needed
     * v10.0: Cleans up stale overflow files at start
     */
    assemble() {
        // v10.0: Clean overflow files older than 24 hours
        this._cleanOverflow(24);
        const effectiveBudget = Math.floor(this._budget * (1 - this._reserveRatio));
        const sorted = [...this._sections].sort((a, b) => b.priority - a.priority);

        let totalTokens = 0;
        const included = [];
        const stats = { totalTokens: 0, sectionsIncluded: 0, compressed: 0, pagedOut: 0 };

        for (const section of sorted) {
            let content = section.content;
            let tokens = estimateTokens(content);

            // Per-section maxTokens cap
            if (section.maxTokens && tokens > section.maxTokens) {
                content = this._truncateToTokens(content, section.maxTokens);
                tokens = section.maxTokens;
            }

            // Budget check
            if (totalTokens + tokens > effectiveBudget) {
                // Phase 2B-extra: filesystem tier — overflow to file instead of truncating
                if (section.tier === 'filesystem') {
                    const overflowPath = this._writeOverflow(section.name, content);
                    if (overflowPath) {
                        content = `[Context overflow: full content saved to ${overflowPath}. Use action "read_context_file" to access.]`;
                        tokens = estimateTokens(content);
                        stats.pagedOut++;
                    } else {
                        stats.pagedOut++;
                        continue;
                    }
                } else if (section.compressible) {
                    // Try compression
                    const remaining = effectiveBudget - totalTokens;
                    if (remaining > 100) {
                        content = this.compressToolResult(content, remaining);
                        tokens = estimateTokens(content);
                        stats.compressed++;
                    } else {
                        stats.pagedOut++;
                        continue;
                    }
                } else {
                    // Non-compressible: truncate hard
                    const remaining = effectiveBudget - totalTokens;
                    if (remaining > 50) {
                        content = this._truncateToTokens(content, remaining);
                        tokens = estimateTokens(content);
                    } else {
                        stats.pagedOut++;
                        continue;
                    }
                }
            }

            included.push({ name: section.name, content, tokens });
            totalTokens += tokens;
        }

        stats.totalTokens = totalTokens;
        stats.sectionsIncluded = included.length;

        // Assemble final context string
        const context = included.map(s => s.content).join('\n\n');
        return { context, stats };
    }

    /**
     * Heuristic compression for tool results and large text blocks
     * JSON → keys + first 3 values
     * Errors → first + last line
     * Text → head + tail
     */
    compressToolResult(result, maxTokens) {
        if (!result) return '';
        const currentTokens = estimateTokens(result);
        if (currentTokens <= maxTokens) return result;

        // Try JSON compression
        try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
                const compressed = {
                    _type: 'array',
                    _count: parsed.length,
                    _sample: parsed.slice(0, 3),
                };
                const out = JSON.stringify(compressed, null, 1);
                if (estimateTokens(out) <= maxTokens) return out;
            } else if (typeof parsed === 'object') {
                const keys = Object.keys(parsed);
                const compressed = {};
                for (const key of keys.slice(0, 5)) {
                    const val = parsed[key];
                    compressed[key] = typeof val === 'string' && val.length > 100
                        ? val.substring(0, 100) + '...'
                        : val;
                }
                if (keys.length > 5) compressed._remainingKeys = keys.slice(5);
                const out = JSON.stringify(compressed, null, 1);
                if (estimateTokens(out) <= maxTokens) return out;
            }
        } catch (_) { /* not JSON */ }

        // Error-style compression: first + last line
        const lines = result.split('\n');
        if (lines.length > 5 && (result.includes('Error') || result.includes('error') || result.includes('Stack'))) {
            const errorCompressed = [
                lines[0],
                `... (${lines.length - 2} lines omitted) ...`,
                lines[lines.length - 1]
            ].join('\n');
            if (estimateTokens(errorCompressed) <= maxTokens) return errorCompressed;
        }

        // Text compression: head + tail
        return this._truncateToTokens(result, maxTokens);
    }

    /**
     * LLM-assisted summarization fallback (costs 1 brain call)
     */
    async summarizeWithBrain(text, brain, maxTokens) {
        if (!brain || !brain.sendMessage) return this._truncateToTokens(text, maxTokens);
        try {
            const prompt = `Summarize the following in under ${maxTokens} tokens. Keep key facts only:\n\n${text.substring(0, 2000)}`;
            const summary = await brain.sendMessage(prompt, true);
            return typeof summary === 'string' ? summary : this._truncateToTokens(text, maxTokens);
        } catch (_) {
            return this._truncateToTokens(text, maxTokens);
        }
    }

    /**
     * Set budget based on the current model's context window
     */
    setBudgetForModel(modelName) {
        this._budget = MODEL_BUDGETS[modelName] || DEFAULT_BUDGET;
    }

    /**
     * Token estimation (delegates to monica-constants)
     */
    estimateTokens(text) {
        return estimateTokens(text);
    }

    /**
     * Truncate text to approximately fit within a token budget
     */
    _truncateToTokens(text, maxTokens) {
        if (!text) return '';
        const approxCharsPerToken = 4;
        const maxChars = maxTokens * approxCharsPerToken;
        if (text.length <= maxChars) return text;

        // Head + tail strategy
        const headSize = Math.floor(maxChars * 0.7);
        const tailSize = Math.floor(maxChars * 0.25);
        return text.substring(0, headSize) +
            `\n\n... (${text.length - headSize - tailSize} chars omitted) ...\n\n` +
            text.substring(text.length - tailSize);
    }

    /**
     * Phase 2B-extra: Write overflowed context to filesystem
     */
    _writeOverflow(sectionName, content) {
        try {
            const overflowDir = path.join(process.cwd(), 'golem_memory', 'context_overflow');
            if (!fs.existsSync(overflowDir)) {
                fs.mkdirSync(overflowDir, { recursive: true });
            }
            const filename = `${sectionName}_${Date.now()}.md`;
            const filepath = path.join(overflowDir, filename);
            fs.writeFileSync(filepath, content);
            console.log(`[ContextEngineer] Overflow written: ${filepath} (${content.length} chars)`);
            return filepath;
        } catch (e) {
            console.warn(`[ContextEngineer] Overflow write failed: ${e.message}`);
            return null;
        }
    }

    /**
     * v10.0: Clean up overflow files older than specified hours
     */
    _cleanOverflow(maxHours) {
        try {
            const overflowDir = path.join(process.cwd(), 'golem_memory', 'context_overflow');
            if (!fs.existsSync(overflowDir)) return;

            const now = Date.now();
            const maxAge = maxHours * 60 * 60 * 1000;
            const files = fs.readdirSync(overflowDir);
            for (const file of files) {
                const filePath = path.join(overflowDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxAge) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* overflow dir doesn't exist yet — fine */ }
    }

    /**
     * Reset sections for reuse
     */
    reset() {
        this._sections = [];
    }
}

// Export MODEL_BUDGETS for RouterBrain
ContextEngineer.MODEL_BUDGETS = MODEL_BUDGETS;
ContextEngineer.DEFAULT_BUDGET = DEFAULT_BUDGET;

module.exports = ContextEngineer;
