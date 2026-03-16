// ============================================================
// Structured Error Types for Project Golem
// ============================================================

class GolemError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'GolemError';
        this.code = options.code || 'GOLEM_ERROR';
        this.serviceId = options.serviceId || null;
        this.retryable = options.retryable || false;
        if (options.cause) this.cause = options.cause;
    }
}

class CircuitOpenError extends GolemError {
    constructor(serviceId, remainingMs, lastError) {
        super(
            `[CircuitBreaker] ${serviceId} 熔斷中 (${Math.ceil(remainingMs / 1000)}s 後重試). 最後錯誤: ${lastError || '?'}`,
            { code: 'CIRCUIT_OPEN', serviceId, retryable: false }
        );
        this.name = 'CircuitOpenError';
        this.remainingMs = remainingMs;
    }
}

class RateLimitError extends GolemError {
    constructor(serviceId, waitMs, model) {
        super(
            `[${serviceId}] Rate limit exceeded${model ? ` for ${model}` : ''}, wait ${Math.ceil(waitMs / 1000)}s`,
            { code: 'RATE_LIMIT', serviceId, retryable: true }
        );
        this.name = 'RateLimitError';
        this.waitMs = waitMs;
        this.model = model;
    }
}

class TimeoutError extends GolemError {
    constructor(serviceId, timeoutMs) {
        super(
            `[${serviceId}] Request timeout (${timeoutMs}ms)`,
            { code: 'TIMEOUT', serviceId, retryable: true }
        );
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
    }
}

class OOMError extends GolemError {
    constructor(serviceId, message) {
        super(
            `[${serviceId}] Out of memory: ${message}`,
            { code: 'OOM', serviceId, retryable: false }
        );
        this.name = 'OOMError';
    }
}

class AgentBudgetError extends GolemError {
    constructor(agentId, message) {
        super(
            `[${agentId}] Token budget exceeded: ${message}`,
            { code: 'AGENT_BUDGET', serviceId: agentId, retryable: false }
        );
        this.name = 'AgentBudgetError';
    }
}

class AgentSpawnError extends GolemError {
    constructor(message) {
        super(
            `[AgentRegistry] Spawn failed: ${message}`,
            { code: 'AGENT_SPAWN', retryable: false }
        );
        this.name = 'AgentSpawnError';
    }
}

module.exports = { GolemError, CircuitOpenError, RateLimitError, TimeoutError, OOMError, AgentBudgetError, AgentSpawnError };
