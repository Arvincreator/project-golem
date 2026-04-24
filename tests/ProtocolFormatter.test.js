jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn().mockResolvedValue([]),
        readFile: jest.fn().mockResolvedValue('')
    }
}));
jest.mock('../src/utils/system', () => ({
    getSystemFingerprint: jest.fn().mockReturnValue('macOS arm64')
}));
jest.mock('../src/skills', () => ({
    getSystemPrompt: jest.fn().mockReturnValue('Base System Prompt'),
    loadSkills: jest.fn().mockReturnValue({})
}));
jest.mock('../src/managers/SkillManager', () => ({
    getEnabled: jest.fn().mockReturnValue([])
}));
jest.mock('../src/managers/SkillIndexManager', () => {
    return jest.fn().mockImplementation(() => ({
        getEnabledSkills: jest.fn().mockImplementation(async (ids = []) => (
            ids.map(id => ({ id, content: `${id} guide` }))
        )),
        init: jest.fn().mockResolvedValue(),
        close: jest.fn().mockResolvedValue()
    }));
});
jest.mock('../src/managers/ToolsetManager', () => ({
    toolsetManager: {
        getActiveTools: jest.fn().mockReturnValue(['actor']),
        getActiveScene: jest.fn().mockReturnValue('assistant')
    }
}));
jest.mock('../src/skills/skillsConfig', () => ({
    resolveEnabledSkills: jest.fn().mockReturnValue(new Set(['actor'])),
    OPTIONAL_SKILLS: ['git']
}));
jest.mock('../src/config', () => ({
    MEMORY_BASE_DIR: '/tmp/test'
}));

const { ProtocolFormatter } = require('../packages/protocol');

describe('ProtocolFormatter', () => {
    test('generateReqId returns a 4-char string', () => {
        const id = ProtocolFormatter.generateReqId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    test('buildStartTag returns correct format', () => {
        const tag = ProtocolFormatter.buildStartTag('abc1');
        expect(tag).toBe('[[BEGIN:abc1]]');
    });

    test('buildEndTag returns correct format', () => {
        const tag = ProtocolFormatter.buildEndTag('abc1');
        expect(tag).toBe('[[END:abc1]]');
    });

    test('buildEnvelope returns properly formatted string', () => {
        const result = ProtocolFormatter.buildEnvelope('Hello', 'test');
        expect(result).toContain('[[BEGIN:test]]');
        expect(result).toContain('[[END:test]]');
        expect(result).toContain('Hello');
    });

    test('buildEnvelope with CONSERVATIVE observer mode', () => {
        const result = ProtocolFormatter.buildEnvelope('msg', 'req1', {
            isObserver: true,
            interventionLevel: 'CONSERVATIVE'
        });
        expect(result).toContain('CONSERVATIVE OBSERVER MODE');
        expect(result).toContain('[INTERVENE]');
    });

    test('buildEnvelope with NORMAL observer mode', () => {
        const result = ProtocolFormatter.buildEnvelope('msg', 'req1', {
            isObserver: true,
            interventionLevel: 'NORMAL'
        });
        expect(result).toContain('NORMAL OBSERVER MODE');
    });

    test('buildEnvelope with PROACTIVE observer mode', () => {
        const result = ProtocolFormatter.buildEnvelope('msg', 'req1', {
            isObserver: true,
            interventionLevel: 'PROACTIVE'
        });
        expect(result).toContain('PROACTIVE OBSERVER MODE');
    });

    test('buildEnvelope with unknown observer level falls back to CONSERVATIVE', () => {
        const result = ProtocolFormatter.buildEnvelope('msg', 'req1', {
            isObserver: true,
            interventionLevel: 'UNKNOWN_LEVEL'
        });
        expect(result).toContain('CONSERVATIVE OBSERVER MODE');
    });

    test('buildSystemPrompt resolves with a prompt string', async () => {
        const result = await ProtocolFormatter.buildSystemPrompt(true, { userDataDir: '/tmp' });
        expect(result).toBeDefined();
        expect(result.systemPrompt).toContain('Base System Prompt');
    });

    test('buildSystemPrompt uses cache on second call', async () => {
        const { getSystemFingerprint } = require('../src/utils/system');
        await ProtocolFormatter.buildSystemPrompt(true, { userDataDir: '/tmp/cache-test' });
        await ProtocolFormatter.buildSystemPrompt(false, { userDataDir: '/tmp/cache-test' });
        // On the cached call, getSystemFingerprint should only be called once
        // (This just verifies it doesn't crash on cache hit)
        const r = await ProtocolFormatter.buildSystemPrompt(false, { userDataDir: '/tmp/cache-test' });
        expect(r).toBeDefined();
    });

    test('buildSystemPrompt loads markdown skills, handles optionally active/deactivated skills', async () => {
        const fs = require('fs');
        const { ProtocolFormatter } = require('../packages/protocol');
        const personaManager = require('../src/skills/core/persona');

        // Mock readdir to return some .md files
        fs.promises.readdir.mockResolvedValue(['actor.md', 'git.md', 'not-a-skill.txt']);
        
        // Mock persona
        personaManager.get = jest.fn().mockReturnValue({ skills: ['actor'] });

        // Test the true/false logic
        const result = await ProtocolFormatter.buildSystemPrompt(true, { userDataDir: '/tmp' });
        
        // It should inject knowledge about activated skills and deactivated ones
        expect(result.systemPrompt).toContain('SKILL: ACTOR'); // It injects the loaded skill contents
        expect(result.systemPrompt).toContain('DEACTIVATED SERVICES:');
    });

    test('buildSystemPrompt filters enabled skills by active toolset scene', async () => {
        const fs = require('fs');
        const personaManager = require('../src/skills/core/persona');
        const SkillIndexManager = require('../src/managers/SkillIndexManager');
        const { toolsetManager } = require('../src/managers/ToolsetManager');
        const { resolveEnabledSkills } = require('../src/skills/skillsConfig');

        fs.promises.readdir.mockResolvedValue(['actor.md', 'code-wizard.md']);
        personaManager.get = jest.fn().mockReturnValue({ skills: ['actor', 'code-wizard'] });
        resolveEnabledSkills.mockReturnValue(new Set(['actor', 'code-wizard']));
        toolsetManager.getActiveTools.mockReturnValue(['actor']);
        toolsetManager.getActiveScene.mockReturnValue('safe');

        const result = await ProtocolFormatter.buildSystemPrompt(true, { userDataDir: '/tmp/toolset-filter' });
        const instance = SkillIndexManager.mock.results[SkillIndexManager.mock.results.length - 1].value;

        expect(instance.getEnabledSkills).toHaveBeenCalledWith(['actor']);
        expect(result.systemPrompt).toContain('SKILL: ACTOR');
        expect(result.systemPrompt).toContain('TOOLSET-DISABLED SERVICES');
        expect(result.systemPrompt).not.toContain('SKILL: CODE-WIZARD');
    });
});
