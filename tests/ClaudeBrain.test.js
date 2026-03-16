// tests/ClaudeBrain.test.js
const ClaudeBrain = require('../src/core/ClaudeBrain');

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
    return jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'Hello from Claude!' }],
                usage: { input_tokens: 10, output_tokens: 20 },
            }),
        },
    }));
});

describe('ClaudeBrain', () => {
    let brain;
    const originalEnv = process.env.ANTHROPIC_API_KEY;

    beforeEach(() => {
        process.env.ANTHROPIC_API_KEY = 'test-key-12345';
        brain = new ClaudeBrain({ serviceId: 'claude' });
    });

    afterEach(() => {
        if (originalEnv) {
            process.env.ANTHROPIC_API_KEY = originalEnv;
        } else {
            delete process.env.ANTHROPIC_API_KEY;
        }
    });

    test('inherits from OpenAICompatBrain', () => {
        const OpenAICompatBrain = require('../src/core/OpenAICompatBrain');
        expect(brain).toBeInstanceOf(OpenAICompatBrain);
    });

    test('constructor sets correct defaults', () => {
        expect(brain._serviceId).toBe('claude');
        expect(brain._model).toBe('claude-opus-4-6-20250515');
        expect(brain._maxTokens).toBe(8192);
        expect(brain._timeout).toBe(120000);
    });

    test('constructor accepts custom model', () => {
        const custom = new ClaudeBrain({ model: 'claude-sonnet-4-6-20250514' });
        expect(custom._model).toBe('claude-sonnet-4-6-20250514');
    });

    test('_getApiKey returns ANTHROPIC_API_KEY', () => {
        expect(brain._getApiKey()).toBe('test-key-12345');
    });

    test('_callCompletion calls Anthropic SDK', async () => {
        brain._systemPrompt = 'You are a helpful assistant';
        brain._messages = [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Hello' },
        ];

        const result = await brain._callCompletion();
        expect(result).toBe('Hello from Claude!');
    });

    test('_callCompletion throws without API key', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        const noKeyBrain = new ClaudeBrain({});
        noKeyBrain._messages = [{ role: 'user', content: 'hi' }];

        await expect(noKeyBrain._callCompletion()).rejects.toThrow('No ANTHROPIC_API_KEY');
    });

    test('supports RAG provider', () => {
        const mockRag = { augmentedRecall: jest.fn(), ingest: jest.fn() };
        const ragBrain = new ClaudeBrain({ ragProvider: mockRag });
        expect(ragBrain._ragProvider).toBe(mockRag);
    });

    test('creates Anthropic client with maxRetries: 0', async () => {
        brain._messages = [{ role: 'user', content: 'test' }];
        await brain._callCompletion();
        const Anthropic = require('@anthropic-ai/sdk');
        expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    });
});
