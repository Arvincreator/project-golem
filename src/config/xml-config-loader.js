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
        console.error(`[Config] XML parse error: ${e.message}`);
        this.config = this._defaults();
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
