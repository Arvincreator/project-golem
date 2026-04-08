const { shouldStartDashboard } = require('../apps/runtime/runtimeMode');

describe('runtimeMode.shouldStartDashboard', () => {
    test('returns true when argv includes dashboard command', () => {
        const result = shouldStartDashboard({
            argv: ['node', 'apps/runtime/index.js', 'dashboard'],
            env: {}
        });

        expect(result).toBe(true);
    });

    test('returns true by default for backward-compatible plain start command', () => {
        const result = shouldStartDashboard({
            argv: ['node', 'apps/runtime/index.js'],
            env: {}
        });

        expect(result).toBe(true);
    });

    test('allows explicit enable through GOLEM_DASHBOARD_ENABLED=true', () => {
        const result = shouldStartDashboard({
            argv: ['node', 'apps/runtime/index.js'],
            env: { GOLEM_DASHBOARD_ENABLED: 'true' }
        });

        expect(result).toBe(true);
    });

    test('allows explicit disable through GOLEM_DASHBOARD_ENABLED=false', () => {
        const result = shouldStartDashboard({
            argv: ['node', 'apps/runtime/index.js', 'dashboard'],
            env: { GOLEM_DASHBOARD_ENABLED: 'false' }
        });

        expect(result).toBe(false);
    });

    test('respects ENABLE_WEB_DASHBOARD=false when GOLEM_DASHBOARD_ENABLED is unset', () => {
        const result = shouldStartDashboard({
            argv: ['node', 'apps/runtime/index.js'],
            env: { ENABLE_WEB_DASHBOARD: 'false' }
        });

        expect(result).toBe(false);
    });

    test('supports --no-dashboard flag when env override is absent', () => {
        const result = shouldStartDashboard({
            argv: ['node', 'apps/runtime/index.js', '--no-dashboard'],
            env: {}
        });

        expect(result).toBe(false);
    });
});
