// ============================================================
// ⏰ ConsoleTimestamp — Prefix all console output with [HH:MM:SS]
// ============================================================

const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

function timestamp() {
    const now = new Date();
    return `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

console.log = function (...args) {
    _origLog.call(console, timestamp(), ...args);
};

console.warn = function (...args) {
    _origWarn.call(console, timestamp(), ...args);
};

console.error = function (...args) {
    _origError.call(console, timestamp(), ...args);
};
