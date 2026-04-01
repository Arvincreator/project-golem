class ProviderBillingAdapter {
    constructor(name = 'provider') {
        this.name = String(name || 'provider');
    }

    getName() {
        return this.name;
    }

    normalizeUsage(rawUsage = {}) {
        if (!rawUsage || typeof rawUsage !== 'object') return null;
        return null;
    }
}

class EstimateBillingAdapter extends ProviderBillingAdapter {
    constructor() {
        super('estimate');
    }

    normalizeUsage(rawUsage = {}) {
        if (!rawUsage || typeof rawUsage !== 'object') return null;

        const toNonNegative = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num) || num < 0) return 0;
            return num;
        };

        const promptTokens = toNonNegative(
            rawUsage.promptTokens ?? rawUsage.prompt_tokens ?? rawUsage.inputTokens ?? rawUsage.input_tokens
        );
        const completionTokens = toNonNegative(
            rawUsage.completionTokens ?? rawUsage.completion_tokens ?? rawUsage.outputTokens ?? rawUsage.output_tokens
        );
        let totalTokens = toNonNegative(rawUsage.totalTokens ?? rawUsage.total_tokens);
        if (totalTokens <= 0) {
            totalTokens = promptTokens + completionTokens;
        }

        const costUsd = toNonNegative(
            rawUsage.costUsd
            ?? rawUsage.cost_usd
            ?? rawUsage.estimatedCostUsd
            ?? rawUsage.estimated_cost_usd
            ?? rawUsage.usd
        );

        const model = String(rawUsage.model || rawUsage.modelName || rawUsage.providerModel || '').trim();
        const mode = String(rawUsage.mode || '').trim();
        const replace = rawUsage.absolute === true || rawUsage.replace === true || mode === 'replace';

        const hasSignal = promptTokens > 0 || completionTokens > 0 || totalTokens > 0 || costUsd > 0 || !!model;
        if (!hasSignal) return null;

        return {
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
            model,
            replace,
        };
    }
}

function createBillingAdapter(name = 'estimate') {
    const normalized = String(name || 'estimate').trim().toLowerCase();
    if (!normalized || normalized === 'estimate') {
        return new EstimateBillingAdapter();
    }

    // Placeholder for provider-grade billing integration.
    // Unknown adapters fall back to estimate mode to keep backward compatibility.
    return new EstimateBillingAdapter();
}

module.exports = {
    ProviderBillingAdapter,
    EstimateBillingAdapter,
    createBillingAdapter,
};
