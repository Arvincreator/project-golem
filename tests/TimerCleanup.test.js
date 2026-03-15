const TaskController = require('../src/core/TaskController');
const ConversationManager = require('../src/core/ConversationManager');
const MoltbookLearner = require('../src/managers/MoltbookLearner');

describe('Timer Cleanup', () => {
    test('TaskController.stop() clears cleanup timer', () => {
        const tc = new TaskController({ golemId: 'test' });
        expect(tc._cleanupTimer).toBeDefined();
        tc.stop();
        expect(tc._cleanupTimer).toBeNull();
    });

    test('ConversationManager.stop() clears buffer timer', () => {
        const mockBrain = { recall: async () => [] };
        const cm = new ConversationManager(mockBrain, {}, {}, { golemId: 'test' });
        expect(cm._bufferCleanupTimer).toBeDefined();
        cm.stop();
        expect(cm._bufferCleanupTimer).toBeNull();
    });

    test('MoltbookLearner.stop() clears all timers', () => {
        const ml = new MoltbookLearner({}, {}, { sendNotification: async () => {} }, { golemId: 'test' });
        ml.start();
        expect(ml._initTimer).toBeDefined();
        ml.stop();
        expect(ml._initTimer).toBeNull();
        expect(ml._cycleTimer).toBeFalsy();
    });
});
