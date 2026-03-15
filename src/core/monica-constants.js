'use strict';

// ============================================================
// Monica Constants — Dual Model Registry (API / Web MAX)
// API models: verified via curl 2026-03-15
// Web models: user-confirmed usable models only (2026-03-15)
// ============================================================

// ── API Models (openapi.monica.im, independent billing) ──
const API_MODELS = {
    'gpt-4o':                    { label: 'GPT-4o',           speed: 0.90, rpm: 100,  tpm: 100000,
        strengths: { code: 0.88, creative: 0.85, analysis: 0.88, reasoning: 0.85 } },
    'gpt-4o-mini':               { label: 'GPT-4o mini',      speed: 0.95, rpm: 500,  tpm: 2000000,
        strengths: { code: 0.75, creative: 0.70, analysis: 0.72, reasoning: 0.65 } },
    'claude-3-5-haiku-20241022': { label: 'Claude 3.5 Haiku', speed: 0.92, rpm: 100,  tpm: 100000,
        strengths: { code: 0.76, creative: 0.74, analysis: 0.74, reasoning: 0.70 } },
    'gemini-1.5-flash-002':      { label: 'Gemini 1.5 Flash', speed: 0.95, rpm: 500,  tpm: 2000000,
        strengths: { code: 0.73, creative: 0.68, analysis: 0.70, reasoning: 0.60 } },
    'llama-3.3-70b-instruct':    { label: 'Llama 3.3 70B',   speed: 0.88, rpm: 50,   tpm: 300000,
        strengths: { code: 0.78, creative: 0.72, analysis: 0.75, reasoning: 0.70 } },
};

// ── Web MAX Models (Monica.im Puppeteer DOM, MAX subscription) ──
// Only user-confirmed usable models (2026-03-15)
const WEB_MODELS = {
    // ─── Advanced Tier ───
    'gpt-5.4':         { label: 'GPT-5.4',           tier: 'advanced', speed: 0.80,
        domKeywords: ['GPT-5.4'],
        strengths: { code: 0.95, creative: 0.92, analysis: 0.95, reasoning: 0.96 } },
    'gpt-5.3-codex':   { label: 'GPT-5.3 Codex',    tier: 'advanced', speed: 0.82,
        domKeywords: ['GPT-5.3 Codex', 'Codex'],
        strengths: { code: 0.96, creative: 0.70, analysis: 0.85, reasoning: 0.90 } },
    'gemini-3.1-pro':  { label: 'Gemini 3.1 Pro',   tier: 'advanced', speed: 0.88,
        domKeywords: ['Gemini 3.1 Pro'],
        strengths: { code: 0.87, creative: 0.83, analysis: 0.87, reasoning: 0.86 } },
    'gemini-3-pro':    { label: 'Gemini 3 Pro',     tier: 'advanced', speed: 0.88,
        domKeywords: ['Gemini 3 Pro'],
        strengths: { code: 0.85, creative: 0.82, analysis: 0.85, reasoning: 0.83 } },
    'claude-4.6-sonnet':  { label: 'Claude 4.6 Sonnet',  tier: 'advanced', speed: 0.85,
        domKeywords: ['Claude 4.6 Sonnet'],
        strengths: { code: 0.94, creative: 0.88, analysis: 0.93, reasoning: 0.93 } },
    'claude-4.5-sonnet':  { label: 'Claude 4.5 Sonnet',  tier: 'advanced', speed: 0.83,
        domKeywords: ['Claude 4.5 Sonnet'],
        strengths: { code: 0.92, creative: 0.86, analysis: 0.91, reasoning: 0.91 } },
    'grok-4':          { label: 'Grok 4',            tier: 'advanced', speed: 0.75,
        domKeywords: ['Grok 4'],
        strengths: { code: 0.88, creative: 0.80, analysis: 0.90, reasoning: 0.94 } },
    'grok-3':          { label: 'Grok 3',            tier: 'advanced', speed: 0.80,
        domKeywords: ['Grok 3'],
        strengths: { code: 0.84, creative: 0.78, analysis: 0.86, reasoning: 0.88 } },

    // ─── Basic Tier ───
    'gpt-4o':          { label: 'GPT-4o',            tier: 'basic', speed: 0.90,
        domKeywords: ['GPT-4o'],
        strengths: { code: 0.80, creative: 0.78, analysis: 0.80, reasoning: 0.78 } },
    'gpt-4o-mini':     { label: 'GPT-4o mini',       tier: 'basic', speed: 0.95,
        domKeywords: ['GPT-4o mini'],
        strengths: { code: 0.72, creative: 0.68, analysis: 0.70, reasoning: 0.65 } },
    'gpt-4.1':         { label: 'GPT-4.1',           tier: 'basic', speed: 0.88,
        domKeywords: ['GPT-4.1'],
        strengths: { code: 0.78, creative: 0.76, analysis: 0.78, reasoning: 0.76 } },
    'gpt-4.1-mini':    { label: 'GPT-4.1 mini',      tier: 'basic', speed: 0.95,
        domKeywords: ['GPT-4.1 mini'],
        strengths: { code: 0.72, creative: 0.68, analysis: 0.70, reasoning: 0.68 } },
    'gpt-4.1-nano':    { label: 'GPT-4.1 nano',      tier: 'basic', speed: 0.98,
        domKeywords: ['GPT-4.1 nano'],
        strengths: { code: 0.65, creative: 0.60, analysis: 0.62, reasoning: 0.58 } },
    'gpt-4':           { label: 'GPT-4',             tier: 'basic', speed: 0.85,
        domKeywords: ['GPT-4'],
        strengths: { code: 0.75, creative: 0.73, analysis: 0.75, reasoning: 0.74 } },
    'gemini-3-flash':  { label: 'Gemini 3 Flash',   tier: 'basic', speed: 0.95,
        domKeywords: ['Gemini 3 Flash'],
        strengths: { code: 0.75, creative: 0.70, analysis: 0.73, reasoning: 0.65 } },
    'gemini-2.5-pro':  { label: 'Gemini 2.5 Pro',   tier: 'basic', speed: 0.88,
        domKeywords: ['Gemini 2.5 Pro'],
        strengths: { code: 0.82, creative: 0.78, analysis: 0.82, reasoning: 0.80 } },
};

