// ============================================================
// MonicaBrain — Unit Tests
// Tests: retry via this (F4), estimateTokens cost tracking (F8),
//        rate limiting, key rotation
// ============================================================

// Mock monica-constants
jest.mock('../src/core/monica-constants', () => {
    const original = jest.requireActual('../src/core/monica-constants');
    return {
        ...original,
        MODEL_SPECS: {
            'gpt-4o': { apiId: 'gpt-4o', context: 128000, maxOutput: 16384, rpm: 3, tpm: 3000, costIn: 2.50, costOut: 10.00, tier: 'basic' },
        },
        getModelSpec: (model) => original.getModelSpec(model),
        resolveForBrain: original.resolveForBrain,
        estimateTokens: original.estimateTokens,
    };
});

// Mock OpenAICompatBrain
jest.mock('../src/core/OpenAICompatBrain', () => {
    return class MockOpenAICompatBrain {
        constructor(opts) {
            this._model = opts.defaultModel || 'gpt-4o';
            this._maxTokens = opts.maxTokens || 8192;
            this._messages = [];
        }
        async _callCompletion(retryCount = 0) {
            return 'mock response text for testing';
        }
    };
});

const MonicaBrain = require('../src/core/MonicaBrain');
const { estimateTokens } = require('../src/core/monica-constants');

describe('MonicaBrain', () => {
    let brain;

    beforeEach(() => {
        process.env.MONICA_API_KEYS = 'test-key-aaaaaaaaa,test-key-bbbbbbbbb';
        brain = new MonicaBrain();
    });

    afterEach(() => {
        delete process.env.MONICA_API_KEYS;
    });

    describe('F4: _callCompletion retry uses this instead of super', () => {
        test('429 retry goes through this._callCompletion (respects rate check)', async () => {
            const callOrder = [];
            brain._messages = [{ content: 'test' }];

            // Override _callCompletion to track calls
            const originalCall = brain._callCompletion.bind(brain);
            let callCount = 0;
            brain._checkRateLimit = jest.fn(async () => {
                callOrder.push('rateCheck');
            });

            // The fix: super._callCompletion → this._callCompletion
            // We verify that on 429 retry, _checkRateLimit is called again
            const superCall = Object.getPrototypeOf(Object.getPrototypeOf(brain))._callCompletion;

            // Simulate: first call throws 429, second succeeds
            const mockSuper = jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(brain)), '_callCompletion')
                .mockImplementationOnce(() => { throw new Error('429 rate limit'); })
                .mockImplementationOnce(() => Promise.resolve('success'));

            const result = await brain._callCompletion(0);
            // On retry via this, _checkRateLimit should be called twice (once per _callCompletion call)
            expect(brain._checkRateLimit).toHaveBeenCalledTimes(2);
            expect(result).toBe('success');

            mockSuper.mockRestore();
        });
    });

    describe('F8: _trackCost uses estimateTokens with CJK awareness', () => {
        test('CJK text produces more tokens than simple char/4', () => {
            const cjkText = '你好世界這是一個測試文字';
            const latinText = 'hello world this is a test';

            const cjkTokens = estimateTokens(cjkText);
            const latinTokens = estimateTokens(latinText);

            // CJK should produce ~1 token per 1.5 chars, not 1 per 4
            expect(cjkTokens).toBeGreaterThan(cjkText.length / 4);
            expect(latinTokens).toBe(Math.ceil(latinText.length / 4));
        });

        test('_trackCost accepts text strings, not char counts', () => {
            const cost = brain._trackCost('gpt-4o', '你好世界', 'Hello');
            expect(cost).toBeGreaterThan(0);
            expect(brain._totalCost).toBe(cost);
        });

        test('_trackCost accumulates total cost', () => {
            brain._trackCost('gpt-4o', 'input one', 'output one');
            const first = brain._totalCost;
            brain._trackCost('gpt-4o', 'input two', 'output two');
            expect(brain._totalCost).toBeGreaterThan(first);
        });
    });

    describe('Rate limiting (_checkRateLimit)', () => {
        test('allows requests within RPM limit', async () => {
            await expect(brain._checkRateLimit('gpt-4o')).resolves.not.toThrow();
            await expect(brain._checkRateLimit('gpt-4o')).resolves.not.toThrow();
        });

        test('throws when RPM exceeded', async () => {
            // gpt-4o has rpm:100 in real specs — fill up timestamps
            const spec = require('../src/core/monica-constants').getModelSpec('gpt-4o');
            for (let i = 0; i < spec.rpm; i++) {
                brain._requestTimestamps.push(Date.now());
            }
            await expect(brain._checkRateLimit('gpt-4o')).rejects.toThrow(/Rate limit/);
        });

        test('sliding window clears old timestamps', async () => {
            // Add old timestamps
            brain._requestTimestamps = [Date.now() - 70000, Date.now() - 65000];
            // Should not count old ones
            await expect(brain._checkRateLimit('gpt-4o')).resolves.not.toThrow();
        });
    });

    describe('Key rotation (_rotateKey)', () => {
        test('rotates through available keys', () => {
            expect(brain._monicaKeyIndex).toBe(0);
            brain._rotateKey();
            expect(brain._monicaKeyIndex).toBe(1);
            brain._rotateKey();
            expect(brain._monicaKeyIndex).toBe(0); // wraps around
        });

        test('_getApiKey returns current key', () => {
            expect(brain._getApiKey()).toBe('test-key-aaaaaaaaa');
            brain._rotateKey();
            expect(brain._getApiKey()).toBe('test-key-bbbbbbbbb');
        });
    });
});
