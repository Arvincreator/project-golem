const EventEmitter = require('events');

jest.mock('fs', () => ({
    existsSync: jest.fn()
}));

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

const fs = require('fs');
const { spawn } = require('child_process');
const opencliSearch = require('../src/skills/core/opencli-search');

function queueSpawnResult({ code = 0, stdout = '', stderr = '', error = null }) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();

    spawn.mockImplementationOnce(() => {
        process.nextTick(() => {
            if (stdout) child.stdout.emit('data', Buffer.from(stdout));
            if (stderr) child.stderr.emit('data', Buffer.from(stderr));
            if (error) child.emit('error', error);
            else child.emit('close', code);
        });
        return child;
    });
}

describe('opencli_search skill', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockImplementation((target) => String(target).includes('opencli'));
    });

    test('builds google command with clamped limit and inferred en lang', async () => {
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'OpenAI', url: 'https://openai.com', snippet: 'AI' }])
        });

        const output = await opencliSearch.run({
            args: { query: 'OpenAI', source: 'google', limit: 999 }
        });

        expect(spawn).toHaveBeenCalledTimes(1);
        const args = spawn.mock.calls[0][1];
        expect(args).toEqual([
            'google',
            'search',
            'OpenAI',
            '--limit',
            '100',
            '--lang',
            'en',
            '-f',
            'json'
        ]);
        expect(output).toContain('結果數: 1');
    });

    test('auto source prefers google news for news-like query', async () => {
        queueSpawnResult({ code: 66, stderr: 'no data' });
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'AI Update', url: 'https://example.com' }])
        });

        const output = await opencliSearch.run({
            args: { query: '最新 AI 新聞', source: 'auto', limit: 5 }
        });

        expect(spawn).toHaveBeenCalledTimes(2);
        expect(spawn.mock.calls[0][1].slice(0, 2)).toEqual(['google', 'news']);
        expect(spawn.mock.calls[1][1].slice(0, 2)).toEqual(['google', 'search']);
        expect(output).toContain('來源策略: news -> google');
    });

    test('falls back to wikipedia when google returns bridge error 69', async () => {
        queueSpawnResult({ code: 69, stderr: 'Browser Bridge extension not connected' });
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'OpenAI', url: 'https://en.wikipedia.org/wiki/OpenAI', snippet: 'wiki' }])
        });

        const output = await opencliSearch.run({
            args: { query: 'OpenAI', source: 'auto' }
        });

        expect(spawn).toHaveBeenCalledTimes(2);
        expect(spawn.mock.calls[0][1].slice(0, 2)).toEqual(['google', 'search']);
        expect(spawn.mock.calls[1][1].slice(0, 2)).toEqual(['wikipedia', 'search']);
        expect(output).toContain('已啟用降級路徑');
        expect(output).toContain('[wikipedia]');
    });

    test.each([77, 78])('falls back when google returns auth/config exit code %s', async (exitCode) => {
        queueSpawnResult({ code: exitCode, stderr: 'auth/config issue' });
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'OpenAI', url: 'https://en.wikipedia.org/wiki/OpenAI' }])
        });

        const output = await opencliSearch.run({
            args: { query: 'OpenAI', source: 'auto' }
        });

        expect(spawn.mock.calls[1][1].slice(0, 2)).toEqual(['wikipedia', 'search']);
        expect(output).toContain(`[wikipedia]`);
        expect(output).toContain(`exit ${exitCode}`);
    });

    test('continues fallback and keeps diagnostics for temporary failure (exit 75)', async () => {
        queueSpawnResult({ code: 75, stderr: 'temporary failure' });
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'Wiki Result', url: 'https://example.com/wiki' }])
        });

        const output = await opencliSearch.run({
            args: { query: 'OpenAI', source: 'auto' }
        });

        expect(output).toContain('[wikipedia]');
        expect(output).toContain('exit 75');
    });

    test('continues on exit 66 and succeeds on later fallback source', async () => {
        queueSpawnResult({ code: 66, stderr: 'google empty' });
        queueSpawnResult({ code: 66, stderr: 'wiki empty' });
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'HN Result', url: 'https://news.ycombinator.com/item?id=1', score: 10 }])
        });

        const output = await opencliSearch.run({
            args: { query: 'OpenCLI', source: 'google', limit: 3 }
        });

        expect(spawn).toHaveBeenCalledTimes(3);
        expect(spawn.mock.calls[2][1].slice(0, 2)).toEqual(['hackernews', 'search']);
        expect(output).toContain('[hackernews]');
        expect(output).toContain('HN Result');
    });

    test('keeps diagnostics when JSON parsing fails and then falls back', async () => {
        queueSpawnResult({ code: 0, stdout: 'not-json' });
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'Wiki Result', url: 'https://example.com/wiki' }])
        });

        const output = await opencliSearch.run({
            args: { query: 'OpenAI', source: 'auto' }
        });

        expect(output).toContain('JSON 解析失敗');
        expect(output).toContain('[wikipedia]');
    });

    test('returns actionable message when local opencli binary is missing', async () => {
        fs.existsSync.mockReturnValue(false);

        const output = await opencliSearch.run({
            args: { query: 'OpenAI' }
        });

        expect(spawn).not.toHaveBeenCalled();
        expect(output).toContain('找不到 OpenCLI 可執行檔');
        expect(output).toContain('npm install @jackwener/opencli');
    });

    test('infers zh lang for CJK query when lang is omitted', async () => {
        queueSpawnResult({
            code: 0,
            stdout: JSON.stringify([{ title: 'OpenAI', url: 'https://example.com' }])
        });

        await opencliSearch.run({
            args: { query: '台灣 AI 搜尋', source: 'google' }
        });

        const args = spawn.mock.calls[0][1];
        expect(args).toContain('--lang');
        expect(args).toContain('zh');
    });
});
