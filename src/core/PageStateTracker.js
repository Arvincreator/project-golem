// ============================================================
// PageStateTracker — Simular Agent S2 / WebArena Pattern
// Tracks browser page state, DOM diffs, navigation history
// Enables better web interaction decisions
// ============================================================

const MAX_HISTORY = 50;
const MAX_DOM_SNAPSHOT_CHARS = 5000;

class PageStateTracker {
    constructor(options = {}) {
        this.golemId = options.golemId || 'default';
        this._states = [];
        this._navigationHistory = [];
        this._domSnapshots = [];
        this._currentState = null;
    }

    /**
     * Capture current page state from Puppeteer page
     * @param {import('puppeteer').Page} page
     * @returns {PageState}
     */
    async capture(page) {
        if (!page) return null;

        try {
            const state = await page.evaluate(() => {
                const getVisibleText = () => {
                    const walker = document.createTreeWalker(
                        document.body, NodeFilter.SHOW_TEXT, null
                    );
                    const texts = [];
                    let node;
                    while ((node = walker.nextNode()) && texts.length < 50) {
                        const text = node.textContent.trim();
                        if (text.length > 5 && text.length < 200) {
                            const parent = node.parentElement;
                            if (parent && parent.offsetHeight > 0) {
                                texts.push(text);
                            }
                        }
                    }
                    return texts.slice(0, 20);
                };

                const getInteractiveElements = () => {
                    const elements = [];
                    const selectors = 'button, [role="button"], a[href], input, textarea, select, [contenteditable="true"]';
                    const els = document.querySelectorAll(selectors);
                    for (let i = 0; i < Math.min(els.length, 30); i++) {
                        const el = els[i];
                        if (el.offsetHeight === 0) continue;
                        const rect = el.getBoundingClientRect();
                        elements.push({
                            tag: el.tagName.toLowerCase(),
                            role: el.getAttribute('role'),
                            text: (el.innerText || el.value || el.placeholder || '').substring(0, 50),
                            id: el.id || null,
                            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
                            visible: rect.width > 0 && rect.height > 0,
                            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                        });
                    }
                    return elements;
                };

                return {
                    url: window.location.href,
                    title: document.title,
                    readyState: document.readyState,
                    visibleText: getVisibleText(),
                    interactiveElements: getInteractiveElements(),
                    hasModals: !!document.querySelector('[role="dialog"], .modal, [aria-modal="true"]'),
                    isLoading: !!document.querySelector('.loading, [aria-busy="true"], .spinner'),
                    scrollPosition: { x: window.scrollX, y: window.scrollY },
                    viewportSize: { w: window.innerWidth, h: window.innerHeight },
                };
            });

            state.capturedAt = Date.now();
            this._currentState = state;
            this._states.push(state);
            if (this._states.length > MAX_HISTORY) this._states.shift();

            // Track navigation
            if (this._navigationHistory.length === 0 ||
                this._navigationHistory[this._navigationHistory.length - 1].url !== state.url) {
                this._navigationHistory.push({
                    url: state.url,
                    title: state.title,
                    timestamp: Date.now(),
                });
                if (this._navigationHistory.length > MAX_HISTORY) this._navigationHistory.shift();
            }

            return state;
        } catch (e) {
            console.warn('[PageStateTracker] Capture failed:', e.message);
            return null;
        }
    }

    /**
     * Capture a lightweight DOM snapshot for diff tracking
     */
    async captureDOM(page) {
        if (!page) return null;
        try {
            const snapshot = await page.evaluate(() => {
                const body = document.body;
                if (!body) return '';
                // Capture structural signature (tag tree without content)
                const walk = (el, depth) => {
                    if (depth > 5) return '';
                    const tag = el.tagName?.toLowerCase() || '';
                    const role = el.getAttribute?.('role') || '';
                    const children = Array.from(el.children || [])
                        .slice(0, 10)
                        .map(c => walk(c, depth + 1))
                        .filter(Boolean);
                    return `${tag}${role ? `[${role}]` : ''}${children.length ? `(${children.join(',')})` : ''}`;
                };
                return walk(body, 0);
            });

            const trimmed = snapshot.substring(0, MAX_DOM_SNAPSHOT_CHARS);
            this._domSnapshots.push({ snapshot: trimmed, timestamp: Date.now() });
            if (this._domSnapshots.length > 20) this._domSnapshots.shift();
            return trimmed;
        } catch (e) {
            return null;
        }
    }

