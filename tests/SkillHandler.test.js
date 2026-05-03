const SkillHandler = require('../src/core/action_handlers/SkillHandler');
const SkillManager = require('../src/managers/SkillManager');

jest.mock('../src/managers/SkillManager', () => ({
    getSkill: jest.fn()
}));

jest.mock('../src/mcp/MCPManager', () => ({
    getInstance: jest.fn()
}));

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

    test('execute should leave sys-admin actions to TaskController approval flow', async () => {
        SkillManager.getSkill.mockReturnValue({
            name: 'sys-admin',
            run: jest.fn().mockResolvedValue('should not run directly')
        });

        const result = await SkillHandler.execute(mockCtx, { action: 'sys_admin', parameters: { command: 'echo hello' } }, mockBrain);

        expect(result).toBe(false);
        expect(SkillManager.getSkill).not.toHaveBeenCalled();
        expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    test('execute should validate mcp_call before calling tool', async () => {
        const MCPManager = require('../src/mcp/MCPManager');
        const callTool = jest.fn();
        MCPManager.getInstance.mockReturnValue({
            load: jest.fn().mockResolvedValue(undefined),
            getServers: jest.fn().mockReturnValue([
                {
                    name: 'github',
                    enabled: true,
                    connected: true,
                    cachedTools: [
                        {
                            name: 'create_issue',
                            inputSchema: {
                                type: 'object',
                                required: ['repository_full_name', 'title'],
                                properties: {
                                    repository_full_name: { type: 'string' },
                                    title: { type: 'string' },
                                },
                                additionalProperties: false,
                            },
                        },
                    ],
                },
            ]),
            callTool,
        });

        const result = await SkillHandler.execute(mockCtx, {
            action: 'mcp_call',
            server: 'github',
            tool: 'create_issue',
            parameters: { title: 'Bug' },
        }, mockBrain);

        expect(result).toBe(true);
        expect(callTool).not.toHaveBeenCalled();
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('呼叫格式錯誤'));
    });
});
