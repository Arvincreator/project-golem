// model-router.test.js — vitest globals mode (no import needed)

// Mock process.env before requiring model-router
process.env.GOLEM_BRAIN_ENGINE = 'api';

const path = require('path');

describe('model-router', () => {
    let router;

    beforeEach(() => {
        const routerPath = path.resolve(__dirname, '../src/skills/core/model-router.js');
        delete require.cache[routerPath];
        router = require(routerPath);
    });

    describe('classifyTask', () => {
        it('should classify code messages', () => {
            expect(router.classifyTask('Write a fibonacci function')).toBe('code');
        });

        it('should classify reasoning messages', () => {
            expect(router.classifyTask('Prove that x^2 + 3x - 10 = 0 has two solutions')).toBe('reasoning');
        });

        it('should classify creative messages', () => {
            expect(router.classifyTask('Write a short poem about AI')).toBe('creative');
        });

        it('should classify fast messages', () => {
            expect(router.classifyTask('translate this to English')).toBe('fast');
        });

        it('should classify analysis messages', () => {
            expect(router.classifyTask('analyze the current AI market trends')).toBe('analysis');
        });

        it('should classify flexible messages', () => {
            expect(router.classifyTask('what is machine learning?')).toBe('flexible');
        });

        it('should return chat for unclassified', () => {
            expect(router.classifyTask('嗨')).toBe('chat');
        });
    });

    describe('selectBestModel', () => {
        it('should route code to gpt-4o in API mode', () => {
            const result = router.selectBestModel('fix this bug in my function', { engine: 'api' });
            expect(result.taskType).toBe('code');
            expect(result.model).toBe('gpt-4o');
            expect(result.reason).toBe('routing_rule');
        });

        it('should route fast to gemini-1.5-flash in API mode', () => {
            const result = router.selectBestModel('quick summary of this', { engine: 'api' });
            expect(result.taskType).toBe('fast');
            expect(result.model).toBe('gemini-1.5-flash-002');
            expect(result.reason).toBe('routing_rule');
        });

        it('should route creative to gpt-4o in API mode', () => {
            const result = router.selectBestModel('write a story about robots', { engine: 'api' });
            expect(result.taskType).toBe('creative');
            expect(result.model).toBe('gpt-4o');
        });

        it('should route flexible to llama in API mode', () => {
            const result = router.selectBestModel('what is quantum computing?', { engine: 'api' });
            expect(result.taskType).toBe('flexible');
            expect(result.model).toBe('llama-3.3-70b-instruct');
        });

        it('should use length_hint or exploration for chat type', () => {
            const result = router.selectBestModel('hi', { engine: 'api' });
            expect(result.taskType).toBe('chat');
            expect(['length_hint', 'exploration']).toContain(result.reason);
        });

        it('should NOT use length_hint for classified tasks', () => {
            const result = router.selectBestModel('debug this', { engine: 'api' });
            expect(result.taskType).toBe('code');
            expect(result.reason).not.toBe('length_hint');
        });

        it('should classify code in web mode', () => {
            const result = router.selectBestModel('implement a new class', { engine: 'browser' });
            expect(result.taskType).toBe('code');
            expect(result.engine).toBe('web');
            // Model may vary due to A/B exploration (10%), but should be a valid WEB model
        });
    });

    describe('run() text extraction', () => {
        it('should extract text from ctx.message', async () => {
            const result = await router.run({
                message: 'debug this function',
                brain: { engineMode: 'api' },
            });
            expect(result.taskType).toBe('code');
        });

        it('should extract text from ctx.args.task', async () => {
            const result = await router.run({
                args: { task: 'write a poem' },
                brain: { engineMode: 'api' },
            });
            expect(result.taskType).toBe('creative');
        });

        it('should extract text from ctx.lastMessage', async () => {
            const result = await router.run({
                lastMessage: { content: 'analyze market data' },
                brain: { engineMode: 'api' },
            });
            expect(result.taskType).toBe('analysis');
        });
    });

    describe('module exports', () => {
        it('should export name and run', () => {
            expect(router.name).toBe('model-router');
            expect(typeof router.run).toBe('function');
        });

        it('should export classifyTask and selectBestModel', () => {
            expect(typeof router.classifyTask).toBe('function');
            expect(typeof router.selectBestModel).toBe('function');
        });
    });
});
