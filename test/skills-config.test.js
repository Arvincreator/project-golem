// skills-config.test.js — vitest globals mode
const { MANDATORY_SKILLS, OPTIONAL_SKILLS, resolveEnabledSkills } = require('../src/skills/skillsConfig');
const fs = require('fs');
const path = require('path');

describe('skillsConfig', () => {
    it('should have 11 mandatory skills', () => {
        expect(MANDATORY_SKILLS).toHaveLength(11);
    });

    it('mandatory skills should match actual files', () => {
        const skillDir = path.resolve(__dirname, '../src/skills/core');
        for (const skill of MANDATORY_SKILLS) {
            const filePath = path.join(skillDir, `${skill}.js`);
            expect(fs.existsSync(filePath), `Missing skill file: ${skill}.js`).toBe(true);
        }
    });

    it('resolveEnabledSkills returns all mandatory plus valid optional', () => {
        const result = resolveEnabledSkills('moltbot', []);
        expect(result.has('model-router')).toBe(true);
        expect(result.has('persona')).toBe(true);
        expect(result.has('moltbot')).toBe(true);
    });

    it('resolveEnabledSkills ignores empty strings', () => {
        const result = resolveEnabledSkills('', []);
        expect(result.size).toBe(MANDATORY_SKILLS.length);
    });

    it('resolveEnabledSkills deduplicates', () => {
        const result = resolveEnabledSkills('model-router,persona', []);
        expect(result.size).toBe(MANDATORY_SKILLS.length);
    });
});
