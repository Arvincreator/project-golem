const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_URL = 'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'marketplace_skills.json');

// Map categories to fetch
const CATEGORIES = [
    'ai-and-llms',
    'apple-apps-and-services',
    'browser-and-automation',
    'calendar-and-scheduling',
    'clawdbot-tools',
    'cli-utilities',
    'coding-agents-and-ides',
    'communication',
    'data-and-analytics',
    'devops-and-cloud',
    'finance',
    'gaming',
    'git-and-github',
    'health-and-fitness',
    'image-and-video-generation',
    'ios-and-macos-development',
    'marketing-and-sales',
    'media-and-streaming',
    'moltbook',
    'notes-and-pkm',
    'pdf-and-documents',
    'personal-development',
    'productivity-and-tasks',
    'search-and-research',
    'security-and-passwords',
    'self-hosted-and-automation',
    'shopping-and-e-commerce',
    'smart-home-and-iot',
    'speech-and-transcription',
    'transportation',
    'web-and-frontend-development'
];

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

async function run() {
    console.log('Fetching OpenClaw Skills...');
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const allSkills = [];

    for (const cat of CATEGORIES) {
        try {
            const url = `${REPO_URL}categories/${cat}.md`;
            console.log(`Fetching ${cat}...`);
            const content = await fetchFile(url);

            // Parse lines like: - [skill-name](https://github.com/...) - Description
            const lines = content.split('\n');
            for (const line of lines) {
                const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\) - (.*)$/);
                if (match) {
                    allSkills.push({
                        title: match[1],
                        id: match[1].toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                        repoUrl: match[2],
                        description: match[3],
                        category: cat
                    });
                }
            }
        } catch (e) {
            console.error(`Error fetching category ${cat}:`, e.message);
        }
    }

    fs.writeFileSync(OUT_FILE, JSON.stringify(allSkills, null, 2));
    console.log(`Successfully saved ${allSkills.length} skills to ${OUT_FILE}`);
}

run();
