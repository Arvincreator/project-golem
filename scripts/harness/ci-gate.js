#!/usr/bin/env node

function normalizeBranch(branch = '') {
    const value = String(branch || '').trim();
    if (!value) return '';
    if (value.startsWith('refs/heads/')) {
        return value.replace(/^refs\/heads\//, '');
    }
    return value;
}

function evaluateGate({ branch = '', compare = {} } = {}) {
    const normalizedBranch = normalizeBranch(branch);
    const isMain = normalizedBranch === 'main';
    const hardFail = compare && compare.hardFail === true;
    const warnings = Array.isArray(compare && compare.warnings) ? compare.warnings : [];

    if (!isMain) {
        return {
            mode: 'warn',
            exitCode: 0,
            hardFail,
            warnings,
        };
    }

    return {
        mode: 'enforce',
        exitCode: hardFail ? 1 : 0,
        hardFail,
        warnings,
    };
}

if (require.main === module) {
    const fs = require('fs');

    const [comparePath, branch = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || ''] = process.argv.slice(2);
    if (!comparePath) {
        console.error('Usage: node scripts/harness/ci-gate.js <compareReportPath> [branch]');
        process.exit(1);
    }

    const compare = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
    const result = evaluateGate({ branch, compare });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
}

module.exports = {
    evaluateGate,
    normalizeBranch,
};
