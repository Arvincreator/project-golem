const PlanCheckpoint = require('../src/core/PlanCheckpoint');
const fs = require('fs');
const path = require('path');

describe('PlanCheckpoint', () => {
    let cp;
    const testDir = path.join(process.cwd(), 'golem_plan_checkpoints');

    beforeEach(() => {
        cp = new PlanCheckpoint({ golemId: 'test' });
    });

    afterAll(() => {
        try {
            const files = fs.readdirSync(testDir);
            for (const f of files) fs.unlinkSync(path.join(testDir, f));
            fs.rmdirSync(testDir);
        } catch (_) {}
    });

    test('save creates a checkpoint file', () => {
        const result = cp.save('plan_1', { steps: [{ id: 's1', status: 'pending' }] });
        expect(result).not.toBeNull();
        expect(result.version).toBeGreaterThan(0);
        expect(fs.existsSync(result.path)).toBe(true);
    });

    test('load returns the latest version', () => {
        cp.save('plan_2', { steps: [{ id: 's1', status: 'v1' }] });
        cp.save('plan_2', { steps: [{ id: 's1', status: 'v2' }] });
        const loaded = cp.load('plan_2');
        expect(loaded).not.toBeNull();
        expect(loaded.state.steps[0].status).toBe('v2');
    });

    test('load with specific version', () => {
        const v1 = cp.save('plan_3', { steps: [{ id: 's1', status: 'first' }] });
        cp.save('plan_3', { steps: [{ id: 's1', status: 'second' }] });
        const loaded = cp.load('plan_3', v1.version);
        expect(loaded.state.steps[0].status).toBe('first');
    });

    test('listVersions returns all versions', () => {
        cp.save('plan_4', { v: 1 });
        cp.save('plan_4', { v: 2 });
        const versions = cp.listVersions('plan_4');
        expect(versions.length).toBe(2);
    });

    test('rollback creates new version from old state', () => {
        const v1 = cp.save('plan_5', { status: 'original' });
        cp.save('plan_5', { status: 'modified' });
        const result = cp.rollback('plan_5', v1.version);
        expect(result).not.toBeNull();
        const latest = cp.load('plan_5');
        expect(latest.state.status).toBe('original');
    });

    test('branch forks a plan', () => {
        cp.save('plan_6', { goal: 'test' });
        const result = cp.branch('plan_6', 'plan_6_branch');
        expect(result).not.toBeNull();
        const branched = cp.load('plan_6_branch');
        expect(branched.state.goal).toBe('test');
        expect(branched.metadata.branchedFrom).toBe('plan_6');
    });

    test('diff detects changes between versions', () => {
        const v1 = cp.save('plan_7', { steps: [{ id: 's1', status: 'pending' }], status: 'pending' });
        const v2 = cp.save('plan_7', { steps: [{ id: 's1', status: 'completed' }, { id: 's2', status: 'pending' }], status: 'running' });
        const result = cp.diff('plan_7', v1.version, v2.version);
        expect(result).not.toBeNull();
        expect(result.changes.length).toBeGreaterThan(0);
        expect(result.statusChange).not.toBeNull();
    });

    test('clear removes all checkpoints for a plan', () => {
        cp.save('plan_8', { v: 1 });
        cp.save('plan_8', { v: 2 });
        cp.clear('plan_8');
        expect(cp.listVersions('plan_8').length).toBe(0);
    });

    test('getStats returns correct counts', () => {
        cp.save('plan_9', { v: 1 });
        const stats = cp.getStats();
        expect(stats.totalCheckpoints).toBeGreaterThan(0);
        expect(stats.totalPlans).toBeGreaterThan(0);
    });

    test('load returns null for non-existent plan', () => {
        expect(cp.load('nonexistent')).toBeNull();
    });
});
