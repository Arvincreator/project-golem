const MCPToolCatalog = require('../src/mcp/MCPToolCatalog');

describe('MCPToolCatalog', () => {
    test('builds action examples from input schema required fields', () => {
        const example = MCPToolCatalog.buildActionExample('github', 'create_issue', {
            type: 'object',
            required: ['repository_full_name', 'title'],
            properties: {
                repository_full_name: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
            },
        });

        expect(example).toEqual({
            action: 'mcp_call',
            server: 'github',
            tool: 'create_issue',
            parameters: {
                repository_full_name: 'owner/repo',
                title: 'Title',
            },
        });
    });

    test('normalizes cached MCP tools into a catalog', () => {
        const catalog = MCPToolCatalog.buildCatalog([
            {
                name: 'demo',
                enabled: true,
                cachedTools: [
                    {
                        name: 'search',
                        description: 'Search records',
                        inputSchema: {
                            type: 'object',
                            required: ['query'],
                            properties: { query: { type: 'string' } },
                        },
                    },
                ],
            },
        ]);

        expect(catalog.tools).toHaveLength(1);
        expect(catalog.tools[0].id).toBe('demo/search');
        expect(catalog.tools[0].example.parameters.query).toBe('search query');
    });
});
