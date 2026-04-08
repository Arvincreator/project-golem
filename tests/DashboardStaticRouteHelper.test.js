const path = require('path');
const { resolveDashboardHtmlPath } = require('../web-dashboard/server/staticRouteHelpers');

describe('staticRouteHelpers.resolveDashboardHtmlPath', () => {
    test('returns null when no dashboard html exists', () => {
        const publicPath = '/tmp/non-existing-dashboard-build';
        const exists = () => false;
        const resolved = resolveDashboardHtmlPath(publicPath, '/dashboard', exists);
        expect(resolved).toBeNull();
    });

    test('falls back to dashboard.html when route html is missing', () => {
        const publicPath = '/tmp/dashboard-build';
        const fallback = path.join(publicPath, 'dashboard.html');
        const exists = (target) => target === fallback;
        const resolved = resolveDashboardHtmlPath(publicPath, '/dashboard/agents', exists);
        expect(resolved).toBe(fallback);
    });

    test('uses route-specific html when available', () => {
        const publicPath = '/tmp/dashboard-build';
        const specific = path.join(publicPath, 'dashboard/agents.html');
        const fallback = path.join(publicPath, 'dashboard.html');
        const exists = (target) => target === specific || target === fallback;
        const resolved = resolveDashboardHtmlPath(publicPath, '/dashboard/agents', exists);
        expect(resolved).toBe(specific);
    });
});
