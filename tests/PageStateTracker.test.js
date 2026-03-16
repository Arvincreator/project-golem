const PageStateTracker = require('../src/core/PageStateTracker');

describe('PageStateTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = new PageStateTracker({ golemId: 'test' });
    });

    test('getCurrentState returns null before capture', () => {
        expect(tracker.getCurrentState()).toBeNull();
    });

    test('diff detects URL change', () => {
        const stateA = { url: 'https://a.com', title: 'A', interactiveElements: [], hasModals: false, isLoading: false, capturedAt: 1000 };
        const stateB = { url: 'https://b.com', title: 'B', interactiveElements: [], hasModals: false, isLoading: false, capturedAt: 2000 };
        const result = tracker.diff(stateA, stateB);
        expect(result.hasChanges).toBe(true);
        expect(result.changes.some(c => c.type === 'navigation')).toBe(true);
    });

    test('diff detects modal appearance', () => {
        const stateA = { url: 'https://a.com', title: 'A', interactiveElements: [], hasModals: false, isLoading: false, capturedAt: 1000 };
        const stateB = { url: 'https://a.com', title: 'A', interactiveElements: [], hasModals: true, isLoading: false, capturedAt: 2000 };
        const result = tracker.diff(stateA, stateB);
        expect(result.changes.some(c => c.type === 'modal_change')).toBe(true);
    });

    test('diff detects element changes', () => {
        const stateA = { url: 'https://a.com', title: 'A', interactiveElements: [{ tag: 'button', text: 'Save' }], hasModals: false, isLoading: false };
        const stateB = { url: 'https://a.com', title: 'A', interactiveElements: [{ tag: 'button', text: 'Save' }, { tag: 'button', text: 'Cancel' }], hasModals: false, isLoading: false };
        const result = tracker.diff(stateA, stateB);
        expect(result.changes.some(c => c.type === 'elements_added')).toBe(true);
    });

    test('diff returns no changes for identical states', () => {
        const state = { url: 'https://a.com', title: 'A', interactiveElements: [], hasModals: false, isLoading: false };
        const result = tracker.diff(state, state);
        expect(result.hasChanges).toBe(false);
    });

    test('getContextString returns empty before capture', () => {
        expect(tracker.getContextString()).toBe('');
    });

    test('getContextString formats current state', () => {
        tracker._currentState = {
            url: 'https://test.com',
            title: 'Test Page',
            isLoading: false,
            hasModals: false,
            interactiveElements: [
                { tag: 'button', role: 'button', text: 'Click me', visible: true },
            ],
        };
        const ctx = tracker.getContextString();
        expect(ctx).toContain('test.com');
        expect(ctx).toContain('Click me');
    });

    test('isReady checks loading state', () => {
        tracker._currentState = null;
        expect(tracker.isReady()).toBe(false);

        tracker._currentState = { isLoading: true, readyState: 'loading' };
        expect(tracker.isReady()).toBe(false);

        tracker._currentState = { isLoading: false, readyState: 'complete' };
        expect(tracker.isReady()).toBe(true);
    });

    test('findElement searches by text', () => {
        tracker._currentState = {
            interactiveElements: [
                { tag: 'button', text: 'Save Changes', visible: true, disabled: false },
                { tag: 'button', text: 'Cancel', visible: true, disabled: false },
                { tag: 'button', text: 'Delete', visible: true, disabled: true },
            ],
        };
        expect(tracker.findElement('save')).not.toBeNull();
        expect(tracker.findElement('save').text).toBe('Save Changes');
        expect(tracker.findElement('delete')).toBeNull(); // disabled
        expect(tracker.findElement('nonexistent')).toBeNull();
    });

    test('getStats returns correct counts', () => {
        const stats = tracker.getStats();
        expect(stats.statesCaptured).toBe(0);
        expect(stats.navigations).toBe(0);
    });

    test('getNavigationHistory returns copy', () => {
        tracker._navigationHistory.push({ url: 'a', timestamp: 1 });
        const history = tracker.getNavigationHistory();
        expect(history.length).toBe(1);
        history.push({ url: 'b' }); // should not affect internal
        expect(tracker._navigationHistory.length).toBe(1);
    });
});
