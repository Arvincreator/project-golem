const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'data', 'marketplace_skills.json');
const outDir = path.join(__dirname, 'data', 'marketplace');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

if (fs.existsSync(inputFile)) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const categories = {};
    for (const skill of data) {
        if (!categories[skill.category]) categories[skill.category] = [];
        categories[skill.category].push({
            ...skill,
            description_zh: skill.description_zh || "",
            original_description: skill.original_description || skill.description
        });
    }
    for (const [cat, skills] of Object.entries(categories)) {
        fs.writeFileSync(path.join(outDir, `${cat}.json`), JSON.stringify(skills, null, 2));
    }
    console.log(`Migrated ${data.length} skills into ${Object.keys(categories).length} categories!`);
} else {
    console.log("No input file found!");
}
