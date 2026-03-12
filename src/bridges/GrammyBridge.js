// src/bridges/GrammyBridge.js
// Drop-in replacement for node-telegram-bot-api using grammY engine
// Exposes the EXACT same API surface used by project-golem v9.0.7
// Does NOT modify any core files — pure additive layer

const { Bot } = require('grammy');
const EventEmitter = require('events');
const { apiThrottler } = require('@grammyjs/transformer-throttler');
const { autoRetry } = require('@grammyjs/auto-retry');

class GrammyBridge extends EventEmitter {
  /**
   * @param {string} token - Telegram Bot Token
   * @param {object} opts - Compatible with node-telegram-bot-api constructor options
   * @param {boolean} opts.polling - Whether to start polling immediately (default: false)
   */
  constructor(token, opts = {}) {
    super();
    this._token = token;
    this._bot = new Bot(token);
    this._polling = false;
    this._stopped = false;

    // === Phase 1A: API Throttler (3-layer rate limiting) ===
    const throttler = apiThrottler({
      global: {
        reservoir: 25,
        reservoirRefreshAmount: 25,
        reservoirRefreshInterval: 1000,
        maxConcurrent: 10,
      },
      group: {
        maxConcurrent: 1,
        minTime: 1500,
        reservoir: 15,
        reservoirRefreshAmount: 15,
        reservoirRefreshInterval: 60000,
      },
      out: {
        maxConcurrent: 1,
        minTime: 100,
      },
    });
    this._bot.api.config.use(throttler);

    // === Phase 1B: Auto-Retry (rate limit + 5xx resilience) ===
    this._bot.api.config.use(autoRetry({
      maxDelaySeconds: 10,
      maxRetryAttempts: 2,
      rethrowInternalServerErrors: false,
      rethrowHttpErrors: false,
    }));

    // Register with graceful shutdown
    try {
      const shutdown = require('./GracefulShutdown');
      shutdown.register('TelegramBot', () => this.stopPolling());
      shutdown.install();
    } catch (e) { /* optional */ }

    // Custom properties that golem core attaches
    this.username = null;
    this.golemConfig = null;

    // Health watchdog integration
    let _healthWatchdog = null;
    try { _healthWatchdog = require('./TelegramHealthWatchdog'); } catch (e) { /* optional */ }
    this._healthWatchdog = _healthWatchdog;

    // grammY middleware: route updates to node-telegram-bot-api style events
    this._bot.on('message', (ctx) => {
      const msg = ctx.message;
      if (this._healthWatchdog) {
        const latency = Date.now() - (msg.date ? msg.date * 1000 : Date.now());
        this._healthWatchdog.recordPollSuccess(Math.max(0, latency));
      }
      this.emit('message', msg);
    });

    this._bot.on('callback_query', (ctx) => {
      // Do NOT auto-answer here — golem core calls answerCallbackQuery explicitly
      const query = ctx.callbackQuery;
      if (this._healthWatchdog) this._healthWatchdog.recordPollSuccess(0);
      this.emit('callback_query', query);
    });

    // Catch grammY-level errors and emit as polling_error for compatibility
    this._bot.catch((err) => {
      const wrapped = this._wrapError(err);
      if (this._healthWatchdog) this._healthWatchdog.recordPollFailure(err.message || String(err));
      this.emit('polling_error', wrapped);
    });

    // Auto-start polling if requested (matches node-telegram-bot-api behavior)
    if (opts.polling === true) {
      this.startPolling();
    }
  }

  /**
   * Get bot info — returns { username, id, first_name, ... }
   * @returns {Promise<object>}
   */
  async getMe() {
    const me = await this._bot.api.getMe();
    return me;
  }

  /**
   * Start long polling
   * @param {object} opts - { restart: true } for 409 conflict recovery
   */
  startPolling(opts = {}) {
    if (this._polling) return;
    this._polling = true;
    this._stopped = false;

    // Start health watchdog
    if (this._healthWatchdog) {
      this._healthWatchdog.recordRestart();
      this._healthWatchdog.start((level, msg) => {
        console.warn(`🚨 [TG Watchdog] [${level}] ${msg}`);
      });
    }

    // Delete webhook before polling to prevent 409 conflicts
    const startOpts = {
      drop_pending_updates: false,
      onStart: (botInfo) => {
        this.username = botInfo.username;
      },
    };

    // grammY's bot.start() returns a promise that resolves when stopped
    this._bot.start(startOpts).catch((err) => {
      if (this._stopped) return; // Expected on stop
      const wrapped = this._wrapError(err);
      this.emit('polling_error', wrapped);
    });
  }

