// ============================================================
// Task Decomposer (BabyAGI inspired)
// Complex goal -> subtask DAG -> topological execution
// ============================================================

class TaskDecomposer {
    constructor(brain, options = {}) {
        this.brain = brain;
        this.golemId = options.golemId || 'default';
    }

    async decompose(goal) {
        const prompt = `【系統指令: 任務分解】
你收到一個複雜目標，請將它分解為可執行的子任務 DAG。

目標: ${goal}

回覆格式 (JSON):
{
    "tasks": [
        { "id": "t1", "desc": "子任務描述", "deps": [], "level": "L0" },
        { "id": "t2", "desc": "子任務描述", "deps": ["t1"], "level": "L1" }
    ]
}

規則:
1. 每個 task 的 level 用 L0/L1/L2/L3 分類 (L0=安全自動, L3=高風險需審批)
2. deps 列出這個 task 依賴的其他 task ID
3. 最多 10 個子任務
4. 用 JSON 格式回覆，不要其他文字`;

        try {
            const raw = await this.brain.sendMessage(prompt, true);
            const jsonMatch = raw.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
            if (!jsonMatch) return { tasks: [{ id: 't1', desc: goal, deps: [], level: 'L1' }] };
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.warn('[TaskDecomposer] Decomposition failed:', e.message);
            return { tasks: [{ id: 't1', desc: goal, deps: [], level: 'L1' }] };
        }
    }

    topologicalSort(tasks) {
        const sorted = [];
        const visited = new Set();
        const taskMap = new Map(tasks.map(t => [t.id, t]));

        function visit(id) {
            if (visited.has(id)) return;
            visited.add(id);
            const task = taskMap.get(id);
            if (!task) return;
            for (const dep of (task.deps || [])) {
                visit(dep);
            }
            sorted.push(task);
        }

        for (const task of tasks) {
            visit(task.id);
        }
        return sorted;
    }

    async execute(goal, ctx, controller, autonomy) {
        const plan = await this.decompose(goal);
        const sorted = this.topologicalSort(plan.tasks);
        const results = [];

        for (const task of sorted) {
            console.log(`[TaskDecomposer] Executing ${task.id}: ${task.desc} (${task.level})`);

            // L2+ tasks need approval
            if ((task.level === 'L2' || task.level === 'L3') && autonomy) {
                const { v4: uuidv4 } = require('uuid');
                const approvalId = uuidv4();
                await autonomy.requestApproval(
                    { action: 'task_decomposer', task: task.desc },
                    task.level,
                    `子任務 ${task.id}: ${task.desc}`,
                    approvalId
                );
                results.push({ id: task.id, status: 'pending_approval', approvalId });
                continue;
            }

            // Execute L0/L1 tasks
            try {
                const prompt = `執行以下子任務:\n${task.desc}\n\n用 [GOLEM_REPLY] 回報結果。如需執行指令，用 [GOLEM_ACTION] 格式。`;
                const raw = await this.brain.sendMessage(prompt, true);
                results.push({ id: task.id, status: 'completed', output: raw?.substring(0, 500) });
            } catch (e) {
                results.push({ id: task.id, status: 'failed', error: e.message });
            }
        }

        return { plan, results };
    }
}

module.exports = TaskDecomposer;
