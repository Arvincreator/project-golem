'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const BASE_URL = process.env.GRAPH_RAG_URL || 'https://yedan-graph-rag.yagami8095.workers.dev';
const AUTH_TOKEN = process.env.GRAPH_RAG_TOKEN || 'graph-rag-2026';
const TIMEOUT_MS = 10000;

class AragClient {
  constructor(baseUrl = BASE_URL, token = AUTH_TOKEN) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const mod = url.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;

      const req = mod.request(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: TIMEOUT_MS,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async query(text, limit = 5) {
    try {
      return await this._request('POST', '/query', { query: text, limit });
    } catch (err) {
      console.warn('[AragClient] query failed:', err.message);
      return [];
    }
  }

  async ingest(entities, relations) {
    try {
      return await this._request('POST', '/bulk-ingest', { entities, relations });
    } catch (err) {
      console.warn('[AragClient] ingest failed:', err.message);
      return null;
    }
  }

  async stats() {
    try {
      return await this._request('GET', '/stats');
    } catch (err) {
      console.warn('[AragClient] stats failed:', err.message);
      return null;
    }
  }

  async health() {
    try {
      return await this._request('GET', '/health');
    } catch (err) {
      console.warn('[AragClient] health failed:', err.message);
      return null;
    }
  }
}

module.exports = AragClient;
