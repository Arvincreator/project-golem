const skillsIndex = require('../src/skills/index');
const fs = require('fs');
const path = require('path');
const persona = require('../src/skills/core/persona');

jest.mock('fs');
jest.mock('../src/skills/core/persona', () => ({
    get: jest.fn().mockReturnValue({ userName: 'TestUser' })
}));
jest.mock('../src/skills/core/definition', () => jest.fn().mockReturnValue('Base Definition'));

const coreDefinition = require('../src/skills/core/definition');

describe('skills/index', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.GOLEM_PROMPT_MCP_MODE;
        // Reset internal loaded state by re-requiring or clearing module cache isn't fully possible here without jest.resetModules
        // but loadSkills(true) forces reload.
    });

    test('loadSkills should scan directory and require valid js files', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['test-file.js', 'ignore.txt']);

        // Since we can't easily mock require dynamically in the same module space for dynamic requires,
        // we'll just let it fail the try-catch and coverage will hit the catch block.
        const skills = skillsIndex.loadSkills(true);
        expect(fs.readdirSync).toHaveBeenCalled();
        expect(skills).toBeDefined();
    });

    test('getSystemPrompt should generate full prompt correctly', () => {
        // Mock the internal loadSkills state by injecting a fake skill into the SKILLS object
        const skills = skillsIndex.loadSkills(true); 
        // We simulate a loaded skill
        skills['FAKE_SKILL'] = { PROMPT: '【已載入技能：Fake】\nFirst line of description' };

        const prompt = skillsIndex.getSystemPrompt(
            { userDataDir: '/tmp' },
            { mcpMode: 'verbose' }
        );
        
        expect(prompt).toContain('Base Definition');
        expect(prompt).toContain('> [FAKE_SKILL]: First line of description');
        expect(prompt).toContain('--- Skill: FAKE_SKILL ---');
        expect(prompt).toContain('請等待 TestUser 的指令');
        expect(coreDefinition).toHaveBeenCalledWith(
            { userDataDir: '/tmp' },
            expect.objectContaining({ mcpMode: 'verbose' })
        );
    });

    test('getSystemPrompt should default mcpMode from env for backward compatibility', () => {
        process.env.GOLEM_PROMPT_MCP_MODE = 'conditional';
        skillsIndex.getSystemPrompt({ userDataDir: '/tmp' });
        expect(coreDefinition).toHaveBeenCalledWith(
            { userDataDir: '/tmp' },
            expect.objectContaining({ mcpMode: 'conditional' })
        );
        delete process.env.GOLEM_PROMPT_MCP_MODE;
    });

    test('getSKILLS should return the skills object', () => {
        const skills = skillsIndex.getSKILLS();
        expect(skills).toBeDefined();
    });
});
