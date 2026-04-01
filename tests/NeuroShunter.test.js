const { NeuroShunter } = require('../packages/protocol');
const ResponseParser = require('../src/utils/ResponseParser');
const AgentActionHandler = require('../src/core/action_handlers/AgentActionHandler');
const SkillHandler = require('../src/core/action_handlers/SkillHandler');
const CommandHandler = require('../src/core/action_handlers/CommandHandler');
const TaskActionHandler = require('../src/core/action_handlers/TaskActionHandler');

jest.mock('../src/utils/ResponseParser');
jest.mock('../src/core/action_handlers/AgentActionHandler');
jest.mock('../src/core/action_handlers/SkillHandler');
jest.mock('../src/core/action_handlers/CommandHandler');
jest.mock('../src/core/action_handlers/TaskActionHandler');

describe('NeuroShunter', () => {
    let mockCtx;
    let mockBrain;
    let mockController;

    beforeEach(() => {
        jest.clearAllMocks();
        TaskActionHandler.isTaskAction.mockReturnValue(false);
        AgentActionHandler.isAgentAction.mockReturnValue(false);
        SkillHandler.execute.mockResolvedValue(false);

        mockCtx = {
            reply: jest.fn().mockResolvedValue(undefined),
            shouldMentionSender: false,
            senderMention: '@user',
            platform: 'web',
        };

        mockBrain = {
            memorize: jest.fn().mockResolvedValue(undefined),
            _appendChatLog: jest.fn(),
        };

        mockController = {
            _handleMultiAgent: jest.fn().mockRejectedValue({
                code: 'AGENT_PROTOCOL_UNSUPPORTED',
                statusCode: 422,
                message: 'legacy blocked',
            }),
        };
    });

    test('dispatch processes memory correctly', async () => {
        ResponseParser.parse.mockReturnValue({
            memory: 'User likes apples',
            reply: '',
            actions: [],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);
        expect(mockBrain.memorize).toHaveBeenCalledWith('User likes apples', { type: 'fact', timestamp: expect.any(Number) });
    });

    test('dispatch auto-unsuppresses reply if suppressReply is true but no actions remain', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: 'Hello there',
            actions: [],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, { suppressReply: true });
        expect(mockCtx.reply).toHaveBeenCalledWith('Hello there');
    });

    test('dispatch overrides suppressReply if [INTERVENE] is present in raw text', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: '[INTERVENE] Hello there',
            actions: [],
        });

        await NeuroShunter.dispatch(mockCtx, '[INTERVENE] raw', mockBrain, mockController, { suppressReply: true });
        expect(mockCtx.reply).toHaveBeenCalledWith('Hello there');
    });

    test('dispatch formats reply for telegram with mention', async () => {
        mockCtx.platform = 'telegram';
        mockCtx.shouldMentionSender = true;
        ResponseParser.parse.mockReturnValue({
            reply: 'Hello',
            actions: [],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);
        expect(mockCtx.reply).toHaveBeenCalledWith('@user Hello');
    });

    test('dispatch handles agent action via AgentActionHandler', async () => {
        AgentActionHandler.isAgentAction.mockReturnValue(true);
        AgentActionHandler.execute.mockResolvedValue(true);
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'agent_session_create', input: { objective: 'x' } }],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);
        expect(AgentActionHandler.execute).toHaveBeenCalled();
        expect(CommandHandler.execute).not.toHaveBeenCalled();
    });

    test('dispatch rejects legacy multi_agent action through controller hard-cut', async () => {
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'multi_agent', task: 'legacy mode' }],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);
        expect(mockController._handleMultiAgent).toHaveBeenCalled();
    });

    test('dispatch handles dynamic skill action', async () => {
        SkillHandler.execute.mockResolvedValue(true);
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'custom_skill', arg: 'val' }],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);
        expect(SkillHandler.execute).toHaveBeenCalled();
        expect(CommandHandler.execute).not.toHaveBeenCalled();
    });

    test('dispatch falls back to CommandHandler if skill does not handle action', async () => {
        SkillHandler.execute.mockResolvedValue(false);
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'unknown_shell_cmd', arg: 'val' }],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController);
        expect(SkillHandler.execute).toHaveBeenCalled();
        expect(CommandHandler.execute).toHaveBeenCalled();
    });

    test('dispatch still executes actions when suppressReply is true and actions exist', async () => {
        SkillHandler.execute.mockResolvedValue(false);
        ResponseParser.parse.mockReturnValue({
            reply: '',
            actions: [{ action: 'command' }],
        });

        await NeuroShunter.dispatch(mockCtx, 'raw', mockBrain, mockController, { suppressReply: true });
        expect(CommandHandler.execute).toHaveBeenCalled();
    });
});
