#!/usr/bin/env node

function safeRate(obj = {}) {
    const value = Number(obj.successRate || 0);
    return Number.isFinite(value) ? value : 0;
}

function compareReports({ current = {}, rolling = {}, fixed = {}, threshold = 0.05 } = {}) {
    const currentRate = safeRate(current);
    const rollingRate = safeRate(rolling);
    const fixedRate = safeRate(fixed);

    const rollingDegrade = Math.max(0, rollingRate - currentRate);
    const fixedDegrade = Math.max(0, fixedRate - currentRate);

    return {
        current: { successRate: currentRate },
        rolling: { successRate: rollingRate, degrade: rollingDegrade },
        fixed: { successRate: fixedRate, degrade: fixedDegrade },
        threshold,
        hardFail: rollingDegrade > threshold,
        warnings: fixedDegrade > threshold ? ['FIXED_BASELINE_DEGRADED'] : [],
    };
}

if (require.main === module) {
    const fs = require('fs');

    const [currentPath, rollingPath, fixedPath, outputPath] = process.argv.slice(2);
    if (!currentPath || !rollingPath || !fixedPath || !outputPath) {
        console.error('Usage: node scripts/harness/compare-baseline.js <current> <rolling> <fixed> <output>');
        process.exit(1);
    }

    const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
    const rolling = JSON.parse(fs.readFileSync(rollingPath, 'utf8'));
    const fixed = JSON.parse(fs.readFileSync(fixedPath, 'utf8'));
    const result = compareReports({ current, rolling, fixed, threshold: 0.05 });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
}

module.exports = {
    compareReports,
    safeRate,
};