  /**
   * Stop long polling
   * @returns {Promise<void>}
   */
  async stopPolling() {
    if (!this._polling) return;
    this._stopped = true;
    this._polling = false;
    await this._bot.stop();
  }

  /**
   * Check if bot is currently polling
   * @returns {boolean}
   */
  isPolling() {
    return this._polling;
  }

  // ================================================================
  // Telegram Bot API Methods — exact same signatures as node-telegram-bot-api
  // ================================================================

  /**
   * Send a text message
   * @param {number|string} chatId
   * @param {string} text
   * @param {object} options - { parse_mode, reply_markup, message_thread_id, reply_to_message_id, ... }
   * @returns {Promise<object>} Sent message object
   */
  async sendMessage(chatId, text, options = {}) {
    const params = { ...options, chat_id: undefined }; // Remove chat_id if accidentally passed
    delete params.chat_id;
    return await this._bot.api.sendMessage(chatId, text, params);
  }

  /**
   * Edit message text
   * @param {string} text - New text
   * @param {object} options - { chat_id, message_id, parse_mode, reply_markup, ... }
   * @returns {Promise<object>}
   */
  async editMessageText(text, options = {}) {
    const { chat_id, message_id, inline_message_id, ...rest } = options;
    if (inline_message_id) {
      return await this._bot.api.editMessageText(inline_message_id, text, rest);
    }
    return await this._bot.api.editMessageText(chat_id, message_id, text, rest);
  }

  /**
   * Answer a callback query (dismiss the loading indicator)
   * @param {string} callbackQueryId
   * @param {object} options - { text, show_alert, ... }
   * @returns {Promise<boolean>}
   */
  async answerCallbackQuery(callbackQueryId, options = {}) {
    return await this._bot.api.answerCallbackQuery(callbackQueryId, options);
  }

  /**
   * Send a document/file
   * @param {number|string} chatId
   * @param {string|object} document - File path, URL, or stream
   * @param {object} options - { message_thread_id, caption, ... }
   * @returns {Promise<object>}
   */
  async sendDocument(chatId, document, options = {}) {
    const { caption, ...rest } = options;
    // grammY uses InputFile for local files
    let inputDoc = document;
    if (typeof document === 'string' && !document.startsWith('http')) {
      const fs = require('fs');
      if (fs.existsSync(document)) {
        const { InputFile } = require('grammy');
        inputDoc = new InputFile(document);
      }
    }
    return await this._bot.api.sendDocument(chatId, inputDoc, { caption, ...rest });
  }

  /**
   * Send chat action (typing indicator, etc.)
   * @param {number|string} chatId
   * @param {string} action - 'typing', 'upload_document', etc.
   * @returns {Promise<boolean>}
   */
  async sendChatAction(chatId, action) {
    return await this._bot.api.sendChatAction(chatId, action);
  }

  /**
   * Get file info for downloading
   * @param {string} fileId
   * @returns {Promise<object>} - { file_id, file_unique_id, file_size, file_path }
   */
  async getFile(fileId) {
    return await this._bot.api.getFile(fileId);
  }

  /**
   * Delete webhook (used before starting polling)
   * @param {object} options - { drop_pending_updates }
   * @returns {Promise<boolean>}
   */
  async deleteWebHook(options = {}) {
    return await this._bot.api.deleteWebhook(options);
  }

  // ================================================================
  // Internal helpers
  // ================================================================

  /**
   * Wrap grammY errors to look like node-telegram-bot-api errors
   * so existing error handlers (409 detection etc.) still work
   */
  _wrapError(err) {
    const error = new Error(err.message || String(err));
    // grammY HttpError has error_code
    if (err.error_code === 409 || (err.message && err.message.includes('409'))) {
      error.code = 'ETELEGRAM';
      error.message = `ETELEGRAM: 409 Conflict: ${err.message}`;
    }
    error.original = err;
    return error;
  }
}

module.exports = GrammyBridge;
