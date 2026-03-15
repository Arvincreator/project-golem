// monica-constants.test.js — vitest globals mode
const {
    API_MODELS, WEB_MODELS,
    API_ROUTING_RULES, WEB_ROUTING_RULES,
    API_DEFAULT_MODEL, WEB_DEFAULT_MODEL,
    getModels, getRoutingRules, getDefaultModel,
} = require('../src/core/monica-constants');

describe('monica-constants', () => {
    describe('API_MODELS', () => {
        it('should have exactly 5 verified models', () => {
            expect(Object.keys(API_MODELS)).toHaveLength(5);
        });

        it('should include gpt-4o', () => {
            expect(API_MODELS['gpt-4o']).toBeDefined();
            expect(API_MODELS['gpt-4o'].label).toBe('GPT-4o');
        });

        it('should have strengths for each model', () => {
            for (const [id, model] of Object.entries(API_MODELS)) {
                expect(model.strengths).toBeDefined();
                expect(model.strengths.code).toBeGreaterThan(0);
                expect(model.strengths.creative).toBeGreaterThan(0);
                expect(model.strengths.analysis).toBeGreaterThan(0);
                expect(model.strengths.reasoning).toBeGreaterThan(0);
            }
        });
    });

    describe('WEB_MODELS', () => {
        it('should have exactly 16 user-confirmed models', () => {
            expect(Object.keys(WEB_MODELS)).toHaveLength(16);
        });

        it('should have 8 advanced tier models', () => {
            const advanced = Object.values(WEB_MODELS).filter(m => m.tier === 'advanced');
            expect(advanced).toHaveLength(8);
        });

        it('should have 8 basic tier models', () => {
            const basic = Object.values(WEB_MODELS).filter(m => m.tier === 'basic');
            expect(basic).toHaveLength(8);
        });

        it('should have domKeywords for each model', () => {
            for (const [id, model] of Object.entries(WEB_MODELS)) {
                expect(model.domKeywords).toBeDefined();
                expect(model.domKeywords.length).toBeGreaterThan(0);
            }
        });

        const expectedAdvanced = [
            'gpt-5.4', 'gpt-5.3-codex', 'gemini-3.1-pro', 'gemini-3-pro',
            'claude-4.6-sonnet', 'claude-4.5-sonnet', 'grok-4', 'grok-3',
        ];
        expectedAdvanced.forEach(id => {
            it(`should include advanced model: ${id}`, () => {
                expect(WEB_MODELS[id]).toBeDefined();
                expect(WEB_MODELS[id].tier).toBe('advanced');
            });
        });

        const expectedBasic = [
            'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini',
            'gpt-4.1-nano', 'gpt-4', 'gemini-3-flash', 'gemini-2.5-pro',
        ];
        expectedBasic.forEach(id => {
            it(`should include basic model: ${id}`, () => {
                expect(WEB_MODELS[id]).toBeDefined();
                expect(WEB_MODELS[id].tier).toBe('basic');
            });
        });
    });

    describe('routing rules', () => {
        it('API routing should reference valid API models', () => {
            for (const model of Object.values(API_ROUTING_RULES)) {
                expect(API_MODELS[model]).toBeDefined();
            }
        });

        it('WEB routing should reference valid WEB models', () => {
            for (const model of Object.values(WEB_ROUTING_RULES)) {
                expect(WEB_MODELS[model]).toBeDefined();
            }
        });

        it('should have all 6 routing dimensions', () => {
            const dims = ['code', 'reasoning', 'creative', 'fast', 'analysis', 'flexible'];
            dims.forEach(d => {
                expect(API_ROUTING_RULES[d]).toBeDefined();
                expect(WEB_ROUTING_RULES[d]).toBeDefined();
            });
        });
    });

    describe('helpers', () => {
        it('getModels(api) returns API_MODELS', () => {
            expect(getModels('api')).toBe(API_MODELS);
        });

        it('getModels(web) returns WEB_MODELS', () => {
            expect(getModels('web')).toBe(WEB_MODELS);
        });

        it('getDefaultModel returns correct defaults', () => {
            expect(getDefaultModel('api')).toBe('gpt-4o');
            expect(getDefaultModel('web')).toBe('gpt-5.4');
        });
    });
});
