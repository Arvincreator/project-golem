// src/core/BrainFactory.js
// Selects brain engine based on golem-config.xml: <gemini engine="sdk|puppeteer" />
// Default: puppeteer (backward compatible)

function createBrain(options = {}) {
    let engine = 'puppeteer'; // default

    try {
        const { getConfig } = require('../config/xml-config-loader');
        const cfg = getConfig();
        const geminiCfg = cfg.getGeminiConfig();
        // XML: <gemini engine="sdk" model="gemini-2.0-flash" />
        if (geminiCfg.engine === 'sdk') {
            engine = 'sdk';
        }
    } catch (e) { /* no XML config, use default */ }

    // Environment override: GOLEM_BRAIN_ENGINE=sdk
    if (process.env.GOLEM_BRAIN_ENGINE) {
        engine = process.env.GOLEM_BRAIN_ENGINE.toLowerCase();
    }

    if (engine === 'sdk') {
        const SdkBrain = require('./SdkBrain');
        console.log(`🧠 [BrainFactory] Using SDK Brain (no Puppeteer)`);
        return new SdkBrain(options);
    }

    const GolemBrain = require('./GolemBrain');
    console.log(`🧠 [BrainFactory] Using Puppeteer Brain (legacy)`);
    return new GolemBrain(options);
}

module.exports = { createBrain };
