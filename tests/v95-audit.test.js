// ============================================================
// v9.5 TITAN-FIX — Structural Audit Tests
// Verifies all v9.5 features truly exist and export correctly
// ============================================================

// Clean up DebouncedWriter timers after all tests
afterAll(async () => {
    try {
        const DebouncedWriter = require('../src/utils/DebouncedWriter');
        await DebouncedWriter.flushAll();
        for (const instance of DebouncedWriter._instances) {
            instance.destroy();
        }
    } catch (e) { /* not critical */ }
});

describe('v9.5 Structural Audit', () => {

    // --- Phase 0: Security Fixes ---

    describe('Phase 0: CodeSafetyValidator', () => {
        const CodeSafetyValidator = require('../src/utils/CodeSafetyValidator');

        test('exports validate() static method', () => {
            expect(typeof CodeSafetyValidator.validate).toBe('function');
        });

        test('exports syntaxCheck() static method', () => {
            expect(typeof CodeSafetyValidator.syntaxCheck).toBe('function');
        });

        test('validate() rejects dangerous code', () => {
            const result = CodeSafetyValidator.validate('const x = eval("1+1")');
            expect(result.safe).toBe(false);
        });

        test('syntaxCheck() accepts valid code', () => {
            const result = CodeSafetyValidator.syntaxCheck('const x = 1 + 2;');
            expect(result.valid).toBe(true);
        });

        test('syntaxCheck() rejects invalid syntax', () => {
            const result = CodeSafetyValidator.syntaxCheck('const x = {{{');
            expect(result.valid).toBe(false);
        });
    });

    describe('Phase 0: CommandSafeguard', () => {
        const CommandSafeguard = require('../src/utils/CommandSafeguard');

        test('blocks $() command substitution', () => {
            const result = CommandSafeguard.validate('echo $(whoami)');
            expect(result.safe).toBe(false);
            expect(result.level).toBe('BLOCKED');
        });

        test('blocks backtick command substitution', () => {
            const result = CommandSafeguard.validate('echo `whoami`');
            expect(result.safe).toBe(false);
            expect(result.level).toBe('BLOCKED');
        });

        test('curl is not in WHITELIST', () => {
            expect(CommandSafeguard.WHITELIST.has('curl')).toBe(false);
        });

        test('wget is not in WHITELIST', () => {
            expect(CommandSafeguard.WHITELIST.has('wget')).toBe(false);
        });
    });

    describe('Phase 0: CoreMemory sanitization', () => {
        const CoreMemory = require('../src/core/CoreMemory');

        test('has INJECTION_PATTERNS', () => {
            expect(CoreMemory.INJECTION_PATTERNS).toBeDefined();
            expect(Array.isArray(CoreMemory.INJECTION_PATTERNS)).toBe(true);
            expect(CoreMemory.INJECTION_PATTERNS.length).toBeGreaterThan(0);
        });

        test('has _sanitize static method', () => {
            expect(typeof CoreMemory._sanitize).toBe('function');
        });

        test('learned_rules defaults to readonly', () => {
            const cm = new CoreMemory({ golemId: 'audit-test' });
            const sections = cm.getSections ? cm.getSections() : cm._sections;
            if (sections && sections.learned_rules) {
                expect(sections.learned_rules.readonly).toBe(true);
            }
        });

        test('golemId is sanitized', () => {
            const cm = new CoreMemory({ golemId: '../../../etc/passwd' });
            expect(cm.golemId).not.toContain('/');
            expect(cm.golemId).not.toContain('.');
        });
    });

    // --- Phase B: Performance Fixes ---

    describe('Phase B1: DebouncedWriter', () => {
        const DebouncedWriter = require('../src/utils/DebouncedWriter');

        test('has markDirty method', () => {
            const w = new DebouncedWriter('/tmp/test-audit-dw.json', 9999);
            expect(typeof w.markDirty).toBe('function');
            w.destroy();
        });

        test('has forceFlush method', () => {
            const w = new DebouncedWriter('/tmp/test-audit-dw2.json', 9999);
            expect(typeof w.forceFlush).toBe('function');
            w.destroy();
        });

        test('has static flushAll method', () => {
            expect(typeof DebouncedWriter.flushAll).toBe('function');
        });

        test('has destroy method', () => {
            const w = new DebouncedWriter('/tmp/test-audit-dw3.json', 9999);
            expect(typeof w.destroy).toBe('function');
            w.destroy();
        });

        test('static _instances is a Set', () => {
            expect(DebouncedWriter._instances instanceof Set).toBe(true);
        });
    });

    // --- Phase D: Pattern Completion ---

    describe('Phase D1/D2: ExperienceReplay EMA + autoReflect', () => {
        const ExperienceReplay = require('../src/core/ExperienceReplay');

        test('has _ema property with 6 buckets', () => {
            const er = new ExperienceReplay({ golemId: 'audit-test' });
            expect(er._ema).toBeDefined();
            expect(Object.keys(er._ema)).toEqual(
                expect.arrayContaining(['L0', 'L1', 'L2', 'L3', 'plan_step', 'reflection'])
            );
        });

        test('has getEmaValues method', () => {
            const er = new ExperienceReplay({ golemId: 'audit-test' });
            expect(typeof er.getEmaValues).toBe('function');
            const ema = er.getEmaValues();
            expect(ema.L0).toBeDefined();
        });

        test('has autoReflectIfNeeded method', () => {
            const er = new ExperienceReplay({ golemId: 'audit-test' });
            expect(typeof er.autoReflectIfNeeded).toBe('function');
        });

        test('has coreMemory link (A4)', () => {
            const mockCM = { append: jest.fn() };
            const er = new ExperienceReplay({ golemId: 'audit-test', coreMemory: mockCM });
            expect(er.coreMemory).toBe(mockCM);
        });

        test('golemId is sanitized', () => {
            const er = new ExperienceReplay({ golemId: '../hack' });
            expect(er.golemId).not.toContain('/');
            expect(er.golemId).not.toContain('.');
        });
    });

    describe('Phase D3: HeartbeatMonitor', () => {
        const HeartbeatMonitor = require('../src/core/HeartbeatMonitor');

        test('has tick method', () => {
            const hm = new HeartbeatMonitor({});
            expect(typeof hm.tick).toBe('function');
        });

        test('has _runHeartbeat method', () => {
            const hm = new HeartbeatMonitor({});
            expect(typeof hm._runHeartbeat).toBe('function');
        });

        test('has getStats method', () => {
            const hm = new HeartbeatMonitor({});
            expect(typeof hm.getStats).toBe('function');
        });
    });

    describe('Phase D2: WorldModel setEmaValues', () => {
        const WorldModel = require('../src/core/WorldModel');

        test('has setEmaValues method', () => {
            const wm = new WorldModel({});
            expect(typeof wm.setEmaValues).toBe('function');
        });
    });

    // --- Phase C: Integration Fixes ---

    describe('Phase C2: NeuroShunter per-golemId isolation', () => {
        test('uses Map for SelfEvolution isolation', () => {
            const src = require('fs').readFileSync(
                require('path').join(__dirname, '../src/core/NeuroShunter.js'), 'utf-8'
            );
            expect(src).toContain('new Map()');
            expect(src).toContain('_selfEvolutionMap');
        });
    });

    describe('Phase C5: ConversationManager DI + named methods', () => {
        test('has _prepareInput, _assembleContext, _runPlanning, _executeAndDispatch', () => {
            const src = require('fs').readFileSync(
                require('path').join(__dirname, '../src/core/ConversationManager.js'), 'utf-8'
            );
            expect(src).toContain('async _prepareInput(');
            expect(src).toContain('_assembleContext(');
            expect(src).toContain('async _runPlanning(');
            expect(src).toContain('async _executeAndDispatch(');
        });
    });

    // --- golemId sanitization coverage (Problem 3 fix) ---

    describe('golemId sanitization coverage', () => {
        test('MetapromptAgent sanitizes golemId', () => {
            const MetapromptAgent = require('../src/core/MetapromptAgent');
            const ma = new MetapromptAgent({ golemId: '../../etc' });
            expect(ma.golemId).not.toContain('/');
            expect(ma.golemId).not.toContain('.');
        });

        test('ChatLogManager sanitizes golemId', () => {
            const ChatLogManager = require('../src/managers/ChatLogManager');
            const clm = new ChatLogManager({ golemId: '../../etc' });
            expect(clm.golemId).not.toContain('/');
            expect(clm.golemId).not.toContain('.');
        });
    });

    // --- D4: SkillSynthesizer skillIndex registration ---

    describe('Phase D4: SkillSynthesizer skillIndex registration', () => {
        test('_saveSkill calls skillIndex.addSkill if available', () => {
            const SkillSynthesizer = require('../src/core/SkillSynthesizer');
            const mockIndex = { addSkill: jest.fn() };
            const ss = new SkillSynthesizer({ skillIndex: mockIndex });
            const code = 'module.exports = { name: "test", execute: async () => {} };';
            ss._saveSkill('test_skill', code, { pattern: 'test', occurrences: 3 });
            expect(mockIndex.addSkill).toHaveBeenCalledWith('test_skill');
        });
    });
});
