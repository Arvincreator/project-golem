require('./setup');

// Mock all heavy dependencies that ConversationManager imports
jest.mock('../src/core/ContextEngineer', () => {
  return class ContextEngineer {
    setBudgetForModel() {}
    addSection() {}
    assemble() { return { context: 'assembled-context', stats: { totalTokens: 100, sectionsIncluded: 2, compressed: 0, pagedOut: 0 } }; }
  };
});
jest.mock('../src/core/TreePlanner', () => {
  return class TreePlanner {
    constructor() {}
    _isComplexQuery() { return false; }
    planTree() { return Promise.resolve({ isSimple: true, root: {} }); }
  };
});
jest.mock('../src/core/GroundingVerifier', () => {
  return class GroundingVerifier {
    constructor() { this.mode = 'off'; }
    verify() { return Promise.resolve({ confidence: null, sources: [], flags: [] }); }
    formatBadge() { return ''; }
  };
});
jest.mock('../src/core/Planner', () => {
  return class Planner {
    constructor() {}
    createPlan() { return Promise.resolve({ steps: [] }); }
  };
});
jest.mock('../src/core/MetricsCollector', () => {
  return class MetricsCollector {
    constructor() {}
    record() {}
    gauge() {}
  };
});
jest.mock('../src/core/WorldModel', () => {
  return class WorldModel {
    constructor() {}
    setEmaValues() {}
  };
});
jest.mock('../src/core/ExperienceReplay', () => {
  return class ExperienceReplay {
    constructor() { this._traces = []; this._reflections = []; }
    recordTrace() {}
    getReflectionContext() { return ''; }
    getSuccessRate() { return { rate: 0.8, successes: 8, total: 10 }; }
    reflect() { return Promise.resolve(null); }
    sample() { return []; }
    getEmaValues() { return {}; }
  };
});
jest.mock('../src/core/OutputGrader', () => {
  return class OutputGrader {
    constructor() {}
    quickGrade() { return { overall: 3.0 }; }
    calibrate() {}
  };
});
jest.mock('../src/core/MetapromptAgent', () => {
  return class MetapromptAgent {
    constructor() {}
    recordPerformance() {}
    autoSelect() {}
    getActivePrompt() { return null; }
    getStats() { return { activeAvgGrade: 3.0 }; }
  };
});
jest.mock('../src/core/PlanCheckpoint', () => {
  return class PlanCheckpoint { constructor() {} };
});
jest.mock('../src/core/AdaptivePlanExecutor', () => {
  return class AdaptivePlanExecutor {
    constructor() {}
    run() { return Promise.resolve({ plan: { status: 'completed' }, results: [] }); }
  };
});
jest.mock('../src/core/CoreMemory', () => {
  return class CoreMemory {
    constructor() { this.blocks = {}; }
    getContextString() { return ''; }
    getStats() { return {}; }
    append() { return true; }
    replace() { return true; }
    read() { return ''; }
  };
});
jest.mock('../src/core/PageStateTracker', () => {
  return class PageStateTracker {
    constructor() {}
    getContextString() { return ''; }
  };
});
jest.mock('../src/core/HeartbeatMonitor', () => {
  return class HeartbeatMonitor {
    constructor() {}
    tick() {}
  };
});

const ConversationManager = require('../src/core/ConversationManager');

