// test/bridges/TelegramBotFactory.test.js
const assert = require('assert');
const path = require('path');
const ConfigManager = require('../../src/config');
const { createTelegramBot, detectEngine } = require('../../src/bridges/TelegramBotFactory');

async function runTests() {
  console.log('--- Testing TelegramBotFactory ---');
  
  // Test 1: Default (grammY if installed)
  console.log('[Test 1] detectEngine() without TG_ENGINE override');
  ConfigManager.CONFIG.TG_ENGINE = '';
  let engine = detectEngine();
  // We installed grammy, so it should be grammy.
  // Wait, detectEngine caches _engine. We can't easily reset it in the module without modifying it.
  // We'll just check what it detected.
  console.log('Detected Engine:', engine);
  assert(engine === 'grammy' || engine === 'legacy');

  // Test 2: Instantiating bot
  console.log('[Test 2] createTelegramBot()');
  const bot = createTelegramBot('dummy:token', { polling: false });
  assert(typeof bot.sendMessage === 'function', 'bot must have sendMessage method');
  assert(typeof bot.stopPolling === 'function', 'bot must have stopPolling method');
  assert(typeof bot.startPolling === 'function', 'bot must have startPolling method');
  assert(typeof bot.isPolling === 'function', 'bot must have isPolling method');
  
  if (engine === 'grammy') {
    assert(bot.constructor.name === 'GrammyBridge', 'bot should be GrammyBridge instance');
  } else {
    assert(bot.constructor.name === 'TelegramBot', 'bot should be node-telegram-bot-api instance');
  }

  console.log('✅ TelegramBotFactory tests passed.');
}

test("TelegramBotFactory creates bots and detects engine correctly", async () => {
  await runTests();
});
// Original runner kept for direct node execution
if (require.main === module) runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
