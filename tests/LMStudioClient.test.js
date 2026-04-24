const LMStudioClient = require('../src/services/LMStudioClient');

function mockJsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status >= 200 && status < 300 ? 'OK' : 'ERROR',
        text: async () => JSON.stringify(payload),
    };
}

describe('LMStudioClient', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete global.fetch;
        jest.clearAllMocks();
    });

    test('chat() posts to /chat/completions and returns text', async () => {
        global.fetch.mockResolvedValueOnce(
            mockJsonResponse(200, {
                choices: [{ message: { content: 'hello from lm studio' } }]
            })
        );

        const client = new LMStudioClient({
            baseUrl: 'http://127.0.0.1:1234/v1',
            timeoutMs: 5000,
            apiKey: 'sk-test'
        });
        const output = await client.chat('ping', { model: 'qwen2.5-14b-instruct' });

        expect(output).toBe('hello from lm studio');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
        expect(options.method).toBe('POST');
        expect(options.headers.Authorization).toBe('Bearer sk-test');
        expect(JSON.parse(options.body)).toMatchObject({
            model: 'qwen2.5-14b-instruct'
        });
    });

    test('chat() supports content array payload', async () => {
        global.fetch.mockResolvedValueOnce(
            mockJsonResponse(200, {
                choices: [{ message: { content: [{ text: 'chunk-a' }, { text: 'chunk-b' }] } }]
            })
        );

        const client = new LMStudioClient({ baseUrl: 'http://127.0.0.1:1234/v1', timeoutMs: 5000 });
        const output = await client.chat('ping', { model: 'local-model' });

        expect(output).toBe('chunk-achunk-b');
    });

    test('chat() throws useful error when API responds with non-2xx', async () => {
        global.fetch.mockResolvedValueOnce(
            mockJsonResponse(400, {
                error: { message: 'bad request' }
            })
        );

        const client = new LMStudioClient({ baseUrl: 'http://127.0.0.1:1234/v1', timeoutMs: 5000 });

        await expect(client.chat('ping', { model: 'local-model' }))
            .rejects
            .toThrow('[LMStudio:/chat/completions] 400 bad request');
    });
});