describe('ConversationManager', () => {
  let cm;
  let mockBrain;
  let mockNeuroShunter;
  let mockController;
  let mockCtx;

  beforeEach(() => {
    jest.useFakeTimers();

    mockBrain = {
      sendMessage: jest.fn().mockResolvedValue('Brain response here'),
      recall: jest.fn().mockResolvedValue([]),
      _appendChatLog: jest.fn(),
      getModelContextWindow: null,
      skillIndex: null,
    };

    mockNeuroShunter = {
      dispatch: jest.fn().mockResolvedValue(undefined),
    };

    mockController = {
      pendingTasks: new Map(),
    };

    mockCtx = {
      chatId: 'chat-001',
      userId: 'user-001',
      senderName: 'TestUser',
      reply: jest.fn().mockResolvedValue({ message_id: 1 }),
      sendTyping: jest.fn().mockResolvedValue(undefined),
      platform: 'test',
      isMentioned: jest.fn().mockReturnValue(false),
    };

    cm = new ConversationManager(mockBrain, mockNeuroShunter, mockController, {
      golemId: 'test',
      threeLayerMemory: {
        addToWorking: jest.fn(),
        getWorkingContext: jest.fn().mockReturnValue([]),
        getStats: jest.fn().mockReturnValue({ working: 5, workingMax: 50, episodic: 10, episodicMax: 500, semantic: 3 }),
        recordEpisode: jest.fn(),
      },
    });

    // Prevent buffer cleanup interval from leaking
    if (cm._bufferCleanupTimer) {
      clearInterval(cm._bufferCleanupTimer);
      cm._bufferCleanupTimer = null;
    }
  });

  afterEach(() => {
    cm.stop();
    jest.useRealTimers();
  });

  test('1. Silent mode skips brain processing', async () => {
    cm.silentMode = true;
    cm.queue.push({ ctx: mockCtx, text: 'hello' });
    cm.isProcessing = false;

    await cm._processQueue();

    expect(mockBrain.sendMessage).not.toHaveBeenCalled();
  });

  test('2. Observer mode suppresses reply', async () => {
    cm.observerMode = true;
    mockCtx.isMentioned = jest.fn().mockReturnValue(false);

    cm.queue.push({ ctx: mockCtx, text: 'hello observer' });
    cm.isProcessing = false;

    await cm._processQueue();

    // Brain should still be called, but NeuroShunter should get suppressReply=true
    expect(mockBrain.sendMessage).toHaveBeenCalled();
    expect(mockNeuroShunter.dispatch).toHaveBeenCalledWith(
      mockCtx,
      expect.anything(),
      mockBrain,
      mockController,
      expect.objectContaining({ suppressReply: true })
    );
  });

  test('3. Rate limit rejection (>10 messages in 30s)', async () => {
    // Send 11 messages rapidly
    for (let i = 0; i < 11; i++) {
      await cm.enqueue(mockCtx, `message ${i}`, { bypassDebounce: true, isPriority: true });
    }

    // The 11th message should have been rate-limited (silently dropped)
    // Queue should have at most 10 items
    // Check that the rate limit map shows count > 10
    const rateKey = `rate_${mockCtx.chatId}`;
    const rateData = cm._rateLimits.get(rateKey);
    expect(rateData.count).toBeGreaterThan(10);
  });

  test('4. Successful end-to-end (mocked brain returns response)', async () => {
    mockBrain.sendMessage.mockResolvedValue('Hello from Golem');
    cm.queue.push({ ctx: mockCtx, text: 'hi there' });
    cm.isProcessing = false;

    await cm._processQueue();

    expect(mockBrain.sendMessage).toHaveBeenCalled();
    expect(mockNeuroShunter.dispatch).toHaveBeenCalledWith(
      mockCtx,
      'Hello from Golem',
      mockBrain,
      mockController,
      expect.objectContaining({
        threeLayerMemory: expect.anything(),
        coreMemory: expect.anything(),
        golemId: 'test',
      })
    );
  });

  test('5. Error handling records experience trace', async () => {
    mockBrain.sendMessage.mockRejectedValue(new Error('API timeout'));
    const recordSpy = jest.spyOn(cm.experienceReplay, 'recordTrace');

    cm.queue.push({ ctx: mockCtx, text: 'trigger error' });
    cm.isProcessing = false;

    await cm._processQueue();

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        result: expect.stringContaining('API timeout'),
      })
    );
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('無法回應'));
  });

  test('6. Queue FIFO processing order', async () => {
    cm.queue.push({ ctx: mockCtx, text: 'first' });
    cm.queue.push({ ctx: mockCtx, text: 'second' });
    cm.isProcessing = false;

    // Process first item
    await cm._processQueue();

    // brain._appendChatLog is called with the user input — first item should be logged first
    const logCalls = mockBrain._appendChatLog.mock.calls;
    expect(logCalls.length).toBeGreaterThanOrEqual(1);
    expect(logCalls[0][0].content).toContain('first');
    // Second item should still be in queue
    expect(cm.queue.length).toBe(1);
    expect(cm.queue[0].text).toBe('second');
  });

  test('7. A1: NeuroShunter.dispatch receives threeLayerMemory and coreMemory', async () => {
    mockBrain.sendMessage.mockResolvedValue('response');
    cm.queue.push({ ctx: mockCtx, text: 'test A1' });
    cm.isProcessing = false;

    await cm._processQueue();

    expect(mockNeuroShunter.dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        threeLayerMemory: expect.anything(),
        coreMemory: expect.anything(),
      })
    );
  });

  test('8. B2: Complex queries get background plan placeholder', async () => {
    // Make treePlanner think it's complex
    cm.treePlanner._isComplexQuery = jest.fn().mockReturnValue(true);
    cm.treePlanner.planTree = jest.fn().mockResolvedValue({
      isSimple: false,
      root: { children: [1, 2, 3] },
    });

    cm.queue.push({ ctx: mockCtx, text: 'complex multi-step query' });
    cm.isProcessing = false;

    await cm._processQueue();

    // Should have sent a placeholder reply for background processing
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('正在處理'));
  });
});
