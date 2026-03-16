require('./setup');

// Mock heavy dependencies
jest.mock('fs', () => ({
  readFileSync: jest.fn((p) => {
    if (p.includes('golem_memory')) return 'mock content';
    throw new Error('File not found');
  }),
  existsSync: jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn((p) => {
      if (p.includes('golem_memory')) return Promise.resolve('mock content');
      return Promise.reject(new Error('File not found'));
    }),
  },
}));

jest.mock('../src/utils/ResponseParser', () => ({
  parse: jest.fn().mockReturnValue({ reply: null, actions: [], memory: null }),
}));

jest.mock('../src/core/action_handlers/MultiAgentHandler', () => ({
  execute: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/core/action_handlers/SkillHandler', () => ({
  execute: jest.fn().mockResolvedValue(false),
}));
jest.mock('../src/core/action_handlers/CommandHandler', () => ({
  execute: jest.fn().mockResolvedValue(undefined),
}));
const mockSelfEvolutionInstances = [];
jest.mock('../src/core/SelfEvolution', () => {
  return jest.fn().mockImplementation(() => {
    const instance = { afterAction: jest.fn().mockReturnValue(null) };
    mockSelfEvolutionInstances.push(instance);
    return instance;
  });
});

const NeuroShunter = require('../src/core/NeuroShunter');
const ResponseParser = require('../src/utils/ResponseParser');
const path = require('path');

describe('NeuroShunter', () => {
  let mockCtx, mockBrain, mockController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      chatId: 'test-chat',
      reply: jest.fn().mockResolvedValue({}),
      sendTyping: jest.fn().mockResolvedValue(undefined),
      platform: 'test',
    };
    mockBrain = {
      sendMessage: jest.fn().mockResolvedValue('ok'),
      memorize: jest.fn().mockResolvedValue(undefined),
      _appendChatLog: jest.fn(),
    };
    mockController = { pendingTasks: new Map() };
  });

  test('memory actions route to threeLayerMemory', async () => {
    const mockTLM = {
      promoteToEpisodic: jest.fn(),
      markExpired: jest.fn(),
      addToWorking: jest.fn(),
      archiveWorking: jest.fn(),
    };

    ResponseParser.parse.mockReturnValue({
      reply: null,
      memory: null,
      actions: [
        { action: 'memory_promote', key: 'item-1' },
        { action: 'memory_forget', key: 'item-2' },
      ],
    });

    await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, {
      threeLayerMemory: mockTLM,
    });

    expect(mockTLM.promoteToEpisodic).toHaveBeenCalledWith('item-1');
    expect(mockTLM.markExpired).toHaveBeenCalledWith('item-2');
  });

  test('core actions route to coreMemory', async () => {
    const mockCM = {
      replace: jest.fn(),
      append: jest.fn(),
    };

    ResponseParser.parse.mockReturnValue({
      reply: null,
      memory: null,
      actions: [
        { action: 'core_replace', label: 'user_profile', oldText: 'old', newText: 'new' },
        { action: 'core_append', label: 'task_context', text: 'new task' },
      ],
    });

    await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, {
      coreMemory: mockCM,
    });

    expect(mockCM.replace).toHaveBeenCalledWith('user_profile', 'old', 'new');
    expect(mockCM.append).toHaveBeenCalledWith('task_context', 'new task');
  });

  test('SelfEvolution isolation per golemId', async () => {
    ResponseParser.parse.mockReturnValue({
      reply: null,
      memory: null,
      actions: [{ action: 'test_action' }],
    });

    // Dispatch with two different golemIds — each creates its own SelfEvolution instance
    await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, { golemId: 'golem-A' });
    await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, { golemId: 'golem-B' });

    // Verify SelfEvolution was instantiated separately per golemId
    expect(mockSelfEvolutionInstances.length).toBeGreaterThanOrEqual(2);
  });

  test('[INTERVENE] detection unsuppresses reply', async () => {
    ResponseParser.parse.mockReturnValue({
      reply: 'Important message [INTERVENE]',
      memory: null,
      actions: [],
    });

    await NeuroShunter.dispatch(mockCtx, 'test [INTERVENE]', mockBrain, mockController, {
      suppressReply: true,
    });

    // [INTERVENE] should override suppressReply
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('Important message'));
  });

  test('read_context_file blocked outside golem_memory/', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    ResponseParser.parse.mockReturnValue({
      reply: null,
      memory: null,
      actions: [{ action: 'read_context_file', path: '/etc/shadow' }],
    });

    await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, {});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('read_context_file BLOCKED')
    );
    consoleSpy.mockRestore();
  });

  test('read_context_file allowed inside golem_memory/', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const allowedPath = path.join(process.cwd(), 'golem_memory', 'data.json');

    ResponseParser.parse.mockReturnValue({
      reply: null,
      memory: null,
      actions: [{ action: 'read_context_file', path: allowedPath }],
    });

    await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, {});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Read context file')
    );
    consoleSpy.mockRestore();
  });
});
