const SkillHandler = require('../src/core/action_handlers/SkillHandler');
const SkillManager = require('../src/managers/SkillManager');
const MCPManager = require('../src/mcp/MCPManager');

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
    let mockMcpManager;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCtx = {
            reply: jest.fn().mockResolvedValue()
        };
        mockBrain = {
            page: {},
            browser: {},
            sendMessage: jest.fn(),
        };
        mockAct = { action: 'TestSkill', args: { foo: 'bar' } };
        mockMcpManager = {
            load: jest.fn().mockResolvedValue(),
            callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'MCP result' }] })
        };
        MCPManager.getInstance.mockReturnValue(mockMcpManager);
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

    test('opencli_search should relay skill observation back to brain and reply with GOLEM_REPLY', async () => {
        const mockSkill = {
            name: 'opencli_search',
            run: jest.fn().mockResolvedValue('🔎 [OpenCLI 搜尋]\nQuery: 台中新聞')
        };
        SkillManager.getSkill.mockReturnValue(mockSkill);
        mockBrain.sendMessage.mockResolvedValue('[GOLEM_REPLY]這是 Gemini 二次整理後的回覆');

        const result = await SkillHandler.execute(mockCtx, { action: 'opencli_search', query: '台中新聞' }, mockBrain);

        expect(result).toBe(true);
        expect(mockBrain.sendMessage).toHaveBeenCalledWith(expect.stringContaining('來源技能: opencli_search'));
        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('執行技能: **opencli_search**'));
        expect(mockCtx.reply).toHaveBeenCalledWith('這是 Gemini 二次整理後的回覆');
        expect(mockCtx.reply).not.toHaveBeenCalledWith(expect.stringContaining('✅ 技能回報:'));
    });

    test('opencli_search should fallback to direct skill report when relay fails', async () => {
        const mockSkill = {
            name: 'opencli_search',
            run: jest.fn().mockResolvedValue('🔎 [OpenCLI 搜尋]\nQuery: 台中新聞')
        };
        SkillManager.getSkill.mockReturnValue(mockSkill);
        mockBrain.sendMessage.mockRejectedValue(new Error('relay failed'));

        await SkillHandler.execute(mockCtx, { action: 'opencli_search', query: '台中新聞' }, mockBrain);

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('✅ 技能回報:'));
    });

    test('mcp_call should relay observation back to brain and reply with GOLEM_REPLY', async () => {
        mockMcpManager.callTool.mockResolvedValue({
            content: [{ type: 'text', text: '台中新聞觀測資料' }]
        });
        mockBrain.sendMessage.mockResolvedValue('[GOLEM_REPLY]這是 Web Gemini 整理後的 MCP 回覆');

        const result = await SkillHandler.execute(
            mockCtx,
            { action: 'mcp_call', server: 'mempalace', tool: 'mempalace_search', parameters: { query: '台中新聞', limit: 3 } },
            mockBrain
        );

        expect(result).toBe(true);
        expect(mockMcpManager.load).toHaveBeenCalledTimes(1);
        expect(mockMcpManager.callTool).toHaveBeenCalledWith('mempalace', 'mempalace_search', { query: '台中新聞', limit: 3 });
        expect(mockBrain.sendMessage).toHaveBeenCalledWith(expect.stringContaining('來源技能: mcp_call:mempalace/mempalace_search'));
        expect(mockCtx.reply).toHaveBeenCalledWith('這是 Web Gemini 整理後的 MCP 回覆');
        expect(mockCtx.reply).not.toHaveBeenCalledWith(expect.stringContaining('✅ [MCP:mempalace/mempalace_search]'));
    });

    test('mcp_call should fallback to direct MCP report when relay fails', async () => {
        mockMcpManager.callTool.mockResolvedValue({
            content: [{ type: 'text', text: '台中新聞觀測資料' }]
        });
        mockBrain.sendMessage.mockRejectedValue(new Error('relay failed'));

        await SkillHandler.execute(
            mockCtx,
            { action: 'mcp_call', server: 'mempalace', tool: 'mempalace_search', parameters: { query: '台中新聞', limit: 3 } },
            mockBrain
        );

        expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('✅ [MCP:mempalace/mempalace_search]'));
    });
});
