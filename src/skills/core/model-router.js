'use strict';

const fs = require('fs');
const path = require('path');

// ── Dependency imports (failsafe) ──
let constants = {};
try { constants = require('../../core/monica-constants'); } catch (_) {
  try { constants = require('./monica-constants'); } catch (__) {
    console.warn('[ModelRouter] monica-constants not found, using empty defaults');
  }
}

let quota = {};
try { quota = require('./monica-quota'); } catch (_) {
  console.warn('[ModelRouter] monica-quota not found, quota gating disabled');
}

// ── Circuit Breaker ──
const circuitBreaker = {};  // { modelId: { failures: N, blockedUntil: timestamp } }
const CB_MAX_FAILURES = 3;
const CB_COOLDOWN_MS = 5 * 60 * 1000;

function isCircuitOpen(modelId) {
  const cb = circuitBreaker[modelId];
  if (!cb) return false;
  if (cb.failures >= CB_MAX_FAILURES) {
    if (Date.now() < cb.blockedUntil) return true;
    // Cooldown expired, reset
    delete circuitBreaker[modelId];
  }
  return false;
}

function recordCircuitFailure(modelId) {
  if (!circuitBreaker[modelId]) circuitBreaker[modelId] = { failures: 0, blockedUntil: 0 };
  circuitBreaker[modelId].failures++;
  if (circuitBreaker[modelId].failures >= CB_MAX_FAILURES) {
    circuitBreaker[modelId].blockedUntil = Date.now() + CB_COOLDOWN_MS;
    console.warn(`[ModelRouter] Circuit OPEN for ${modelId} — ${CB_MAX_FAILURES} consecutive failures, cooldown ${CB_COOLDOWN_MS / 1000}s`);
  }
}

function recordCircuitSuccess(modelId) {
  delete circuitBreaker[modelId];
}

// ── Task Classification ──
const TASK_PATTERNS = {
  code:      /\b(code|function|class|import|export|bug|fix|debug|refactor|implement|api|endpoint|script|deploy|test|unit\s?test|regex|sql|css|html|jsx|tsx|webpack|eslint|typescript|python|javascript)\b/i,
  reasoning: /\b(reason|logic|prove|theorem|math|calculate|deduce|infer|analyze\s+why|explain\s+how|step.by.step|chain.of.thought)\b/i,
  creative:  /\b(write|story|poem|creative|imagine|generate\s+(?:a|an|the)\s|compose|brainstorm|design|narrative|fiction|blog\s?post|article|slogan|tagline)\b/i,
  fast:      /\b(quick|fast|brief|short|tl;?dr|summary|summarize|one.liner|yes.or.no|translate)\b/i,
  analysis:  /\b(analyz\w*|evaluat\w*|compar\w*|review|audit|assess\w*|benchmark|report|survey|research|data|metrics|statistics|trend)\b/i,
  flexible:  /\b(general|help|assist|explain|what\s+is|how\s+to|tell\s+me|can\s+you)\b/i,
};

function classifyTask(text) {
  if (!text) return 'chat';
  for (const [rule, pattern] of Object.entries(TASK_PATTERNS)) {
    if (pattern.test(text)) return rule;
  }
  return 'chat';
}

// ── Complexity Estimation ──
function estimateComplexity(text) {
  if (!text) return 'simple';
  const len = text.length;
  if (len < 50) return 'simple';
  if (len > 500) return 'complex';
  return 'medium';
}

// ── Persistence Helpers ──
function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.warn(`[ModelRouter] Failed to load ${filePath}: ${e.message}`);
  }
  return {};
}

function saveJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch (_) {}
  }
}

function historyPath(userDataDir) {
  return path.join(userDataDir || process.cwd(), 'model_history.json');
}

function abPath(userDataDir) {
  return path.join(userDataDir || process.cwd(), 'model_ab_results.json');
}

// ── Sticky Routing Cache ──
const stickyCache = {};  // { `${conversationId}:${taskType}`: modelId }

