async function run(ctx = {}) {
    if (ctx && ctx.args && ctx.args.help) {
        return [
            'NotebookLM Studio workflow is installed at tools/notebooklm-studio/',
            '1) Validate: python3 tools/notebooklm-studio/scripts/validate_environment.py --json',
            '2) Dashboard: python3 tools/notebooklm-studio/scripts/dashboard_server.py --host 127.0.0.1 --port 8765 --profile default --out-dir ./notebooklm_outputs/dashboard',
            '3) Pipeline plan/run: python3 tools/notebooklm-studio/scripts/artifact_pipeline.py ...',
        ].join('\n');
    }
    return null;
}

module.exports = { run };
