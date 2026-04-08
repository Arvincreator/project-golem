const { execSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const helperPath = path.join(repoRoot, 'scripts/lib/install_profile.sh');

function runShell(expr) {
    const escaped = expr.replace(/"/g, '\\"');
    return execSync(`rtk bash -lc "source '${helperPath}'; ${escaped}"`, {
        cwd: repoRoot,
        encoding: 'utf8'
    }).trim();
}

describe('install profile helpers', () => {
    test('normalizes empty selection to defaults', () => {
        const out = runShell('normalize_install_components "";');
        expect(out).toBe('core,mempalace,dashboard,doctor');
    });

    test('keeps known items only and deduplicates', () => {
        const out = runShell('normalize_install_components "dashboard,core,dashboard,unknown";');
        expect(out).toBe('core,dashboard');
    });

    test('component check returns true for enabled component', () => {
        const out = runShell('if install_component_enabled "dashboard" "core,dashboard"; then echo yes; else echo no; fi');
        expect(out).toBe('yes');
    });

    test('component check returns false for disabled component', () => {
        const out = runShell('if install_component_enabled "mempalace" "core,dashboard"; then echo yes; else echo no; fi');
        expect(out).toBe('no');
    });

    test('cli backend choice rejects perplexity and falls back to gemini', () => {
        const out = runShell('normalize_cli_backend_choice "perplexity";');
        expect(out).toBe('gemini');
    });

    test('cli comm mode rejects tgdc and falls back to direct', () => {
        const out = runShell('normalize_cli_comm_mode "tgdc";');
        expect(out).toBe('direct');
    });

    test('known local embedding model keeps original value', () => {
        const out = runShell('normalize_local_embedding_model_choice "Xenova/all-MiniLM-L6-v2";');
        expect(out).toBe('Xenova/all-MiniLM-L6-v2');
    });

    test('unknown local embedding model maps to custom option', () => {
        const out = runShell('normalize_local_embedding_model_choice "my/private-model";');
        expect(out).toBe('custom');
    });
});
