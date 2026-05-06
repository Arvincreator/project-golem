const express = require('express');
const { normalizeRpgOutput } = require('./lib/rpgOutputNormalizer');

function extractPrompt(body) {
    if (!body) return '';
    if (typeof body.prompt === 'string') return body.prompt;

    const contents = Array.isArray(body.contents) ? body.contents : [];
    return contents
        .flatMap((content) => Array.isArray(content && content.parts) ? content.parts : [])
        .map((part) => typeof part.text === 'string' ? part.text : '')
        .filter(Boolean)
        .join('\n');
}

function getActiveBrain(server, requestedGolemId) {
    if (requestedGolemId && server.contexts && server.contexts.has(requestedGolemId)) {
        return server.contexts.get(requestedGolemId).brain;
    }

    if (server.contexts && server.contexts.size > 0) {
        const first = server.contexts.values().next().value;
        if (first && first.brain) return first.brain;
    }

    if (typeof global.getOrCreateGolem === 'function') {
        const instance = global.getOrCreateGolem();
        return instance && instance.brain ? instance.brain : null;
    }

    return null;
}

async function generateWithBrain(brain, prompt) {
    if (typeof brain._wikiChat === 'function') {
        return brain._wikiChat(prompt);
    }

    if (typeof brain.sendMessage === 'function') {
        const result = await brain.sendMessage(prompt, false, { _rpgBypass: true });
        return typeof result === 'string' ? result : (result && result.text) || '';
    }

    throw new Error('Active Golem brain does not expose a text generation method.');
}

function buildRpgPrompt(userPrompt) {
    return `You are currently serving the Project Golem Text RPG web app, not a normal chat session.

RPG OUTPUT BOUNDARY:
- Do NOT use Project Golem protocol tags: [GOLEM_MEMORY], [GOLEM_ACTION], [GOLEM_REPLY].
- Do NOT call tools or describe actions being executed.
- Do NOT write memory notes, status narration, or assistant prefaces.
- Return only the exact format requested by the RPG prompt below.
- If the RPG prompt requests JSON, your entire response must be valid JSON only.

RPG PROMPT:
${userPrompt}`;
}

module.exports = function registerRpgRoutes(server) {
    const router = express.Router();

    router.post('/api/rpg/generateContent', async (req, res) => {
        const startedAt = Date.now();
        try {
            const prompt = extractPrompt(req.body);
            if (!prompt.trim()) {
                return res.status(400).json({ error: 'Missing prompt text.' });
            }

            const golemId = String(req.query.golemId || req.body.golemId || '').trim();
            const brain = getActiveBrain(server, golemId);
            if (!brain) {
                return res.status(503).json({ error: 'No active Golem brain is available.' });
            }

            const text = await generateWithBrain(brain, buildRpgPrompt(prompt));
            const output = normalizeRpgOutput(text);
            if (!output) {
                return res.status(502).json({ error: 'Golem returned an empty response.' });
            }

            server.broadcastLog({
                time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                msg: `[RPG] Golem generated ${output.length} chars in ${Date.now() - startedAt}ms`,
                type: 'system',
                raw: output.slice(0, 500),
                golemId: golemId || 'golem_A'
            });

            return res.json({
                candidates: [{
                    content: {
                        parts: [{ text: output }]
                    }
                }],
                model: req.query.model || 'golem',
                source: 'project-golem'
            });
        } catch (e) {
            console.error('[RPG] generateContent failed:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};

module.exports._private = {
    buildRpgPrompt,
    normalizeRpgOutput,
};
