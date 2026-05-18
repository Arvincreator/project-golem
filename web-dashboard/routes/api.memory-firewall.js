const express = require('express');
const { buildOperationGuard } = require('../server/security');
const { getMemoryFirewallService, parseLooseBoolean } = require('../../src/services/MemoryFirewallService');

module.exports = function registerMemoryFirewallRoutes(server) {
  const router = express.Router();
  const requireMemoryAdmin = buildOperationGuard(server, 'memory_mutation');
  const svc = getMemoryFirewallService();

  router.get('/api/memory-firewall/status', (req, res) => {
    try {
      return res.json(svc.getStatus());
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.patch('/api/memory-firewall/status', requireMemoryAdmin, (req, res) => {
    try {
      const enabled = parseLooseBoolean(req.body?.enabled);
      if (enabled === undefined) return res.status(400).json({ error: 'enabled must be boolean' });
      const status = svc.setEnabled(enabled);
      return res.json({ success: true, ...status });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/memory-firewall/rules', (req, res) => {
    try {
      const includeDisabled = parseLooseBoolean(req.query.includeDisabled) === true;
      const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
      const rules = svc.listRules({ includeDisabled, scope });
      return res.json(rules);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.post('/api/memory-firewall/rules', requireMemoryAdmin, (req, res) => {
    try {
      const result = svc.addRule(req.body || {});
      if (result.success === false) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.patch('/api/memory-firewall/rules/:id', requireMemoryAdmin, (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id is required' });
      const result = svc.updateRule(id, req.body || {});
      if (result.success === false) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.delete('/api/memory-firewall/rules/:id', requireMemoryAdmin, (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id is required' });
      const result = svc.deleteRule(id);
      if (result.success === false) return res.status(404).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/memory-firewall/hits', (req, res) => {
    try {
      const limit = Number(req.query.limit || 100);
      return res.json(svc.listHits(limit));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
};
