const MCPCallValidator = require('../src/mcp/MCPCallValidator');

const servers = [
    {
        name: 'github',
        enabled: true,
        cachedTools: [
            {
                name: 'create_issue',
                description: 'Create an issue',
                inputSchema: {
                    type: 'object',
                    required: ['repository_full_name', 'title'],
                    additionalProperties: false,
                    properties: {
                        repository_full_name: { type: 'string' },
                        title: { type: 'string' },
                        body: { type: 'string' },
                    },
                },
            },
        ],
    },
];

describe('MCPCallValidator', () => {
    test('accepts valid MCP calls', () => {
        const result = MCPCallValidator.validateMcpCall({
            server: 'github',
            tool: 'create_issue',
            parameters: {
                repository_full_name: 'Arvincreator/project-golem',
                title: 'Bug',
            },
        }, { servers });

        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
    });

    test('rejects missing required parameters with a usable example', () => {
        const result = MCPCallValidator.validateMcpCall({
            server: 'github',
            tool: 'create_issue',
            parameters: { title: 'Bug' },
        }, { servers });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('Missing required parameter: repository_full_name');
        expect(result.example.parameters.repository_full_name).toBe('owner/repo');
    });

    test('rejects unknown parameters when schema disallows them', () => {
        const result = MCPCallValidator.validateMcpCall({
            server: 'github',
            tool: 'create_issue',
            parameters: {
                repository_full_name: 'Arvincreator/project-golem',
                title: 'Bug',
                unexpected: true,
            },
        }, { servers });

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('Unknown parameter not allowed by schema: unexpected');
    });
});
