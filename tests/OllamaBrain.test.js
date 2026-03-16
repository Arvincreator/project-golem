// ============================================================
// OllamaBrain — Unit Tests
// DeepSeek R1:8B parameters, thinking extraction, auto-start, internal fallback
// GPU/CPU hybrid inference (v9.9)
// ============================================================

// Mock child_process
const mockSpawn = jest.fn();
const mockExecSync = jest.fn();
const mockExec = jest.fn();
jest.mock('child_process', () => ({
    spawn: (...args) => mockSpawn(...args),
    execSync: (...args) => mockExecSync(...args),
    exec: (...args) => mockExec(...args),
}));

// Mock os module
const mockTotalmem = jest.fn(() => 8 * 1024 * 1024 * 1024); // 8GB
const mockFreemem = jest.fn(() => 4 * 1024 * 1024 * 1024);  // 4GB
jest.mock('os', () => ({
    totalmem: () => mockTotalmem(),
    freemem: () => mockFreemem(),
}));

// Mock OpenAICompatBrain
jest.mock('../src/core/OpenAICompatBrain', () => {
    return class MockOpenAICompatBrain {
        constructor(opts) {
            this._baseURL = opts.baseURL || '';
            this._apiKey = opts.apiKey || '';
            this._model = opts.defaultModel || 'gpt-4o';
            this._serviceId = opts.serviceId || 'openai';
            this._maxTokens = opts.maxTokens || 8192;
            this._temperature = opts.temperature || 0.7;
            this._timeout = opts.timeout || 30000;
            this._messages = [];
            this._systemPrompt = null;
        }
        _buildRequestBody() {
            return {
                model: this._model,
                messages: this._messages,
                max_tokens: this._maxTokens,
                temperature: this._temperature,
            };
        }
        async init() { this._systemPrompt = 'test'; }
        async sendMessage(text) { return `mock: ${text}`; }
        async _callCompletion(retryCount = 0) { return 'mock response'; }
    };
});

const OllamaBrain = require('../src/core/OllamaBrain');

