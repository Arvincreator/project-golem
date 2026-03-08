/**
 * 🩺 Golem Doctor — 啟動診斷工具
 * Usage: node index.js --doctor
 */
const fs = require('fs');
const path = require('path');
const net = require('net');

async function runDoctor() {
    console.log('\n🩺 Golem Doctor — 系統診斷\n');
    const results = [];

    // 1. Node.js version
    const nodeVersion = process.versions.node;
    const nodeMajor = parseInt(nodeVersion.split('.')[0]);
    results.push({
        name: 'Node.js version',
        pass: nodeMajor >= 18,
        detail: `v${nodeVersion}${nodeMajor < 18 ? ' (需要 >= 18)' : ''}`
    });

    // 2. Required env vars
    require('dotenv').config();
    const { cleanEnv, isPlaceholder } = require('../config');

    const tgToken = cleanEnv(process.env.TELEGRAM_TOKEN);
    const dcToken = cleanEnv(process.env.DISCORD_TOKEN);
    results.push({
        name: 'Bot Token (TG 或 DC)',
        pass: !isPlaceholder(tgToken) || !isPlaceholder(dcToken),
        detail: !isPlaceholder(tgToken) ? 'Telegram ✓' : !isPlaceholder(dcToken) ? 'Discord ✓' : '均未設定'
    });

    const apiKeys = (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k && !isPlaceholder(k));
    results.push({
        name: 'Gemini API Keys',
        pass: apiKeys.length > 0,
        detail: apiKeys.length > 0 ? `${apiKeys.length} key(s)` : '未設定'
    });

    // 3. Memory directory writable
    const memDir = cleanEnv(process.env.USER_DATA_DIR || './golem_memory', true);
    let memWritable = false;
    try {
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        const testFile = path.join(memDir, '.doctor_test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        memWritable = true;
    } catch (e) { /* not writable */ }
    results.push({
        name: 'Memory directory',
        pass: memWritable,
        detail: `${memDir} ${memWritable ? '(可寫)' : '(不可寫!)'}`
    });

    // 4. Dashboard port available
    const dashPort = parseInt(process.env.DASHBOARD_PORT || '3000');
    const portAvailable = await checkPort(dashPort);
    results.push({
        name: 'Dashboard port',
        pass: portAvailable,
        detail: `:${dashPort} ${portAvailable ? '(可用)' : '(已被佔用!)'}`
    });

    // 5. Chromium binary (browser mode)
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
    const chromeExists = fs.existsSync(chromePath);
    results.push({
        name: 'Chromium binary',
        pass: chromeExists,
        detail: chromeExists ? chromePath : `${chromePath} (找不到)`
    });

    // 6. package.json version
    let version = 'unknown';
    try { version = require('../../package.json').version; } catch (e) { /* ignore */ }
    results.push({
        name: 'Golem version',
        pass: true,
        detail: `v${version}`
    });

    // 7. .env file exists
    const envExists = fs.existsSync(path.join(process.cwd(), '.env'));
    results.push({
        name: '.env file',
        pass: envExists,
        detail: envExists ? '存在' : '找不到 (使用系統環境變數)'
    });

    // Print results
    console.log('┌──────────────────────┬────┬──────────────────────────┐');
    console.log('│ Check                │    │ Detail                   │');
    console.log('├──────────────────────┼────┼──────────────────────────┤');
    for (const r of results) {
        const icon = r.pass ? '✅' : '❌';
        console.log(`│ ${r.name.padEnd(20)} │ ${icon} │ ${r.detail.padEnd(24)} │`);
    }
    console.log('└──────────────────────┴────┴──────────────────────────┘');

    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    console.log(`\n結果: ${passed}/${total} 通過`);

    if (passed < total) {
        console.log('⚠️ 部分檢查未通過，請查看上方詳情修復。');
        process.exit(1);
    } else {
        console.log('✅ 所有檢查通過，系統準備就緒！');
        process.exit(0);
    }
}

function checkPort(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => { server.close(); resolve(true); });
        server.listen(port);
    });
}

module.exports = { runDoctor };
