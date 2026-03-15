const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// DOM Doctor v2 (Monica API / Ollama fallback)
class DOMDoctor {
    constructor() {
        this.cacheFile = path.join(process.cwd(), 'golem_selectors.json');
        this.defaults = {
            input: 'textarea, div[contenteditable="true"], rich-textarea > div, p[data-placeholder]',
            send: 'div[class*="rounded-[100px]"][class*="clickable"], div.clickable, button[aria-label*="Send"], button[aria-label*="\u50b3\u9001"]',
            response: '[class*="markdown"], [class*="message-content"], [class*="response"], .markdown-body, div[class*="content"]'
        };
    }

    loadSelectors() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
                return { ...this.defaults, ...cached };
            }
        } catch (e) { }
        return { ...this.defaults };
    }

    saveSelectors(newSelectors) {
        try {
            const current = this.loadSelectors();
            const updated = { ...current, ...newSelectors };
            fs.writeFileSync(this.cacheFile, JSON.stringify(updated, null, 2));
            console.log('[Doctor] Selector updated and saved');
        } catch (e) { }
    }

    async _callLLM(prompt) {
        const monicaKey = process.env.MONICA_API_KEY;
        if (monicaKey) {
            try { return await this._callMonicaAPI(prompt, monicaKey); }
            catch (e) { console.warn(`[Doctor] Monica API failed: ${e.message}`); }
        }
        // Try Groq (free, fast)
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey) {
            try { return await this._callGroq(prompt, groqKey); }
            catch (e) { console.warn(`[Doctor] Groq failed: ${e.message}`); }
        }
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const ollamaModel = process.env.OLLAMA_MODEL || 'ri:8b';
        try { return await this._callOllama(prompt, ollamaUrl, ollamaModel); }
        catch (e) { console.warn(`[Doctor] Ollama failed: ${e.message}`); }
        return null;
    }

    async _callMonicaAPI(prompt, apiKey) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 200,
            });
            const req = https.request({
                hostname: 'openapi.monica.im',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Length': Buffer.byteLength(data),
                },
                timeout: 30000,
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        resolve(json.choices?.[0]?.message?.content || '');
                    } catch (e) { reject(new Error('JSON parse failed')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(data);
            req.end();
        });
    }


    async _callGroq(prompt, apiKey) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 200,
            });
            const req = https.request({
                hostname: 'api.groq.com',
                path: '/openai/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey,
                    'Content-Length': Buffer.byteLength(data),
                },
                timeout: 30000,
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        if (json.error) { reject(new Error(json.error.message)); return; }
                        resolve(json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '');
                    } catch (e) { reject(new Error('JSON parse failed')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(data);
            req.end();
        });
    }

    async _callOllama(prompt, baseUrl, model) {
        return new Promise((resolve, reject) => {
            const url = new URL(baseUrl + '/api/generate');
            const data = JSON.stringify({ model, prompt, stream: false });
            const transport = url.protocol === 'https:' ? https : http;
            const req = transport.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
                timeout: 30000,
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        resolve(json.response || '');
                    } catch (e) { reject(new Error('JSON parse failed')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(data);
            req.end();
        });
    }

    async diagnose(htmlSnippet, targetType) {
        const hints = {
            'input': 'Find the input container div with contenteditable or role=textbox.',
            'send': 'Find the send button with aria-label=Send.',
            'response': 'Find the AI response text bubble.'
        };
        const targetDescription = hints[targetType] || targetType;
        console.log(`[Doctor] Diagnosing: target [${targetType}]...`);

        let safeHtml = htmlSnippet;
        if (htmlSnippet.length > 60000) {
            safeHtml = htmlSnippet.substring(0, 5000) + '\n\n' + htmlSnippet.substring(htmlSnippet.length - 55000);
        }

        const prompt = `You are a Puppeteer automation expert. The current CSS Selector is broken.\n` +
            `Analyze this HTML and find the best CSS Selector for: "${targetType}" (${targetDescription}).\n\n` +
            `HTML snippet:\n\`\`\`html\n${safeHtml}\n\`\`\`\n\n` +
            `Rules:\n1. Return ONLY JSON: {"selector": "your_css_selector"}\n` +
            `2. High specificity but no random IDs.\n` +
            `3. Prefer id, name, role, aria-label, data-attributes.`;

        try {
            const rawText = await this._callLLM(prompt);
            if (!rawText) { console.warn('[Doctor] No LLM available, skipping.'); return null; }

            let selector = '';
            try {
                const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(jsonStr);
                selector = parsed.selector;
            } catch (jsonErr) {
                const lines = rawText.split('\n').filter(l => l.trim().length > 0);
                const lastLine = lines[lines.length - 1].trim();
                if (!lastLine.includes(' ')) selector = lastLine;
            }

            if (selector && selector.length > 0 && selector.length < 150) {
                console.log(`[Doctor] Diagnosis success, new Selector: ${selector}`);
                return selector;
            } else {
                console.warn(`[Doctor] Invalid selector from AI: ${selector}`);
            }
        } catch (e) {
            console.error(`[Doctor] Diagnosis error: ${e.message}`);
        }
        return null;
    }
}

module.exports = DOMDoctor;