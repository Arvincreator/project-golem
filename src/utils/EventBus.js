/**
 * EventBus — Central event system for decoupling Golem components.
 *
 * Usage:
 *   const { eventBus } = require('./utils/EventBus');
 *   eventBus.on('brain:ready', (data) => console.log('Brain initialized', data));
 *   eventBus.emit('brain:ready', { model: 'gemini-2.5-flash' });
 *
 * Standard Events:
 *   brain:ready          — Brain initialized successfully
 *   brain:error          — Brain encountered an error
 *   brain:response       — Brain produced a response
 *   skill:loaded         — Skill loaded/reloaded
 *   skill:executed       — Skill execution completed
 *   skill:error          — Skill execution failed
 *   memory:stored        — Memory stored successfully
 *   memory:recalled      — Memory recalled
 *   task:queued          — Task added to queue
 *   task:started         — Task execution started
 *   task:completed       — Task execution completed
 *   task:failed          — Task execution failed
 *   dashboard:connected  — Dashboard client connected
 *   dashboard:disconnected — Dashboard client disconnected
 *   system:shutdown      — System shutting down
 *   system:health        — Health check event
 */

'use strict';

class EventBus {
    constructor(options = {}) {
        this._listeners = new Map();
        this._onceListeners = new Map();
        this._history = [];
        this._historyLimit = options.historyLimit ?? 100;
        this._wildcardListeners = [];
        this._maxListeners = options.maxListeners ?? 50;
        this._errorHandler = options.onError ?? null;
    }

    /**
     * Register a listener for an event.
     * @param {string} event - Event name (supports namespace like 'brain:ready')
     * @param {Function} fn - Listener function
     * @returns {Function} Unsubscribe function
     */
    on(event, fn) {
        if (typeof fn !== 'function') {
            throw new TypeError(`Listener must be a function, got ${typeof fn}`);
        }

        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }

        const listeners = this._listeners.get(event);

        if (listeners.length >= this._maxListeners) {
            console.warn(
                `⚠️ [EventBus] Max listeners (${this._maxListeners}) reached for "${event}". ` +
                `Possible memory leak.`
            );
        }

        listeners.push(fn);

