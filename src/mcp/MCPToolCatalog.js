const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
const CATALOG_PATH = path.resolve(process.cwd(), 'golem_memory', 'mcp', 'tool-catalog.json');

function getSchemaType(schema = {}) {
    if (Array.isArray(schema.type)) return schema.type[0] || 'string';
    return schema.type || (schema.properties ? 'object' : 'string');
}

function exampleValueForSchema(schema = {}, name = 'value') {
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

    const type = getSchemaType(schema);
    if (type === 'boolean') return false;
    if (type === 'integer' || type === 'number') return 1;
    if (type === 'array') return [exampleValueForSchema(schema.items || {}, name.replace(/s$/, ''))];
    if (type === 'object') {
        const output = {};
        const properties = schema.properties || {};
        const required = Array.isArray(schema.required) ? schema.required : Object.keys(properties).slice(0, 3);
        for (const key of required) {
            output[key] = exampleValueForSchema(properties[key] || {}, key);
        }
        return output;
    }
    if (/url/i.test(name)) return 'https://example.com';
    if (/repo|repository/i.test(name)) return 'owner/repo';
    if (/path/i.test(name)) return 'path/to/file';
    if (/title/i.test(name)) return 'Title';
    if (/query|search/i.test(name)) return 'search query';
    if (/body|content|message|text/i.test(name)) return 'Text content';
    return `<${name}>`;
}

function buildExampleParameters(inputSchema = {}) {
    const properties = inputSchema.properties || {};
    const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
    const keys = required.length > 0 ? required : Object.keys(properties).slice(0, 3);
    const params = {};

    for (const key of keys) {
        params[key] = exampleValueForSchema(properties[key] || {}, key);
    }

    return params;
}

function buildActionExample(serverName, toolName, inputSchema = {}) {
    return {
        action: 'mcp_call',
        server: serverName,
        tool: toolName,
        parameters: buildExampleParameters(inputSchema),
    };
}

function normalizeTool(server, tool) {
    const inputSchema = tool.inputSchema || tool.schema || null;
    return {
        server: server.name,
        tool: tool.name,
        id: `${server.name}/${tool.name}`,
        description: tool.description || '',
        inputSchema,
        required: inputSchema && Array.isArray(inputSchema.required) ? inputSchema.required : [],
        example: buildActionExample(server.name, tool.name, inputSchema || {}),
    };
}

function readServers(configPath = DEFAULT_CONFIG_PATH) {
    try {
        if (!fs.existsSync(configPath)) return [];
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildCatalog(servers = readServers()) {
    const tools = [];
    for (const server of servers.filter(item => item && item.enabled !== false)) {
        for (const tool of server.cachedTools || []) {
            if (!tool || !tool.name) continue;
            tools.push(normalizeTool(server, tool));
        }
    }
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        tools,
    };
}

function writeCatalog(servers = readServers(), catalogPath = CATALOG_PATH) {
    const catalog = buildCatalog(servers);
    const dir = path.dirname(catalogPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
    return catalog;
}

function findTool(serverName, toolName, servers = readServers()) {
    const server = servers.find(item => item && item.enabled !== false && item.name === serverName);
    if (!server) return null;
    const tool = (server.cachedTools || []).find(item => item.name === toolName);
    return tool ? normalizeTool(server, tool) : null;
}

module.exports = {
    DEFAULT_CONFIG_PATH,
    CATALOG_PATH,
    buildCatalog,
    writeCatalog,
    findTool,
    buildActionExample,
    buildExampleParameters,
    exampleValueForSchema,
};
