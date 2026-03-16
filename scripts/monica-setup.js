#!/usr/bin/env node
// scripts/monica-setup.js — Monica.im 一鍵登入 + 設定驗證
// Usage: node scripts/monica-setup.js

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SELECTOR_FILE = path.resolve(PROJECT_ROOT, 'monica_selectors.json');

async function main() {
    let BrowserLauncher;
    try {
        BrowserLauncher = require('../src/core/BrowserLauncher');
    } catch (e) {
        console.error('[Setup] BrowserLauncher not found:', e.message);
        process.exit(1);
    }

    const profileDir = path.resolve(PROJECT_ROOT, 'golem_memory', 'monica_profile');
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }

    console.log('[Setup] Step 1: Attempting headless login check...');

    let browser;
    try {
        browser = await BrowserLauncher.launch({
            userDataDir: profileDir,
            headless: 'new',
            protocolTimeout: 60000,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
        });

        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        await page.setViewport({ width: 1400, height: 900 });

        await page.goto('https://monica.im/home/chat', { waitUntil: 'networkidle2', timeout: 30000 });
        const url = page.url();

        if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
            console.log('[Setup] ⚠️ Not logged in. Relaunching in GUI mode...');
            await browser.close();

            // Relaunch with visible browser
            browser = await BrowserLauncher.launch({
                userDataDir: profileDir,
                headless: false,
                protocolTimeout: 300000,
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1400,900'],
            });

            const guiPages = await browser.pages();
            const guiPage = guiPages[0] || await browser.newPage();
            await guiPage.setViewport({ width: 1400, height: 900 });
            await guiPage.goto('https://monica.im/home/chat', { waitUntil: 'networkidle2', timeout: 60000 });

            console.log('[Setup] 請在瀏覽器中手動登入 Monica.im...');
            console.log('[Setup] 登入完成後按 Enter 繼續...');

            await new Promise(resolve => {
                process.stdin.resume();
                process.stdin.once('data', resolve);
            });

            // Check again
            const newUrl = guiPage.url();
            if (newUrl.includes('/login') || newUrl.includes('/signin')) {
                console.error('[Setup] ❌ 仍未登入，請重試。');
                await browser.close();
                process.exit(1);
            }

            console.log('[Setup] ✅ 登入成功!');

            // Run DOM scout
            await runDOMScout(guiPage);
            await browser.close();
        } else {
            console.log('[Setup] ✅ 已登入! URL:', url);

            // Run DOM scout
            await runDOMScout(page);
            await browser.close();
        }
    } catch (e) {
        console.error('[Setup] Error:', e.message);
        if (browser) try { await browser.close(); } catch (_) {}
        process.exit(1);
    }

    // Verify selectors
    console.log('\n[Setup] Step 4: Verifying selectors...');
    if (fs.existsSync(SELECTOR_FILE)) {
        try {
            const selectors = JSON.parse(fs.readFileSync(SELECTOR_FILE, 'utf-8'));
            const keys = Object.keys(selectors);
            const valid = keys.filter(k => selectors[k] && selectors[k] !== 'NONE');
            console.log(`  Selectors: ${valid.length}/${keys.length} valid`);
            for (const k of keys) {
                const icon = selectors[k] && selectors[k] !== 'NONE' ? '✅' : '⚠️';
                console.log(`  ${icon} ${k}: ${selectors[k] || '(empty)'}`);
            }
        } catch (e) {
            console.warn('  ⚠️ Selector file parse error:', e.message);
        }
    } else {
        console.warn('  ⚠️ monica_selectors.json not found. Run DOM scout first.');
    }

    // Summary
    console.log('\n[Setup] === 摘要 ===');
    console.log(`  Profile: ${profileDir}`);
    console.log(`  Selectors: ${SELECTOR_FILE}`);
    console.log(`  建議: 用 Telegram 發送 GOLEM_SKILL::{"action":"model-router","task":"test"} 驗證路由`);
}

async function runDOMScout(page) {
    console.log('\n[Setup] Step 3: Running DOM scout...');
    try {
        const selectors = await page.evaluate(() => {
            const result = {};

            // Find input
            const textarea = document.querySelector('textarea.ant-input[placeholder="Ask me anything"]') ||
                             document.querySelector('textarea') ||
                             document.querySelector('[contenteditable="true"]');
            result.input = textarea ? buildSelector(textarea) : 'NONE';

            // Find model picker
            const modelEl = document.querySelector('div[class*="model"]') ||
                            document.querySelector('button[class*="model"]') ||
                            document.querySelector('[class*="picker"]');
            result.modelPicker = modelEl ? buildSelector(modelEl) : 'NONE';

            // Find response area
            const respEl = document.querySelector('div[class*="chat-main-wrapper"] div[class*="markdown"]') ||
                           document.querySelector('div[class*="message-content"]');
            result.response = respEl ? buildSelector(respEl) : 'NONE';

            function buildSelector(el) {
                if (el.id) return `#${el.id}`;
                const tag = el.tagName.toLowerCase();
                const cls = el.className && typeof el.className === 'string'
                    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                    : '';
                return `${tag}${cls}`;
            }

            return result;
        });

        fs.writeFileSync(SELECTOR_FILE, JSON.stringify(selectors, null, 2));
        console.log('[Setup] DOM scout complete. Selectors saved.');
    } catch (e) {
        console.warn('[Setup] DOM scout failed:', e.message);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
