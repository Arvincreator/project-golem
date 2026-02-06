/**
 * 🛠️ Golem v8.5 Hotfix Patch V2 - Content Diffing Strategy
 * ---------------------------------------------------
 * 目的：修復 "Off-by-one" 延遲問題，並解決 DOM 重繪導致的死鎖。
 * 原理：放棄「氣泡數量」檢查，改用「內容指紋」比對 (Stale Text Check)。
 */

const fs = require('fs');
const path = require('path');

const TARGET_FILE = path.join(process.cwd(), 'index.js');
const BACKUP_FILE = path.join(process.cwd(), 'index.js.bak_v2');

console.log("🔍 正在初始化修補程序 (策略：內容指紋比對)...");

// 1. 檢查檔案
if (!fs.existsSync(TARGET_FILE)) {
    console.error("❌ 找不到 index.js");
    process.exit(1);
}

// 2. 備份
try {
    fs.copyFileSync(TARGET_FILE, BACKUP_FILE);
    console.log(`📦 已建立備份: ${BACKUP_FILE}`);
} catch (e) {
    console.error("❌ 備份失敗:", e.message);
    process.exit(1);
}

let content = fs.readFileSync(TARGET_FILE, 'utf-8');

// ============================================================
// 🩹 Patch 1: 將 preCount (數量) 替換為 staleText (舊內容快照)
// ============================================================
// 目標：const preCount = await this.page.evaluate(s => document.querySelectorAll(s).length, sel.response);
const SEARCH_1 = /const\s+preCount\s*=\s*await\s*this\.page\.evaluate\s*\(\s*s\s*=>\s*document\.querySelectorAll\s*\(s\)\.length,\s*sel\.response\s*\);/g;

const REPLACE_1 = `// [Patch V2] 改用內容指紋，防止 DOM 重繪導致數量誤判
          const staleText = await this.page.evaluate((s) => {
            const bubbles = document.querySelectorAll(s);
            return bubbles.length ? bubbles[bubbles.length - 1].innerText : "___START___";
          }, sel.response);
          console.log(\`🔒 [Brain] 鎖定舊回應 (Fingerprint: \${staleText.substring(0, 10)}...)\`);`;

if (SEARCH_1.test(content)) {
    content = content.replace(SEARCH_1, REPLACE_1);
    console.log("✅ [1/3] 已注入內容指紋快照邏輯 (staleText)");
} else {
    [cite_start]console.warn("⚠️ [1/3] 找不到 preCount 定義，請確認 index.js 是否為原始版本 [cite: 1]。");
}

// ============================================================
// 🩹 Patch 2: 修改 DOM 輪詢判斷 (文字比對)
// ============================================================
// 目標：if (text.includes('—-回覆結束—-')) {
const SEARCH_2 = /if\s*\(\s*text\.includes\s*\(\s*['"]—-回覆結束—-['"]\s*\)\s*\)\s*\{/g;

const REPLACE_2 = `// [Patch V2] 只有當內容變更且包含結束標記時，才算成功
            if (text !== staleText && text.includes('—-回覆結束—-')) {`;

if (SEARCH_2.test(content)) {
    content = content.replace(SEARCH_2, REPLACE_2);
    console.log("✅ [2/3] 已更新 DOM 結束標記檢查邏輯");
} else {
    console.warn("⚠️ [2/3] 找不到結束標記檢查代碼。");
}

// ============================================================
// 🩹 Patch 3: 修改 Code Block 的判斷 (防止抓到舊代碼)
// ============================================================
// 目標：if (text.trim().endsWith('```')) {
const SEARCH_3 = /if\s*\(\s*text\.trim\(\)\.endsWith\s*\(\s*['"]```['"]\s*\)\s*\)\s*\{/g;

const REPLACE_3 = `if (text !== staleText && text.trim().endsWith('\`\`\`')) {`;

if (SEARCH_3.test(content)) {
    content = content.replace(SEARCH_3, REPLACE_3);
    console.log("✅ [3/3] 已更新代碼區塊檢查邏輯");
} else {
    console.warn("⚠️ [3/3] 找不到代碼區塊檢查代碼。");
}

// 4. 寫入
try {
    fs.writeFileSync(TARGET_FILE, content, 'utf-8');
    console.log("\n🎉 修補完成！策略已更新為 Content Diffing。");
    console.log("👉 請輸入 npm start 重啟 Golem。");
} catch (e) {
    console.error("❌ 寫入失敗:", e.message);
}