describe('OllamaBrain', () => {
    let brain;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        brain = new OllamaBrain();
        mockSpawn.mockReset();
        mockExecSync.mockReset();
        global.fetch = jest.fn();
        // Clean GPU env vars
        delete process.env.OLLAMA_NUM_GPU;
        delete process.env.OLLAMA_NUM_THREAD;
        delete process.env.OLLAMA_GPU_TIMEOUT;
        delete process.env.OLLAMA_ADAPTIVE_CTX;
        delete process.env.OLLAMA_MIN_NUM_CTX;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    // 1. Constructor defaults
    describe('constructor defaults', () => {
        test('uses deepseek-r1:8b as default model', () => {
            expect(brain._model).toBe('deepseek-r1:8b');
        });

        test('uses 90s timeout for CPU inference', () => {
            expect(brain._timeout).toBe(90000);
        });

        test('uses 0.6 temperature for R1 reasoning', () => {
            expect(brain._temperature).toBe(0.6);
        });

        test('uses 8192 max tokens', () => {
            expect(brain._maxTokens).toBe(8192);
        });

        test('sets fallback models', () => {
            expect(brain._fallbackModels).toEqual(['qwen2:1.5b']);
        });

        test('initializes GPU hybrid fields to null', () => {
            expect(brain._gpuInfo).toBeNull();
            expect(brain._gpuLayers).toBeNull();
            expect(brain._cpuThreads).toBeNull();
            expect(brain._adaptiveTimeout).toBeNull();
            expect(brain._adaptiveNumCtx).toBeNull();
            expect(brain._oomRetryCount).toBe(0);
        });
    });

    // 2. _buildRequestBody
    describe('_buildRequestBody()', () => {
        test('includes ollama options with num_ctx and num_predict', () => {
            const body = brain._buildRequestBody();
            expect(body.options).toBeDefined();
            expect(body.options.num_ctx).toBe(32768);
            expect(body.options.num_predict).toBe(8192);
            expect(body.options.repeat_penalty).toBe(1.1);
        });

        test('inherits base fields from super', () => {
            const body = brain._buildRequestBody();
            expect(body.model).toBe('deepseek-r1:8b');
            expect(body.temperature).toBe(0.6);
        });

        test('includes num_gpu when GPU mode active', () => {
            brain._gpuLayers = -1;
            const body = brain._buildRequestBody();
            expect(body.options.num_gpu).toBe(-1);
        });

        test('includes num_thread when set', () => {
            brain._gpuLayers = -1;
            brain._cpuThreads = 4;
            const body = brain._buildRequestBody();
            expect(body.options.num_thread).toBe(4);
        });

        test('does not include num_gpu when null (CPU backward compat)', () => {
            brain._gpuLayers = null;
            const body = brain._buildRequestBody();
            expect(body.options.num_gpu).toBeUndefined();
        });

        test('uses adaptiveNumCtx when set', () => {
            brain._adaptiveNumCtx = 16384;
            const body = brain._buildRequestBody();
            expect(body.options.num_ctx).toBe(16384);
        });
    });

    // 3-5. _extractThinking
    describe('_extractThinking()', () => {
        test('extracts thinking block from R1 output', () => {
            const input = '<think>Step 1: analyze\nStep 2: solve</think>The answer is 42.';
            const result = brain._extractThinking(input);
            expect(result.thinking).toBe('Step 1: analyze\nStep 2: solve');
            expect(result.content).toBe('The answer is 42.');
        });

        test('returns original content when no thinking block', () => {
            const input = 'Just a normal response.';
            const result = brain._extractThinking(input);
            expect(result.thinking).toBeNull();
            expect(result.content).toBe('Just a normal response.');
        });

        test('handles multiple thinking blocks', () => {
            const input = '<think>First thought</think>Middle<think>Second thought</think>End';
            const result = brain._extractThinking(input);
            expect(result.thinking).toBe('First thought'); // First match
            expect(result.content).toBe('MiddleEnd');
        });

        test('handles empty thinking block', () => {
            const input = '<think></think>Content after.';
            const result = brain._extractThinking(input);
            expect(result.thinking).toBe(''); // Empty thinking block
            expect(result.content).toBe('Content after.');
        });
    });

    // 6. _ensureOllamaRunning — healthy
    describe('_ensureOllamaRunning()', () => {
        test('returns immediately if server is healthy', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: true });
            await brain._ensureOllamaRunning();
            expect(mockSpawn).not.toHaveBeenCalled();
        });

        // 7. _ensureOllamaRunning — spawn
        test('spawns ollama serve if server not reachable', async () => {
            const mockProcess = { unref: jest.fn() };
            mockSpawn.mockReturnValue(mockProcess);

            let callCount = 0;
            global.fetch = jest.fn().mockImplementation(() => {
                callCount++;
                if (callCount <= 1) throw new Error('ECONNREFUSED');
                return Promise.resolve({ ok: true });
            });

            await brain._ensureOllamaRunning();
            expect(mockSpawn).toHaveBeenCalledWith('ollama', ['serve'], {
                detached: true,
                stdio: 'ignore',
            });
            expect(mockProcess.unref).toHaveBeenCalled();
        });
    });

    // 8. Internal fallback — success
    describe('_callCompletion() internal fallback', () => {
        test('falls back to secondary model on primary failure', async () => {
            let callCount = 0;
            brain._callCompletion = OllamaBrain.prototype._callCompletion.bind(brain);

            // Override super._callCompletion to fail on primary, succeed on fallback
            const superCall = jest.fn().mockImplementation(() => {
                callCount++;
                if (brain._model === 'deepseek-r1:8b') {
                    throw new Error('Model not found');
                }
                return Promise.resolve('fallback response');
            });
            Object.getPrototypeOf(Object.getPrototypeOf(brain))._callCompletion = superCall;

            const result = await brain._callCompletion(0);
            expect(result).toBe('fallback response');
            // Model should be restored
            expect(brain._model).toBe('deepseek-r1:8b');
        });

        // 9. Internal fallback — all fail
        test('throws when all models fail', async () => {
            brain._callCompletion = OllamaBrain.prototype._callCompletion.bind(brain);
            Object.getPrototypeOf(Object.getPrototypeOf(brain))._callCompletion = jest.fn()
                .mockRejectedValue(new Error('All models failed'));

            await expect(brain._callCompletion(0)).rejects.toThrow('All models failed');
        });
    });

    // 10. ENV overrides
    describe('ENV overrides', () => {
        test('OLLAMA_MODEL overrides default model', () => {
            process.env.OLLAMA_MODEL = 'llama3:8b';
            const b = new OllamaBrain();
            expect(b._model).toBe('llama3:8b');
        });

        test('OLLAMA_TIMEOUT overrides default timeout', () => {
            process.env.OLLAMA_TIMEOUT = '120000';
            const b = new OllamaBrain();
            expect(b._timeout).toBe(120000);
        });

        test('OLLAMA_NUM_PREDICT overrides max tokens', () => {
            process.env.OLLAMA_NUM_PREDICT = '4096';
            const b = new OllamaBrain();
            expect(b._maxTokens).toBe(4096);
        });

        test('OLLAMA_NUM_CTX overrides context in request body', () => {
            process.env.OLLAMA_NUM_CTX = '16384';
            const b = new OllamaBrain();
            const body = b._buildRequestBody();
            expect(body.options.num_ctx).toBe(16384);
        });

        test('OLLAMA_FALLBACK_MODELS overrides fallback list', () => {
            process.env.OLLAMA_FALLBACK_MODELS = 'phi3:mini,gemma2:2b';
            const b = new OllamaBrain();
            expect(b._fallbackModels).toEqual(['phi3:mini', 'gemma2:2b']);
        });
    });

    // ========== GPU/CPU Hybrid Tests (v9.9) ==========

    describe('_detectGPU()', () => {
        test('detects GPU when nvidia-smi succeeds', async () => {
            mockExec.mockImplementation((cmd, opts, cb) => {
                if (typeof opts === 'function') { cb = opts; }
                cb(null, { stdout: 'NVIDIA GeForce RTX 4050, 6144, 5500\n', stderr: '' });
            });
            await brain._detectGPU();
            expect(brain._gpuInfo).toEqual({
                available: true,
                name: 'NVIDIA GeForce RTX 4050',
                vramTotalMB: 6144,
                vramFreeMB: 5500,
            });
        });

        test('falls back to CPU when nvidia-smi fails', async () => {
            mockExec.mockImplementation((cmd, opts, cb) => {
                if (typeof opts === 'function') { cb = opts; }
                cb(new Error('command not found'));
            });
            await brain._detectGPU();
            expect(brain._gpuInfo).toEqual({ available: false });
        });

        test('forces CPU-only when OLLAMA_NUM_GPU=0', async () => {
            process.env.OLLAMA_NUM_GPU = '0';
            mockExec.mockClear();
            await brain._detectGPU();
            expect(brain._gpuInfo).toEqual({ available: false });
            expect(mockExec).not.toHaveBeenCalled();
        });
    });

    describe('_detectSystemMemory()', () => {
        test('returns system memory info', () => {
            const mem = brain._detectSystemMemory();
            expect(mem.totalMB).toBe(8192);
            expect(mem.freeMB).toBe(4096);
        });
    });

    describe('_estimateModelSize()', () => {
        test('estimates 8B model at ~4700MB', () => {
            expect(brain._estimateModelSize('deepseek-r1:8b')).toBe(4700);
        });

        test('estimates 1.5B model at ~900MB', () => {
            expect(brain._estimateModelSize('qwen2:1.5b')).toBe(900);
        });

        test('estimates 2B model at ~900MB', () => {
            expect(brain._estimateModelSize('gemma:2b')).toBe(900);
        });

        test('defaults to 4700MB for unknown size', () => {
            expect(brain._estimateModelSize('unknown-model')).toBe(4700);
        });
    });

    describe('_calculateHybridParams()', () => {
        test('full GPU offload when VRAM sufficient (6GB free, 4.7GB model)', () => {
            brain._gpuInfo = { available: true, name: 'RTX 4050', vramTotalMB: 6144, vramFreeMB: 6000 };
            brain._calculateHybridParams();
            expect(brain._gpuLayers).toBe(-1);
            expect(brain._timeout).toBe(30000);
        });

        test('partial GPU offload when VRAM insufficient (3GB free)', () => {
            brain._gpuInfo = { available: true, name: 'RTX 3050', vramTotalMB: 4096, vramFreeMB: 3000 };
            brain._calculateHybridParams();
            expect(brain._gpuLayers).toBeGreaterThan(0);
            expect(brain._gpuLayers).toBeLessThan(33);
            expect(brain._timeout).toBe(60000);
        });

        test('CPU-only when no GPU detected', () => {
            brain._gpuInfo = { available: false };
            brain._calculateHybridParams();
            expect(brain._gpuLayers).toBe(0);
            expect(brain._timeout).toBe(90000); // unchanged
        });

        test('ENV OLLAMA_NUM_GPU overrides auto-detection', () => {
            process.env.OLLAMA_NUM_GPU = '0';
            brain._gpuInfo = { available: true, name: 'RTX 4050', vramTotalMB: 6144, vramFreeMB: 6000 };
            brain._calculateHybridParams();
            expect(brain._gpuLayers).toBe(0); // forced CPU
        });

        test('ENV OLLAMA_GPU_TIMEOUT overrides timeout', () => {
            process.env.OLLAMA_GPU_TIMEOUT = '15000';
            brain._gpuInfo = { available: true, name: 'RTX 4050', vramTotalMB: 6144, vramFreeMB: 6000 };
            brain._calculateHybridParams();
            expect(brain._timeout).toBe(15000);
        });

        test('shrinks ctx when model fits but KV cache too large for VRAM', () => {
            // 5200MB free * 0.9 = 4680MB usable, model 4700MB → partial
            // Actually let's use a scenario where model fits but total doesn't
            brain._gpuInfo = { available: true, name: 'RTX 4050', vramTotalMB: 6144, vramFreeMB: 5300 };
            // usableVram = 5300 * 0.9 = 4770, modelSize=4700 fits, but totalNeeded=4700+1638=6338 > 4770
            brain._calculateHybridParams();
            expect(brain._gpuLayers).toBe(-1); // model fits
            expect(brain._adaptiveNumCtx).toBeLessThan(32768); // ctx reduced
            expect(brain._adaptiveNumCtx).toBeGreaterThanOrEqual(8192); // above minimum
        });
    });

    describe('CUDA OOM retry', () => {
        test('reduces GPU layers on CUDA OOM and retries', async () => {
            brain._gpuLayers = -1;
            brain._callCompletion = OllamaBrain.prototype._callCompletion.bind(brain);

            let callCount = 0;
            Object.getPrototypeOf(Object.getPrototypeOf(brain))._callCompletion = jest.fn()
                .mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) throw new Error('CUDA out of memory');
                    return Promise.resolve('success after oom retry');
                });

            const result = await brain._callCompletion(0);
            expect(result).toBe('success after oom retry');
            expect(brain._gpuLayers).toBe(25); // -1 → 25
        });

        test('falls back to model fallback when OOM retry also fails', async () => {
            brain._gpuLayers = -1;
            brain._callCompletion = OllamaBrain.prototype._callCompletion.bind(brain);

            Object.getPrototypeOf(Object.getPrototypeOf(brain))._callCompletion = jest.fn()
                .mockImplementation(() => {
                    if (brain._model === 'deepseek-r1:8b') {
                        throw new Error('CUDA out of memory');
                    }
                    return Promise.resolve('fallback after oom');
                });

            const result = await brain._callCompletion(0);
            expect(result).toBe('fallback after oom');
            expect(brain._model).toBe('deepseek-r1:8b'); // restored
        });
    });

    describe('getGPUStatus()', () => {
        test('returns correct structure with GPU detected', () => {
            brain._gpuInfo = { available: true, name: 'RTX 4050', vramTotalMB: 6144, vramFreeMB: 5500 };
            brain._gpuLayers = -1;
            brain._cpuThreads = 4;
            brain._adaptiveNumCtx = 32768;
            brain._timeout = 30000;

            const status = brain.getGPUStatus();
            expect(status).toEqual({
                gpuAvailable: true,
                gpuName: 'RTX 4050',
                vramTotalMB: 6144,
                vramFreeMB: 5500,
                gpuLayers: -1,
                cpuThreads: 4,
                timeout: 30000,
                numCtx: 32768,
            });
        });

        test('returns correct structure with no GPU', () => {
            brain._gpuInfo = null;
            const status = brain.getGPUStatus();
            expect(status.gpuAvailable).toBe(false);
            expect(status.gpuName).toBeNull();
            expect(status.vramTotalMB).toBe(0);
            expect(status.vramFreeMB).toBe(0);
        });
    });
});