    /**
     * Compute diff between two states
     */
    diff(stateA, stateB) {
        if (!stateA || !stateB) return null;

        const changes = [];

        if (stateA.url !== stateB.url) {
            changes.push({ type: 'navigation', from: stateA.url, to: stateB.url });
        }
        if (stateA.title !== stateB.title) {
            changes.push({ type: 'title_change', from: stateA.title, to: stateB.title });
        }
        if (stateA.hasModals !== stateB.hasModals) {
            changes.push({ type: 'modal_change', appeared: stateB.hasModals });
        }
        if (stateA.isLoading !== stateB.isLoading) {
            changes.push({ type: 'loading_change', isLoading: stateB.isLoading });
        }

        // Element diff
        const elemsA = new Set((stateA.interactiveElements || []).map(e => `${e.tag}:${e.text}`));
        const elemsB = new Set((stateB.interactiveElements || []).map(e => `${e.tag}:${e.text}`));
        const added = [...elemsB].filter(e => !elemsA.has(e));
        const removed = [...elemsA].filter(e => !elemsB.has(e));
        if (added.length > 0) changes.push({ type: 'elements_added', count: added.length, elements: added.slice(0, 5) });
        if (removed.length > 0) changes.push({ type: 'elements_removed', count: removed.length, elements: removed.slice(0, 5) });

        return {
            hasChanges: changes.length > 0,
            changes,
            timeDelta: (stateB.capturedAt || 0) - (stateA.capturedAt || 0),
        };
    }

    /**
     * Get the diff from the last two states
     */
    getLatestDiff() {
        if (this._states.length < 2) return null;
        return this.diff(
            this._states[this._states.length - 2],
            this._states[this._states.length - 1]
        );
    }

    /**
     * Generate a context string for brain injection
     * Summarizes current page state for LLM understanding
     */
    getContextString() {
        if (!this._currentState) return '';
        const s = this._currentState;
        const lines = [
            `[Page State] ${s.url}`,
            `Title: ${s.title}`,
            `Loading: ${s.isLoading ? 'yes' : 'no'} | Modals: ${s.hasModals ? 'yes' : 'no'}`,
        ];
        if (s.interactiveElements.length > 0) {
            lines.push(`Interactive elements: ${s.interactiveElements.length}`);
            const topElements = s.interactiveElements
                .filter(e => e.visible && e.text)
                .slice(0, 5)
                .map(e => `  ${e.tag}${e.role ? `[${e.role}]` : ''}: "${e.text}"`);
            lines.push(...topElements);
        }
        return lines.join('\n');
    }

    /**
     * Check if page is ready for interaction
     */
    isReady() {
        if (!this._currentState) return false;
        return !this._currentState.isLoading &&
            this._currentState.readyState === 'complete';
    }

    /**
     * Find an interactive element by text content
     */
    findElement(text) {
        if (!this._currentState) return null;
        const needle = text.toLowerCase();
        return this._currentState.interactiveElements.find(e =>
            e.text && e.text.toLowerCase().includes(needle) && e.visible && !e.disabled
        ) || null;
    }

    /** Get current state */
    getCurrentState() { return this._currentState; }

    /** Get navigation history */
    getNavigationHistory() { return [...this._navigationHistory]; }

    /** Get stats */
    getStats() {
        return {
            statesCaptured: this._states.length,
            navigations: this._navigationHistory.length,
            domSnapshots: this._domSnapshots.length,
            currentUrl: this._currentState?.url || null,
        };
    }
}

module.exports = PageStateTracker;
