'use strict';

class WorkerBridge {
    constructor() {
        this._rpcHandlers = new Map();
        this._controlHandler = null;
        this._installed = false;
    }

    install(options = {}) {
        if (this._installed || typeof process.send !== 'function') return;

        this._controlHandler = typeof options.onControl === 'function' ? options.onControl : null;
        const handlers = options.rpcHandlers || {};
        Object.entries(handlers).forEach(([key, fn]) => {
            if (typeof fn === 'function') {
                this._rpcHandlers.set(key, fn);
            }
        });

        process.on('message', async (message) => {
            if (!message || typeof message !== 'object') return;

            if (message.type === 'rpc') {
                await this._handleRpc(message);
                return;
            }

            if (message.type === 'control' && this._controlHandler) {
                try {
                    await this._controlHandler(message.action, message.payload || {});
                } catch (error) {
                    this.sendEvent('worker.control.error', {
                        action: message.action,
                        error: error.message,
                    });
                }
            }
        });

        this._installed = true;
    }

    async _handleRpc(message) {
        const handler = this._rpcHandlers.get(message.method);
        if (!handler) {
            this._send({
                type: 'rpc_result',
                id: message.id,
                error: {
                    message: `Unknown RPC method: ${message.method}`,
                    code: 'RPC_METHOD_NOT_FOUND',
                    statusCode: 404,
                },
            });
            return;
        }

        try {
            const result = await handler(message.params || {});
            this._send({
                type: 'rpc_result',
                id: message.id,
                result,
            });
        } catch (error) {
            this._send({
                type: 'rpc_result',
                id: message.id,
                error: {
                    message: error && error.message ? error.message : String(error),
                    code: error && error.code ? String(error.code) : '',
                    statusCode: Number(error && (error.statusCode || error.status) || 500),
                    details: error && error.details && typeof error.details === 'object' ? error.details : {},
                },
            });
        }
    }

    sendSnapshot(snapshot) {
        this._send({
            type: 'runtime_snapshot',
            snapshot,
        });
    }

    sendEvent(name, payload = {}) {
        this._send({
            type: 'runtime_event',
            name,
            payload,
        });
    }

    _send(message) {
        if (typeof process.send !== 'function') return;
        try {
            process.send(message);
        } catch {}
    }
}

module.exports = new WorkerBridge();
