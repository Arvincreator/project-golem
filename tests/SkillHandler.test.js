const mockMcpManager = {
    load: jest.fn(),
    callTool: jest.fn(),
    getServers: jest.fn(),
    listTools: jest.fn()
};

jest.mock('../src/managers/SkillManager', () => ({
    getSkill: jest.fn()
}));

jest.mock('../src/mcp/MCPManager', () => ({
    getInstance: jest.fn(() => mockMcpManager)
}));

const SkillHandler = require('../src/core/action_handlers/SkillHandler');
const SkillManager = require('../src/managers/SkillManager');
const MCPManager = require('../src/mcp/MCPManager');

describe('SkillHandler', () => {
    let mockCtx;
    let mockBrain;
    let mockAct;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCtx = {
            reply: jest.fn().mockResolvedValue()
        };
        mockBrain = {
            page: {},
            browser: {},
        };
        mockAct = { action: 'TestSkill', args: { foo: 'bar' } };
    });

    test('execute should return false if skill not found', async () => {
        SkillManager.getSkill.mockReturnValue(null);
        const result = await SkillHandler.execute(mockCtx, mockAct, mockBrain);
        expect(result).toBe(false);
        expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    test('execute should run skill and return true', async () => {
        const mockSkill = {
            name: 'TestSkill',
            run: jest.fn().mockResolvedValue('Skill success')
        };
        SkillManager.getSkill.mockReturnValue(mockSkill);

        const result = await SkillHandler.execute(mockCtx, mockAct, mockBrain);

        expect(result).toBe(true);
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('執行技能: **TestSkill**'));
        expect(mockSkill.run).toHaveBeenCalledWith(expect.objectContaining({
            brain: mockBrain,
            args: mockAct
        }));
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('Skill success'));
    });

    test('execute should truncate long results', async () => {
        const longResult = 'A'.repeat(4000);
        const mockSkill = {
            name: 'TestSkill',
            run: jest.fn().mockResolvedValue(longResult)
        };
        SkillManager.getSkill.mockReturnValue(mockSkill);

        await SkillHandler.execute(mockCtx, mockAct, mockBrain);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('...(已截斷)'));
        const lastReplyArg = mockCtx.reply.mock.calls[1][0];
        expect(lastReplyArg.length).toBeLessThan(4000);
    });

    test('execute should catch and reply errors', async () => {
        const mockSkill = {
            name: 'TestSkill',
            run: jest.fn().mockRejectedValue(new Error('Skill failed randomly'))
        };
        SkillManager.getSkill.mockReturnValue(mockSkill);

        await SkillHandler.execute(mockCtx, mockAct, mockBrain);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('技能執行錯誤: Skill failed randomly'));
    });

    test('execute should auto-route MCP tool action when action equals tool name', async () => {
        SkillManager.getSkill.mockReturnValue(null);
        mockMcpManager.load.mockResolvedValue();
        mockMcpManager.getServers.mockReturnValue([
            { name: 'mempalace', enabled: true, connected: true, cachedTools: [] }
        ]);
        mockMcpManager.listTools.mockResolvedValue([{ name: 'mempalace_status', description: 'status' }]);
        mockMcpManager.callTool.mockResolvedValue({
            content: [{ type: 'text', text: 'ok' }]
        });

        const result = await SkillHandler.execute(mockCtx, { action: 'mempalace_status' }, mockBrain);

        expect(result).toBe(true);
        expect(MCPManager.getInstance).toHaveBeenCalled();
        expect(mockMcpManager.callTool).toHaveBeenCalledWith('mempalace', 'mempalace_status', {});
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('[MCP:mempalace/mempalace_status]'));
    });
});
