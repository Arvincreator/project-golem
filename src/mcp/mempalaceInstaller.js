const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_VENV_NAME = '.venv';

function quoteArg(value) {
    const text = String(value);
    return /\s/.test(text) ? JSON.stringify(text) : text;
}

function formatCommand(command, args = []) {
    return [command, ...args].map(quoteArg).join(' ');
}

function trimOutput(text) {
    return String(text || '').trim();
}

function shortenOutput(text, maxLength = 1200) {
    const raw = trimOutput(text);
    if (raw.length <= maxLength) return raw;
    return `${raw.slice(0, maxLength)}...(truncated)`;
}

function extractVersionFromOutput(stdoutOrStderr, fallback = 'unknown') {
    const lines = String(stdoutOrStderr || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return fallback;
    return lines[lines.length - 1];
}

function runCommand(command, args, options = {}) {
    const {
        cwd = process.cwd(),
        env = process.env,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        allowFailure = false,
    } = options;

    const result = spawnSync(command, args, {
        cwd,
        env,
        timeout: timeoutMs,
        encoding: 'utf8',
        windowsHide: true,
    });

    const stdout = trimOutput(result.stdout);
    const stderr = trimOutput(result.stderr);
    const status = Number.isInteger(result.status) ? result.status : null;
    const ok = !result.error && status === 0;
    const cmdText = formatCommand(command, args);

    if (!ok && !allowFailure) {
        const reason = result.error ? result.error.message : `exit ${status === null ? 'unknown' : status}`;
        const output = shortenOutput(stderr || stdout || 'No output');
        throw new Error(`Command failed: ${cmdText}\nReason: ${reason}\nOutput: ${output}`);
    }

    return {
        ok,
        status,
        stdout,
        stderr,
        error: result.error || null,
        command,
        args,
        cmdText,
    };
}

function getVenvPythonPath(venvDir) {
    return process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python');
}

function ensureRuntimeDirs(cwd = process.cwd()) {
    const runtimeDir = path.resolve(cwd, 'data', 'mcp', 'mempalace-runtime');
    const palaceDir = path.join(runtimeDir, 'palace');
    fs.mkdirSync(palaceDir, { recursive: true });
    return { runtimeDir, palaceDir };
}

function collectPythonCandidates(preferredPython = '') {
    const raw = [
        preferredPython,
        process.env.MEMPALACE_PYTHON_BIN,
        'python3.11',
        'python3.10',
        'python3.12',
        'python3',
        'python',
    ];
    const normalized = raw
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    return [...new Set(normalized)];
}

function probePython(command, options = {}) {
    const result = runCommand(command, ['--version'], {
        ...options,
        timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 20000),
        allowFailure: true,
    });
    return {
        ok: result.ok,
        command,
        version: extractVersionFromOutput(result.stderr || result.stdout, 'Python (unknown version)'),
        detail: shortenOutput(result.stderr || result.stdout || (result.error ? result.error.message : `exit ${result.status}`)),
        status: result.status,
    };
}

function detectPython(preferredPython = '', options = {}) {
    const candidates = collectPythonCandidates(preferredPython);
    const tried = [];

    for (const candidate of candidates) {
        const probe = probePython(candidate, options);
        tried.push(probe);
        if (probe.ok) {
            return {
                command: probe.command,
                version: probe.version,
                tried,
            };
        }
    }

    const triedSummary = tried.map((item) => `${item.command}: ${item.detail}`).join(' | ');
    throw new Error(`Unable to find a usable Python runtime for MemPalace. Tried: ${triedSummary}`);
}

function checkMempalaceAvailable(pythonCommand, options = {}) {
    const versionCheck = runCommand(
        pythonCommand,
        ['-c', 'import mempalace; print(getattr(mempalace, "__version__", "unknown"))'],
        {
            ...options,
            timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 30000),
            allowFailure: true,
        }
    );
    if (!versionCheck.ok) {
        return {
            available: false,
            reason: shortenOutput(versionCheck.stderr || versionCheck.stdout || (versionCheck.error ? versionCheck.error.message : '')),
        };
    }

    const moduleCheck = runCommand(
        pythonCommand,
        ['-c', 'import importlib; importlib.import_module("mempalace.mcp_server"); print("ok")'],
        {
            ...options,
            timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 30000),
            allowFailure: true,
        }
    );
    if (!moduleCheck.ok) {
        return {
            available: false,
            reason: shortenOutput(moduleCheck.stderr || moduleCheck.stdout || (moduleCheck.error ? moduleCheck.error.message : '')),
        };
    }

    return {
        available: true,
        version: extractVersionFromOutput(versionCheck.stdout, 'unknown'),
    };
}

