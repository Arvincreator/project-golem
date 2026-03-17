const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

console.log('\n==========================================');
console.log('🩺 Project Golem - System Doctor Check');
console.log('==========================================\n');

let hasErrors = false;
let hasWarnings = false;

function check(name, pass, successMsg, failMsg, fixInstruction, isWarning = false) {
    if (pass) {
        console.log(`✅ [OK] ${name}: ${successMsg}`);
    } else {
        if (isWarning) {
            console.log(`⚠️  [WARN] ${name}: ${failMsg}`);
            console.log(`   👉 Fix: ${fixInstruction}`);
            hasWarnings = true;
        } else {
            console.log(`❌ [FAIL] ${name}: ${failMsg}`);
            console.log(`   👉 Fix: ${fixInstruction}`);
            hasErrors = true;
        }
    }
}

// 1. Check Node.js Version
const nodeVersion = process.version;
const nodeMajor = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
check('Node.js Version', nodeMajor >= 20, nodeVersion, `Found ${nodeVersion}, but v20+ is required.`, 'Please update Node.js (e.g., using nvm: `nvm install 20 && nvm use 20`)');

// 2. Check npm
try {
    const npmVersion = execSync('npm -v', { stdio: 'pipe' }).toString().trim();
    check('npm', true, `v${npmVersion}`, '', '');
} catch (e) {
    check('npm', false, '', 'npm command not found.', 'Install npm or fix your PATH.');
}

// 3. Check .env
const envPath = path.join(__dirname, '..', '.env');
check('Environment (.env)', fs.existsSync(envPath), 'Found', 'Missing', 'Run `./setup.sh --install` (Mac/Linux) or double-click `setup.bat` (Windows), or manually copy `.env.example` to `.env`.');

// 4. Check node_modules
const modulesPath = path.join(__dirname, '..', 'node_modules');
check('Dependencies (node_modules)', fs.existsSync(modulesPath), 'Installed', 'Not installed', 'Run `npm install` in the project root.');

// 5. Check Dashboard Port
const testPort = (port) => {
    return new Promise((resolve) => {
        const server = http.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false); // Port in use
            } else {
                resolve(true); // Other error, assume not blocked by EADDRINUSE
            }
        });
        server.once('listening', () => {
            server.close();
            resolve(true); // Port is free
        });
        server.listen(port);
    });
};

// 6. Check golem-config.xml
const configPath = path.join(__dirname, '..', 'golem-config.xml');
if (fs.existsSync(configPath)) {
    try {
        const { GolemConfigLoader } = require('../src/config/xml-config-loader');
        const loader = new GolemConfigLoader(configPath);
        loader.load();
        const validation = loader.validate();
        check('Config (golem-config.xml)', validation.valid, 'Parsed OK', `Parse errors: ${validation.errors.join(', ')}`, 'Fix XML syntax in golem-config.xml');
    } catch (e) {
        check('Config (golem-config.xml)', false, '', `Load failed: ${e.message}`, 'Ensure fast-xml-parser is installed: npm install fast-xml-parser');
    }
} else {
    check('Config (golem-config.xml)', false, '', 'Not found', 'Create golem-config.xml or copy from template', true);
}

// 7. Check disk space (>500MB free)
try {
    const diskInfo = execSync('df -BM --output=avail . 2>/dev/null || echo "N/A"', { stdio: 'pipe' }).toString().trim();
    const lines = diskInfo.split('\n');
    if (lines.length >= 2 && lines[1] !== 'N/A') {
        const availMB = parseInt(lines[1].replace(/[^0-9]/g, ''), 10);
        check('Disk Space', availMB > 500, `${availMB}MB free`, `Only ${availMB}MB free`, 'Free up disk space (need >500MB)', availMB > 200);
    }
} catch (e) { /* disk check optional on Windows */ }

// 8. Check Node memory usage
const memUsageMB = Math.round(process.memoryUsage.rss ? process.memoryUsage.rss() / 1024 / 1024 : process.memoryUsage().rss / 1024 / 1024);
check('Node Memory', memUsageMB < 1024, `${memUsageMB}MB`, `${memUsageMB}MB (high)`, 'Investigate memory leaks or increase --max-old-space-size', true);

