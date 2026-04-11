const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({
    spawnSync: jest.fn(),
}));

const { spawnSync } = require('child_process');
const { installMempalace, getVenvPythonPath } = require('../src/mcp/mempalaceInstaller');

function mockSpawnResult({ status = 0, stdout = '', stderr = '', error = null } = {}) {
    return { status, stdout, stderr, error };
}

function queueSpawnResults(sequence, hooks = {}) {
    let index = 0;
    const { onCall } = hooks;
    spawnSync.mockImplementation((command, args) => {
        if (onCall) onCall(command, args);
        const item = sequence[index] || {};
        index += 1;
        return mockSpawnResult(item);
    });
}

describe('mempalaceInstaller', () => {
    let tempCwd = '';
    let runtimeDir = '';
    let venvDir = '';
    let venvPython = '';

    beforeEach(() => {
        jest.clearAllMocks();
        tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'golem-mempalace-installer-'));
        runtimeDir = path.join(tempCwd, 'data', 'mcp', 'mempalace-runtime');
        venvDir = path.join(runtimeDir, '.venv');
        venvPython = getVenvPythonPath(venvDir);
    });

    afterEach(() => {
        if (tempCwd) {
            fs.rmSync(tempCwd, { recursive: true, force: true });
            tempCwd = '';
        }
        delete process.env.MEMPALACE_PYTHON_BIN;
    });

    test('returns already_installed when existing venv can import mempalace', () => {
        fs.mkdirSync(path.dirname(venvPython), { recursive: true });
        fs.writeFileSync(venvPython, '', 'utf8');

        queueSpawnResults([
            { status: 0, stdout: '1.0.0' }, // import mempalace
            { status: 0, stdout: 'ok' }, // import mempalace.mcp_server
            { status: 0, stderr: 'Python 3.11.9' }, // --version
        ]);

        const result = installMempalace({ cwd: tempCwd });

        expect(result.installAction).toBe('already_installed');
        expect(result.installMode).toBe('venv');
        expect(result.pythonBin).toBe(venvPython);
        expect(result.mempalaceVersion).toBe('1.0.0');
        expect(spawnSync).toHaveBeenCalledTimes(3);
    });

    test('creates venv and installs mempalace with available python candidate', () => {
        queueSpawnResults(
            [
                { status: 1, stderr: 'not found' }, // python3.11 --version
                { status: 1, stderr: 'not found' }, // python3.10 --version
                { status: 1, stderr: 'not found' }, // python3.12 --version
                { status: 0, stderr: 'Python 3.12.3' }, // python3 --version
                { status: 0, stdout: '' }, // python3 -m venv
                { status: 0, stdout: 'pip 24.0' }, // venv pip --version
                { status: 0, stdout: 'tooling upgraded' }, // upgrade pip/setuptools/wheel
                { status: 0, stdout: 'installed mempalace' }, // install mempalace
                { status: 0, stdout: '1.2.3' }, // import mempalace
                { status: 0, stdout: 'ok' }, // import mempalace.mcp_server
            ],
            {
                onCall: (_command, args) => {
                    if (Array.isArray(args) && args[0] === '-m' && args[1] === 'venv') {
                        const createdVenvDir = args[2];
                        const createdVenvPython = getVenvPythonPath(createdVenvDir);
                        fs.mkdirSync(path.dirname(createdVenvPython), { recursive: true });
                        fs.writeFileSync(createdVenvPython, '', 'utf8');
                    }
                },
            }
        );

        const result = installMempalace({ cwd: tempCwd });

        expect(result.installAction).toBe('installed');
        expect(result.installMode).toBe('venv');
        expect(result.basePythonBin).toBe('python3');
        expect(result.pythonBin).toBe(venvPython);
        expect(result.mempalaceVersion).toBe('1.2.3');
        expect(fs.existsSync(path.join(runtimeDir, 'palace'))).toBe(true);
    });

    test('falls back to next python candidate when first candidate fails to resolve dependencies', () => {
        queueSpawnResults(
            [
                { status: 0, stderr: 'Python 3.11.9' }, // python3.11 --version
                { status: 0, stdout: '' }, // python3.11 -m venv
                { status: 0, stdout: 'pip 24.0' }, // pip --version
                { status: 0, stdout: 'tooling upgraded' }, // upgrade tooling
                { status: 1, stderr: 'ResolutionImpossible: dependency conflict' }, // install mempalace failed
                { status: 0, stderr: 'Python 3.10.14' }, // python3.10 --version
                { status: 0, stdout: '' }, // python3.10 -m venv
                { status: 0, stdout: 'pip 24.0' }, // pip --version
                { status: 0, stdout: 'tooling upgraded' }, // upgrade tooling
                { status: 0, stdout: 'installed mempalace' }, // install mempalace
                { status: 0, stdout: '2.0.0' }, // import mempalace
                { status: 0, stdout: 'ok' }, // import module
            ],
            {
                onCall: (_command, args) => {
                    if (Array.isArray(args) && args[0] === '-m' && args[1] === 'venv') {
                        const createdVenvDir = args[2];
                        const createdVenvPython = getVenvPythonPath(createdVenvDir);
                        fs.mkdirSync(path.dirname(createdVenvPython), { recursive: true });
                        fs.writeFileSync(createdVenvPython, '', 'utf8');
                    }
                },
            }
        );

        const result = installMempalace({ cwd: tempCwd, preferredPython: 'python3.11' });

        expect(result.installAction).toBe('installed');
        expect(result.basePythonBin).toBe('python3.10');
        expect(result.mempalaceVersion).toBe('2.0.0');
        expect(Array.isArray(result.attempts)).toBe(true);
        expect(result.attempts.length).toBeGreaterThan(0);
    });
});