// ── Routing Rules ──
const API_ROUTING_RULES = {
    code:      'gpt-4o',
    reasoning: 'gpt-4o',
    creative:  'gpt-4o',
    fast:      'gemini-1.5-flash-002',
    analysis:  'gpt-4o',
    flexible:  'llama-3.3-70b-instruct',
};

const WEB_ROUTING_RULES = {
    code:      'claude-4.6-sonnet',
    reasoning: 'grok-4',
    creative:  'gpt-5.4',
    fast:      'gemini-3-flash',
    analysis:  'gemini-3.1-pro',
    flexible:  'gemini-2.5-pro',
};

const API_DEFAULT_MODEL = 'gpt-4o';
const WEB_DEFAULT_MODEL = 'gpt-5.4';

// ── A/B Testing Config ──
const AB_CONFIG = {
    explorationRate: 0.1,
    minSamples: 10,
    decayFactor: 0.95,
    qualityMetrics: ['responseLen', 'latencyMs', 'errorRate'],
};

// ── Helpers ──
function getModels(engine) {
    return engine === 'web' ? WEB_MODELS : API_MODELS;
}

function getRoutingRules(engine) {
    return engine === 'web' ? WEB_ROUTING_RULES : API_ROUTING_RULES;
}

function getDefaultModel(engine) {
    return engine === 'web' ? WEB_DEFAULT_MODEL : API_DEFAULT_MODEL;
}

module.exports = {
    API_MODELS, WEB_MODELS,
    API_ROUTING_RULES, WEB_ROUTING_RULES,
    API_DEFAULT_MODEL, WEB_DEFAULT_MODEL,
    AB_CONFIG,
    getModels, getRoutingRules, getDefaultModel,
};
