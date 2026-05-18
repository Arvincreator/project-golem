const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_PATH = path.resolve(process.cwd(), 'data', 'dashboard', 'memory-firewall.json');
const DEFAULT_STATE = {
  enabled: true,
  rules: [],
  hits: []
};

const MAX_HITS = 500;

function ensureDir(targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRule(input = {}) {
  const createdAt = input.createdAt || nowIso();
  const updatedAt = input.updatedAt || nowIso();
  const phrase = String(input.pattern || '').trim();
  return {
    id: String(input.id || randomUUID()),
    pattern: phrase,
    matchMode: input.matchMode === 'exact' ? 'exact' : 'contains',
    scope: typeof input.scope === 'string' && input.scope.trim() ? input.scope.trim() : 'global',
    enabled: input.enabled !== false,
    createdAt,
    updatedAt
  };
}

function parseLooseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return undefined;
}

function extractPattern(sentence) {
  const raw = String(sentence || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/^請\s*/u, '')
    .replace(/不要再提起?|不要提起?|別再提起?|別提起?|請勿提起?|禁止提起?/u, '')
    .replace(/[。！？!?,，]+$/u, '')
    .trim();
  return cleaned || raw;
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (_) {
    return fallback;
  }
}

class MemoryFirewallService {
  constructor() {
    this.dataPath = DATA_PATH;
    this.state = null;
    this._load();
  }

  _load() {
    ensureDir(this.dataPath);
    const payload = safeReadJson(this.dataPath, DEFAULT_STATE);
    const rules = Array.isArray(payload.rules) ? payload.rules : [];
    const hits = Array.isArray(payload.hits) ? payload.hits : [];
    this.state = {
      enabled: payload.enabled !== false,
      rules: rules.map((r) => normalizeRule(r)).filter((r) => r.pattern),
      hits: hits.slice(-MAX_HITS)
    };
    this._save();
  }

  _save() {
    ensureDir(this.dataPath);
    fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  isEnabled() {
    return this.state.enabled !== false;
  }

  setEnabled(enabled) {
    this.state.enabled = enabled !== false;
    this._save();
    return this.getStatus();
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      rulesCount: this.state.rules.length,
      activeRulesCount: this.state.rules.filter((r) => r.enabled !== false).length,
      hitsCount: this.state.hits.length,
      updatedAt: nowIso()
    };
  }

  listRules(options = {}) {
    const scope = String(options.scope || '').trim();
    const includeDisabled = options.includeDisabled === true;
    let rules = this.state.rules.slice();
    if (scope) rules = rules.filter((r) => r.scope === 'global' || r.scope === scope);
    if (!includeDisabled) rules = rules.filter((r) => r.enabled !== false);
    rules.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    return rules;
  }

  addRule(input = {}) {
    const pattern = extractPattern(input.pattern || input.sentence || '');
    if (!pattern) return { success: false, error: 'pattern is required' };
    const rule = normalizeRule({ ...input, pattern });
    this.state.rules.unshift(rule);
    this._save();
    return { success: true, rule };
  }

  updateRule(id, patch = {}) {
    const targetId = String(id || '').trim();
    const idx = this.state.rules.findIndex((r) => r.id === targetId);
    if (idx < 0) return { success: false, error: 'rule not found' };
    const current = this.state.rules[idx];
    const nextPattern = patch.pattern !== undefined || patch.sentence !== undefined
      ? extractPattern(patch.pattern || patch.sentence || '')
      : current.pattern;
    if (!nextPattern) return { success: false, error: 'pattern is required' };
    const next = normalizeRule({
      ...current,
      ...patch,
      pattern: nextPattern,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowIso()
    });
    this.state.rules[idx] = next;
    this._save();
    return { success: true, rule: next };
  }

  deleteRule(id) {
    const targetId = String(id || '').trim();
    const before = this.state.rules.length;
    this.state.rules = this.state.rules.filter((r) => r.id !== targetId);
    if (before === this.state.rules.length) return { success: false, error: 'rule not found' };
    this._save();
    return { success: true };
  }

  listHits(limit = 100) {
    const n = Number.isFinite(Number(limit)) ? Number(limit) : 100;
    return this.state.hits.slice(-Math.max(1, Math.min(n, MAX_HITS))).reverse();
  }

  _scopeMatches(ruleScope, ctx = {}) {
    if (!ruleScope || ruleScope === 'global') return true;
    if (!ctx.golemId) return false;
    return ruleScope === `golem:${ctx.golemId}`;
  }

  _textMatches(rule, text) {
    const haystack = String(text || '').toLowerCase();
    const needle = String(rule.pattern || '').toLowerCase();
    if (!needle) return false;
    if (rule.matchMode === 'exact') return haystack === needle;
    return haystack.includes(needle);
  }

  _recordHit(rule, phase, ctx = {}, sample = '') {
    const entry = {
      id: randomUUID(),
      ruleId: rule.id,
      phase,
      golemId: ctx.golemId || null,
      sample: String(sample || '').slice(0, 200),
      timestamp: nowIso()
    };
    this.state.hits.push(entry);
    if (this.state.hits.length > MAX_HITS) {
      this.state.hits = this.state.hits.slice(this.state.hits.length - MAX_HITS);
    }
    this._save();
  }

  filterMemories(memories = [], ctx = {}) {
    if (!this.isEnabled()) return { enabled: false, memories, removed: [] };
    const activeRules = this.state.rules.filter((r) => r.enabled !== false);
    if (activeRules.length === 0) return { enabled: true, memories, removed: [] };

    const kept = [];
    const removed = [];

    for (const memory of memories) {
      const text = String(memory && memory.text ? memory.text : '');
      let blockedBy = null;
      for (const rule of activeRules) {
        if (!this._scopeMatches(rule.scope, ctx)) continue;
        if (this._textMatches(rule, text)) {
          blockedBy = rule;
          break;
        }
      }
      if (blockedBy) {
        removed.push({ memory, ruleId: blockedBy.id, pattern: blockedBy.pattern });
        this._recordHit(blockedBy, 'recall', ctx, text);
        continue;
      }
      kept.push(memory);
    }

    return { enabled: true, memories: kept, removed };
  }

  inspectResponse(text, ctx = {}) {
    if (!this.isEnabled()) return { enabled: false, blocked: false, text, matchedRules: [] };
    const activeRules = this.state.rules.filter((r) => r.enabled !== false);
    if (activeRules.length === 0) return { enabled: true, blocked: false, text, matchedRules: [] };

    let masked = String(text || '');
    const matchedRules = [];

    for (const rule of activeRules) {
      if (!this._scopeMatches(rule.scope, ctx)) continue;
      if (!this._textMatches(rule, masked)) continue;
      matchedRules.push(rule);
      this._recordHit(rule, 'response', ctx, masked);
      const escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'ig');
      masked = masked.replace(regex, '（已依記憶防火牆隱去）');
    }

    return {
      enabled: true,
      blocked: matchedRules.length > 0,
      text: masked,
      matchedRules: matchedRules.map((r) => ({ id: r.id, pattern: r.pattern }))
    };
  }
}

let singleton = null;

module.exports = {
  getMemoryFirewallService() {
    if (!singleton) singleton = new MemoryFirewallService();
    return singleton;
  },
  parseLooseBoolean,
  extractPattern
};
