const NeuroShunter = require('../src/core/NeuroShunter');
const ResponseParser = require('../src/utils/ResponseParser');
const MultiAgentHandler = require('../src/core/action_handlers/MultiAgentHandler');
const SkillHandler = require('../src/core/action_handlers/SkillHandler');
const CommandHandler = require('../src/core/action_handlers/CommandHandler');

jest.mock('../src/utils/ResponseParser');
jest.mock('../src/core/action_handlers/MultiAgentHandler');
jest.mock('../src/core/action_handlers/SkillHandler');
jest.mock('../src/core/action_handlers/CommandHandler');

describe('NeuroShunter', () => {
    let mockCtx;
    let mockBrain;
    let mockController;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCtx = {
            reply: jest.fn().mockResolvedValue(),
            shouldMentionSender: false,
            senderMention: '@user',
            platform: 'web'
        };
        mockBrain = {
            memorize: jest.fn().mockResolvedValue(),
            _appendChatLog: jest.fn() // Add this method
        };
        mockController = {};
    });

    test('dispatch processes memory correctly', async () => {
        ResponseParser.parse.mockReturnValue({
            memory: 'User likes apples',
            reply: '',
            actions: []
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);

        expect(mockBrain.memorize).toHaveBeenCalledWith('User likes apples', { type: 'fact', timestamp: expect.any(Number) });
    });

    test('dispatch suppresses reply if options.suppressReply is true', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: 'Hello there',
            actions: []
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, { suppressReply: true });

        expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    test('dispatch overrides suppressReply if [INTERVENE] is present in raw text', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: '[INTERVENE] Hello there',
            actions: []
        });

        await NeuroShunter.dispatch(mockCtx, '[INTERVENE] raw', mockBrain, mockController, { suppressReply: true });

        expect(mockCtx.reply).toHaveBeenCalledWith('Hello there', expect.any(Object));
    });

    test('dispatch formats reply for telegram with mention', async () => {
        mockCtx.platform = 'telegram';
        mockCtx.shouldMentionSender = true;
        
        ResponseParser.parse.mockReturnValue({
            reply: 'Hello',
            actions: []
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);

        expect(mockCtx.reply).toHaveBeenCalledWith('@user Hello', expect.any(Object));
    });

    test('dispatch handles multi_agent action', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'multi_agent', task: 'subtask' }]
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);

        expect(MultiAgentHandler.execute).toHaveBeenCalled();
        expect(SkillHandler.execute).not.toHaveBeenCalled();
        expect(CommandHandler.execute).not.toHaveBeenCalled();
    });

    test('dispatch handles dynamic skill action', async () => {
        SkillHandler.execute.mockResolvedValue(true);
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'custom_skill', arg: 'val' }]
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);

        expect(SkillHandler.execute).toHaveBeenCalled();
        expect(CommandHandler.execute).not.toHaveBeenCalled();
    });

    test('dispatch falls back to CommandHandler if not multi_agent and skill fails', async () => {
        SkillHandler.execute.mockResolvedValue(false);
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'unknown_shell_cmd', arg: 'val' }]
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);

        expect(SkillHandler.execute).toHaveBeenCalled();
        expect(CommandHandler.execute).toHaveBeenCalled();
    });

    test('dispatch skips actions if suppressReply is true and no INTERVENE', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'command' }]
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, { suppressReply: true });

        expect(MultiAgentHandler.execute).not.toHaveBeenCalled();
        expect(SkillHandler.execute).not.toHaveBeenCalled();
        expect(CommandHandler.execute).not.toHaveBeenCalled();
    });
});
