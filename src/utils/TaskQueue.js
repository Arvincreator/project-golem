/**
 * TaskQueue — Priority-based async task queue with concurrency control.
 *
 * Manages task execution with priority levels, concurrency limits,
 * timeout handling, and backpressure.
 *
 * Usage:
 *   const queue = new TaskQueue({ concurrency: 3 });
 *   const result = await queue.add(() => doWork(), { priority: 'high' });
 *   queue.stats();
 */

'use strict';

const PRIORITY = {
    CRITICAL: 0,
    HIGH: 1,
    NORMAL: 2,
    LOW: 3,
    BACKGROUND: 4,
};

const PRIORITY_NAMES = ['critical', 'high', 'normal', 'low', 'background'];

class TaskQueue {
    /**
     * @param {Object} options
     * @param {number} options.concurrency - Max concurrent tasks (default: 3)
     * @param {number} options.maxSize - Max queue size (0 = unlimited)
     * @param {number} options.defaultTimeout - Default task timeout in ms (0 = no timeout)
     * @param {Function} options.onComplete - Called when a task completes
     * @param {Function} options.onError - Called when a task fails
     */
    constructor(options = {}) {
        this._concurrency = options.concurrency ?? 3;
        this._maxSize = options.maxSize ?? 0;
        this._defaultTimeout = options.defaultTimeout ?? 0;
        this._onComplete = options.onComplete ?? null;
        this._onError = options.onError ?? null;

        this._queue = [];      // Sorted by priority
        this._running = [];    // Currently executing
        this._paused = false;
        this._taskId = 0;

        this._stats = {
            totalAdded: 0,
            totalCompleted: 0,
            totalFailed: 0,
            totalTimedOut: 0,
            totalDropped: 0,
        };
    }

    /**
     * Add a task to the queue.
     * @param {Function} fn - Async function to execute
     * @param {Object} options
     * @param {string|number} options.priority - 'critical'|'high'|'normal'|'low'|'background' or 0-4
     * @param {string} options.label - Human-readable label for debugging
     * @param {number} options.timeout - Task-specific timeout in ms
     * @returns {Promise<*>} Resolves with task result
     */
    add(fn, options = {}) {
        const priority = this._normalizePriority(options.priority);
        const label = options.label ?? `task-${++this._taskId}`;
        const timeout = options.timeout ?? this._defaultTimeout;

        // Backpressure: reject if queue full
        if (this._maxSize > 0 && this._queue.length >= this._maxSize) {
            this._stats.totalDropped++;
            return Promise.reject(
                new Error(`Queue full (${this._maxSize}). Task "${label}" dropped.`)
            );
        }

        this._stats.totalAdded++;

        return new Promise((resolve, reject) => {
            const task = {
                fn,
                priority,
                label,
                timeout,
                resolve,
                reject,
                addedAt: Date.now(),
            };

            // Insert in priority order (lower number = higher priority)
            const insertIdx = this._queue.findIndex(t => t.priority > priority);
            if (insertIdx === -1) {
                this._queue.push(task);
            } else {
                this._queue.splice(insertIdx, 0, task);
            }

            this._process();
        });
    }

    /**
     * Pause task processing (running tasks continue).
     */
    pause() {
        this._paused = true;
    }

    /**
     * Resume task processing.
     */
    resume() {
        this._paused = false;
        this._process();
    }

    /**
     * Clear all pending tasks.
     * @param {string} reason - Reason for clearing
     * @returns {number} Number of tasks cleared
     */
    clear(reason = 'Queue cleared') {
        const count = this._queue.length;
        for (const task of this._queue) {
            task.reject(new Error(reason));
            this._stats.totalDropped++;
        }
        this._queue = [];
        return count;
    }

    /**
     * Get queue size by priority.
     * @returns {Object}
     */
    size() {
        const byPriority = {};
        for (const name of PRIORITY_NAMES) {
            byPriority[name] = 0;
        }
        for (const task of this._queue) {
            const name = PRIORITY_NAMES[task.priority] || 'unknown';
            byPriority[name]++;
        }
        return {
            pending: this._queue.length,
            running: this._running.length,
            byPriority,
        };
    }

    /**
     * Get queue statistics.
     * @returns {Object}
     */
    stats() {
        return {
            ...this._stats,
            pending: this._queue.length,
            running: this._running.length,
            concurrency: this._concurrency,
            paused: this._paused,
        };
    }

    /**
     * Check if queue is idle (no pending or running tasks).
     * @returns {boolean}
     */
    isIdle() {
        return this._queue.length === 0 && this._running.length === 0;
    }

    /**
     * Wait for all tasks to complete.
     * @returns {Promise<void>}
     */
    async drain() {
        while (!this.isIdle()) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    /**
     * Process next tasks from queue.
     * @private
     */
    _process() {
        if (this._paused) return;

        while (
            this._running.length < this._concurrency &&
            this._queue.length > 0
        ) {
            const task = this._queue.shift();
            this._execute(task);
        }
    }

    /**
     * Execute a single task.
     * @private
     */
    async _execute(task) {
        this._running.push(task);
        let timer = null;

        try {
            let result;

            if (task.timeout > 0) {
                result = await Promise.race([
                    task.fn(),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            this._stats.totalTimedOut++;
                            reject(new Error(
                                `Task "${task.label}" timed out after ${task.timeout}ms`
                            ));
                        }, task.timeout);
                    }),
                ]);
            } else {
                result = await task.fn();
            }

            if (timer) clearTimeout(timer);
            this._stats.totalCompleted++;

            if (this._onComplete) {
                this._onComplete(task.label, result);
            }

            task.resolve(result);
        } catch (error) {
            if (timer) clearTimeout(timer);
            this._stats.totalFailed++;

            if (this._onError) {
                this._onError(task.label, error);
            }

            task.reject(error);
        } finally {
            const idx = this._running.indexOf(task);
            if (idx !== -1) this._running.splice(idx, 1);
            this._process();
        }
    }

    /**
     * Normalize priority to a number.
     * @private
     */
    _normalizePriority(priority) {
        if (typeof priority === 'number') {
            return Math.max(0, Math.min(4, priority));
        }
        if (typeof priority === 'string') {
            const idx = PRIORITY_NAMES.indexOf(priority.toLowerCase());
            return idx !== -1 ? idx : PRIORITY.NORMAL;
        }
        return PRIORITY.NORMAL;
    }
}

module.exports = { TaskQueue, PRIORITY, PRIORITY_NAMES };
