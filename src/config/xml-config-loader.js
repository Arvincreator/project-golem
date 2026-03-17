// src/config/xml-config-loader.js
// XML 配置中心載入器 — 支援 hot reload
// 依賴: fast-xml-parser (45KB, 0 依賴, npm install fast-xml-parser)

const fs = require('fs');
const path = require('path');

let XMLParser;
try {
  ({ XMLParser } = require('fast-xml-parser'));
} catch {
  XMLParser = null;
}

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../golem-config.xml');

class GolemConfigLoader {
  constructor(configPath) {
    this.configPath = configPath || DEFAULT_CONFIG_PATH;
    this.config = null;
    this.lastLoaded = 0;
    this._watcher = null;
    this._parser = XMLParser ? new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: true,
      allowBooleanAttributes: true,
    }) : null;
  }

  load() {
    if (!fs.existsSync(this.configPath)) {
      console.warn(`[Config] ${this.configPath} not found, using defaults`);
      this.config = this._defaults();
      return this.config;
    }

    const raw = fs.readFileSync(this.configPath, 'utf-8');

    if (this._parser) {
      try {
        const parsed = this._parser.parse(raw);
        this.config = parsed['golem-config'] || parsed;
      } catch (e) {
        console.error(`[Config] CRITICAL: XML parse error in ${this.configPath}: ${e.message}`);
        console.error(`[Config] Using defaults — system may not behave as expected`);
        this.config = this._defaults();
        this._parseError = e.message;
      }
    } else {
      // Fallback: try JSON config
      const jsonPath = this.configPath.replace('.xml', '.json');
      if (fs.existsSync(jsonPath)) {
        try {
          this.config = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        } catch {
          this.config = this._defaults();
        }
      } else {
        console.warn('[Config] No XML parser and no JSON fallback');
        this.config = this._defaults();
      }
    }

    this.lastLoaded = Date.now();
    return this.config;
  }

  getNodeConfig(nodeId) {
    if (!this.config) this.load();
    const nodes = this._ensureArray(this.config?.node);
    return nodes.find(n => n['@_id'] === nodeId) || null;
  }

  getCircuitBreakerConfig(name) {
    if (!this.config) this.load();
    const breakers = this._ensureArray(this.config?.['circuit-breakers']?.breaker);
    const found = breakers.find(b => b['@_name'] === name);
    if (!found) return null;
    return {
      timeout: found['@_timeout-ms'] || 3000,
      resetTimeout: found['@_reset-ms'] || 30000,
      errorThresholdPercentage: found['@_error-pct'] || 50,
    };
  }

  getRagConfig() {
    if (!this.config) this.load();
    const rag = this.config?.rag;
    if (!rag) return { url: 'https://yedan-graph-rag.yagami8095.workers.dev', timeout: 15000 };
    return {
      url: rag?.remote?.['@_url'] || 'https://yedan-graph-rag.yagami8095.workers.dev',
      authEnv: rag?.remote?.['@_auth-env'] || 'FLEET_AUTH_TOKEN',
      timeout: rag?.remote?.['@_timeout-ms'] || 15000,
      localDriver: rag?.local?.['@_driver'] || 'magma',
      localDataFile: rag?.local?.['@_data-file'] || 'src/memory/graph/nodes.json',
      syncIntervalMin: rag?.sync?.['@_interval-minutes'] || 60,
    };
  }

  getGeminiConfig() {
    if (!this.config) this.load();
    const g = this.config?.gemini;
    if (!g) return { model: 'gemini-2.5-flash', rpm: 60 };
    return {
      engine: g?.['@_engine'] || 'puppeteer',
      model: g?.model?.['@_primary'] || 'gemini-2.5-flash',
      fallbackModel: g?.model?.['@_fallback'] || 'gemini-3-flash-preview',
      rpm: g?.limits?.['@_rpm'] || 60,
      daily: g?.limits?.['@_daily'] || 1500,
    };
  }

  getTelegramConfig() {
    if (!this.config) this.load();
    const tg = this.config?.telegram;
    if (!tg) return { pollingTimeout: 30, maxErrors: 10 };
    return {
      pollingTimeout: tg?.polling?.['@_timeout-sec'] || 30,
      maxConsecutiveErrors: tg?.polling?.['@_max-consecutive-errors'] || 10,
      backoffMax: tg?.polling?.['@_backoff-max-sec'] || 60,
      jitter: tg?.polling?.['@_jitter'] === true || tg?.polling?.['@_jitter'] === 'true',
      deleteWebhookOnStart: true,
      dropPending: tg?.startup?.['delete-webhook']?.['@_drop-pending'] === 'true',
      startupWait: tg?.startup?.['wait-sec'] || 3,
    };
  }

  // v10.0: New getters for expanded XML config sections

  getBrainConfig() {
    if (!this.config) this.load();
    const b = this.config?.brains;
    if (!b) return null;
    return {
      engine: b['@_engine'] || 'router',
      router: {
        totalTimeoutMs: b?.router?.['@_total-timeout-ms'] || 90000,
        fallbackChain: (b?.router?.['fallback-chain'] || 'monica-web,monica,sdk,ollama').split(',').map(s => s.trim()),
        stickyRouting: b?.router?.['sticky-routing']?.['@_enabled'] !== false,
        stickyWindowSize: b?.router?.['sticky-routing']?.['@_window-size'] || 20,
      },
      monica: {
        baseUrlEnv: b?.monica?.api?.['@_base-url-env'] || 'MONICA_API_URL',
        keyEnv: b?.monica?.api?.['@_key-env'] || 'MONICA_API_KEY',
        defaultModel: b?.monica?.api?.['@_default-model'] || 'gpt-4o',
        timeoutMs: b?.monica?.api?.['@_timeout-ms'] || 60000,
        webDefaultModel: b?.monica?.web?.['@_default-model'] || 'gpt-4o',
        webDailyLimit: b?.monica?.web?.['@_daily-limit'] || 500,
      },
      ollama: {
        url: b?.ollama?.['@_url'] || 'http://localhost:11434/v1',
        model: b?.ollama?.['@_model'] || 'deepseek-r1:8b',
        timeoutMs: b?.ollama?.['@_timeout-ms'] || 90000,
        fallbackModels: (b?.ollama?.['@_fallback-models'] || 'qwen2:1.5b').split(',').map(s => s.trim()),
        gpu: {
          numGpu: b?.ollama?.gpu?.['@_num-gpu'] || 'auto',
          timeoutMs: b?.ollama?.gpu?.['@_timeout-ms'] || 30000,
          adaptiveCtx: b?.ollama?.gpu?.['@_adaptive-ctx'] !== false,
          minCtx: b?.ollama?.gpu?.['@_min-ctx'] || 8192,
        },
      },
    };
  }

  getSecurityConfig() {
    if (!this.config) this.load();
    const s = this.config?.security;
    if (!s) return null;
    const whitelist = (s?.['command-whitelist'] || '').split(',').map(c => c.trim()).filter(Boolean);
    const rules = this._ensureArray(s?.['level-rules']?.rule).map(r => ({
      level: r['@_level'],
      pattern: r['@_pattern'],
    }));
    return { whitelist, rules };
  }

  getMemoryConfig() {
    if (!this.config) this.load();
    const m = this.config?.memory;
    if (!m) return null;
    return {
      mode: m['@_mode'] || 'browser',
      chatLog: {
        retentionHourlyHours: m?.['chat-log']?.retention?.['@_hourly-hours'] || 72,
        retentionDailyDays: m?.['chat-log']?.retention?.['@_daily-days'] || 30,
        retentionMonthlyMonths: m?.['chat-log']?.retention?.['@_monthly-months'] || 12,
        retentionYearlyYears: m?.['chat-log']?.retention?.['@_yearly-years'] || 5,
        compressionTimeoutMs: m?.['chat-log']?.compression?.['@_timeout-ms'] || 60000,
        maxWordsDailySummary: m?.['chat-log']?.compression?.['@_max-words-daily'] || 500,
        maxWordsMonthlySummary: m?.['chat-log']?.compression?.['@_max-words-monthly'] || 300,
      },
      threeLayer: {
        workingCap: m?.['three-layer']?.['@_working-cap'] || 50,
        episodicCap: m?.['three-layer']?.['@_episodic-cap'] || 500,
        summaryThreshold: m?.['three-layer']?.['@_summary-threshold'] || 0.5,
      },
      contextEngineer: {
        tokenBudget: m?.['context-engineer']?.['@_token-budget'] || 32768,
        reservePct: m?.['context-engineer']?.['@_reserve-pct'] || 15,
        overflowCleanupHours: m?.['context-engineer']?.['@_overflow-cleanup-hours'] || 24,
      },
    };
  }

  getLoggingConfig() {
    if (!this.config) this.load();
    const l = this.config?.logging;
    if (!l) return null;
    return {
      system: {
        bufferSize: l?.system?.['@_buffer-size'] || 100,
        flushIntervalMs: l?.system?.['@_flush-interval-ms'] || 500,
        rotateMaxMb: l?.system?.['@_rotate-max-mb'] || 10,
        rotateKeep: l?.system?.['@_rotate-keep'] || 3,
      },
      console: {
        timestamp: l?.console?.['@_timestamp'] !== false,
        level: l?.console?.['@_level'] || 'info',
      },
    };
  }

  getRetryConfig() {
    if (!this.config) this.load();
    const r = this.config?.retry;
    if (!r) return null;
    return {
      maxAttempts: r['@_max-attempts'] || 3,
      baseDelayMs: r['@_base-delay-ms'] || 1000,
      maxDelayMs: r['@_max-delay-ms'] || 30000,
      jitter: r['@_jitter'] || 'decorrelated',
      retryableCodes: (r['@_retryable-codes'] || '429,500,502,503,504').split(',').map(Number),
    };
  }

  getVectorStoreConfig() {
    if (!this.config) this.load();
    const vs = this.config?.['vector-store'];
    if (!vs) return null;
    return {
      dbPath: vs['@_db-path'] || 'golem_memory/vectors.db',
      maxVectors: vs['@_max-vectors'] || 10000,
      embeddings: {
        provider: vs?.embeddings?.['@_provider'] || 'gemini',
        model: vs?.embeddings?.['@_model'] || 'text-embedding-004',
        fallback: vs?.embeddings?.['@_fallback'] || 'ollama:nomic-embed-text',
        cacheSize: vs?.embeddings?.['@_cache-size'] || 100,
        batchSize: vs?.embeddings?.['@_batch-size'] || 20,
      },
    };
  }

  getClaudeConfig() {
    if (!this.config) this.load();
    const c = this.config?.claude;
    if (!c) return null;
    return {
      apiKeyEnv: c['@_api-key-env'] || 'ANTHROPIC_API_KEY',
      defaultModel: c['@_default-model'] || 'claude-opus-4-6-20250515',
      timeoutMs: c['@_timeout-ms'] || 120000,
      maxTokens: c['@_max-tokens'] || 8192,
    };
  }

  getClaudeGatewayConfig() {
    if (!this.config) this.load();
    const cg = this.config?.['claude-gateway'];
    if (!cg) return null;
    return {
      enabled: cg['@_enabled'] === true || cg['@_enabled'] === 'true',
      tokenEnv: cg['@_token-env'] || 'CLAUDE_GATEWAY_TOKEN',
      rateLimitRpm: cg['@_rate-limit-rpm'] || 60,
    };
  }

  // v12.0: 8 new getters for v11.5 module externalization

  getErrorPatternLearnerConfig() {
    if (!this.config) this.load();
    const e = this.config?.['error-pattern-learner'];
    if (!e) return { maxPatterns: 200, dedupThreshold: 0.8, retentionDays: 90, autoSuggest: true };
    return {
      maxPatterns: e['@_max-patterns'] || 200,
      dedupThreshold: e['@_dedup-threshold'] || 0.8,
      retentionDays: e['@_retention-days'] || 90,
      autoSuggest: e['@_auto-suggest'] !== false && e['@_auto-suggest'] !== 'false',
    };
  }

  getScanQualityTrackerConfig() {
    if (!this.config) this.load();
    const s = this.config?.['scan-quality-tracker'];
    if (!s) return { maxRecords: 500, worthlessThreshold: 3, autoSkip: true, minEffectiveness: 0.1 };
    return {
      maxRecords: s['@_max-records'] || 500,
      worthlessThreshold: s['@_worthless-threshold'] || 3,
      autoSkip: s['@_auto-skip'] !== false && s['@_auto-skip'] !== 'false',
      minEffectiveness: s['@_min-effectiveness'] || 0.1,
    };
  }

  getWorkerHealthAuditorConfig() {
    if (!this.config) this.load();
    const w = this.config?.['worker-health-auditor'];
    if (!w) return { timeoutMs: 5000, maxConsecutiveFailures: 3, checkIntervalMin: 30, maxHistory: 200 };
    return {
      timeoutMs: w['@_timeout-ms'] || 5000,
      maxConsecutiveFailures: w['@_max-consecutive-failures'] || 3,
      checkIntervalMin: w['@_check-interval-min'] || 30,
      maxHistory: w['@_max-history'] || 200,
    };
  }

  getSecurityAuditorConfig() {
    if (!this.config) this.load();
    const s = this.config?.['security-auditor'];
    if (!s) return { aiRiskChecks: true, traditionalWeight: 0.6, aiRiskWeight: 0.4, maxRiskScore: 100 };
    return {
      aiRiskChecks: s['@_ai-risk-checks'] !== false && s['@_ai-risk-checks'] !== 'false',
      traditionalWeight: s['@_traditional-weight'] || 0.6,
      aiRiskWeight: s['@_ai-risk-weight'] || 0.4,
      maxRiskScore: s['@_max-risk-score'] || 100,
    };
  }

  getRAGQualityMonitorConfig() {
    if (!this.config) this.load();
    const r = this.config?.['rag-quality-monitor'];
    if (!r) return { testQueryCount: 10, minRecall: 0.3, latencyWarnMs: 500, checkIntervalMin: 120 };
    return {
      testQueryCount: r['@_test-query-count'] || 10,
      minRecall: r['@_min-recall'] || 0.3,
      latencyWarnMs: r['@_latency-warn-ms'] || 500,
      checkIntervalMin: r['@_check-interval-min'] || 120,
    };
  }

  getDebateQualityTrackerConfig() {
    if (!this.config) this.load();
    const d = this.config?.['debate-quality-tracker'];
    if (!d) return { maxHistory: 100, diversityWeight: 0.3, differentiationWeight: 0.4, coverageWeight: 0.3 };
    return {
      maxHistory: d['@_max-history'] || 100,
      diversityWeight: d['@_diversity-weight'] || 0.3,
      differentiationWeight: d['@_differentiation-weight'] || 0.4,
      coverageWeight: d['@_coverage-weight'] || 0.3,
    };
  }

  getAutonomySchedulerConfig() {
    if (!this.config) this.load();
    const a = this.config?.['autonomy-scheduler'];
    if (!a) return { scanIntervalMin: 120, debateIntervalMin: 180, optimizeIntervalMin: 60, rssHealThresholdMb: 350, episodeDedupThreshold: 50, workerCheckIntervalMin: 30, securityAuditIntervalMin: 360, yerenSyncIntervalMin: 60 };
    return {
      scanIntervalMin: a['@_scan-interval-min'] || 120,
      debateIntervalMin: a['@_debate-interval-min'] || 180,
      optimizeIntervalMin: a['@_optimize-interval-min'] || 60,
      rssHealThresholdMb: a['@_rss-heal-threshold-mb'] || 350,
      episodeDedupThreshold: a['@_episode-dedup-threshold'] || 50,
      workerCheckIntervalMin: a['@_worker-check-interval-min'] || 30,
      securityAuditIntervalMin: a['@_security-audit-interval-min'] || 360,
      yerenSyncIntervalMin: a['@_yeren-sync-interval-min'] || 60,
    };
  }

  getTokenTrackingConfig() {
    if (!this.config) this.load();
    const t = this.config?.['token-tracking'];
    if (!t) return { enabled: true, budgetDaily: 50000, persistIntervalMs: 5000, dataFile: 'data/token_usage.json', warnThresholdPct: 80 };
    return {
      enabled: t['@_enabled'] !== false && t['@_enabled'] !== 'false',
      budgetDaily: t['@_budget-daily'] || 50000,
      persistIntervalMs: t['@_persist-interval-ms'] || 5000,
      dataFile: t['@_data-file'] || 'data/token_usage.json',
      warnThresholdPct: t['@_warn-threshold-pct'] || 80,
    };
  }

  getFailoverConfig() {
    if (!this.config) this.load();
    const fo = this.config?.failover;
    if (!fo) return { heartbeatSec: 30, detectSec: 90, confirmSec: 180 };
    return {
      heartbeatSec: fo?.heartbeat?.['@_interval-sec'] || 30,
      storage: fo?.heartbeat?.['@_storage'] || 'd1',
      detectSec: fo?.timeout?.['@_detect-sec'] || 90,
      confirmSec: fo?.timeout?.['@_confirm-sec'] || 180,
      autoTakeover: fo?.takeover?.['@_auto'] === true || fo?.takeover?.['@_auto'] === 'true',
    };
  }

  validate() {
    const errors = [];
    if (this._parseError) errors.push(`Parse error: ${this._parseError}`);
    if (!this.config) errors.push('Config not loaded');
    return { valid: errors.length === 0, errors };
  }

  watch(callback) {
    if (this._watcher) return;
    try {
      this._watcher = fs.watch(this.configPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          console.log('[Config] golem-config.xml changed, reloading...');
          try {
            this.load();
            if (callback) callback(this.config);
          } catch (e) {
            console.error('[Config] Reload failed:', e.message);
          }
        }
      });
    } catch (e) {
      console.warn('[Config] Cannot watch config file:', e.message);
    }
  }

  stopWatch() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  _ensureArray(val) {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  }

  _defaults() {
    return {
      node: { '@_id': 'unknown', '@_role': 'standalone' },
      rag: { remote: { '@_url': 'https://yedan-graph-rag.yagami8095.workers.dev' } },
      telegram: { polling: { '@_timeout-sec': 30, '@_max-consecutive-errors': 10 } },
      'circuit-breakers': { breaker: [] },
    };
  }
}

// Singleton instance
let _instance = null;
function getConfig(configPath) {
  if (!_instance) {
    _instance = new GolemConfigLoader(configPath);
    _instance.load();
  }
  return _instance;
}

module.exports = { GolemConfigLoader, getConfig };
