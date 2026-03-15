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

// 5. Check Terminal Compatibility (Windows Special)
if (process.platform === 'win32') {
    const isWindowsTerminal = !!process.env.WT_SESSION;
    const isConEmu = !!process.env.ConEmuPID;
    const isLegacyCmd = !isWindowsTerminal && !isConEmu && !process.env.TERM;
    
    check('Terminal Environment', !isLegacyCmd, 
        isWindowsTerminal ? 'Windows Terminal (Recommended)' : (isConEmu ? 'ConEmu' : 'Compatible'),
        'Legacy Windows CMD detected.', 
        'Legacy CMD has limited support for colors and symbols. Please use **Windows Terminal** (available in Microsoft Store) or **PowerShell 7** for the best experience.', 
        true);
}

testPort(3000).then((isFree) => {
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
