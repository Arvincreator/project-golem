// ============================================================
// PlanCheckpoint — LangGraph PostgresSaver/StateSnapshot Pattern
// Full plan state snapshots with versioning, rollback, branching
// ============================================================
const fs = require('fs');
const path = require('path');

const CHECKPOINT_DIR = 'golem_plan_checkpoints';
const MAX_VERSIONS = 20;

class PlanCheckpoint {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this._dir = path.join(process.cwd(), CHECKPOINT_DIR);
        this._counter = 0;
        this._ensureDir();
    }

    /**
     * Save a full plan state snapshot with version
     * @param {string} planId - Plan identifier
     * @param {Object} state - Full plan state
     * @param {Object} metadata - Additional metadata
     * @returns {{ version, path }}
     */
    save(planId, state, metadata = {}) {
        const version = Date.now() * 1000 + (this._counter++);
        const snapshot = {
            planId,
            version,
            state: JSON.parse(JSON.stringify(state)), // deep clone
            metadata: {
                ...metadata,
                golemId: this.golemId,
                savedAt: new Date().toISOString(),
            },
            parentVersion: metadata.parentVersion || null,
        };

        const filename = `${planId}_v${version}.json`;
        const filepath = path.join(this._dir, filename);

        try {
            fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));

            // Prune old versions
            this._pruneVersions(planId);

            return { version, path: filepath };
        } catch (e) {
            console.warn('[PlanCheckpoint] Save failed:', e.message);
            return null;
        }
    }

    /**
     * Load a specific version or the latest version of a plan
     * @param {string} planId
     * @param {number} [version] - Specific version, or latest if omitted
     */
    load(planId, version = null) {
        const versions = this._listVersions(planId);
        if (versions.length === 0) return null;

        let target;
        if (version) {
            target = versions.find(v => v.version === version);
        } else {
            target = versions[versions.length - 1]; // latest
        }

        if (!target) return null;

        try {
            return JSON.parse(fs.readFileSync(target.path, 'utf-8'));
        } catch (e) {
            console.warn('[PlanCheckpoint] Load failed:', e.message);
            return null;
        }
    }

    /**
     * List all versions for a plan
     */
    listVersions(planId) {
        return this._listVersions(planId).map(v => ({
            version: v.version,
            savedAt: new Date(v.version).toISOString(),
        }));
    }

    /**
     * Rollback to a previous version
     */
    rollback(planId, targetVersion) {
        const snapshot = this.load(planId, targetVersion);
        if (!snapshot) return null;

        // Save as new version with rollback metadata
        return this.save(planId, snapshot.state, {
            parentVersion: targetVersion,
            rollbackFrom: Date.now(),
        });
    }

    /**
     * Create a branch from a checkpoint (fork a plan)
     */
    branch(planId, newPlanId, version = null) {
        const snapshot = this.load(planId, version);
        if (!snapshot) return null;

        // Save branched state under new plan ID
        return this.save(newPlanId, snapshot.state, {
            branchedFrom: planId,
            parentVersion: snapshot.version,
        });
    }

    /**
     * Diff two versions of a plan
     */
    diff(planId, versionA, versionB) {
        const a = this.load(planId, versionA);
        const b = this.load(planId, versionB);
        if (!a || !b) return null;

        const stepsA = a.state.steps || [];
        const stepsB = b.state.steps || [];

        const changes = [];

        // Compare steps
        const allIds = new Set([...stepsA.map(s => s.id), ...stepsB.map(s => s.id)]);
        for (const id of allIds) {
            const stepA = stepsA.find(s => s.id === id);
            const stepB = stepsB.find(s => s.id === id);

            if (!stepA) {
                changes.push({ type: 'added', stepId: id, description: stepB.description });
            } else if (!stepB) {
                changes.push({ type: 'removed', stepId: id, description: stepA.description });
            } else if (stepA.status !== stepB.status) {
                changes.push({
                    type: 'status_changed', stepId: id,
                    from: stepA.status, to: stepB.status,
                });
            }
        }

        return {
            planId,
            versionA, versionB,
            changes,
            statusChange: a.state.status !== b.state.status
                ? { from: a.state.status, to: b.state.status }
                : null,
        };
    }

    /**
     * Delete all checkpoints for a plan
     */
    clear(planId) {
        const versions = this._listVersions(planId);
        for (const v of versions) {
            try { fs.unlinkSync(v.path); } catch (_) { /* expected: file may already be deleted */ }
        }
    }

    /**
     * Get total checkpoint stats
     */
    getStats() {
        this._ensureDir();
        try {
            const files = fs.readdirSync(this._dir).filter(f => f.endsWith('.json'));
            const plans = new Set(files.map(f => f.split('_v')[0]));
            return { totalCheckpoints: files.length, totalPlans: plans.size };
        } catch (_) { /* expected: dir may not exist yet */
            return { totalCheckpoints: 0, totalPlans: 0 };
        }
    }

    // --- Internal ---

    _ensureDir() {
        try {
            if (!fs.existsSync(this._dir)) fs.mkdirSync(this._dir, { recursive: true });
        } catch (_) { /* expected: concurrent creation race */ }
    }

    _listVersions(planId) {
        this._ensureDir();
        try {
            const files = fs.readdirSync(this._dir)
                .filter(f => f.startsWith(`${planId}_v`) && f.endsWith('.json'))
                .map(f => {
                    const match = f.match(/_v(\d+)\.json$/);
                    return match ? { version: parseInt(match[1]), path: path.join(this._dir, f) } : null;
                })
                .filter(Boolean)
                .sort((a, b) => a.version - b.version);
            return files;
        } catch (_) { /* expected: dir may not exist yet */
            return [];
        }
    }

    _pruneVersions(planId) {
        const versions = this._listVersions(planId);
        if (versions.length <= MAX_VERSIONS) return;

        const toRemove = versions.slice(0, versions.length - MAX_VERSIONS);
        for (const v of toRemove) {
            try { fs.unlinkSync(v.path); } catch (_) { /* expected: file may not exist */ }
        }
    }
}

module.exports = PlanCheckpoint;
