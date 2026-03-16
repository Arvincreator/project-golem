// src/core/BrainFactory.js
// Selects brain engine based on env GOLEM_BRAIN_ENGINE or golem-config.xml
// Supported engines: puppeteer, sdk, monica (API), monica-web (Puppeteer), ollama, router

// v10.5: Initialize shared RAGProvider for non-router brains
function _initRAGProvider(options) {
    try {
        const path = require('path');
        const EmbeddingProvider = require('../memory/EmbeddingProvider');
        const VectorStore = require('../memory/VectorStore');
        const RAGProvider = require('../memory/RAGProvider');

        const ep = new EmbeddingProvider();
        const userDataDir = options.userDataDir || './golem_memory';
        const vsPath = path.resolve(userDataDir, 'vectors.db');
        const vs = new VectorStore(vsPath, ep);

        let magma = null;
        try { magma = require('../memory/graph/ma_gma'); } catch (e) { /* optional */ }

        const rag = new RAGProvider({ vectorStore: vs, magma });

        // Async init with _readyPromise — callers await before using RAG
        rag._readyPromise = (async () => {
            await ep.init();
            await vs.init();
            await rag.init();
            console.log('[BrainFactory] RAG provider initialized');
        })().catch(e => {
            rag._initFailed = true;
            console.warn('[BrainFactory] RAG init failed:', e.message);
        });

        return rag;
    } catch (e) {
        console.warn('[BrainFactory] RAG provider not available:', e.message);
        return null;
    }
}

function createBrain(options = {}) {
    let engine = 'puppeteer'; // default

    try {
        const { getConfig } = require('../config/xml-config-loader');
        const cfg = getConfig();
        const geminiCfg = cfg.getGeminiConfig();
        if (geminiCfg.engine) engine = geminiCfg.engine;
    } catch (e) { /* no XML config, use default */ }

    // Environment override (highest priority)
    if (process.env.GOLEM_BRAIN_ENGINE) {
        engine = process.env.GOLEM_BRAIN_ENGINE.toLowerCase();
    }

    // v10.5: Inject RAG provider for non-router engines (router handles its own)
    if (engine !== 'router' && !options.ragProvider) {
        options.ragProvider = _initRAGProvider(options);
    }

    switch (engine) {
        case 'router': {
            const RouterBrain = require('./RouterBrain');
            console.log('🧠 [BrainFactory] Using Intelligent Router Brain');
            return new RouterBrain(options);
        }
        case 'claude': {
            const ClaudeBrain = require('./ClaudeBrain');
            console.log('🧠 [BrainFactory] Using Claude Brain (Anthropic API)');
            return new ClaudeBrain(options);
        }
        case 'monica-web': {
            const MonicaWebBrain = require('./MonicaWebBrain');
            console.log('🧠 [BrainFactory] Using Monica Web Brain (Puppeteer)');
            return new MonicaWebBrain(options);
        }
        case 'monica': {
            const MonicaBrain = require('./MonicaBrain');
            console.log('🧠 [BrainFactory] Using Monica Brain (API)');
            return new MonicaBrain(options);
        }
        case 'ollama': {
            const OllamaBrain = require('./OllamaBrain');
            console.log('🧠 [BrainFactory] Using Ollama Brain (local)');
            return new OllamaBrain(options);
        }
        case 'sdk': {
            const SdkBrain = require('./SdkBrain');
            console.log('🧠 [BrainFactory] Using SDK Brain (Gemini API)');
            return new SdkBrain(options);
        }
        case 'puppeteer':
        default: {
            const GolemBrain = require('./GolemBrain');
            console.log('🧠 [BrainFactory] Using Puppeteer Brain (Gemini Web)');
            return new GolemBrain(options);
        }
    }
}

module.exports = { createBrain };
