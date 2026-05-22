'use strict';

const CapabilityRegistry = require('./CapabilityRegistry');

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function tokenize(value) {
  const text = normalizeText(value);
  const terms = new Set();
  const ascii = text.match(/[a-z0-9_-]{2,}/g) || [];
  for (const t of ascii) terms.add(t);
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const chunk of cjk) {
    terms.add(chunk);
    for (let i = 0; i < chunk.length - 1; i += 1) terms.add(chunk.slice(i, i + 2));
  }
  return [...terms];
}

function scoreCapability(cap, terms) {
  const haystack = normalizeText([
    cap.lane,
    cap.id,
    cap.target,
    cap.name,
    cap.description,
    cap.server,
    cap.tool
  ].join(' '));

  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (haystack.includes(term)) score += term.length >= 3 ? 3 : 1;
  }
  if (!cap.exampleCovered) score += 6;
  if (cap.lane === 'mcp') score += 1;
  return score;
}

function buildTask(cap, rank) {
  const title = cap.lane === 'skill'
    ? `補齊 skill action 範例：${cap.target}`
    : `補齊 MCP tool 範例：${cap.target}`;

  const verify = cap.lane === 'skill'
    ? `執行一次 ${cap.target} 的最小 action，確認不再出現 invalid_field / missing_required。`
    : `執行一次 mcp_call 到 ${cap.target}，確認 server/tool/parameters 形狀正確。`;

  return {
    rank,
    lane: cap.lane,
    target: cap.target,
    title,
    reason: cap.exampleCovered ? '雖已覆蓋，但與本次需求關聯高。' : '目前缺少對應 example 覆蓋。',
    verify,
  };
}

class RefinePlanner {
  plan(userDataDir, goalText = '') {
    const goal = String(goalText || '').trim();
    const { registry, path } = CapabilityRegistry.sync(userDataDir);
    const capabilities = Array.isArray(registry.capabilities) ? registry.capabilities : [];
    const uncovered = capabilities.filter(c => !c.exampleCovered);
    const terms = tokenize(goal);

    const ranked = capabilities
      .map(cap => ({ cap, score: scoreCapability(cap, terms) }))
      .filter(item => item.score > 0 || !item.cap.exampleCovered)
      .sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, 8).map((item, idx) => buildTask(item.cap, idx + 1));

    return {
      goal,
      registryPath: path,
      summary: {
        total: Number(registry.summary.total || 0),
        covered: Number(registry.summary.coveredExamples || 0),
        uncovered: uncovered.length
      },
      tasks: top
    };
  }

  format(planResult) {
    const lines = [];
    lines.push('🧪 **Refine 計劃（半自動）**');
    if (planResult.goal) lines.push(`- 目標：${planResult.goal}`);
    lines.push(`- Capability Coverage：${planResult.summary.covered}/${planResult.summary.total}`);
    lines.push(`- 缺口數量：${planResult.summary.uncovered}`);
    lines.push(`- Registry：\`${planResult.registryPath}\``);
    lines.push('');
    lines.push('**優先補強任務（Top）**');
    for (const task of planResult.tasks) {
      lines.push(`${task.rank}. [${task.lane}] ${task.title}`);
      lines.push(`   - 原因：${task.reason}`);
      lines.push(`   - 驗證：${task.verify}`);
    }
    lines.push('');
    lines.push('**建議下一步**');
    lines.push('1. 先執行 `/examples sync` 補齊缺口範例。');
    lines.push('2. 再執行 `/examples validate` 驗證範例品質。');
    lines.push('3. 若仍有缺口，再決定是否進入自動產生或手動補強。');
    return lines.join('\n');
  }
}

module.exports = new RefinePlanner();
