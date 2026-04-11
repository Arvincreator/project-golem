#!/usr/bin/env node

const { installMempalace } = require('../../src/mcp/mempalaceInstaller');

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function readFlagValue(flag) {
    const idx = process.argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= process.argv.length) return '';
    return String(process.argv[idx + 1] || '').trim();
}

function printHumanReadable(result) {
    console.log('[MemPalace Installer] ✅ Success');
    console.log(`- Action: ${result.installAction}`);
    console.log(`- Python: ${result.pythonBin} (${result.pythonVersion})`);
    console.log(`- MemPalace version: ${result.mempalaceVersion}`);
    console.log(`- Runtime dir: ${result.runtimeDir}`);
    console.log(`- Palace dir: ${result.palaceDir}`);
    if (result.installCommand) {
        console.log(`- Install command: ${result.installCommand}`);
    }
}

function printHumanError(error) {
    console.error('[MemPalace Installer] ❌ Failed');
    console.error(error.message);
}

function main() {
    const jsonMode = hasFlag('--json');
    const forceInstall = hasFlag('--force');
    const preferredPython = readFlagValue('--python');

    try {
        const result = installMempalace({
            cwd: process.cwd(),
            forceInstall,
            preferredPython,
        });

        if (jsonMode) {
            process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
        } else {
            printHumanReadable(result);
        }
        process.exit(0);
    } catch (error) {
        if (jsonMode) {
            process.stdout.write(`${JSON.stringify({
                success: false,
                error: error && error.message ? error.message : String(error),
            })}\n`);
        } else {
            printHumanError(error);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
