// src/skills/core/skill-generator.js
// v12.0: Auto Skill Generator — reads scan results → generates skill templates
// Preview mode by default — requires user confirmation before injection

const fs = require('fs');
const path = require('path');

// Import DANGEROUS_PATTERNS from skill-inject for safety validation
const DANGEROUS_PATTERNS = [
    /child_process/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /process\.exit/,
    /fs\.rm\b/,
];

const SCAN_DATA_DIR = path.resolve(process.cwd(), 'data');

class SkillGenerator {
    constructor(options = {}) {
        this._promptScorer = options.promptScorer || null;
        this._previewMode = options.previewMode !== false; // default true
    }

    /**
     * Read latest scan results and identify actionable findings
     * @returns {{ findings: object[], candidates: object[] }}
     */
    identifyCandidates() {
        const findings = this._loadLatestScanFindings();
        const candidates = [];

        for (const finding of findings) {
            const text = (finding.synthesis || finding.situation || finding.content || '').toLowerCase();

            // Identify skill-worthy patterns
            if (/framework|tool|library|sdk|api/i.test(text) && /new|launch|release|update/i.test(text)) {
                candidates.push({
                    type: 'integration',
                    source: finding,
                    name: this._extractName(text, 'integration'),
                    description: `Integration skill for: ${text.substring(0, 100)}`,
                });
            }

            if (/technique|method|approach|strategy|pattern/i.test(text) && /improv|optim|enhance|better/i.test(text)) {
                candidates.push({
                    type: 'optimization',
                    source: finding,
                    name: this._extractName(text, 'optimizer'),
                    description: `Optimization skill: ${text.substring(0, 100)}`,
                });
            }

            if (/monitor|track|detect|alert|watch/i.test(text)) {
                candidates.push({
                    type: 'monitor',
                    source: finding,
                    name: this._extractName(text, 'monitor'),
                    description: `Monitoring skill: ${text.substring(0, 100)}`,
                });
            }
        }

        return { findings: findings.length, candidates };
    }

    /**
     * Generate a skill template from a candidate
     * @param {object} candidate
     * @returns {{ name, code, description, prompt, safetyCheck }}
     */
    generateTemplate(candidate) {
        if (!candidate || !candidate.name) return null;

        const safeName = candidate.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 30);
        const description = candidate.description || `Auto-generated ${candidate.type} skill`;

        // Optimize PROMPT using PromptScorer if available
        let prompt = `## ${safeName}\n${description}\n\n### 使用方式:\n\`{ "action": "${safeName}", "task": "run" }\``;
        if (this._promptScorer && this._promptScorer.nlToStructured) {
            const optimized = this._promptScorer.nlToStructured(prompt, description);
            if (optimized.scoreGain > 0) {
                prompt = optimized.structured;
            }
        }

        const code = `// Auto-generated skill: ${safeName}
// Type: ${candidate.type}
// Generated: ${new Date().toISOString()}

async function execute(args) {
    const task = args.task || 'run';

    if (task === 'run') {
        return '${safeName}: 執行中... (請自訂此技能的邏輯)';
    }

    if (task === 'status') {
        return '${safeName}: 就緒';
    }

    return '可用指令: run, status';
}

module.exports = {
    execute,
    name: '${safeName}',
    description: '${description.replace(/'/g, "\\'")}',
    PROMPT: \`${prompt.replace(/`/g, '\\`')}\`
};
`;

        // Safety validation
        const safetyCheck = { passed: true, violations: [] };
        for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(code)) {
                safetyCheck.passed = false;
                safetyCheck.violations.push(pattern.source);
            }
        }

        return {
            name: safeName,
            code,
            description,
            prompt,
            safetyCheck,
            candidate,
            previewMode: this._previewMode,
        };
    }

    /**
     * Generate all skill templates from current scan data
     * @returns {{ templates: object[], total: number }}
     */
    generateAll() {
        const { candidates } = this.identifyCandidates();
        const templates = [];

        for (const candidate of candidates.slice(0, 5)) { // Max 5 per run
            const template = this.generateTemplate(candidate);
            if (template && template.safetyCheck.passed) {
                templates.push(template);
            }
        }

        return { templates, total: templates.length };
    }

    // --- Internal ---

    _loadLatestScanFindings() {
        const findings = [];
        try {
            // Try loading from various scan data files
            const scanFiles = [
                'v114_scan_history_default.json',
                'v115_live_results.json',
            ];

            for (const file of scanFiles) {
                const filePath = path.join(SCAN_DATA_DIR, file);
                if (fs.existsSync(filePath)) {
                    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    const items = Array.isArray(raw) ? raw : [raw];
                    for (const item of items.slice(-10)) {
                        if (item.details) findings.push(item.details);
                        else findings.push(item);
                    }
                }
            }
        } catch (e) {
            // No scan data yet — ok
        }
        return findings;
    }

    _extractName(text, fallbackType) {
        // Try to extract a meaningful name from the text
        const match = text.match(/\b([a-z][a-z0-9]{2,15}(?:[-_][a-z0-9]+)*)\b/i);
        return match ? match[1].toLowerCase() : `auto-${fallbackType}-${Date.now() % 10000}`;
    }
}

module.exports = SkillGenerator;