// 9. Check TELEGRAM_BOT_TOKEN format
try {
    require('dotenv').config({ path: envPath });
} catch (e) { /* dotenv might not be installed yet */ }
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const tokenValid = /^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken);
check('Telegram Bot Token', tokenValid || !botToken, botToken ? 'Format OK' : 'Not set (optional)', `Invalid format: "${botToken.substring(0, 10)}..."`, 'Set TELEGRAM_BOT_TOKEN in .env with format: 123456:ABC...', !botToken);

// 10. Check Cloudflare Workers reachability (v10.8)
const cfChecks = [];
const workerRagUrl = process.env.WORKER_RAG_URL || process.env.RAG_URL;
if (workerRagUrl) {
    cfChecks.push(
        fetch(workerRagUrl.replace(/\/query$/, '') + '/health', { signal: AbortSignal.timeout(5000) })
            .then(res => check('RAG Worker', res.ok, 'Reachable', `HTTP ${res.status}`, 'Check WORKER_RAG_URL in .env', true))
            .catch(e => check('RAG Worker', false, '', e.message, 'Network issue or worker offline', true))
    );
}
const warRoomUrl = process.env.WARROOM_URL;
if (warRoomUrl) {
    cfChecks.push(
        fetch(warRoomUrl + '/health', { signal: AbortSignal.timeout(5000) })
            .then(res => check('War Room Worker', res.ok, 'Reachable', `HTTP ${res.status}`, 'Check WARROOM_URL in .env', true))
            .catch(e => check('War Room Worker', false, '', e.message, 'Network issue or worker offline', true))
    );
}

// 11. v11.5: Check all known CF Workers
const KNOWN_WORKER_URLS = [
    { name: 'rag', url: 'https://rag.yagami8095.workers.dev' },
    { name: 'notion-warroom', url: 'https://notion-warroom.yagami8095.workers.dev' },
    { name: 'health-commander', url: 'https://health-commander.yagami8095.workers.dev' },
    { name: 'intel-ops', url: 'https://intel-ops.yagami8095.workers.dev' },
    { name: 'orchestrator', url: 'https://orchestrator.yagami8095.workers.dev' },
    { name: 'content-engine', url: 'https://content-engine.yagami8095.workers.dev' },
    { name: 'revenue-sentinel', url: 'https://revenue-sentinel.yagami8095.workers.dev' },
    { name: 'analytics-dashboard', url: 'https://analytics-dashboard.yagami8095.workers.dev' },
    { name: 'auto-agent', url: 'https://auto-agent-worker.yagami8095.workers.dev' },
];

for (const worker of KNOWN_WORKER_URLS) {
    cfChecks.push(
        (async () => {
            const start = Date.now();
            try {
                const res = await fetch(worker.url + '/health', { signal: AbortSignal.timeout(5000) });
                const latency = Date.now() - start;
                check(`CF Worker: ${worker.name}`, res.ok, `Reachable (${latency}ms)`, `HTTP ${res.status}`, `Check ${worker.url}`, true);
            } catch (e) {
                const latency = Date.now() - start;
                check(`CF Worker: ${worker.name}`, false, '', `${e.message} (${latency}ms)`, `Worker may be offline: ${worker.url}`, true);
            }
        })()
    );
}

Promise.all(cfChecks).then(() => testPort(3000)).then((isFree) => {
    check('Port 3000 (Dashboard)', isFree, 'Available', 'In Use', 'Port 3000 is occupied. Stop processes using this port (e.g. `lsof -i :3000` then `kill <PID>`), or change DASHBOARD_PORT in .env.', true);

    console.log('\n==========================================');
    if (hasErrors) {
        console.log('❌ Diagnosis: The system has critical issues that WILL prevent Golem from running.');
        console.log('Please follow the fix instructions above.');
        process.exit(1);
    } else if (hasWarnings) {
        console.log('⚠️  Diagnosis: The system has warnings. Golem might run, but you may encounter issues.');
        console.log('Please review the warnings above.');
        process.exit(0);
    } else {
        console.log('✨ Diagnosis: All checks passed! Your system is ready for Project Golem.');
        process.exit(0);
    }
});
