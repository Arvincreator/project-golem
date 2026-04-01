function compactText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

class PlanningIntentRouter {
    constructor(options = {}) {
        this.threshold = Number.isFinite(Number(options.threshold))
            ? Math.max(1, Math.floor(Number(options.threshold)))
            : 5;
        this.keywords = Array.isArray(options.keywords) && options.keywords.length > 0
            ? options.keywords.map((item) => String(item || '').toLowerCase())
            : [
                'plan',
                'planning',
                'roadmap',
                'phase',
                'milestone',
                'architecture',
                'orchestration',
                'multi-agent',
                'workflow',
                'refactor',
                'implement',
                'integration',
                'verification',
                'parallel',
                '測試',
                '規劃',
                '計畫',
                '里程碑',
                '架構',
                '多代理',
                '任務',
                '整合',
                '驗證',
                '重構',
                '流程',
                '自動化',
            ];
    }

    evaluate(input = {}) {
        const text = compactText(input.text || input.finalInput, '');
        const normalized = text.toLowerCase();
        const lines = text ? text.split('\n').filter((line) => line.trim().length > 0) : [];

        let score = 0;
        const reasons = [];
        const signals = {};

        if (text.length >= 180) {
            score += 2;
            reasons.push('long_request');
            signals.longRequest = true;
        } else {
            signals.longRequest = false;
        }

        if (lines.length >= 4) {
            score += 1;
            reasons.push('multi_line');
            signals.multiLine = true;
        } else {
            signals.multiLine = false;
        }

        const listMatches = text.match(/(^|\n)\s*(\d+\.|[-*])\s+/g) || [];
        if (listMatches.length >= 2) {
            score += 2;
            reasons.push('step_structure');
            signals.stepStructure = true;
        } else {
            signals.stepStructure = false;
        }

        const matchedKeywords = this.keywords.filter((keyword) => normalized.includes(keyword));
        signals.keywordHits = matchedKeywords.length;
        if (matchedKeywords.length >= 2) {
            score += 2;
            reasons.push('task_keywords');
        }

        if (matchedKeywords.length >= 4) {
            score += 1;
            reasons.push('dense_keywords');
        }

        const codeLike = /```|`[^`]+`|\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_-]+\.(js|ts|py|md|json)\b/.test(text);
        signals.codeLike = codeLike;
        if (codeLike) {
            score += 1;
            reasons.push('code_context');
        }

        const explicitPlanning = /(多代理|planning mode|plan mode|coordinator|orchestrat|phase|里程碑|規劃|計畫)/i.test(text);
        signals.explicitPlanning = explicitPlanning;
        if (explicitPlanning) {
            score += 2;
            reasons.push('explicit_planning_request');
        }

        if (input.hasAttachment === true) {
            score += 1;
            reasons.push('has_attachment');
            signals.hasAttachment = true;
        } else {
            signals.hasAttachment = false;
        }

        const usePlanning = score >= this.threshold;
        return {
            usePlanning,
            score,
            threshold: this.threshold,
            reason: reasons.length > 0 ? reasons.join(',') : 'simple_request',
            matchedKeywords: matchedKeywords.slice(0, 12),
            signals,
        };
    }
}

module.exports = PlanningIntentRouter;
