#!/usr/bin/env node

const MCPManager = require('../src/mcp/MCPManager');

function toSafeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function preview(value, maxLength = 240) {
    const text = toSafeJson(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...(truncated)`;
}

function resolveSchema(schema) {
    if (!schema || typeof schema !== 'object') return {};
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return resolveSchema(schema.oneOf[0]);
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return resolveSchema(schema.anyOf[0]);
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) return resolveSchema(schema.allOf[0]);
    return schema;
}

function pickType(typeValue) {
    if (Array.isArray(typeValue)) return typeValue.find((item) => item !== 'null') || typeValue[0];
    return typeValue;
}

function sampleFromSchema(schema, key = 'value') {
    const normalized = resolveSchema(schema);
    if (Object.prototype.hasOwnProperty.call(normalized, 'const')) return normalized.const;
    if (Array.isArray(normalized.enum) && normalized.enum.length > 0) return normalized.enum[0];

    const type = pickType(normalized.type);
    if (type === 'integer' || type === 'number') return 1;
    if (type === 'boolean') return true;
    if (type === 'array') return [];
    if (type === 'object') return {};

    if (/limit|count|top/i.test(key)) return 3;
    if (/direction/i.test(key)) return 'both';
    if (/query|keyword|q/i.test(key)) return 'project-golem verification';
    if (/entity|subject|head/i.test(key)) return 'verify_entity';
    if (/relation|predicate/i.test(key)) return 'related_to';
    if (/tail|object|target/i.test(key)) return 'project-golem';
    if (/wing/i.test(key)) return 'wing_project_golem';
    if (/room/i.test(key)) return 'verification';
    if (/content|text|note/i.test(key)) return 'verification note';
    if (/added_by|author|source|by/i.test(key)) return 'golem-verifier';
    return `verify_${key}`;
}

function buildKnownArgs(toolName, ctx) {
    const map = {
        mempalace_status: () => ({}),
        mempalace_health: () => ({}),
        mempalace_ping: () => ({}),
        mempalace_search: () => ({ query: 'project-golem verification', limit: 3 }),
        mempalace_kg_query: () => ({ entity: ctx.entity, direction: 'both' }),
        mempalace_kg_add: () => ({
            subject: ctx.entity,
            predicate: 'related_to',
            object: 'project-golem',
            source_closet: 'closet_verify',
        }),
        mempalace_add_drawer: () => ({
            wing: ctx.wing,
            room: ctx.room,
            content: `MemPalace integration verification ${new Date().toISOString()}`,
            added_by: 'golem-verifier',
            source_file: 'scripts/verify-mempalace-tools.js',
        }),
        mempalace_list_drawers: () => ({ wing: ctx.wing, room: ctx.room, limit: 10 }),
        mempalace_get_drawer: () => ({ wing: ctx.wing, room: ctx.room, index: 0 }),
    };
    const builder = map[String(toolName || '').trim()];
    return builder ? builder() : null;
}

function mergeRequiredArgs(baseArgs, tool) {
    const schema = tool && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = schema && typeof schema.properties === 'object' ? schema.properties : {};
    const propertyKeys = Object.keys(properties);
    const hasSchemaProperties = propertyKeys.length > 0;

    const merged = {};
    if (baseArgs && typeof baseArgs === 'object') {
        for (const [key, value] of Object.entries(baseArgs)) {
            if (!hasSchemaProperties || propertyKeys.includes(key)) {
                merged[key] = value;
            }
        }
    }

    for (const key of required) {
        if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
        merged[key] = sampleFromSchema(properties[key], key);
    }
    return merged;
}

function buildArgs(tool, ctx) {
    const known = buildKnownArgs(tool.name, ctx);
    if (known) return mergeRequiredArgs(known, tool);
    return mergeRequiredArgs({}, tool);
}

async function ensureMempalaceConnected(mgr) {
    const server = mgr.getServer('mempalace');
    if (!server) {
        throw new Error('MCP server "mempalace" not found in data/mcp-servers.json');
    }

    if (server.connected) return;

    if (server.enabled === false) {
        await mgr.toggleServer('mempalace', true);
    } else {
        // If marked enabled but disconnected, force a reconnect cycle.
        await mgr.toggleServer('mempalace', false);
        await mgr.toggleServer('mempalace', true);
    }

    const refreshed = mgr.getServer('mempalace');
    if (!refreshed || !refreshed.connected) {
        throw new Error('Failed to connect to "mempalace" after enable/reconnect');
    }
}

async function main() {
    const mgr = MCPManager.getInstance();
    let exitCode = 0;
    try {
        await mgr.load();
        await ensureMempalaceConnected(mgr);

        const tools = await mgr.listTools('mempalace');
        if (!Array.isArray(tools) || tools.length === 0) {
            throw new Error('No tools returned from mempalace');
        }

        const runId = Date.now();
        const ctx = {
            runId,
            wing: `wing_verify_${runId}`,
            room: 'integration',
            entity: `verify_entity_${runId}`,
        };

        const report = [];
        for (const tool of tools) {
            const name = String(tool.name || '').trim();
            const args = buildArgs(tool, ctx);
            const startedAt = Date.now();
            try {
                const result = await mgr.callTool('mempalace', name, args);
                report.push({
                    tool: name,
                    ok: true,
                    durationMs: Date.now() - startedAt,
                    args,
                    resultPreview: preview(result),
                });
                console.log(`✅ ${name} (${Date.now() - startedAt}ms)`);
            } catch (error) {
                report.push({
                    tool: name,
                    ok: false,
                    durationMs: Date.now() - startedAt,
                    args,
                    error: error && error.message ? error.message : String(error),
                });
                console.error(`❌ ${name}: ${error && error.message ? error.message : String(error)}`);
            }
        }

        const failed = report.filter((item) => !item.ok);
        const summary = {
            success: failed.length === 0,
            totalTools: report.length,
            passedTools: report.length - failed.length,
            failedTools: failed.length,
            failed: failed.map((item) => ({
                tool: item.tool,
                error: item.error,
                args: item.args,
            })),
        };

        console.log('\n=== MemPalace Verification Summary ===');
        console.log(JSON.stringify(summary, null, 2));

        if (failed.length > 0) {
            exitCode = 1;
        }
    } finally {
        if (typeof mgr._stopClient === 'function') {
            await mgr._stopClient('mempalace').catch(() => { });
        }
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error('[verify-mempalace-tools] failed:', error && error.message ? error.message : String(error));
    process.exit(1);
});
