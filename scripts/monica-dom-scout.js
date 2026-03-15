#!/usr/bin/env node
// ============================================================
// Monica.im DOM Scout — 偵察 Monica.im 聊天頁面的真實 DOM 結構
// 用途: 取得正確的 CSS selector 供 MonicaWebBrain 使用
//
// 使用方式:
//   首次: node scripts/monica-dom-scout.js --login   (開 GUI 讓你登入)
//   之後: node scripts/monica-dom-scout.js            (自動掃描)
// ============================================================
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const MONICA_URL = 'https://monica.im/home/chat';
const PROFILE_DIR = path.resolve(__dirname, '..', 'golem_memory', 'monica_profile');
const REPORT_FILE = path.resolve(__dirname, '..', 'monica_dom_report.json');
const SELECTOR_FILE = path.resolve(__dirname, '..', 'monica_selectors.json');

const isLoginMode = process.argv.includes('--login');
const isHeadless = !isLoginMode && (process.argv.includes('--headless') || process.env.PUPPETEER_HEADLESS === 'new');

async function main() {
    console.log('🔍 [Monica DOM Scout] Starting...');
    console.log(`   Profile: ${PROFILE_DIR}`);
    console.log(`   Mode: ${isLoginMode ? 'LOGIN (GUI)' : isHeadless ? 'HEADLESS' : 'GUI'}`);

    const browser = await puppeteer.launch({
        headless: isHeadless ? 'new' : false,
        userDataDir: PROFILE_DIR,
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--window-size=1400,900',
            '--disable-gpu',
        ],
    });

    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    console.log(`🌐 Navigating to ${MONICA_URL}...`);
    await page.goto(MONICA_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Check if redirected to login
    const url = page.url();
    console.log(`📍 Current URL: ${url}`);

    if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
        if (isLoginMode) {
            console.log('\n⚠️  Please login to Monica.im in the browser window.');
            console.log('   After login, the script will continue automatically.\n');
            // Wait for navigation away from login (max 5 min)
            try {
                await page.waitForNavigation({ timeout: 300000, waitUntil: 'networkidle2' });
                console.log('✅ Login detected! Continuing...');
                // Navigate to chat after login
                if (!page.url().includes('/chat')) {
                    await page.goto(MONICA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
                }
            } catch (e) {
                console.error('❌ Login timeout. Please try again.');
                await browser.close();
                process.exit(1);
            }
        } else {
            console.error('❌ Not logged in! Run with --login first: node scripts/monica-dom-scout.js --login');
            await browser.close();
            process.exit(1);
        }
    }

    // Wait for page to fully render (React/Next.js CSR)
    console.log('⏳ Waiting for chat interface to render...');
    await new Promise(r => setTimeout(r, 5000));

    // === PHASE 1: Full DOM scan ===
    console.log('🔬 Scanning DOM...');

    const report = await page.evaluate(() => {
        const result = {
            url: window.location.href,
            timestamp: new Date().toISOString(),
            inputs: [],
            buttons: [],
            messageContainers: [],
            modelSelectors: [],
            interestingElements: [],
            fullBodyClasses: document.body.className,
            chatAreaHTML: '',
        };

        // 1. Find all input-like elements
        const inputSelectors = [
            'textarea',
            '[contenteditable="true"]',
            '[role="textbox"]',
            'input[type="text"]',
            '.ant-input',
            '.ant-input-textarea textarea',
            '[class*="input"]',
            '[class*="sender"]',
            '[class*="editor"]',
            '[class*="compose"]',
        ];

        for (const sel of inputSelectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    if (el.offsetHeight > 0) { // visible only
                        result.inputs.push({
                            selector: sel,
                            tag: el.tagName.toLowerCase(),
                            id: el.id || '',
                            className: el.className?.toString?.() || '',
                            placeholder: el.getAttribute('placeholder') || '',
                            contentEditable: el.contentEditable,
                            role: el.getAttribute('role') || '',
                            ariaLabel: el.getAttribute('aria-label') || '',
                            rect: { w: el.offsetWidth, h: el.offsetHeight },
                            outerHTML: el.outerHTML.substring(0, 500),
                        });
                    }
                });
            } catch (e) {}
        }

        // 2. Find all buttons
        document.querySelectorAll('button, [role="button"], a.btn, [class*="send"], [class*="submit"]').forEach(el => {
            if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                const text = (el.innerText || '').trim().substring(0, 50);
                const ariaLabel = el.getAttribute('aria-label') || '';
                result.buttons.push({
                    tag: el.tagName.toLowerCase(),
                    id: el.id || '',
                    className: el.className?.toString?.() || '',
                    text,
                    ariaLabel,
                    title: el.getAttribute('title') || '',
                    disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
                    rect: { w: el.offsetWidth, h: el.offsetHeight, top: el.getBoundingClientRect().top },
                    outerHTML: el.outerHTML.substring(0, 400),
                });
            }
        });

        // 3. Find message containers
        const msgSelectors = [
            '[class*="message"]',
            '[class*="bubble"]',
            '[class*="chat"]',
            '[class*="response"]',
            '[class*="assistant"]',
            '[class*="markdown"]',
            '[role="article"]',
            '[role="log"]',
            '[class*="conversation"]',
            '[class*="msg"]',
        ];

        const seen = new Set();
        for (const sel of msgSelectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    const key = el.tagName + '.' + (el.className?.toString?.() || '').substring(0, 100);
                    if (!seen.has(key) && el.offsetHeight > 20) {
                        seen.add(key);
                        result.messageContainers.push({
                            selector: sel,
                            tag: el.tagName.toLowerCase(),
                            className: el.className?.toString?.() || '',
                            id: el.id || '',
                            childCount: el.children.length,
                            textLength: (el.innerText || '').length,
                            rect: { w: el.offsetWidth, h: el.offsetHeight },
                            outerHTML: el.outerHTML.substring(0, 300),
                        });
                    }
                });
            } catch (e) {}
        }

        // 4. Find model selector
        const modelKeywords = ['gpt', 'claude', 'gemini', 'model', 'GPT', 'Claude', 'Gemini'];
        document.querySelectorAll('[class*="model"], [class*="select"], [class*="dropdown"], [class*="picker"]').forEach(el => {
            if (el.offsetHeight > 0) {
                const text = (el.innerText || '').substring(0, 200);
                if (modelKeywords.some(k => text.toLowerCase().includes(k.toLowerCase()))) {
                    result.modelSelectors.push({
                        tag: el.tagName.toLowerCase(),
                        className: el.className?.toString?.() || '',
                        text: text.substring(0, 100),
                        rect: { w: el.offsetWidth, h: el.offsetHeight },
                        outerHTML: el.outerHTML.substring(0, 500),
                    });
                }
            }
        });

        // 5. Interesting elements with data-* attributes
        document.querySelectorAll('[data-testid], [data-component], [data-type]').forEach(el => {
            result.interestingElements.push({
                tag: el.tagName.toLowerCase(),
                testId: el.getAttribute('data-testid') || '',
                component: el.getAttribute('data-component') || '',
                dataType: el.getAttribute('data-type') || '',
                className: el.className?.toString?.().substring(0, 100) || '',
            });
        });

        // 6. Capture main chat area HTML (truncated)
        const chatArea = document.querySelector('[class*="chat"], [class*="conversation"], main, [role="main"]');
        if (chatArea) {
            result.chatAreaHTML = chatArea.innerHTML.substring(0, 10000);
        }

        return result;
    });

    // === PHASE 2: Save report ===
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`\n📋 DOM Report saved to: ${REPORT_FILE}`);

    // === PHASE 3: Auto-generate selectors ===
    const selectors = { input: '', send: '', response: '', modelPicker: '' };

    // Best input selector
    if (report.inputs.length > 0) {
        // Prefer textarea, then contenteditable, then role=textbox
        const textarea = report.inputs.find(i => i.tag === 'textarea' && i.rect.w > 200);
        const editable = report.inputs.find(i => i.contentEditable === 'true' && i.rect.w > 200);
        const textbox = report.inputs.find(i => i.role === 'textbox');
        const best = textarea || editable || textbox || report.inputs[0];

        if (best.id) selectors.input = `#${best.id}`;
        else if (best.className) {
            const cls = best.className.split(/\s+/).filter(c => c.length > 3 && !c.includes('undefined'))[0];
            if (cls) selectors.input = `${best.tag}.${cls}`;
        }
        if (!selectors.input) selectors.input = best.selector;
        console.log(`✅ Input: ${selectors.input} (${best.tag}, ${best.rect.w}x${best.rect.h})`);
    } else {
        console.warn('⚠️  No input elements found!');
    }

    // Best send button
    const sendButtons = report.buttons.filter(b => {
        const t = (b.text + b.ariaLabel + b.title + b.className).toLowerCase();
        return t.includes('send') || t.includes('submit') || t.includes('傳送') || t.includes('arrow') || t.includes('enter');
    });
    if (sendButtons.length > 0) {
        const best = sendButtons[0];
        if (best.ariaLabel) selectors.send = `button[aria-label="${best.ariaLabel}"]`;
        else if (best.className) {
            const cls = best.className.split(/\s+/).filter(c => c.length > 3)[0];
            if (cls) selectors.send = `button.${cls}`;
        }
        console.log(`✅ Send: ${selectors.send} ("${best.text || best.ariaLabel}")`);
    } else {
        console.warn('⚠️  No send button found! Might need to use Enter key only.');
        selectors.send = 'button[type="submit"]';
    }

    // Best response container
    const responseCandidates = report.messageContainers
        .filter(m => m.textLength > 10 && m.rect.h > 30)
        .sort((a, b) => b.textLength - a.textLength);
    if (responseCandidates.length > 0) {
        const best = responseCandidates[0];
        const cls = best.className.split(/\s+/).filter(c => c.length > 3 && !c.includes('undefined'))[0];
        if (cls) selectors.response = `.${cls}`;
        else selectors.response = best.selector;
        console.log(`✅ Response: ${selectors.response} (${best.childCount} children, ${best.textLength} chars)`);
    } else {
        console.warn('⚠️  No response containers found!');
    }

    // Model picker
    if (report.modelSelectors.length > 0) {
        const best = report.modelSelectors[0];
        const cls = best.className.split(/\s+/).filter(c => c.length > 3)[0];
        if (cls) selectors.modelPicker = `.${cls}`;
        console.log(`✅ Model Picker: ${selectors.modelPicker} ("${best.text.substring(0, 30)}")`);
    }

    fs.writeFileSync(SELECTOR_FILE, JSON.stringify(selectors, null, 2));
    console.log(`\n📋 Selectors saved to: ${SELECTOR_FILE}`);

    // === Summary ===
    console.log('\n=== DOM SCOUT SUMMARY ===');
    console.log(`Inputs found:    ${report.inputs.length}`);
    console.log(`Buttons found:   ${report.buttons.length}`);
    console.log(`Msg containers:  ${report.messageContainers.length}`);
    console.log(`Model selectors: ${report.modelSelectors.length}`);
    console.log(`Data-* elements: ${report.interestingElements.length}`);
    console.log('========================\n');

    if (!isLoginMode) {
        await browser.close();
    } else {
        console.log('🔓 Login mode: browser stays open. Close it manually when done.');
        console.log('   Your session cookies are saved in:', PROFILE_DIR);
    }
}

main().catch(e => {
    console.error('❌ Monica DOM Scout error:', e.message);
    process.exit(1);
});
