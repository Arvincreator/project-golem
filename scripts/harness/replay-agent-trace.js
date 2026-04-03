#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { replayTrace } = require('../../src/harness/HarnessReplayEngine');

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function collectTraceFiles(targetPath) {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
        return [targetPath];
    }

    if (!stat.isDirectory()) {
        return [];
    }

    return fs.readdirSync(targetPath)
        .map((name) => path.join(targetPath, name))
        .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile() && candidate.endsWith('.jsonl'))
        .sort((a, b) => a.localeCompare(b));
}

function readEvents(tracePath) {
    const files = collectTraceFiles(tracePath);
    const events = [];
    for (const filePath of files) {
        events.push(...readJsonl(filePath));
    }
    return events;
}

function main() {
    const [tracePath, mode = 'strict', outputPath = path.join(process.cwd(), 'replay_report.json')] = process.argv.slice(2);
    if (!tracePath) {
        console.error('Usage: node scripts/harness/replay-agent-trace.js <tracePath> [mode] [outputPath]');
        process.exit(1);
    }

    const events = readEvents(tracePath);
    const result = replayTrace({ mode, events });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
}

if (require.main === module) {
    main();
}

module.exports = {
    readEvents,
    collectTraceFiles,
};
