const {
    parseDuckDuckGoHtml,
    fetchDuckDuckGoHtml,
    SEARCH_HEADERS,
} = require('../src/skills/modules/duckduckgo-search');

describe('duckduckgo-search skill', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('parses result__a titles and resolves DuckDuckGo redirect URLs', () => {
        const html = `
            <div class="result">
              <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpost%3Fa%3D1&amp;rut=abc">Example &amp; Title</a>
              <a class="result__snippet">This is &lt;b&gt;snippet&lt;/b&gt; text.</a>
              <span class="result__url">example.com/post</span>
            </div>
            <div class="result">
              <a class="result__a" href="https://news.example.tw/">Second Result</a>
            </div>
        `;

        const rows = parseDuckDuckGoHtml(html, { limit: 5 });

        expect(rows).toEqual([
            {
                rank: 1,
                title: 'Example & Title',
                url: 'https://example.com/post?a=1',
                snippet: 'This is snippet text.',
                source: 'example.com/post',
            },
            {
                rank: 2,
                title: 'Second Result',
                url: 'https://news.example.tw/',
                snippet: '',
                source: 'DuckDuckGo HTML search',
            },
        ]);
    });

    test('fetches html.duckduckgo.com with browser-like headers', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue('<html></html>'),
        });

        const result = await fetchDuckDuckGoHtml('台灣 AI', { timeoutMs: 5000 });

        expect(result.url).toBe('https://html.duckduckgo.com/html/?q=%E5%8F%B0%E7%81%A3+AI&kl=tw-tzh');
        expect(global.fetch).toHaveBeenCalledWith(result.url, expect.objectContaining({
            headers: expect.objectContaining({
                'Accept-Language': 'zh-TW,zh;q=0.9',
                Referer: 'https://html.duckduckgo.com/',
                'User-Agent': SEARCH_HEADERS['User-Agent'],
            }),
            redirect: 'follow',
        }));
    });
});
