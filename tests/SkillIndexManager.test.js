const SkillIndexManager = require('../src/managers/SkillIndexManager');
const sqlite3 = require('sqlite3');
const fs = require('fs');

// Create an in-memory db wrapper for testing
jest.mock('sqlite3', () => {
    return {
        verbose: () => ({
            Database: class {
                constructor(path, cb) {
                    this.commands = [];
                    if (cb) process.nextTick(() => cb(null));
                }
                run(query, paramsOrCallback, cb) {
                    if (typeof paramsOrCallback === 'function') {
                        paramsOrCallback(null);
                    } else if (cb) {
                        cb(null);
                    }
                }
                all(query, params, cb) {
                    const callback = typeof params === 'function' ? params : cb;
                    callback(null, [{ id: 'found-skill', name: 'Test Skill', content: 'test content' }]);
                }
                get(query, params, cb) {
                    const callback = typeof params === 'function' ? params : cb;
                    callback(null, { last_modified: 12345 });
                }
                close(cb) {
                    if (cb) cb();
                }
            }
        })
    };
});

jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn().mockResolvedValue(),
        readdir: jest.fn().mockResolvedValue(['test-skill.md']),
        access: jest.fn().mockResolvedValue(),
        stat: jest.fn().mockResolvedValue({ mtimeMs: 54321 }), // different, forces update
        readFile: jest.fn().mockResolvedValue('【已載入技能：Test Skill】\nThis is a test description.')
    }
}));
jest.mock('../src/skills/skillsConfig', () => ({
    MANDATORY_SKILLS: ['test-skill']
}));
// To prevent require/config access issues
jest.mock('../src/config', () => ({
    MEMORY_BASE_DIR: '/tmp/golem_memory'
}));

describe('SkillIndexManager', () => {
    let sm;

    beforeEach(() => {
        jest.clearAllMocks();
        sm = new SkillIndexManager('/tmp/test_db');
    });

    afterEach(async () => {
        await sm.close();
    });

    test('init should create db and tables', async () => {
        await sm.init();
        expect(sm.db).not.toBeNull();
    });

    test('sync should update mandatory skills', async () => {
        await sm.sync([]);
        expect(require('fs').promises.readdir).toHaveBeenCalled();
        expect(require('fs').promises.readFile).toHaveBeenCalled();
    });

    test('searchSkills should execute SELECT and return rows', async () => {
        const results = await sm.searchSkills('test');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Test Skill');
    });

    test('getEnabledSkills should execute IN query', async () => {
        const results = await sm.getEnabledSkills(['test-skill']);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('found-skill');
    });

    test('listAllSkills should return all rows', async () => {
        const results = await sm.listAllSkills();
        expect(results).toHaveLength(1);
    });
});
