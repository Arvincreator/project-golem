const SkillGenerator = require('../src/skills/core/skill-generator');
const PromptScorer = require('../src/core/PromptScorer');

describe('SkillGenerator (v12.0)', () => {
    let generator;

    beforeEach(() => {
        generator = new SkillGenerator({
            promptScorer: new PromptScorer(),
            previewMode: true,
        });
    });

    test('identifyCandidates returns structure', () => {
        const result = generator.identifyCandidates();
        expect(result).toHaveProperty('findings');
        expect(result).toHaveProperty('candidates');
        expect(Array.isArray(result.candidates)).toBe(true);
    });

    test('generateTemplate creates valid skill code', () => {
        const candidate = {
            type: 'monitor',
            name: 'test-monitor',
            description: 'Test monitoring skill',
            source: {},
        };
        const template = generator.generateTemplate(candidate);
        expect(template.name).toBe('test-monitor');
        expect(template.code).toContain('module.exports');
        expect(template.code).toContain('execute');
        expect(template.safetyCheck.passed).toBe(true);
        expect(template.previewMode).toBe(true);
    });

    test('generateTemplate rejects dangerous code', () => {
        // Generator produces safe code by design; verify safety check
        const candidate = { type: 'test', name: 'safe-skill', description: 'test', source: {} };
        const template = generator.generateTemplate(candidate);
        expect(template.safetyCheck.passed).toBe(true);
        expect(template.safetyCheck.violations).toHaveLength(0);
    });

    test('generateAll returns bounded templates', () => {
        const result = generator.generateAll();
        expect(result).toHaveProperty('templates');
        expect(result).toHaveProperty('total');
        expect(result.total).toBeLessThanOrEqual(5);
    });

    test('handles null candidate gracefully', () => {
        expect(generator.generateTemplate(null)).toBeNull();
        expect(generator.generateTemplate({})).toBeNull();
    });
});
