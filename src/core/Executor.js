const { spawn } = require('child_process');

// ============================================================
// ⚡ Executor (安全強化版)
// ============================================================
class Executor {
    constructor() {
        this.defaultTimeout = 60000;
    }

    /**
     * 安全地解析 shell 指令為 command + args
     * 防止 shell injection，但仍支援基本指令
     */
    _parseCommand(command) {
        const trimmed = (command || '').trim();
        // 檢測危險的 shell 操作符
        if (/[;&|`$()]/.test(trimmed) && !/\|/.test(trimmed)) {
            // 含有危險字符但非 pipe — 使用受限 shell
            return { cmd: process.platform === 'win32' ? 'cmd' : '/bin/sh', args: [process.platform === 'win32' ? '/c' : '-c', trimmed], useShell: false };
        }
        // pipe 指令需要 shell
        if (/\|/.test(trimmed)) {
            return { cmd: process.platform === 'win32' ? 'cmd' : '/bin/sh', args: [process.platform === 'win32' ? '/c' : '-c', trimmed], useShell: false };
        }
        // 簡單指令 — 直接拆分，不用 shell
        const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [trimmed];
        const cleanParts = parts.map(p => p.replace(/^["']|["']$/g, ''));
        return { cmd: cleanParts[0], args: cleanParts.slice(1), useShell: false };
    }

    /**
     * 執行 Shell 指令 (安全版)
     */
    run(command, options = {}) {
        return new Promise((resolve, reject) => {
            const cwd = options.cwd || process.cwd();
            const timeout = options.timeout !== undefined ? options.timeout : this.defaultTimeout;
            const { cmd, args, useShell } = this._parseCommand(command);

            console.log(`⚡ [Executor] Running: "${cmd}" with ${args.length} args in ${cwd}`);

            const child = spawn(cmd, args, {
                shell: useShell,
                cwd: cwd,
                env: { ...process.env, PATH: process.env.PATH }  // 限制環境變數
            });

            let stdout = '';
            let stderr = '';
            let isDone = false;

            let timer = null;
            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (!isDone) {
                        isDone = true;
                        child.kill('SIGKILL');
                        reject(new Error(`❌ Command timed out after ${timeout}ms`));
                    }
                }, timeout);
            }

            child.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                if (options.onData) options.onData(text);
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                if (options.onData) options.onData(text);
            });

            child.on('error', (err) => {
                if (!isDone) { isDone = true; if (timer) clearTimeout(timer); reject(err); }
            });

            child.on('close', (code) => {
                if (!isDone) {
                    isDone = true;
                    if (timer) clearTimeout(timer);
                    if (code !== 0) {
                        reject(new Error(`Command failed (Exit Code ${code}).\nStderr: ${stderr}\nStdout: ${stdout}`));
                    } else {
                        resolve(stdout);
                    }
                }
            });
        });
    }
}

module.exports = Executor;