// ── Core: selectBestModel ──
function selectBestModel(text, options = {}) {
  const { userDataDir, engine = 'browser', conversationId } = options;
  const engineKey = engine === 'api' ? 'api' : 'web';

  const models = constants.getModels ? constants.getModels(engineKey) : {};
  const rules = constants.getRoutingRules ? constants.getRoutingRules(engineKey) : {};
  const defaultModel = constants.getDefaultModel ? constants.getDefaultModel(engineKey) : Object.keys(models)[0] || 'gpt-4o';
  const abConfig = constants.AB_CONFIG || { explorationRate: 0.1, minSamples: 10 };

  const taskType = classifyTask(text);
  const complexity = estimateComplexity(text);
  const textLen = (text || '').length;

  // Length-based shortcut
  const modelIds = Object.keys(models);
  if (modelIds.length === 0) {
    return { model: defaultModel, score: 0, taskType, complexity, allScores: {}, engine: engineKey, reason: 'no_models_configured' };
  }

  // Flash model for very short, top model for very long
  let lengthHint = null;
  if (textLen < 50) {
    lengthHint = rules.fast || defaultModel;
  } else if (textLen > 1000) {
    lengthHint = rules.code || rules.reasoning || defaultModel;
  }

  // Quota gate (browser mode only)
  let allowedModels = modelIds;
  if (engineKey === 'web' && quota.shouldUseAdvanced) {
    const useAdvanced = quota.shouldUseAdvanced(userDataDir, taskType, complexity);
    if (!useAdvanced) {
      // Filter to basic tier only
      allowedModels = modelIds.filter(id => {
        const m = models[id];
        return m && m.tier === 'basic';
      });
      if (allowedModels.length === 0) allowedModels = modelIds; // fallback
    }
  }

  // Filter out circuit-broken models
  const healthyModels = allowedModels.filter(id => !isCircuitOpen(id));
  if (healthyModels.length === 0) {
    // All models circuit-broken, reset and allow all
    for (const id of allowedModels) delete circuitBreaker[id];
    console.warn('[ModelRouter] All models circuit-broken, resetting breakers');
  }
  const candidates = healthyModels.length > 0 ? healthyModels : allowedModels;

  // Load history for scoring
  const history = loadJSON(historyPath(userDataDir));

  // Score each candidate
  const allScores = {};
  for (const id of candidates) {
    const m = models[id];
    if (!m) continue;
    const baseStrength = (m.strengths && m.strengths[taskType]) || (m.strengths && m.strengths.code) || 0.5;

    let histScore = 0;
    let useHist = false;
    if (history[id] && history[id].total >= abConfig.minSamples) {
      histScore = history[id].success / history[id].total;
      useHist = true;
    }

    const score = useHist
      ? baseStrength * 0.7 + histScore * 0.3
      : baseStrength;

    allScores[id] = Math.round(score * 1000) / 1000;
  }

  // Sticky routing: same conversation + same taskType → reuse last successful model
  if (conversationId) {
    const stickyKey = `${conversationId}:${taskType}`;
    const stickyModel = stickyCache[stickyKey];
    if (stickyModel && candidates.includes(stickyModel)) {
      return { model: stickyModel, score: allScores[stickyModel] || 0, taskType, complexity, allScores, engine: engineKey, reason: 'sticky' };
    }
  }

  // A/B exploration
  if (Math.random() < abConfig.explorationRate && candidates.length > 1) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return { model: pick, score: allScores[pick] || 0, taskType, complexity, allScores, engine: engineKey, reason: 'exploration' };
  }

  // Length hint override — only for unclassified chat messages
  if (lengthHint && taskType === 'chat' && candidates.includes(lengthHint)) {
    return { model: lengthHint, score: allScores[lengthHint] || 0, taskType, complexity, allScores, engine: engineKey, reason: 'length_hint' };
  }

  // Use routing rule first if task type is classified (not 'chat')
  const ruleModel = rules[taskType];
  if (taskType !== 'chat' && ruleModel && candidates.includes(ruleModel)) {
    return { model: ruleModel, score: allScores[ruleModel] || 0, taskType, complexity, allScores, engine: engineKey, reason: 'routing_rule' };
  }

  // Pick highest score for chat or when routing rule not available
  let bestModel = defaultModel;
  let bestScore = -1;
  for (const [id, score] of Object.entries(allScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestModel = id;
    }
  }

  return { model: bestModel, score: bestScore, taskType, complexity, allScores, engine: engineKey, reason: 'scored' };
}

// ── Browser Model Switching ──
async function switchModel(page, modelId) {
  if (!page) return false;
  const models = constants.WEB_MODELS || {};
  const meta = models[modelId];
  if (!meta || !meta.domKeywords || meta.domKeywords.length === 0) {
    console.warn(`[ModelRouter] No domKeywords for ${modelId}`);
    return false;
  }

  try {
    // Click model dropdown
    const dropdownClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role="button"], [class*="model"], [class*="selector"]')];
      for (const btn of btns) {
        const text = btn.textContent || btn.innerText || '';
        if (/model|gpt|claude|gemini|llama|grok|deepseek/i.test(text)) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!dropdownClicked) return false;
    await new Promise(r => setTimeout(r, 500));

    // Find and click target model
    const keywords = meta.domKeywords;
    const switched = await page.evaluate((kws) => {
      const items = [...document.querySelectorAll('[role="option"], [role="menuitem"], li, div[class*="item"], div[class*="option"]')];
      for (const item of items) {
        const text = item.textContent || item.innerText || '';
        for (const kw of kws) {
          if (text.includes(kw)) {
            item.click();
            return true;
          }
        }
      }
      return false;
    }, keywords);

    if (switched) {
      console.log(`[ModelRouter] Switched to ${meta.name} via DOM`);
    }
    return switched;
  } catch (e) {
    console.error(`[ModelRouter] switchModel error: ${e.message}`);
    return false;
  }
}

