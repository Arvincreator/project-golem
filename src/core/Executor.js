const { spawn } = require('child_process');

class Executor {
    constructor() {
        this.defaultTimeout = 60000; // 預設超時：60秒 (避免 AI 卡死)
    }

    /**
     * 執行 Shell 指令 (進階版)
     * @param {string} command - 要執行的指令
     * @param {Object} options - 選項設定
     * @param {string} [options.cwd] - 指定執行目錄 (預設為 process.cwd())
     * @param {number} [options.timeout] - 設定超時毫秒數 (預設 60000ms, 0 為不限制)
     * @param {function(string):void} [options.onData] - 即時輸出回調函式 (用於 Socket.io 串流)
     * @returns {Promise<string>} - 回傳完整的輸出結果
     */
    run(command, options = {}) {
        return new Promise((resolve, reject) => {
            const cwd = options.cwd || process.cwd();
            const timeout = options.timeout !== undefined ? options.timeout : this.defaultTimeout;

            console.log(`⚡ [Executor] Running: "${command}" in ${cwd}`);

            // 使用 spawn 啟動子進程
            const child = spawn(command, [], {
                shell: true,     // 允許使用 pipe (|) 和重導向 (>)
                cwd: cwd,        // 設定工作目錄
                env: process.env // 繼承原本的環境變數
            });

            let stdout = '';
            let stderr = '';
            let isDone = false; // 避免 timeout 後又觸發 close

            // --- 設定超時計時器 ---
            let timer = null;
            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (!isDone) {
                        isDone = true;
                        child.kill('SIGKILL'); // 殺死進程
                        const msg = `❌ [Executor] Command timed out after ${timeout}ms: "${command}"`;
                        console.warn(msg);
                        reject(new Error(msg));
                    }
                }, timeout);
            }

            // --- 處理標準輸出 ---
            child.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;

                // 如果有設定即時回調 (例如送給前端 Socket)，就在這裡呼叫
                if (options.onData && typeof options.onData === 'function') {
                    options.onData(text);
                }
            });

            // --- 處理錯誤輸出 ---
            child.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;

                // 錯誤訊息通常也要即時顯示
                if (options.onData && typeof options.onData === 'function') {
                    options.onData(text);
                }
            });

            // --- 處理進程錯誤 (如 spawn 失敗) ---
            child.on('error', (err) => {
                if (!isDone) {
                    isDone = true;
                    if (timer) clearTimeout(timer);
                    reject(err);
                }
            });

            // --- 處理進程結束 ---
            child.on('close', (code) => {
                if (!isDone) {
                    isDone = true;
                    if (timer) clearTimeout(timer); // 清除計時器

                    if (code !== 0) {
                        // 回傳詳細錯誤，讓 AI 知道發生什麼事
                        // 這裡選擇 resolve 而不是 reject，是因為有時候 exit code 1 只是警告
                        // 您可以根據需求改回 reject
                        console.warn(`⚠️ [Executor] Finished with code ${code}`);
                        reject(new Error(`Command failed (Exit Code ${code}).\nStderr: ${stderr}\nStdout: ${stdout}`));
                    } else {
                        // console.log(`✅ [Executor] Finished successfully.`);
                        resolve(stdout);
                    }
                }
            });
        });
    }
}

module.exports = Executor;