        // Return unsubscribe function
        return () => this.off(event, fn);
    }

    /**
     * Register a one-time listener.
     * @param {string} event - Event name
     * @param {Function} fn - Listener function
     * @returns {Function} Unsubscribe function
     */
    once(event, fn) {
        if (typeof fn !== 'function') {
            throw new TypeError(`Listener must be a function, got ${typeof fn}`);
        }

        if (!this._onceListeners.has(event)) {
            this._onceListeners.set(event, []);
        }

        this._onceListeners.get(event).push(fn);

        return () => {
            const arr = this._onceListeners.get(event);
            if (arr) {
                const idx = arr.indexOf(fn);
                if (idx !== -1) arr.splice(idx, 1);
            }
        };
    }

    /**
     * Register a wildcard listener that receives ALL events.
     * @param {Function} fn - Listener function receiving (event, data)
     * @returns {Function} Unsubscribe function
     */
    onAny(fn) {
        if (typeof fn !== 'function') {
            throw new TypeError(`Listener must be a function, got ${typeof fn}`);
        }

        this._wildcardListeners.push(fn);

        return () => {
            const idx = this._wildcardListeners.indexOf(fn);
            if (idx !== -1) this._wildcardListeners.splice(idx, 1);
        };
    }

    /**
     * Remove a specific listener.
     * @param {string} event - Event name
     * @param {Function} fn - Listener function to remove
     */
    off(event, fn) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            const idx = listeners.indexOf(fn);
            if (idx !== -1) listeners.splice(idx, 1);
            if (listeners.length === 0) this._listeners.delete(event);
        }
    }

    /**
     * Emit an event to all registered listeners.
     * @param {string} event - Event name
     * @param {*} data - Event data
     * @returns {number} Number of listeners called
     */
    emit(event, data = null) {
        let count = 0;
        const timestamp = Date.now();

        // Record in history
        this._history.push({ event, data, timestamp });
        if (this._history.length > this._historyLimit) {
            this._history.shift();
        }

        // Call regular listeners
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const fn of [...listeners]) {
                try {
                    fn(data);
                    count++;
                } catch (error) {
                    this._handleError(event, error);
                }
            }
        }

        // Call once listeners and remove them
        const onceListeners = this._onceListeners.get(event);
        if (onceListeners) {
            const fns = [...onceListeners];
            this._onceListeners.delete(event);
            for (const fn of fns) {
                try {
                    fn(data);
                    count++;
                } catch (error) {
                    this._handleError(event, error);
                }
            }
        }

        // Call wildcard listeners
        for (const fn of [...this._wildcardListeners]) {
            try {
                fn(event, data);
                count++;
            } catch (error) {
                this._handleError(event, error);
            }
        }

        // Call namespace listeners (e.g., 'brain:*' matches 'brain:ready')
        if (event.includes(':')) {
            const namespace = event.split(':')[0] + ':*';
            const nsListeners = this._listeners.get(namespace);
            if (nsListeners) {
                for (const fn of [...nsListeners]) {
                    try {
                        fn(data, event);
                        count++;
                    } catch (error) {
                        this._handleError(event, error);
                    }
                }
            }
        }

        return count;
    }

    /**
     * Wait for an event (promise-based).
     * @param {string} event - Event name
     * @param {number} timeout - Timeout in milliseconds (0 = no timeout)
     * @returns {Promise<*>} Event data
     */
    waitFor(event, timeout = 0) {
        return new Promise((resolve, reject) => {
            let timer = null;

            const unsub = this.once(event, (data) => {
                if (timer) clearTimeout(timer);
                resolve(data);
            });

            if (timeout > 0) {
                timer = setTimeout(() => {
                    unsub();
                    reject(new Error(`Timeout waiting for event "${event}" after ${timeout}ms`));
                }, timeout);
            }
        });
    }

    /**
     * Get event history.
     * @param {string} [event] - Filter by event name
     * @param {number} [limit] - Max entries to return
     * @returns {Array} Event history entries
     */
    history(event = null, limit = 20) {
        let entries = this._history;
        if (event) {
            entries = entries.filter(e => e.event === event);
        }
        return entries.slice(-limit);
    }

    /**
     * Get listener count for an event (or all events).
     * @param {string} [event] - Event name
     * @returns {number|Object} Listener count
     */
    listenerCount(event) {
        if (event) {
            return (this._listeners.get(event) || []).length +
                   (this._onceListeners.get(event) || []).length;
        }

        const counts = {};
        for (const [name, fns] of this._listeners) {
            counts[name] = fns.length;
        }
        for (const [name, fns] of this._onceListeners) {
            counts[name] = (counts[name] || 0) + fns.length;
        }
        return counts;
    }

    /**
     * Remove all listeners for an event, or all events.
     * @param {string} [event] - Event name (omit to remove all)
     */
    removeAllListeners(event) {
        if (event) {
            this._listeners.delete(event);
            this._onceListeners.delete(event);
        } else {
            this._listeners.clear();
            this._onceListeners.clear();
            this._wildcardListeners = [];
        }
    }

    /**
     * Get all registered event names.
     * @returns {string[]} Event names
     */
    eventNames() {
        const names = new Set([
            ...this._listeners.keys(),
            ...this._onceListeners.keys()
        ]);
        return [...names];
    }

    /**
     * Get statistics about the event bus.
     * @returns {Object} Stats
     */
    stats() {
        let totalListeners = 0;
        for (const fns of this._listeners.values()) totalListeners += fns.length;
        for (const fns of this._onceListeners.values()) totalListeners += fns.length;

        return {
            events: this._listeners.size + this._onceListeners.size,
            listeners: totalListeners,
            wildcardListeners: this._wildcardListeners.length,
            historySize: this._history.length,
            historyLimit: this._historyLimit,
        };
    }

    /**
     * Handle listener errors without crashing the bus.
     * @private
     */
    _handleError(event, error) {
        if (this._errorHandler) {
            this._errorHandler(event, error);
        } else {
            console.error(`❌ [EventBus] Error in listener for "${event}":`, error.message);
        }
    }
}

// Singleton instance for cross-module communication
const eventBus = new EventBus();

module.exports = { EventBus, eventBus };
