const fs = require('fs');
const os = require('os');
const path = require('path');

const personaManager = require('../src/skills/core/persona');
const CORE_DEFINITION = require('../src/skills/core/definition');

function writeMcpServers(tempRoot, servers) {
    const dataDir = path.join(tempRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
        path.join(dataDir, 'mcp-servers.json'),
        JSON.stringify(servers, null, 2),
        'utf8'
    );
}

describe('CORE_DEFINITION prompt contract', () => {
    let tempRoot;
    let cwdSpy;
    let personaSpy;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-definition-test-'));
        cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempRoot);
        personaSpy = jest.spyOn(personaManager, 'get').mockReturnValue({
            aiName: 'GolemTest',
            userName: 'Tester',
            currentRole: 'logic-first assistant',
            tone: 'precise',
            skills: [],
            isNew: false,
        });
        delete process.env.GOLEM_PROMPT_MCP_MODE;
        delete process.env.GOLEM_PROMPT_MCP_VERBOSE;
        delete process.env.GOLEM_DEBUG_PROMPT;
    });

    afterEach(() => {
        if (personaSpy) personaSpy.mockRestore();
        if (cwdSpy) cwdSpy.mockRestore();
        fs.rmSync(tempRoot, { recursive: true, force: true });
        delete process.env.GOLEM_PROMPT_MCP_MODE;
        delete process.env.GOLEM_PROMPT_MCP_VERBOSE;
        delete process.env.GOLEM_DEBUG_PROMPT;
    });

    test('contains logic-first task governance contract keywords', () => {
        const prompt = CORE_DEFINITION({
            systemFingerprint: 'macOS arm64',
            userDataDir: '/tmp/user',
        });

        expect(prompt).toContain('Core Decision Loop');
        expect(prompt).toContain('task-first');
        expect(prompt).toContain('verification.status=verified');
        expect(prompt).toContain('no fake completion');
        expect(prompt).toContain('multi_agent');
        expect(prompt).toContain('agent_session_create');
        expect(prompt).toContain('direct-chat auto mode');
        expect(prompt).toContain('executed');
        expect(prompt).toContain('not_executed');
        expect(prompt).toContain('failed');
        expect(prompt).toContain('Pending Tasks Snapshot');
        expect(prompt).toContain('Pending Agent Sessions Snapshot');
        expect(prompt).toContain('task_resume');
        expect(prompt).toContain('agent_resume');
        expect(prompt).toContain('strict synthesis gate');
        expect(prompt).toContain('humanized reporting');
    });

    test('mcpMode=compact shows summary only without tool detail list', () => {
        writeMcpServers(tempRoot, [{
            name: 'demo-server',
            command: 'node',
            args: ['server.js'],
            enabled: true,
            description: 'Demo MCP',
            cachedTools: [
                { name: 'tool_alpha', description: 'Alpha tool description' },
                { name: 'tool_beta', description: 'Beta tool description' },
            ],
        }]);

        const prompt = CORE_DEFINITION(
            { systemFingerprint: 'linux x64' },
            { mcpMode: 'compact' }
        );

        expect(prompt).toContain('**demo-server** | tools=2 | Demo MCP');
        expect(prompt).not.toContain('`tool_alpha`');
        expect(prompt).not.toContain('Alpha tool description');
    });

    test('mcpMode=verbose keeps full tool descriptions for backward compatibility', () => {
        writeMcpServers(tempRoot, [{
            name: 'demo-server',
            command: 'node',
            args: ['server.js'],
            enabled: true,
            description: 'Demo MCP',
            cachedTools: [
                { name: 'tool_alpha', description: 'Alpha tool description' },
            ],
        }]);

        const prompt = CORE_DEFINITION(
            { systemFingerprint: 'linux x64' },
            { mcpMode: 'verbose' }
        );

        expect(prompt).toContain('`tool_alpha`');
        expect(prompt).toContain('Alpha tool description');
    });

    test('mcpMode=conditional expands tool details only when debug flag is enabled', () => {
        writeMcpServers(tempRoot, [{
            name: 'demo-server',
            command: 'node',
            args: ['server.js'],
            enabled: true,
            description: 'Demo MCP',
            cachedTools: [
                { name: 'tool_alpha', description: 'Alpha tool description' },
            ],
        }]);

        const compactPrompt = CORE_DEFINITION(
            { systemFingerprint: 'linux x64' },
            { mcpMode: 'conditional' }
        );
        expect(compactPrompt).not.toContain('`tool_alpha`');

        process.env.GOLEM_PROMPT_MCP_VERBOSE = 'true';
        const verbosePrompt = CORE_DEFINITION(
            { systemFingerprint: 'linux x64' },
            { mcpMode: 'conditional' }
        );
        expect(verbosePrompt).toContain('`tool_alpha`');
    });
});