// ── Recording ──
function recordResult(userDataDir, modelId, success) {
  const fp = historyPath(userDataDir);
  const history = loadJSON(fp);
  if (!history[modelId]) history[modelId] = { success: 0, total: 0 };
  history[modelId].total++;
  if (success) {
    history[modelId].success++;
    recordCircuitSuccess(modelId);
  } else {
    recordCircuitFailure(modelId);
  }
  saveJSON(fp, history);
}

function recordResponse(userDataDir, modelId, taskType, metrics = {}) {
  const fp = abPath(userDataDir);
  const ab = loadJSON(fp);
  const key = `${modelId}:${taskType}`;
  if (!ab[key]) ab[key] = { samples: [], successCount: 0, failCount: 0 };

  const entry = {
    ts: Date.now(),
    responseLen: metrics.responseLen || 0,
    latencyMs: metrics.latencyMs || 0,
    error: metrics.error || null,
  };

  ab[key].samples.push(entry);
  if (entry.error) ab[key].failCount++;
  else ab[key].successCount++;

  // Cap samples at 200
  if (ab[key].samples.length > 200) {
    ab[key].samples = ab[key].samples.slice(-200);
  }

  saveJSON(fp, ab);
}

// ── Calibration ──
function calibrateStrengths(userDataDir, taskType) {
  const abConfig = constants.AB_CONFIG || { minSamples: 10 };
  const fp = abPath(userDataDir);
  const ab = loadJSON(fp);
  const results = {};

  for (const [key, data] of Object.entries(ab)) {
    const [modelId, tt] = key.split(':');
    if (tt !== taskType) continue;

    const total = data.successCount + data.failCount;
    if (total < abConfig.minSamples) continue;

    const successRate = data.successCount / total;

    // Average latency (from recent samples, excluding errors)
    const validSamples = data.samples.filter(s => !s.error && s.latencyMs > 0);
    const avgLatency = validSamples.length > 0
      ? validSamples.reduce((sum, s) => sum + s.latencyMs, 0) / validSamples.length
      : 0;

    // Score: higher success rate = better, lower latency = better
    // Normalize latency: 1.0 at 0ms, ~0.5 at 10s, floor at 0.2
    const latencyFactor = avgLatency > 0 ? Math.max(0.2, 1 - avgLatency / 20000) : 1;
    const adjustedScore = successRate * 0.7 + latencyFactor * 0.3;

    results[modelId] = {
      successRate: Math.round(successRate * 1000) / 1000,
      avgLatency: Math.round(avgLatency),
      adjustedScore: Math.round(adjustedScore * 1000) / 1000,
      samples: total,
    };
  }

  return results;
}

// ── Skill Entry Point ──
async function run(ctx) {
  const args = ctx.args || {};
  const text = args.task || ctx.message || (ctx.lastMessage && (ctx.lastMessage.content || ctx.lastMessage.text)) || '';
  const engine = process.env.GOLEM_BRAIN_ENGINE || 'browser';
  const userDataDir = (ctx.brain && ctx.brain.userDataDir) || process.cwd();
  const conversationId = (ctx.brain && ctx.brain.conversationId) || args.conversationId || null;

  const result = selectBestModel(text, { userDataDir, engine, conversationId });

  // Record usage in history
  recordResult(userDataDir, result.model, true);

  // Update sticky cache
  if (conversationId) {
    stickyCache[`${conversationId}:${result.taskType}`] = result.model;
  }

  // Attempt browser switch if page available
  let switched = false;
  if (ctx.page) {
    switched = await switchModel(ctx.page, result.model);
  }

  // Only log when model actually changes or on non-default routing
  if (result.reason !== 'length_hint' && result.reason !== 'sticky') {
    console.log(`[ModelRouter] ${result.model} (${result.taskType}/${result.reason})`);
  }

  return {
    ...result,
    switched,
    text: `Selected model: ${result.model} (${result.reason}, ${result.taskType}/${result.complexity})`,
  };
}


// Experience Replay: log routing outcomes for RL-style improvement
const experienceLog = [];
function logExperience(model, taskType, latencyMs, success) {
    experienceLog.push({
        model, taskType, latencyMs, success,
        timestamp: Date.now(),
    });
    // Keep only last 100 entries in memory
    if (experienceLog.length > 100) experienceLog.shift();

    // Push to Graph RAG if available (fire-and-forget)
    try {
        const AragClient = require('../../services/AragClient');
        const client = new AragClient();
        client.ingest({
            type: 'experience_replay',
            source: 'model-router',
            content: JSON.stringify({ model, taskType, latencyMs, success }),
            metadata: { timestamp: Date.now() }
        }).catch(() => {});
    } catch (e) { }
}

module.exports = {
    logExperience,
    experienceLog,
  name: 'model-router',
  description: '智能模型路由器 — 雙引擎 (API/Browser)，A/B 測試，自動校準',
  run,
  selectBestModel,
  switchModel,
  classifyTask,
  estimateComplexity,
  recordResult,
  recordResponse,
  calibrateStrengths,
};
