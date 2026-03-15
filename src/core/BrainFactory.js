// src/core/BrainFactory.js
// Selects brain engine based on env GOLEM_BRAIN_ENGINE or golem-config.xml
// Supported engines: puppeteer, sdk, monica (API), monica-web (Puppeteer), ollama, router

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

    switch (engine) {
        case 'router': {
            const RouterBrain = require('./RouterBrain');
            console.log('🧠 [BrainFactory] Using Intelligent Router Brain');
            return new RouterBrain(options);
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
