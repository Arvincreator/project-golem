// src/bridges/GracefulShutdown.js
// Coordinates clean shutdown of all bridge components
// Prevents orphan polling sessions (409 conflicts) and data loss

class GracefulShutdown {
  constructor() {
    this._handlers = [];
    this._shuttingDown = false;
    this._installed = false;
  }

  /**
   * Register a shutdown handler
   * @param {string} name - Component name for logging
   * @param {Function} fn - Async cleanup function
   */
  register(name, fn) {
    this._handlers.push({ name, fn });
  }

  /**
   * Install process signal handlers (call once at startup)
   */
  install() {
    if (this._installed) return;
    this._installed = true;

    const shutdown = (signal) => {
      if (this._shuttingDown) return;
      this._shuttingDown = true;
      console.log(`\n🛑 [Shutdown] Signal ${signal} received, cleaning up...`);
      this._runAll().then(() => {
        console.log('✅ [Shutdown] All components stopped cleanly.');
        process.exit(0);
      }).catch((e) => {
        console.error('❌ [Shutdown] Error during cleanup:', e.message);
        process.exit(1);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    console.log('[Shutdown] Graceful shutdown handlers installed');
  }

  async _runAll() {
    const timeout = 10000; // 10s max per handler
    for (const { name, fn } of this._handlers) {
      try {
        console.log(`  ⏳ Stopping ${name}...`);
        await Promise.race([
          fn(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
        ]);
        console.log(`  ✅ ${name} stopped`);
      } catch (e) {
        console.warn(`  ⚠️ ${name}: ${e.message}`);
      }
    }
  }
}

module.exports = new GracefulShutdown();
