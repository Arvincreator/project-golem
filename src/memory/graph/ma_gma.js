// ============================================================
// 🧠 MAGMA — Local Knowledge Graph (Fallback + Sync with YEDAN RAG)
// 4-Layer: entity / semantic / causal / temporal
// ============================================================
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'nodes.json');

class MAGMA {
    constructor() {
        this.data = { nodes: [], edges: [] };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
                this.data.nodes = raw.nodes || [];
                this.data.edges = raw.edges || [];
            }
        } catch (e) {
            console.warn('[MAGMA] Failed to load graph data, trying backup:', e.message);
            const backupPath = DATA_FILE + '.bak';
            try {
                if (fs.existsSync(backupPath)) {
                    const raw = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
                    this.data.nodes = raw.nodes || [];
                    this.data.edges = raw.edges || [];
                    console.log('[MAGMA] Recovered from backup');
                }
            } catch (e2) {
                console.warn('[MAGMA] Backup also failed:', e2.message);
            }
        }
    }

    _save() {
        if (this._saving) return; // Prevent concurrent writes
        this._saving = true;
        try {
            const json = JSON.stringify(this.data, null, 2);
            // Validate before writing (prevents corruption)
            JSON.parse(json);
            fs.writeFileSync(DATA_FILE, json);
            try { fs.writeFileSync(DATA_FILE + '.bak', json); } catch (_) { console.warn('[MAGMA] Failed to write backup:', _.message); }
            this._writeCount = (this._writeCount || 0) + 1;
            // Auto-consolidate every 100 writes
            if (this._writeCount % 100 === 0) {
                this._saving = false;
                this.consolidate();
                return;
            }
        } catch (e) {
            console.warn('[MAGMA] Failed to save:', e.message);
        } finally {
            this._saving = false;
        }
    }

    // --- Node Operations ---

    addNode(id, properties = {}) {
        if (!id || typeof id !== 'string') return null;
        if (id.length < 2) return null;
        // Reject properties with numeric keys (corruption pattern)
        if (properties && properties['0'] !== undefined) return null;
        // Reject nodes where all property values are empty/null
        if (properties && typeof properties === 'object') {
            const vals = Object.values(properties).filter(v => v !== null && v !== undefined && v !== '');
            if (vals.length === 0 && !properties.type && !properties.name) return null;
        }
        const existing = this.data.nodes.find(n => n.id === id);
        if (existing) {
            Object.assign(existing, properties, { updated_at: new Date().toISOString() });
        } else {
            this.data.nodes.push({ id, ...properties, created_at: new Date().toISOString() });
        }
        this._save();
        return this.getNode(id);
    }

    getNode(id) {
        return this.data.nodes.find(n => n.id === id) || null;
    }

    removeNode(id) {
        this.data.nodes = this.data.nodes.filter(n => n.id !== id);
        this.data.edges = this.data.edges.filter(e => e.source !== id && e.target !== id);
        this._save();
    }

    // --- Edge Operations ---

    addRelation(source, type, target, properties = {}) {
        // Ensure nodes exist
        if (!this.getNode(source)) this.addNode(source);
        if (!this.getNode(target)) this.addNode(target);

        // Dedup: don't add same relation twice
        const exists = this.data.edges.find(
            e => e.source === source && e.type === type && e.target === target
        );
        if (exists) {
            Object.assign(exists, properties, { updated_at: new Date().toISOString() });
        } else {
            this.data.edges.push({
                source, type, target,
                ...properties,
                created_at: new Date().toISOString()
            });
        }
        this._save();
    }

    removeRelation(source, type, target) {
        this.data.edges = this.data.edges.filter(
            e => !(e.source === source && e.type === type && e.target === target)
        );
        this._save();
    }

    // --- Query ---

    query(keyword) {
        const kw = (keyword || '').toLowerCase();
        const kwWords = kw.split(/\s+/).filter(w => w.length > 1);
        let nodes = this.data.nodes.filter(n =>
            !n.deprecated &&
            (n.id.toLowerCase().includes(kw) ||
            (n.name && n.name.toLowerCase().includes(kw)) ||
            (n.type && n.type.toLowerCase().includes(kw)))
        );
        // Add _relevanceScore (keyword match ratio)
        nodes.forEach(n => {
            if (kwWords.length > 0) {
                const text = `${n.id} ${n.name || ''} ${n.type || ''}`.toLowerCase();
                const hits = kwWords.filter(w => text.includes(w)).length;
                n._relevanceScore = Math.round(hits / kwWords.length * 100) / 100;
            } else {
                n._relevanceScore = 1;
            }
        });
        // Sort: higher score first → higher _accessCount first → more recent updated_at first
        nodes.sort((a, b) => {
            const scoreDiff = (b.score || 0) - (a.score || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const accessDiff = (b._accessCount || 0) - (a._accessCount || 0);
            if (accessDiff !== 0) return accessDiff;
            const aTime = new Date(b.updated_at || b.created_at || 0).getTime();
            const bTime = new Date(a.updated_at || a.created_at || 0).getTime();
            return aTime - bTime;
        });
        const nodeIds = new Set(nodes.map(n => n.id));
        const edges = this.data.edges.filter(
            e => nodeIds.has(e.source) || nodeIds.has(e.target)
        );
        // Boost weight tracking on accessed nodes
        nodes.forEach(n => {
            n._accessCount = (n._accessCount || 0) + 1;
            n._lastAccess = new Date().toISOString();
        });
        if (nodes.length > 0) this._save();
        return { nodes, edges };
    }

    getNeighbors(nodeId) {
        const edges = this.data.edges.filter(e => e.source === nodeId || e.target === nodeId);
        const neighborIds = new Set();
        edges.forEach(e => {
            if (e.source !== nodeId) neighborIds.add(e.source);
            if (e.target !== nodeId) neighborIds.add(e.target);
        });
        const neighbors = this.data.nodes.filter(n => neighborIds.has(n.id));
        return { edges, neighbors };
    }

    // --- Stats ---

    stats() {
        const types = {};
        this.data.nodes.forEach(n => {
            const t = n.type || 'unknown';
            types[t] = (types[t] || 0) + 1;
        });
        const edgeTypes = {};
        this.data.edges.forEach(e => {
            edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1;
        });
        return {
            nodes: this.data.nodes.length,
            edges: this.data.edges.length,
            nodeTypes: types,
            edgeTypes: edgeTypes
        };
    }

    // --- Consolidate (merge duplicate/similar nodes) ---

    consolidate() {
        const removed = [];
        const nodeMap = new Map();
        // Group by name (case-insensitive)
        for (const node of this.data.nodes) {
            const key = (node.name || node.id).toLowerCase().trim();
            if (!nodeMap.has(key)) {
                nodeMap.set(key, node);
            } else {
                // Merge properties into existing
                const existing = nodeMap.get(key);
                Object.assign(existing, { ...node, ...existing, updated_at: new Date().toISOString() });
                // Redirect edges
                this.data.edges = this.data.edges.map(e => ({
                    ...e,
                    source: e.source === node.id ? existing.id : e.source,
                    target: e.target === node.id ? existing.id : e.target,
                }));
                removed.push(node.id);
            }
        }
        this.data.nodes = this.data.nodes.filter(n => !removed.includes(n.id));
        // Dedup edges
        const edgeKeys = new Set();
        this.data.edges = this.data.edges.filter(e => {
            const key = `${e.source}|${e.type}|${e.target}`;
            if (edgeKeys.has(key)) return false;
            edgeKeys.add(key);
            return true;
        });
        this._save();
        return { mergedNodes: removed.length, totalNodes: this.data.nodes.length, totalEdges: this.data.edges.length };
    }

    // --- Prune (remove old nodes) ---

    prune(maxAgeDays = 90) {
        const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
        const before = this.data.nodes.length;
        const protectedTypes = ['skill_injection', 'experience', 'core'];
        this.data.nodes = this.data.nodes.filter(n =>
            protectedTypes.includes(n.type) || !n.created_at || n.created_at > cutoff
        );
        const nodeIds = new Set(this.data.nodes.map(n => n.id));
        this.data.edges = this.data.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
        this._save();
        return { pruned: before - this.data.nodes.length, remaining: this.data.nodes.length };
    }

    // --- Backup / Restore ---

    backup() {
        const backupPath = DATA_FILE + '.bak';
        fs.writeFileSync(backupPath, JSON.stringify(this.data, null, 2));
        return backupPath;
    }

    restore() {
        const backupPath = DATA_FILE + '.bak';
        if (!fs.existsSync(backupPath)) return false;
        try {
            const raw = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
            this.data.nodes = raw.nodes || [];
            this.data.edges = raw.edges || [];
            this._save();
            return true;
        } catch (e) {
            console.warn('[MAGMA] Restore failed:', e.message);
            return false;
        }
    }

    // --- Bulk import (from YEDAN RAG sync) ---

    importFromRAG(entities, relationships) {
        let nodesAdded = 0, edgesAdded = 0;
        for (const e of (entities || [])) {
            if (e.id || e.name) {
                this.addNode(e.id || e.name, { type: e.type, name: e.name, ...(e.properties || {}) });
                nodesAdded++;
            }
        }
        for (const r of (relationships || [])) {
            if (r.source && r.target && r.type) {
                this.addRelation(r.source, r.type, r.target);
                edgesAdded++;
            }
        }
        return { nodesAdded, edgesAdded };
    }
}

module.exports = new MAGMA();
