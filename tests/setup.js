// Jest test setup — prevent Puppeteer/Bot initialization
process.env.GOLEM_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

// Track all timers created during tests so we can clean them up
const _trackedIntervals = new Set();
const _trackedTimeouts = new Set();

const _origSetInterval = global.setInterval;
const _origSetTimeout = global.setTimeout;
const _origClearInterval = global.clearInterval;
const _origClearTimeout = global.clearTimeout;

global.setInterval = function trackedSetInterval(...args) {
    const id = _origSetInterval.apply(this, args);
    _trackedIntervals.add(id);
    return id;
};

global.setTimeout = function trackedSetTimeout(...args) {
    const id = _origSetTimeout.apply(this, args);
    _trackedTimeouts.add(id);
    return id;
};

global.clearInterval = function trackedClearInterval(id) {
    _trackedIntervals.delete(id);
    return _origClearInterval.call(this, id);
};

global.clearTimeout = function trackedClearTimeout(id) {
    _trackedTimeouts.delete(id);
    return _origClearTimeout.call(this, id);
};

// Export for cleanup in setup-afterall.js
global.__testTimerTracking = {
    intervals: _trackedIntervals,
    timeouts: _trackedTimeouts,
    origClearInterval: _origClearInterval,
    origClearTimeout: _origClearTimeout,
};
