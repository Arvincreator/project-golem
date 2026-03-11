// src/bridges/TelegramBotFactory.js
// Non-invasive factory: decides between grammY (GrammyBridge) and node-telegram-bot-api
// Reads golem-config.xml <telegram engine="grammy|legacy"> to decide
// Default: "grammy" — set to "legacy" to fall back to node-telegram-bot-api

const path = require('path');

let _engine = null;

function detectEngine() {
  if (_engine) return _engine;

  // Check XML config for engine preference
  try {
    const { getConfig } = require('../config/xml-config-loader');
    const cfg = getConfig();
    const tgConfig = cfg.config?.telegram;
    if (tgConfig && tgConfig['@_engine'] === 'legacy') {
      _engine = 'legacy';
      console.log('[TG Factory] Engine: node-telegram-bot-api (legacy, from XML config)');
      return _engine;
    }
  } catch (e) {
    // XML config not available, check env
  }

  // Check env override
  if (process.env.TG_ENGINE === 'legacy') {
    _engine = 'legacy';
    console.log('[TG Factory] Engine: node-telegram-bot-api (legacy, from TG_ENGINE env)');
    return _engine;
  }

  // Default to grammY
  try {
    require('grammy');
    _engine = 'grammy';
    console.log('[TG Factory] Engine: grammY (modern)');
  } catch {
    _engine = 'legacy';
    console.log('[TG Factory] Engine: node-telegram-bot-api (grammy not installed)');
  }

  return _engine;
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
  const TelegramBot = require('node-telegram-bot-api');
  return new TelegramBot(token, opts);
}

module.exports = { createTelegramBot, detectEngine };
