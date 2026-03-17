// ============================================================
// AgentBus — In-process pub/sub for SubAgent communication
// ============================================================

class AgentBus {
    constructor() {
        this._subscriptions = new Map(); // topic → Set<{ handler, subscriberId }>
        this._messageLog = [];           // ring buffer max 500
        this._deadLetterQueue = [];      // max 50
        this._topicMessageCount = {};    // topic → count (incremental, avoids O(n) scan)
    }

    static TOPICS = {
        AGENT_STARTED: 'agent.started',
        AGENT_STOPPED: 'agent.stopped',
        ALERT: 'alert',
        TASK_REQUEST: 'task.request',
        TASK_RESULT: 'task.result',
        OODA_DECISION: 'ooda.decision',
        // v11.2: Goal propagation topics
        GOAL_PUBLISHED: 'goal.published',
        GOAL_CLAIMED: 'goal.claimed',
        GOAL_COMPLETED: 'goal.completed',
        GOAL_LEARNING: 'goal.learning',
    };

    /**
     * Publish message to all subscribers of a topic
     * @param {string} topic
     * @param {*} payload
     * @param {string} senderId
     */
    publish(topic, payload, senderId) {
        const message = {
            topic,
            payload,
            senderId: senderId || 'unknown',
            timestamp: Date.now(),
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        };

        // Log message
        this._messageLog.push(message);
        if (this._messageLog.length > 500) this._messageLog.shift();
        this._topicMessageCount[topic] = (this._topicMessageCount[topic] || 0) + 1;

        const subs = this._subscriptions.get(topic);
        if (!subs || subs.size === 0) {
            // No subscribers — dead letter
            this._deadLetterQueue.push(message);
            if (this._deadLetterQueue.length > 50) this._deadLetterQueue.shift();
            return 0;
        }

        let delivered = 0;
        for (const sub of subs) {
            try {
                sub.handler(message);
                delivered++;
            } catch (err) {
                console.warn(`[AgentBus] Handler error for topic=${topic} subscriber=${sub.subscriberId}: ${err.message}`);
            }
        }

        return delivered;
    }

    /**
     * Subscribe to a topic
     * @param {string} topic
     * @param {Function} handler - receives { topic, payload, senderId, timestamp, id }
     * @param {string} subscriberId
     */
    subscribe(topic, handler, subscriberId) {
        if (!this._subscriptions.has(topic)) {
            this._subscriptions.set(topic, new Set());
        }
        this._subscriptions.get(topic).add({ handler, subscriberId });
    }

    /**
     * Unsubscribe a specific subscriber from a topic
     */
    unsubscribe(topic, subscriberId) {
        const subs = this._subscriptions.get(topic);
        if (!subs) return;
        for (const sub of subs) {
            if (sub.subscriberId === subscriberId) {
                subs.delete(sub);
                break;
            }
        }
    }

    /**
     * Remove all subscriptions for a subscriber (used on agent stop)
     */
    unsubscribeAll(subscriberId) {
        for (const [, subs] of this._subscriptions) {
            for (const sub of subs) {
                if (sub.subscriberId === subscriberId) {
                    subs.delete(sub);
                }
            }
        }
    }

    /**
     * Get recent message log
     * @param {number} limit
     * @returns {Array}
     */
    getMessageLog(limit = 50) {
        return this._messageLog.slice(-limit);
    }

    /**
     * Get dead letter queue contents
     * @param {number} limit
     * @returns {Array}
     */
    getDeadLetterQueue(limit = 50) {
        return this._deadLetterQueue.slice(-limit);
    }

    /**
     * Get total subscription count across all topics
     * @returns {number}
     */
    getSubscriptionCount() {
        let count = 0;
        for (const [, subs] of this._subscriptions) {
            count += subs.size;
        }
        return count;
    }

    /**
     * v11.2: Get topic-level metrics
     * @returns {Object} { topic: { subscribers, messages } }
     */
    getTopicMetrics() {
        const metrics = {};
        for (const [topic, subs] of this._subscriptions) {
            metrics[topic] = {
                subscribers: subs.size,
                messages: this._topicMessageCount[topic] || 0,
            };
        }
        return metrics;
    }
}

module.exports = AgentBus;
