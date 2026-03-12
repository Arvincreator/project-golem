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
            console.warn('[MAGMA] Failed to load graph data:', e.message);
        }
    }

    _save() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.warn('[MAGMA] Failed to save:', e.message);
        }
    }

    // --- Node Operations ---

    addNode(id, properties = {}) {
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
        const nodes = this.data.nodes.filter(n =>
            n.id.toLowerCase().includes(kw) ||
            (n.name && n.name.toLowerCase().includes(kw)) ||
            (n.type && n.type.toLowerCase().includes(kw))
        );
        const nodeIds = new Set(nodes.map(n => n.id));
        const edges = this.data.edges.filter(
            e => nodeIds.has(e.source) || nodeIds.has(e.target)
        );
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
