// tests/PromptForge.test.js
const path = require('path');
const fs = require('fs');
const promptForge = require('../src/skills/core/prompt-forge');

const DNA_FILE = path.join(process.cwd(), 'promptforge_dna.json');

describe('PromptForge Skill', () => {
    // Cleanup DNA file before/after tests
    beforeEach(() => {
        if (fs.existsSync(DNA_FILE)) fs.unlinkSync(DNA_FILE);
    });

    afterAll(() => {
        if (fs.existsSync(DNA_FILE)) fs.unlinkSync(DNA_FILE);
    });

    describe('generate', () => {
        it('returns prompt + scores for valid intent', async () => {
            const result = await promptForge.execute({ task: 'generate', intent: '分析股票走勢並預測趨勢' });

            expect(result).toContain('PromptForge');
            expect(result).toContain('生成完成');
            expect(result).toContain('分析股票');
            expect(result).toContain('/4.0');
            expect(result).toContain('推理模式');
        });

        it('returns error when intent is missing', async () => {
            const result = await promptForge.execute({ task: 'generate' });
            expect(result).toContain('請提供意圖');
        });

        it('saves DNA entry', async () => {
            await promptForge.execute({ task: 'generate', intent: 'test DNA save' });
            expect(fs.existsSync(DNA_FILE)).toBe(true);
            const dna = JSON.parse(fs.readFileSync(DNA_FILE, 'utf-8'));
            expect(dna.prompts.length).toBe(1);
            expect(dna.stats.total_generated).toBe(1);
        });
    });

    describe('evaluate', () => {
        it('returns 9 axis scores', async () => {
            const result = await promptForge.execute({
                task: 'evaluate',
                prompt: '## 角色\n你是分析師。\n## 任務\n請分析數據。\n## 格式\nJSON',
                intent: '分析',
            });

            expect(result).toContain('9 軸評分');
            expect(result).toContain('clarity');
            expect(result).toContain('safety');
            expect(result).toContain('/4.0');
        });

        it('returns error without prompt', async () => {
            const result = await promptForge.execute({ task: 'evaluate' });
            expect(result).toContain('請提供');
        });
    });

    describe('detect-pattern', () => {
        it('detects CoT for reasoning tasks', async () => {
            const result = await promptForge.execute({ task: 'detect-pattern', intent: '分析這個數學問題的推理步驟' });
            expect(result).toContain('CoT');
        });

        it('detects ReAct for search tasks', async () => {
            const result = await promptForge.execute({ task: 'detect-pattern', intent: '搜尋並查詢 API 資料庫' });
            expect(result).toContain('ReAct');
        });

        it('detects Reflexion for iteration tasks', async () => {
            const result = await promptForge.execute({ task: 'detect-pattern', intent: '改進並反思這個方案' });
            expect(result).toContain('Reflexion');
        });

        it('returns error without intent', async () => {
            const result = await promptForge.execute({ task: 'detect-pattern' });
            expect(result).toContain('請提供');
        });
    });

    describe('history', () => {
        it('returns formatted history', async () => {
            // Generate some entries first
            await promptForge.execute({ task: 'generate', intent: '歷史測試' });
            const result = await promptForge.execute({ task: 'history' });
            expect(result).toContain('歷史');
            expect(result).toContain('歷史測試');
        });

        it('returns empty message when no history', async () => {
            const result = await promptForge.execute({ task: 'history' });
            expect(result).toContain('尚無');
        });
    });

    describe('stats', () => {
        it('returns statistics', async () => {
            await promptForge.execute({ task: 'generate', intent: '統計測試' });
            const result = await promptForge.execute({ task: 'stats' });

            expect(result).toContain('統計');
            expect(result).toContain('生成: 1');
            expect(result).toContain('DNA 庫: 1');
        });
    });

    describe('compare', () => {
        it('returns winner', async () => {
            const result = await promptForge.execute({
                task: 'compare',
                a: '## 角色\n你是專家。\n## 任務\n請分析。\n## 格式\nJSON',
                b: '看看這個',
            });
            expect(result).toContain('勝者');
            expect(result).toContain('/4.0');
        });

        it('returns error without both prompts', async () => {
            const result = await promptForge.execute({ task: 'compare', a: 'only one' });
            expect(result).toContain('請提供兩個');
        });
    });

    describe('export/import', () => {
        it('completes full export-import cycle', async () => {
            // Generate
            await promptForge.execute({ task: 'generate', intent: '匯出測試' });

            // Export
            const exported = await promptForge.execute({ task: 'export' });
            const data = JSON.parse(exported);
            expect(data.prompts.length).toBe(1);

            // Clear
            fs.unlinkSync(DNA_FILE);

            // Import
            const importResult = await promptForge.execute({ task: 'import', data: exported });
            expect(importResult).toContain('匯入完成');
            expect(importResult).toContain('1 筆');

            // Verify
            const dna = JSON.parse(fs.readFileSync(DNA_FILE, 'utf-8'));
            expect(dna.prompts.length).toBe(1);
        });

        it('rejects invalid import data', async () => {
            const result = await promptForge.execute({ task: 'import', data: '{"invalid": true}' });
            expect(result).toContain('無效');
        });
    });

    describe('templates', () => {
        it('lists empty templates', async () => {
            const result = await promptForge.execute({ task: 'templates' });
            expect(result).toContain('尚無模板');
        });

        it('adds and lists template', async () => {
            await promptForge.execute({
                task: 'templates', sub: 'add',
                name: 'stock-analysis',
                template: '分析 {stock} 的走勢',
            });
            const result = await promptForge.execute({ task: 'templates' });
            expect(result).toContain('stock-analysis');
        });
    });

    describe('null brain graceful degradation', () => {
        it('generate works without brain', async () => {
            const result = await promptForge.execute({ task: 'generate', intent: '無 brain 測試' });
            expect(result).toContain('生成完成');
            expect(result).toContain('/4.0');
        });

        it('evaluate works without brain', async () => {
            const result = await promptForge.execute({ task: 'evaluate', prompt: '測試提示詞' });
            expect(result).toContain('9 軸評分');
        });
    });

    describe('optimize', () => {
        it('returns optimized prompt with trajectory', async () => {
            const result = await promptForge.execute({
                task: 'optimize',
                prompt: '簡單的分析提示',
                intent: '分析問題',
                generations: 2,
            });

            expect(result).toContain('演化優化完成');
            expect(result).toContain('Gen 1');
            expect(result).toContain('Gen 2');
        });

        it('returns error without prompt', async () => {
            const result = await promptForge.execute({ task: 'optimize' });
            expect(result).toContain('請提供');
        });
    });

    describe('unknown task', () => {
        it('returns help message', async () => {
            const result = await promptForge.execute({ task: 'nonexistent' });
            expect(result).toContain('未知');
            expect(result).toContain('generate');
        });
    });

    describe('module exports', () => {
        it('exports required fields', () => {
            expect(promptForge.name).toBe('prompt-forge');
            expect(promptForge.description).toBeTruthy();
            expect(promptForge.PROMPT).toContain('prompt-forge');
            expect(promptForge.execute).toBeInstanceOf(Function);
            expect(promptForge.detectPattern).toBeInstanceOf(Function);
        });
    });
});
