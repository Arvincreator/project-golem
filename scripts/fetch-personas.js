const https = require('https');
const fs = require('fs');
const path = require('path');

const CSV_URL = 'https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv';
const ZH_JSON_URL = 'https://raw.githubusercontent.com/PlexPt/awesome-chatgpt-prompts-zh/main/prompts-zh-TW.json';
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'marketplace');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'personas.json');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const result = [];
  let row = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentVal += '"';
        i++; // skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(currentVal);
        currentVal = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && nextChar === '\n') {
          i++; // skip \n
        }
        row.push(currentVal);
        if (row.length > 0 && row.some(v => v !== '')) {
            result.push(row);
        }
        row = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
  }
  if (currentVal !== '' || row.length > 0) {
    row.push(currentVal);
    result.push(row);
  }
  return result;
}

const crypto = require('crypto');
function generateSlug(text) {
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (!slug) {
    slug = crypto.createHash('md5').update(text).digest('hex').substring(0, 8);
  }
  return slug;
}

function categorize(title, prompt) {
  const text = (title + " " + prompt).toLowerCase();
  
  if (text.match(/code|program|developer|engineer|software|python|javascript|html|css|sql|database|react|node|api|linux|terminal|git|前端|後端|工程師|程式|開發|終端機|代碼|寫程式/)) {
    return { category: 'coding-and-dev', name: {en: 'Coding & Development', zh: '寫程式與開發'} };
  }
  if (text.match(/write|essay|blog|article|proofread|grammar|translate|language|editor|copywriter|poet|翻譯|寫作|文法|文章|編輯|文案/)) {
    return { category: 'writing-and-language', name: {en: 'Writing & Language', zh: '寫作與語言'} };
  }
  if (text.match(/marketer|sales|seo|advertising|brand|social media|content creator|business|startup|ceo|finance|accountant|invest|行銷|廣告|業務|投資|金融|會計/)) {
    return { category: 'business-and-marketing', name: {en: 'Business & Marketing', zh: '商業與行銷'} };
  }
  if (text.match(/teacher|tutor|math|science|history|learn|education|instructor|philosopher|老師|教育|學習|指導|教學|歷史|科學/)) {
    return { category: 'education', name: {en: 'Education & Tutors', zh: '教育與學習'} };
  }
  if (text.match(/coach|health|fitness|diet|nutrition|therapist|psychologist|doctor|medical|健康|醫療|醫生|健身|飲食|營養|心理/)) {
    return { category: 'health-and-fitness', name: {en: 'Health & Fitness', zh: '健康與塑身'} };
  }
  if (text.match(/game|rpg|character|play|adventure|storyteller|遊戲|角色扮演|故事/)) {
    return { category: 'gaming-and-rpg', name: {en: 'Gaming & RPG', zh: '遊戲與角色扮演'} };
  }
  if (text.match(/analyze|data|statistics|research|scientist|分析|數據|研究/)) {
    return { category: 'data-and-research', name: {en: 'Data & Research', zh: '數據與研究'} };
  }
  if (text.match(/art|music|design|photo|drawing|creative|藝術|音樂|設計|創意|畫家|攝影/)) {
    return { category: 'creative-arts', name: {en: 'Creative Arts', zh: '創意與藝術'} };
  }
  return { category: 'other', name: {en: 'Other Personas', zh: '其他角色'} };
}

async function main() {
  console.log('Fetching CSV from', CSV_URL);
  console.log('Fetching Chinese Translations from', ZH_JSON_URL);

  try {
    const [csvData, zhJsonData] = await Promise.all([
      fetchUrl(CSV_URL),
      fetchUrl(ZH_JSON_URL)
    ]);
    
    console.log('CSV downloaded, size:', csvData.length, 'bytes');
    console.log('ZH JSON downloaded, size:', zhJsonData.length, 'bytes');

    const rows = parseCSV(csvData);
    let zhArray = [];
    try {
      zhArray = JSON.parse(zhJsonData);
    } catch (e) {
      console.error('Failed to parse ZH JSON, proceeding without translations.');
    }

    if (rows.length < 2) {
      throw new Error('CSV seems empty or parsing failed');
    }

    const header = rows[0];
    const actIdx = header.findIndex(h => h.toLowerCase() === 'act');
    const promptIdx = header.findIndex(h => h.toLowerCase() === 'prompt');

    if (actIdx === -1 || promptIdx === -1) {
      throw new Error('CSV must contain "act" and "prompt" columns');
    }

    const personas = [];
    // Process English Data
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= Math.max(actIdx, promptIdx)) continue;
        
        const act = row[actIdx];
        const prompt = row[promptIdx];
        if (!act || !prompt) continue;

        const description = prompt.split('.')[0] + '.';
        const catInfo = categorize(act, prompt);

        personas.push({
            id: generateSlug(act),
            name: act,
            name_zh: '',
            description: description.substring(0, 150),
            description_zh: '',
            role: prompt,
            role_zh: '',
            tags: ['market', 'en'],
            category: catInfo.category,
            category_name: catInfo.name
        });
    }

    // Process Chinese Data
    for (const item of zhArray) {
        if (!item.act || !item.prompt) continue;
        const act = item.act;
        const prompt = item.prompt;
        
        const description_zh = prompt.split(/。|\./)[0] + '。';
        const catInfo = categorize(act, prompt);

        personas.push({
            id: 'zh-' + generateSlug(act),
            name: act,
            name_zh: act,
            description: '',
            description_zh: description_zh.substring(0, 150),
            role: '',
            role_zh: prompt,
            tags: ['market', 'zh'],
            category: catInfo.category,
            category_name: catInfo.name
        });
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(personas, null, 2));
    console.log(`Successfully extracted ${personas.length} personas to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
