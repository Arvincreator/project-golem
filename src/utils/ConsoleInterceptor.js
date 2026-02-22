/**
 * 🛡️ ConsoleInterceptor - 集中處理控制台攔截邏輯
 */
class ConsoleInterceptor {
    constructor() {
        // 1. 保存原始的 Console 方法 (備份以利後續還原)
        this.originalLog = console.log;
        this.originalError = console.error;
        this.onLog = null;
        this.onError = null;
    }

    /**
     * 啟動攔截器
     * @param {Object} callbacks - 包含 onLog 與 onError 的回呼函式
     */
    hijack(callbacks = {}) {
        this.onLog = callbacks.onLog;
        this.onError = callbacks.onError;

        console.log = (...args) => {
            this.originalLog.apply(console, args); // 保持原輸出到終端
            if (this.onLog) this.onLog(args);
        };

        console.error = (...args) => {
            this.originalError.apply(console, args);
            if (this.onError) this.onError(args);
        };
    }

    /**
     * 還原原始的 Console 方法 (退出系統時調用)
     */
    restore() {
        console.log = this.originalLog;
        console.error = this.originalError;
    }
}

module.exports = new ConsoleInterceptor();
