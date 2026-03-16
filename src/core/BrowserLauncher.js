// ============================================================
// 🚀 BrowserLauncher - Playwright (Chromium) 啟動 / 連線管理
// ============================================================
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { BROWSER_ARGS, LOCK_FILES, LIMITS, TIMINGS } = require('./constants');

chromium.use(StealthPlugin());

class BrowserLauncher {
    /**
     * 統一入口：根據環境自動選擇連線或啟動瀏覽器
     * @param {Object} options
     * @param {string} options.userDataDir - 瀏覽器使用者資料目錄
     * @param {string} [options.headless] - 無頭模式設定 ('true' | 'new' | falsy)
     * @returns {Promise<import('playwright').BrowserContext>}
     */
    static async launch({ userDataDir, headless }) {
        const isDocker = fs.existsSync('/.dockerenv');
        const remoteDebugPort = process.env.PUPPETEER_REMOTE_DEBUGGING_PORT;

        if (isDocker && remoteDebugPort) {
            return BrowserLauncher.connectRemote('host.docker.internal', remoteDebugPort);
        }
        return BrowserLauncher.launchLocal(userDataDir, headless);
    }

    /**
     * Docker 環境下，透過 Remote Debugging Protocol 連線到宿主機 Chrome
     * @param {string} host - 宿主機主機名
     * @param {string|number} port - Debugging 埠號
     * @returns {Promise<import('playwright').Browser>}
     */
    static async connectRemote(host, port) {
        const browserURL = `http://${host}:${port}`;
        console.log(`🔌 [System] Connecting to Remote Chrome via CDP at ${browserURL}...`);

        const wsEndpoint = await new Promise((resolve, reject) => {
            const req = http.get(
                `http://${host}:${port}/json/version`,
                { headers: { 'Host': 'localhost' } },
                (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            resolve(json.webSocketDebuggerUrl);
                        } catch (e) {
                            reject(new Error(`Failed to parse /json/version: ${data}`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.setTimeout(TIMINGS.CDP_TIMEOUT, () => {
                req.destroy();
                reject(new Error('Timeout fetching /json/version'));
            });
        });

        const browser = await chromium.connectOverCDP(wsEndpoint);
        console.log(`✅ [System] Connected to Remote Chrome!`);
        return browser;
    }

    /**
     * 本地環境啟動瀏覽器 (使用 launchPersistentContext 以符合原本的 userDataDir 行為)
     * @param {string} userDataDir - 使用者資料目錄
     * @param {string} [headless] - 無頭模式
     * @param {number} [retries] - 剩餘重試次數
     * @returns {Promise<import('playwright').BrowserContext>}
     */
    static async launchLocal(userDataDir, headless, retries = LIMITS.MAX_BROWSER_RETRY) {
        BrowserLauncher.cleanLocks(userDataDir);

        try {
            // Playwright 中，launchPersistentContext 直接回傳 Context，省去 browser.newPage() 的麻煩
            const context = await chromium.launchPersistentContext(userDataDir, {
                headless: headless !== 'false',
                viewport: null,
                args: [...BROWSER_ARGS],
                ignoreDefaultArgs: ['--disable-extensions'], // 保留某些必要的擴充功能行為
            });
            return context;
        } catch (err) {
            if (retries > 0 && err.message.includes('profile appears to be in use')) {
                console.warn(`⚠️ [System] Profile locked. Retrying launch (${retries} left)...`);
                BrowserLauncher.cleanLocks(userDataDir);
                await new Promise(r => setTimeout(r, TIMINGS.BROWSER_RETRY_DELAY));
                return BrowserLauncher.launchLocal(userDataDir, headless, retries - 1);
            }
            throw err;
        }
    }

    /**
     * 清理 Chrome 殘留的 Lock 檔案
     * @param {string} userDataDir - 使用者資料目錄
     * @returns {number} 成功清理的檔案數
     */
    static cleanLocks(userDataDir) {
        let cleaned = 0;
        if (!fs.existsSync(userDataDir)) return 0;
        
        LOCK_FILES.forEach(file => {
            const p = path.join(userDataDir, file);
            try {
                fs.lstatSync(p);
                fs.rmSync(p, { force: true, recursive: true });
                console.log(`🔓 [System] Removed Stale Lock: ${file}`);
                cleaned++;
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    console.warn(`⚠️ [System] Failed to remove ${file}: ${e.message}`);
                }
            }
        });
        return cleaned;
    }
}

module.exports = BrowserLauncher;
