// ============================================================
// OllamaBrain — Local Ollama fallback (DeepSeek R1:8B)
// Auto-start, health check, thinking chain extraction, internal fallback
// GPU/CPU hybrid inference with adaptive parameters (v9.9)
// ============================================================
const { spawn } = require('child_process');
const OpenAICompatBrain = require('./OpenAICompatBrain');

class OllamaBrain extends OpenAICompatBrain {
    constructor(options = {}) {
        super({
            ...options,
            baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
            apiKey: 'ollama',
            defaultModel: process.env.OLLAMA_MODEL || 'deepseek-r1:8b',
            serviceId: 'ollama',
            maxTokens: parseInt(process.env.OLLAMA_NUM_PREDICT) || 8192,
            temperature: 0.6,       // R1 reasoning optimal temperature
            timeout: parseInt(process.env.OLLAMA_TIMEOUT) || 90000,  // CPU 8B needs ~90s
        });
        this._ollamaBaseUrl = (process.env.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
        this._fallbackModels = (process.env.OLLAMA_FALLBACK_MODELS || 'qwen2:1.5b')
            .split(',').map(s => s.trim()).filter(Boolean);
        this._ollamaProcess = null;

        // GPU/CPU hybrid inference (v9.9)
        this._gpuInfo = null;         // { available, name, vramTotalMB, vramFreeMB }
        this._gpuLayers = null;       // num_gpu calculated value
        this._cpuThreads = null;      // num_thread calculated value
        this._adaptiveTimeout = null; // reduced timeout for GPU mode
        this._adaptiveNumCtx = null;  // reduced ctx when memory-constrained
        this._oomRetryCount = 0;      // CUDA OOM retry counter
    }

    _getApiKey() {
        return 'ollama'; // No auth needed
    }

    // --- GPU/CPU Hybrid Detection (v9.9) ---

    async _detectGPU() {
        // ENV force CPU-only
        if (process.env.OLLAMA_NUM_GPU === '0') {
            this._gpuInfo = { available: false };
            return;
        }
        try {
            const { promisify } = require('util');
            const { exec } = require('child_process');
            const execAsync = promisify(exec);
            const { stdout } = await execAsync(
                'nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits',
                { timeout: 5000 }
            );
            const csv = stdout.trim();
            // v10.0: Handle multi-GPU output — take first GPU or use OLLAMA_GPU_INDEX
            const gpuIndex = parseInt(process.env.OLLAMA_GPU_INDEX) || 0;
            const gpuLines = csv.split('\n').map(l => l.trim()).filter(Boolean);
            const selectedLine = gpuLines[gpuIndex] || gpuLines[0];
            const [name, totalStr, freeStr] = selectedLine.split(',').map(s => s.trim());
            this._gpuInfo = {
                available: true,
                name,
                vramTotalMB: parseInt(totalStr),
                vramFreeMB: parseInt(freeStr),
            };
            console.log(`[Ollama] GPU detected: ${name} (${totalStr}MB total, ${freeStr}MB free)`);
        } catch {
            this._gpuInfo = { available: false };
            console.log('[Ollama] No GPU detected, CPU-only mode');
        }
    }

    _detectSystemMemory() {
        const os = require('os');
        return {
            totalMB: Math.floor(os.totalmem() / (1024 * 1024)),
            freeMB: Math.floor(os.freemem() / (1024 * 1024)),
        };
    }

    _estimateModelSize(modelName) {
        const name = (modelName || this._model).toLowerCase();
        if (/:(1\.5|2)b/.test(name)) return 900;
        if (/:(7|8)b/.test(name)) return 4700;
        if (/:(13|14)b/.test(name)) return 8000;
        return 4700; // conservative default
    }

    _calculateHybridParams() {
        // ENV overrides take absolute priority
        const envNumGpu = process.env.OLLAMA_NUM_GPU;
        const envNumThread = process.env.OLLAMA_NUM_THREAD;
        const envGpuTimeout = process.env.OLLAMA_GPU_TIMEOUT;
        const envAdaptiveCtx = process.env.OLLAMA_ADAPTIVE_CTX;
        const envMinCtx = parseInt(process.env.OLLAMA_MIN_NUM_CTX) || 8192;

        if (envNumGpu !== undefined) {
            this._gpuLayers = parseInt(envNumGpu);
        }
        if (envNumThread) {
            this._cpuThreads = parseInt(envNumThread);
        }
        if (envGpuTimeout) {
            this._adaptiveTimeout = parseInt(envGpuTimeout);
            this._timeout = this._adaptiveTimeout;
        }

        // If num_gpu explicitly set via ENV, skip auto-detection
        if (envNumGpu !== undefined) return;

        // No GPU → CPU-only defaults
        if (!this._gpuInfo || !this._gpuInfo.available) {
            this._gpuLayers = 0;
            // Keep original timeout (90s)
            return;
        }

        const vramFree = this._gpuInfo.vramFreeMB;
        const modelSize = this._estimateModelSize();
        const baseNumCtx = parseInt(process.env.OLLAMA_NUM_CTX) || 32768;
        const kvCacheMB = baseNumCtx * 0.05;
        const totalNeeded = modelSize + kvCacheMB;
        const usableVram = vramFree * 0.9;

        // Case 1: Full GPU offload — everything fits in VRAM
        if (totalNeeded <= usableVram) {
            this._gpuLayers = -1; // all layers
            if (!envGpuTimeout) { this._adaptiveTimeout = 30000; this._timeout = 30000; }
            this._adaptiveNumCtx = baseNumCtx;
            console.log(`[Ollama] Full GPU offload: model(${modelSize}MB) + KV(${Math.round(kvCacheMB)}MB) <= VRAM(${Math.round(usableVram)}MB)`);
            return;
        }

        // Case 2: Model fits but need to shrink ctx
        if (modelSize <= usableVram) {
            this._gpuLayers = -1;
            if (!envGpuTimeout) { this._adaptiveTimeout = 30000; this._timeout = 30000; }
            // Shrink ctx to fit remaining VRAM
            const remainingVram = usableVram - modelSize;
            const maxCtx = Math.floor(remainingVram / 0.05);
            this._adaptiveNumCtx = Math.max(envMinCtx, Math.min(baseNumCtx, maxCtx));
            if (envAdaptiveCtx === 'false') this._adaptiveNumCtx = baseNumCtx;
            console.log(`[Ollama] GPU offload with reduced ctx: ${this._adaptiveNumCtx} (from ${baseNumCtx})`);
            return;
        }

        // Case 3: Partial offload — model too big for VRAM
        const totalLayers = 33; // 8B model typical layer count
        this._gpuLayers = Math.floor(totalLayers * usableVram / modelSize);
        this._gpuLayers = Math.max(1, Math.min(totalLayers - 1, this._gpuLayers));
        if (!envGpuTimeout) { this._adaptiveTimeout = 60000; this._timeout = 60000; }
        this._adaptiveNumCtx = baseNumCtx;
        console.log(`[Ollama] Partial GPU offload: ${this._gpuLayers}/${totalLayers} layers`);
    }

    getGPUStatus() {
        return {
            gpuAvailable: this._gpuInfo?.available || false,
            gpuName: this._gpuInfo?.name || null,
            vramTotalMB: this._gpuInfo?.vramTotalMB || 0,
            vramFreeMB: this._gpuInfo?.vramFreeMB || 0,
            gpuLayers: this._gpuLayers,
            cpuThreads: this._cpuThreads,
            timeout: this._timeout,
            numCtx: this._adaptiveNumCtx,
        };
    }

    // --- Overrides ---

    _buildRequestBody() {
        const body = super._buildRequestBody();
        body.options = {
            num_ctx: this._adaptiveNumCtx || parseInt(process.env.OLLAMA_NUM_CTX) || 32768,
            num_predict: parseInt(process.env.OLLAMA_NUM_PREDICT) || 8192,
            repeat_penalty: 1.1,
        };
        if (this._gpuLayers !== null && this._gpuLayers !== undefined) {
            body.options.num_gpu = this._gpuLayers;
        }
        if (this._cpuThreads !== null && this._cpuThreads !== undefined) {
            body.options.num_thread = this._cpuThreads;
        }
        return body;
    }

    async init(forceReload = false) {
        await this._ensureOllamaRunning();
        await this._ensureModelAvailable();
        await this._detectGPU();
        this._calculateHybridParams();
        await super.init(forceReload);
    }

    async _ensureOllamaRunning() {
        const healthUrl = `${this._ollamaBaseUrl}/api/tags`;

        // Check if already running
        try {
            const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
            if (res.ok) return; // Already running
        } catch {
            // Not running, try to start
        }

        console.log('[Ollama] Not running, attempting to start ollama serve...');
        try {
            this._ollamaProcess = spawn('ollama', ['serve'], {
                detached: true,
                stdio: 'ignore',
            });
            this._ollamaProcess.unref();
        } catch (e) {
            console.warn('[Ollama] Failed to spawn ollama serve:', e.message);
            return;
        }

        // Poll for readiness (5 attempts, 2s apart)
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
                if (res.ok) {
                    console.log('[Ollama] Server started successfully');
                    return;
                }
            } catch {
                // Keep trying
            }
        }
        console.warn('[Ollama] Server did not become ready after 10s — continuing anyway');
    }

    async _ensureModelAvailable() {
        const tagsUrl = `${this._ollamaBaseUrl}/api/tags`;
        try {
            const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) return;
            const data = await res.json();
            const models = (data.models || []).map(m => m.name);
            const target = this._model;

            // Check exact match or prefix match (e.g. "deepseek-r1:8b" matches "deepseek-r1:8b-...")
            const found = models.some(m => m === target || m.startsWith(target));
            if (!found) {
                console.warn(`[Ollama] Model "${target}" not found locally. Available: ${models.join(', ') || 'none'}`);
                console.warn(`[Ollama] Please run: ollama pull ${target}`);
            }
        } catch {
            // Server not reachable, skip check
        }
    }

    _extractThinking(content) {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        const thinking = thinkMatch ? thinkMatch[1].trim() : null;
        const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return { thinking, content: cleaned || content };
    }

    async sendMessage(text, isSystem = false, options = {}) {
        const raw = await super.sendMessage(text, isSystem, options);
        const { thinking, content } = this._extractThinking(raw);
        if (thinking) {
            console.log(`[Ollama] R1 thinking (${thinking.length} chars)`);
        }
        return content;
    }

    async _callCompletion(retryCount = 0) {
        try {
            return await super._callCompletion(retryCount);
        } catch (e) {
            // CUDA OOM → reduce GPU layers and retry once
            if (this._gpuLayers !== null && this._gpuLayers !== 0 &&
                this._oomRetryCount === 0 &&
                /cuda|out of memory|oom|vram/i.test(e.message)) {
                this._oomRetryCount++;
                const prev = this._gpuLayers;
                this._gpuLayers = prev === -1 ? 25 : Math.max(0, Math.floor(prev * 0.6));
                console.warn(`[Ollama] CUDA OOM — GPU layers ${prev} → ${this._gpuLayers}`);
                try {
                    const result = await super._callCompletion(0);
                    this._oomRetryCount = 0;
                    return result;
                } catch {
                    this._oomRetryCount = 0;
                    // Fall through to model fallback
                }
            }
            // Internal model fallback
            for (const fallback of this._fallbackModels) {
                try {
                    const original = this._model;
                    this._model = fallback;
                    const result = await super._callCompletion(0);
                    this._model = original; // Restore
                    console.warn(`[Ollama] Degraded to ${fallback}`);
                    return result;
                } catch {
                    continue;
                }
            }
            throw e;
        }
    }
}

module.exports = OllamaBrain;
