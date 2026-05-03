const Executor = require('../../../core/Executor');

function extractCommand(args = {}) {
    if (typeof args === 'string') return args;
    if (args.command) return args.command;
    if (args.cmd) return args.cmd;
    if (args.parameter) return args.parameter;
    if (args.parameters && typeof args.parameters === 'string') return args.parameters;
    if (args.parameters && typeof args.parameters === 'object') {
        return args.parameters.command || args.parameters.cmd || args.parameters.parameter || '';
    }
    return '';
}

async function run(ctx = {}) {
    const args = ctx.args || {};
    const command = String(extractCommand(args) || '').trim();
    if (!command) return '❌ sys-admin 缺少 command 參數。';

    const executor = new Executor();
    return executor.run(command, {
        cwd: process.cwd(),
        timeout: Number(args.timeout || args.parameters?.timeout || 180000),
    });
}

module.exports = {
    name: 'sys-admin',
    description: '執行已通過 TaskController 安全審批的系統管理 Shell 指令。',
    run,
};

if (require.main === module) {
    const rawArgs = process.argv[2] || '{}';
    let parsed = {};
    try {
        parsed = JSON.parse(rawArgs);
    } catch (error) {
        console.error(`❌ sys-admin 參數解析失敗: ${error.message}`);
        process.exit(1);
    }

    run({ args: parsed })
        .then(output => {
            if (output) process.stdout.write(String(output));
        })
        .catch(error => {
            console.error(error.message || String(error));
            process.exit(1);
        });
}
