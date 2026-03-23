// src/bridges/TelegramBotFactory.js
// Non-invasive factory: decides between grammY (GrammyBridge) and node-telegram-bot-api
// Reads environment configuration via ConfigManager to decide

const ConfigManager = require('../config');

let _engine = null;
let _legacyCtor = null;

function loadLegacyEngine() {
  if (_legacyCtor) return _legacyCtor;
  try {
    _legacyCtor = require('node-telegram-bot-api');
    return _legacyCtor;
  } catch {
    return null;
  }
}

function detectEngine() {
  if (_engine) return _engine;

  const requested = String(ConfigManager.CONFIG.TG_ENGINE || '').trim().toLowerCase();
  if (requested === 'legacy') {
    if (loadLegacyEngine()) {
      _engine = 'legacy';
      console.log('[TG Factory] Engine: node-telegram-bot-api (legacy, from ConfigManager)');
      return _engine;
    }
    console.warn('[TG Factory] TG_ENGINE=legacy but node-telegram-bot-api is not installed. Falling back to grammY.');
  }

  try {
    require.resolve('grammy');
    _engine = 'grammy';
    console.log('[TG Factory] Engine: grammY (modern)');
    return _engine;
  } catch {
    if (loadLegacyEngine()) {
      _engine = 'legacy';
      console.log('[TG Factory] Engine: node-telegram-bot-api (grammy not installed)');
      return _engine;
    }

    throw new Error('No Telegram engine is available. Install "grammy" or "node-telegram-bot-api".');
  }
}

/**
 * Create a Telegram bot instance — same API surface regardless of engine
 * @param {string} token
 * @param {object} opts - { polling: false, ... }
 * @returns {object} Bot instance with node-telegram-bot-api compatible API
 */
function createTelegramBot(token, opts = {}) {
  const engine = detectEngine();

  if (engine === 'grammy') {
    const GrammyBridge = require('./GrammyBridge');
    return new GrammyBridge(token, opts);
  }

  // Fallback: original node-telegram-bot-api
  const TelegramBot = loadLegacyEngine();
  if (!TelegramBot) {
    throw new Error('TG_ENGINE=legacy but node-telegram-bot-api is not installed.');
  }
  return new TelegramBot(token, opts);
}

module.exports = { createTelegramBot, detectEngine };
