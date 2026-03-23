function resolveActiveGolemId(server, preferredId) {
    if (preferredId) return preferredId;
    if (!server || !server.contexts || server.contexts.size === 0) return null;
    return Array.from(server.contexts.keys())[0] || null;
}

function resolveActiveContext(server, preferredId) {
    const golemId = resolveActiveGolemId(server, preferredId);
    const context = golemId ? server.contexts.get(golemId) : null;
    return { golemId, context };
}

module.exports = {
    resolveActiveGolemId,
    resolveActiveContext,
};