function ensurePipAvailable(pythonCommand, options = {}) {
    const pipCheck = runCommand(pythonCommand, ['-m', 'pip', '--version'], {
        ...options,
        timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 20000),
        allowFailure: true,
    });
    if (pipCheck.ok) return;

    runCommand(pythonCommand, ['-m', 'ensurepip', '--upgrade'], {
        ...options,
        timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 120000),
    });

    runCommand(pythonCommand, ['-m', 'pip', '--version'], {
        ...options,
        timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 20000),
    });
}

function prepareVenv(basePython, venvDir, options = {}) {
    if (fs.existsSync(venvDir)) {
        fs.rmSync(venvDir, { recursive: true, force: true });
    }

    runCommand(basePython, ['-m', 'venv', venvDir], options);
    const venvPython = getVenvPythonPath(venvDir);
    if (!fs.existsSync(venvPython)) {
        throw new Error(`Virtual environment created but python binary not found: ${venvPython}`);
    }
    return venvPython;
}

function installMempalaceInVenv(venvPython, options = {}) {
    ensurePipAvailable(venvPython, options);

    // Keep tooling fresh to reduce resolver edge-cases.
    runCommand(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], {
        ...options,
        timeoutMs: Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 180000),
    });

    runCommand(venvPython, ['-m', 'pip', 'install', '--upgrade', 'mempalace'], options);
}

function tryInstallWithBasePython(basePython, runtimeDir, options = {}) {
    const venvDir = path.join(runtimeDir, DEFAULT_VENV_NAME);
    const venvPython = prepareVenv(basePython, venvDir, options);
    installMempalaceInVenv(venvPython, options);

    const check = checkMempalaceAvailable(venvPython, options);
    if (!check.available) {
        throw new Error(`mempalace install finished but import check failed: ${check.reason || 'unknown reason'}`);
    }

    return {
        venvDir,
        venvPython,
        mempalaceVersion: check.version || 'unknown',
    };
}

function installMempalace(options = {}) {
    const {
        cwd = process.cwd(),
        timeoutMs = DEFAULT_TIMEOUT_MS,
        preferredPython = '',
        forceInstall = false,
    } = options;

    const commandOptions = { cwd, timeoutMs };
    const { runtimeDir, palaceDir } = ensureRuntimeDirs(cwd);
    const venvDir = path.join(runtimeDir, DEFAULT_VENV_NAME);
    const venvPython = getVenvPythonPath(venvDir);

    if (fs.existsSync(venvPython) && !forceInstall) {
        const existing = checkMempalaceAvailable(venvPython, commandOptions);
        if (existing.available) {
            const versionProbe = runCommand(venvPython, ['--version'], { ...commandOptions, allowFailure: true });
            return {
                installAction: 'already_installed',
                installMode: 'venv',
                pythonBin: venvPython,
                basePythonBin: null,
                pythonVersion: extractVersionFromOutput(versionProbe.stderr || versionProbe.stdout, 'Python (unknown version)'),
                mempalaceVersion: existing.version || 'unknown',
                runtimeDir,
                palaceDir,
                venvDir,
                checkedAt: new Date().toISOString(),
            };
        }
    }

    const candidates = collectPythonCandidates(preferredPython);
    const attempts = [];
    let lastError = null;

    for (const candidate of candidates) {
        const probe = probePython(candidate, commandOptions);
        if (!probe.ok) {
            attempts.push({
                basePython: candidate,
                ok: false,
                detail: probe.detail,
            });
            continue;
        }

        try {
            const installResult = tryInstallWithBasePython(candidate, runtimeDir, commandOptions);
            return {
                installAction: 'installed',
                installMode: 'venv',
                pythonBin: installResult.venvPython,
                basePythonBin: candidate,
                pythonVersion: probe.version,
                mempalaceVersion: installResult.mempalaceVersion,
                runtimeDir,
                palaceDir,
                venvDir: installResult.venvDir,
                attempts,
                checkedAt: new Date().toISOString(),
            };
        } catch (error) {
            lastError = error;
            attempts.push({
                basePython: candidate,
                ok: false,
                detail: shortenOutput(error && error.message ? error.message : String(error)),
            });
        }
    }

    const detected = (() => {
        try {
            return detectPython(preferredPython, commandOptions);
        } catch {
            return null;
        }
    })();
    const fallbackHint = detected ? `Detected python: ${detected.command} (${detected.version}).` : 'No usable python detected.';
    const attemptSummary = attempts.map((item) => `${item.basePython}: ${item.detail}`).join(' | ');
    const lastMessage = lastError && lastError.message ? lastError.message : 'unknown error';
    throw new Error(
        `Failed to install mempalace in isolated venv. ${fallbackHint} Attempts: ${attemptSummary || 'none'} | last=${shortenOutput(lastMessage)}. `
        + 'Tip: install Python 3.11 and retry, or set MEMPALACE_PYTHON_BIN to a compatible python executable.'
    );
}

module.exports = {
    installMempalace,
    detectPython,
    checkMempalaceAvailable,
    getVenvPythonPath,
};
