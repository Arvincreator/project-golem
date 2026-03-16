#!/usr/bin/env node
// ============================================================
// Ollama Setup — One-click DeepSeek R1:8B configuration
// Usage: node scripts/ollama-setup.js [--with-fallback]
// ============================================================
const { spawn, execSync } = require('child_process');

const OLLAMA_BASE = process.env.OLLAMA_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:11434';
const PRIMARY_MODEL = process.env.OLLAMA_MODEL || 'deepseek-r1:8b';
const FALLBACK_MODELS = (process.env.OLLAMA_FALLBACK_MODELS || 'qwen2:1.5b').split(',').map(s => s.trim()).filter(Boolean);
const WITH_FALLBACK = process.argv.includes('--with-fallback');

async function checkBinary() {
    try {
        const version = execSync('ollama --version', { encoding: 'utf-8' }).trim();
        console.log(`✓ Ollama binary found: ${version}`);
        return true;
    } catch {
        console.error('✗ Ollama binary not found. Install: https://ollama.ai/download');
        return false;
    }
}

async function ensureServer() {
    try {
        const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            console.log('✓ Ollama server already running');
            return true;
        }
    } catch {
        // Not running
    }

    console.log('→ Starting ollama serve...');
    const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
    proc.unref();

    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                console.log('✓ Ollama server started');
                return true;
            }
        } catch {
            // Keep trying
        }
    }
    console.error('✗ Failed to start Ollama server after 20s');
    return false;
}

async function pullModel(model) {
    console.log(`→ Pulling ${model} (this may take a while)...`);

    return new Promise((resolve) => {
        const proc = spawn('ollama', ['pull', model], { stdio: 'inherit' });
        proc.on('close', (code) => {
            if (code === 0) {
                console.log(`✓ ${model} pulled successfully`);
                resolve(true);
            } else {
                console.error(`✗ Failed to pull ${model} (exit code ${code})`);
                resolve(false);
            }
        });
        proc.on('error', (e) => {
            console.error(`✗ Failed to pull ${model}: ${e.message}`);
            resolve(false);
        });
    });
}

async function smokeTest(model) {
    console.log(`→ Smoke test: sending "1+1=?" to ${model}...`);
    const start = Date.now();

    try {
        const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: '1+1=? Answer with just the number.' }],
                options: { num_ctx: 4096, num_predict: 128 },
            }),
            signal: AbortSignal.timeout(120000),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error(`✗ Smoke test failed: HTTP ${res.status} ${body.substring(0, 200)}`);
            return;
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '(empty)';
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`✓ Response (${elapsed}s): ${content.substring(0, 200).trim()}`);
    } catch (e) {
        console.error(`✗ Smoke test failed: ${e.message}`);
    }
}

async function listModels() {
    try {
        const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const data = await res.json();
        console.log('\n📋 Local models:');
        for (const m of data.models || []) {
            const size = (m.size / (1024 * 1024 * 1024)).toFixed(1);
            console.log(`   ${m.name} (${size} GB)`);
        }
    } catch {
        // Skip
    }
}

async function showSystemInfo() {
    console.log('\n📊 System info:');
    try {
        const mem = execSync('free -h | head -2', { encoding: 'utf-8' });
        console.log(mem.trim());
    } catch {
        // Skip
    }
}

function detectGPU() {
    console.log('\n🎮 GPU detection:');
    try {
        const csv = execSync(
            'nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits',
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        const [name, total, free, driver] = csv.split(',').map(s => s.trim());
        console.log(`   GPU: ${name}`);
        console.log(`   VRAM: ${free}MB free / ${total}MB total`);
        console.log(`   Driver: ${driver}`);
        return { available: true, name, totalMB: parseInt(total), freeMB: parseInt(free) };
    } catch {
        console.log('   No NVIDIA GPU detected (CPU-only mode)');
        return { available: false };
    }
}

async function gpuBenchmark(model) {
    const gpu = detectGPU();
    if (!gpu.available) return;

    console.log(`\n⚡ GPU benchmark: ${model}`);
    const prompt = { role: 'user', content: 'Explain what 1+1 equals in one sentence.' };
    const benchOpts = { num_ctx: 4096, num_predict: 64 };

    // CPU-only run
    console.log('   → CPU-only (num_gpu=0)...');
    const cpuStart = Date.now();
    let cpuTime = null;
    try {
        const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [prompt], options: { ...benchOpts, num_gpu: 0 } }),
            signal: AbortSignal.timeout(120000),
        });
        if (res.ok) {
            await res.json();
            cpuTime = (Date.now() - cpuStart) / 1000;
            console.log(`   CPU: ${cpuTime.toFixed(1)}s`);
        } else {
            console.log(`   CPU: failed (HTTP ${res.status})`);
        }
    } catch (e) {
        console.log(`   CPU: failed (${e.message})`);
    }

    // Full GPU run
    console.log('   → Full GPU (num_gpu=-1)...');
    const gpuStart = Date.now();
    let gpuTime = null;
    try {
        const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [prompt], options: { ...benchOpts, num_gpu: -1 } }),
            signal: AbortSignal.timeout(120000),
        });
        if (res.ok) {
            await res.json();
            gpuTime = (Date.now() - gpuStart) / 1000;
            console.log(`   GPU: ${gpuTime.toFixed(1)}s`);
        } else {
            console.log(`   GPU: failed (HTTP ${res.status})`);
        }
    } catch (e) {
        console.log(`   GPU: failed (${e.message})`);
    }

    if (cpuTime && gpuTime) {
        const speedup = (cpuTime / gpuTime).toFixed(1);
        console.log(`   GPU speedup: ${speedup}x (CPU: ${cpuTime.toFixed(1)}s -> GPU: ${gpuTime.toFixed(1)}s)`);
    }
}

async function main() {
    console.log('🦙 Ollama Setup for Yeren (DeepSeek R1:8B)\n');

    if (!await checkBinary()) return process.exit(1);
    if (!await ensureServer()) return process.exit(1);

    // Pull primary model
    const primaryOk = await pullModel(PRIMARY_MODEL);

    // Pull fallback models if requested
    if (WITH_FALLBACK) {
        for (const fb of FALLBACK_MODELS) {
            await pullModel(fb);
        }
    }

    // Smoke test
    if (primaryOk) {
        await smokeTest(PRIMARY_MODEL);
    }

    await listModels();
    await showSystemInfo();

    // GPU detection + benchmark
    if (primaryOk) {
        await gpuBenchmark(PRIMARY_MODEL);
    } else {
        detectGPU();
    }

    console.log('\n✅ Setup complete. Recommended .env:');
    console.log(`   OLLAMA_MODEL=${PRIMARY_MODEL}`);
    console.log('   # GPU/CPU hybrid is auto-detected (v9.9)');
    console.log('   # Override with OLLAMA_NUM_GPU=0 for CPU-only');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
