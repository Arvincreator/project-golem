// src/utils/Logger.js
// Lightweight structured logger with level filtering
// Usage: const log = require('./Logger')('ComponentName');
//        log.info('message'); log.warn('warning'); log.error('error');
// Control via LOG_LEVEL env: debug | info | warn | error | silent

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 1;

function createLogger(component) {
    return {
        debug: (...args) => { if (currentLevel <= 0) console.log(`[${component}]`, ...args); },
        info:  (...args) => { if (currentLevel <= 1) console.log(`[${component}]`, ...args); },
        warn:  (...args) => { if (currentLevel <= 2) console.warn(`[${component}]`, ...args); },
        error: (...args) => { if (currentLevel <= 3) console.error(`[${component}]`, ...args); },
    };
}

module.exports = createLogger;
