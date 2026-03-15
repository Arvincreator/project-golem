const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_URL = 'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'marketplace');

// Define bilingual categories
const CATEGORY_MAP = {
    'ai-and-llms': { en: 'AI & LLMs', zh: '人工智慧與語言模型' },
    'apple-apps-and-services': { en: 'Apple Apps & Services', zh: 'Apple 應用與服務' },
    'browser-and-automation': { en: 'Browser & Automation', zh: '瀏覽器與自動化' },
    'calendar-and-scheduling': { en: 'Calendar & Scheduling', zh: '行事曆與排程' },
    'clawdbot-tools': { en: 'Clawdbot Tools', zh: 'Clawdbot 工具' },
    'cli-utilities': { en: 'CLI Utilities', zh: '命令列工具' },
    'coding-agents-and-ides': { en: 'Coding Agents & IDEs', zh: '程式碼代理與 IDE' },
    'communication': { en: 'Communication', zh: '通訊聯絡' },
    'data-and-analytics': { en: 'Data & Analytics', zh: '數據與分析' },
    'devops-and-cloud': { en: 'DevOps & Cloud', zh: 'DevOps 與雲端' },
    'finance': { en: 'Finance', zh: '金融理財' },
    'gaming': { en: 'Gaming', zh: '遊戲娛樂' },
    'git-and-github': { en: 'Git & GitHub', zh: 'Git 與 GitHub' },
    'health-and-fitness': { en: 'Health & Fitness', zh: '健康與健身' },
    'image-and-video-generation': { en: 'Image & Video Generation', zh: '圖像與影片生成' },
    'ios-and-macos-development': { en: 'iOS & macOS Development', zh: 'iOS 與 macOS 開發' },
    'marketing-and-sales': { en: 'Marketing & Sales', zh: '行銷與銷售' },
    'media-and-streaming': { en: 'Media & Streaming', zh: '媒體與串流' },
    'moltbook': { en: 'Moltbook', zh: 'Moltbook' },
    'notes-and-pkm': { en: 'Notes & PKM', zh: '筆記與知識管理' },
    'pdf-and-documents': { en: 'PDF & Documents', zh: 'PDF 與文件' },
    'personal-development': { en: 'Personal Development', zh: '個人成長' },
    'productivity-and-tasks': { en: 'Productivity & Tasks', zh: '生產力與任務' },
    'search-and-research': { en: 'Search & Research', zh: '搜索與研究' },
    'security-and-passwords': { en: 'Security & Passwords', zh: '安全與密碼' },
    'self-hosted-and-automation': { en: 'Self-hosted & Automation', zh: '自託管與自動化' },
    'shopping-and-e-commerce': { en: 'Shopping & E-commerce', zh: '購物與電商' },
    'smart-home-and-iot': { en: 'Smart Home & IoT', zh: '智慧家庭與物聯網' },
    'speech-and-transcription': { en: 'Speech & Transcription', zh: '語音與逐字稿' },
    'transportation': { en: 'Transportation', zh: '交通運輸' },
    'web-and-frontend-development': { en: 'Web & Frontend Development', zh: '網頁與前端開發' }
};

const CATEGORIES = Object.keys(CATEGORY_MAP);

async function fetchFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function translateToZhTW(text) {
    if (!text || text.trim() === '') return text;
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-tw&dt=t&q=${encodeURIComponent(text)}`;
        const content = await fetchFile(url);
        const parsed = JSON.parse(content);
        if (parsed && parsed[0]) {
            return parsed[0].map(s => s[0]).join('');
        }
        return text;
    } catch (e) {
        console.error("Translation error for text:", text.substring(0, 50), "...", e.message);
        return text;
    }
}

async function run() {
    console.log('Fetching & Translating OpenClaw Skills (Bilingual Mode)...');
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let globalTotal = 0;
    let translatedCount = 0;

    for (const catKey of CATEGORIES) {
        try {
            const url = `${REPO_URL}categories/${catKey}.md`;
            console.log(`\nFetching ${catKey}...`);
            const content = await fetchFile(url);

            const outFile = path.join(DATA_DIR, `${catKey}.json`);
            let existingMap = {};
            if (fs.existsSync(outFile)) {
                try {
                    const oldData = JSON.parse(fs.readFileSync(outFile, 'utf8'));
                    oldData.forEach(s => {
                        existingMap[s.id] = s;
                    });
                } catch (e) { console.warn('[updateMarketplace] Failed to read existing marketplace data:', e.message); }
            }

            const parsedSkills = [];
            const lines = content.split('\n');
            let catCount = 0;

            for (const line of lines) {
                const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\) - (.*)$/);
                if (match) {
                    const rawTitle = match[1];
                    const rawId = rawTitle.toLowerCase().replace(/[^a-z0-9_-]/g, '');
                    const rawRepoUrl = match[2];
                    const rawDesc = match[3];

                    let descZh = "";

                    // Incremental Cache Check
                    if (existingMap[rawId] && (existingMap[rawId].original_description === rawDesc || existingMap[rawId].description === rawDesc) && existingMap[rawId].description_zh) {
                        descZh = existingMap[rawId].description_zh;
                    } else {
                        // Needs translation
                        descZh = await translateToZhTW(rawDesc);
                        translatedCount++;
                        // Small throttle
                        await new Promise(r => setTimeout(r, 100));
                    }

                    parsedSkills.push({
                        title: rawTitle,
                        id: rawId,
                        repoUrl: rawRepoUrl,
                        description: rawDesc, // Keep original English
                        original_description: rawDesc,
                        description_zh: descZh, // Chinese translation
                        category: catKey,
                        category_name: CATEGORY_MAP[catKey] // Bilingual category names
                    });
                    catCount++;
                }
            }

            fs.writeFileSync(outFile, JSON.stringify(parsedSkills, null, 2));
            console.log(`➡️  Saved ${catCount} skills to ${catKey}.json`);
            globalTotal += catCount;

        } catch (e) {
            console.error(`Error processing category ${catKey}:`, e.message);
        }
    }

    console.log(`\n✅ Finished! Read ${globalTotal} total skills. Made ${translatedCount} new translation requests.`);
}

run();
