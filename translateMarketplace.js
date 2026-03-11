const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, 'data', 'marketplace');

// Update to bilingual mapping if not present
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
    const cleanText = text.replace(/[*_~`]/g, '');
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-tw&dt=t&q=${encodeURIComponent(cleanText)}`;
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

async function translateFile(filePath) {
    console.log(`Processing ${path.basename(filePath)}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let changed = false;
    let count = 0;

    for (let i = 0; i < data.length; i++) {
        const skill = data[i];

        // Ensure bilingual category names exist
        if (!skill.category_name) {
            skill.category_name = CATEGORY_MAP[skill.category] || { en: skill.category, zh: skill.category };
            changed = true;
        }

        // Fix description mapping: description should be English, description_zh should be Chinese
        const original = skill.original_description || skill.description;

        // If description is currently not English (matches original_description but translated), restore it
        if (skill.description !== original && original) {
            skill.description = original;
            changed = true;
        }

        if (!skill.description_zh || skill.description_zh.trim() === '') {
            console.log(`  [${i + 1}/${data.length}] Translating: ${skill.title}...`);
            const translated = await translateToZhTW(original);
            if (translated !== original) {
                skill.description_zh = translated;
                changed = true;
                count++;
            }
            await new Promise(r => setTimeout(r, 150));
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`✅ Updated ${count} translations and structure in ${path.basename(filePath)}`);
    } else {
        console.log(`ℹ️ No changes needed for ${path.basename(filePath)}`);
    }
}

async function run() {
    if (!fs.existsSync(DATA_DIR)) {
        console.error("Marketplace directory not found!");
        return;
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} categories to process.`);

    for (const file of files) {
        await translateFile(path.join(DATA_DIR, file));
    }

    console.log("\n🎊 All translation tasks completed.");
}

run();
