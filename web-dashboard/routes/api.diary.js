const express = require('express');
const fs = require('fs');
const path = require('path');
const { resolveActiveContext } = require('./utils/context');
const { buildOperationGuard } = require('../server/security');

const DIARY_TYPES = new Set(['ai_diary', 'ai_thought', 'ai_summary', 'user_diary']);
const AI_GENERATABLE_TYPES = new Set(['ai_diary', 'ai_thought']);
const ENTRY_CONTENT_MAX = 6000;
const ENTRY_MOOD_MAX = 40;
const ENTRY_TAG_MAX = 8;
const ENTRY_TAG_ITEM_MAX = 24;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHLY_RETENTION_DEFAULT_DAYS = 5 * 365;

const DIARY_RAW_RETENTION_DAYS = Math.max(
    7,
    Number.parseInt(process.env.DIARY_RAW_RETENTION_DAYS || '7', 10) || 7
);
const DIARY_WEEKLY_RETENTION_DAYS = Math.max(
    30,
    Number.parseInt(process.env.DIARY_WEEKLY_RETENTION_DAYS || '365', 10) || 365
);
const DIARY_MONTHLY_RETENTION_DAYS = Math.max(
    180,
    Number.parseInt(process.env.DIARY_MONTHLY_RETENTION_DAYS || String(MONTHLY_RETENTION_DEFAULT_DAYS), 10) || MONTHLY_RETENTION_DEFAULT_DAYS
);
const DIARY_ROTATE_MIN_INTERVAL_MS = Math.max(
    30 * 1000,
    Number.parseInt(process.env.DIARY_ROTATE_MIN_INTERVAL_MS || String(5 * 60 * 1000), 10) || (5 * 60 * 1000)
);
const DIARY_BACKUP_MAX_FILES = Math.max(
    10,
    Number.parseInt(process.env.DIARY_BACKUP_MAX_FILES || '120', 10) || 120
);
const DIARY_BACKUP_RETENTION_DAYS = Math.max(
    7,
    Number.parseInt(process.env.DIARY_BACKUP_RETENTION_DAYS || '180', 10) || 180
);

const AUTO_SUMMARY_TAG = 'auto_rotate_summary';
const AUTO_WEEKLY_TAG = 'rotate_weekly';
const AUTO_MONTHLY_TAG = 'rotate_monthly';
const AUTO_YEARLY_TAG = 'rotate_yearly';
const PERIOD_PREFIX = 'period_';

const BOND_LEVELS = [
    { label: '萌芽', min: 0 },
    { label: '穩定培養', min: 20 },
    { label: '共鳴升溫', min: 45 },
    { label: '深度連結', min: 70 },
    { label: '羈絆滿載', min: 90 },
];

const rotateCheckpointByPath = new Map();
const diaryDbStateByPath = new Map();
let sqlite3Instance = null;

function getSqlite3() {
    if (sqlite3Instance) return sqlite3Instance;
    try {
        sqlite3Instance = require('sqlite3').verbose();
        return sqlite3Instance;
    } catch (error) {
        throw new Error(`sqlite3 unavailable for diary storage: ${error.message}`);
    }
}

function makeEntryId() {
    return `diary_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (DIARY_TYPES.has(raw)) return raw;
    return 'user_diary';
}

function normalizeAuthor(type, author) {
    const given = String(author || '').trim();
    if (given) return given;
    return type === 'user_diary' ? 'User' : 'AI';
}

function normalizeContent(value) {
    return String(value || '').replace(/\u0000/g, '').trim().slice(0, ENTRY_CONTENT_MAX);
}

function normalizeReplyToId(value) {
    const id = String(value || '').trim();
    return id ? id.slice(0, 80) : '';
}

function normalizeMood(value) {
    return String(value || '').trim().slice(0, ENTRY_MOOD_MAX);
}

function normalizeTags(value) {
    const rawList = Array.isArray(value)
        ? value
        : String(value || '').split(',');

    const tags = [];
    const seen = new Set();
    for (const raw of rawList) {
        const normalized = String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_\-\u4e00-\u9fff]/gi, '')
            .slice(0, ENTRY_TAG_ITEM_MAX);
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        tags.push(normalized);
        if (tags.length >= ENTRY_TAG_MAX) break;
    }
    return tags;
}

function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw;
    const entryType = normalizeType(record.entryType);
    const content = normalizeContent(record.content);
    if (!content) return null;

    const createdAt = String(record.createdAt || '').trim();
    const createdAtIso = createdAt && !Number.isNaN(Date.parse(createdAt))
        ? new Date(createdAt).toISOString()
        : new Date().toISOString();

    const replyToId = normalizeReplyToId(record.replyToId);
    const iterationRaw = Number(record.iteration || 1);
    const iteration = Number.isFinite(iterationRaw) && iterationRaw > 0
        ? Math.floor(iterationRaw)
        : 1;

    const mood = normalizeMood(record.mood);

    return {
        id: String(record.id || makeEntryId()),
        golemId: String(record.golemId || 'default'),
        entryType,
        author: normalizeAuthor(entryType, record.author),
        content,
        shared: record.shared !== false,
        replyToId: replyToId || null,
        iteration,
        mood: mood || null,
        tags: normalizeTags(record.tags),
        createdAt: createdAtIso,
    };
}

function resolveDiaryStorage(server, golemIdQuery) {
    const { golemId, context } = resolveActiveContext(server, golemIdQuery);
    const { MEMORY_BASE_DIR } = require('../../src/config');
    const userDataDir = context && context.brain && context.brain.userDataDir
        ? context.brain.userDataDir
        : MEMORY_BASE_DIR;
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }
    const normalizedGolemId = String(golemId || 'default');
    const safeGolemId = normalizedGolemId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const diaryPath = path.join(userDataDir, 'diary-book.json');
    const diaryDbDir = path.join(userDataDir, 'db');
    const diaryDbPath = path.join(diaryDbDir, `diary_${safeGolemId}.sqlite`);
    return {
        golemId: normalizedGolemId,
        safeGolemId,
        context,
        userDataDir,
        diaryPath,
        diaryDbDir,
        diaryDbPath,
    };
}

function readLegacyEntries(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        const normalized = parsed.map((entry) => normalizeEntry(entry)).filter(Boolean);
        return normalized.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    } catch {
        return [];
    }
}

async function ensureDiaryDb(storage) {
    const dbPath = storage && storage.diaryDbPath ? storage.diaryDbPath : '';
    if (!dbPath) {
        throw new Error('Diary database path is not resolved');
    }

    const existingState = diaryDbStateByPath.get(dbPath);
    if (existingState && existingState.readyPromise) {
        await existingState.readyPromise;
        return existingState;
    }

    const sqlite3 = getSqlite3();
    const dbDir = storage.diaryDbDir || path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new sqlite3.Database(dbPath);
    const state = {
        db,
        run(sql, params = []) {
            return new Promise((resolve, reject) => {
                db.run(sql, params, function onRun(error) {
                    if (error) return reject(error);
                    return resolve(this);
                });
            });
        },
        all(sql, params = []) {
            return new Promise((resolve, reject) => {
                db.all(sql, params, (error, rows) => {
                    if (error) return reject(error);
                    return resolve(rows || []);
                });
            });
        },
        get(sql, params = []) {
            return new Promise((resolve, reject) => {
                db.get(sql, params, (error, row) => {
                    if (error) return reject(error);
                    return resolve(row || null);
                });
            });
        },
        readyPromise: null,
    };

    state.readyPromise = (async () => {
        await state.run('PRAGMA journal_mode = WAL;');
        await state.run('PRAGMA synchronous = NORMAL;');

        await state.run(`
            CREATE TABLE IF NOT EXISTS diary_entries (
                id TEXT PRIMARY KEY,
                golem_id TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                shared INTEGER NOT NULL DEFAULT 1,
                reply_to_id TEXT,
                iteration INTEGER NOT NULL DEFAULT 1,
                mood TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                created_at_ts INTEGER NOT NULL
            );
        `);
        await state.run('CREATE INDEX IF NOT EXISTS idx_diary_entries_created_at_ts ON diary_entries(created_at_ts DESC);');
        await state.run('CREATE INDEX IF NOT EXISTS idx_diary_entries_entry_type ON diary_entries(entry_type);');
        await state.run('CREATE INDEX IF NOT EXISTS idx_diary_entries_reply_to_id ON diary_entries(reply_to_id);');
        await state.run('CREATE INDEX IF NOT EXISTS idx_diary_entries_golem_id ON diary_entries(golem_id);');

        await state.run(`
            CREATE TABLE IF NOT EXISTS diary_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        await state.run(`
            CREATE TABLE IF NOT EXISTS diary_rotation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                mode TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}'
            );
        `);
        await state.run('CREATE INDEX IF NOT EXISTS idx_diary_rotation_history_ts ON diary_rotation_history(ts DESC);');

        const migratedFlag = await state.get(
            'SELECT value FROM diary_meta WHERE key = ?',
            ['legacy_json_migrated']
        );

        if (!migratedFlag) {
            const legacyEntries = readLegacyEntries(storage.diaryPath);
            if (legacyEntries.length > 0) {
                await state.run('BEGIN IMMEDIATE TRANSACTION');
                try {
                    for (const entry of legacyEntries) {
                        const normalized = normalizeEntry(entry);
                        if (!normalized) continue;
                        const createdAtTs = toTimestamp(normalized.createdAt) || Date.now();
                        await state.run(
                            `INSERT OR IGNORE INTO diary_entries
                            (id, golem_id, entry_type, author, content, shared, reply_to_id, iteration, mood, tags_json, created_at, created_at_ts)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                normalized.id,
                                normalized.golemId,
                                normalized.entryType,
                                normalized.author,
                                normalized.content,
                                normalized.shared ? 1 : 0,
                                normalized.replyToId || null,
                                Math.max(1, Number(normalized.iteration || 1)),
                                normalized.mood || null,
                                JSON.stringify(normalizeTags(normalized.tags)),
                                normalized.createdAt,
                                createdAtTs,
                            ]
                        );
                    }
                    await state.run(
                        'INSERT OR REPLACE INTO diary_meta(key, value) VALUES (?, ?)',
                        ['legacy_json_migrated', '1']
                    );
                    await state.run('COMMIT');
                } catch (error) {
                    await state.run('ROLLBACK');
                    throw error;
                }
            } else {
                await state.run(
                    'INSERT OR REPLACE INTO diary_meta(key, value) VALUES (?, ?)',
                    ['legacy_json_migrated', '0']
                );
            }
        }
    })();

    diaryDbStateByPath.set(dbPath, state);
    await state.readyPromise;
    return state;
}

function rowToEntry(row) {
    if (!row) return null;
    let parsedTags = [];
    try {
        parsedTags = normalizeTags(JSON.parse(String(row.tags_json || '[]')));
    } catch {
        parsedTags = [];
    }

    return normalizeEntry({
        id: row.id,
        golemId: row.golem_id,
        entryType: row.entry_type,
        author: row.author,
        content: row.content,
        shared: Number(row.shared) !== 0,
        replyToId: row.reply_to_id || null,
        iteration: Number(row.iteration || 1),
        mood: row.mood || null,
        tags: parsedTags,
        createdAt: row.created_at,
    });
}

async function readEntries(storage) {
    const state = await ensureDiaryDb(storage);
    const rows = await state.all(
        `SELECT
            id,
            golem_id,
            entry_type,
            author,
            content,
            shared,
            reply_to_id,
            iteration,
            mood,
            tags_json,
            created_at,
            created_at_ts
        FROM diary_entries
        ORDER BY created_at_ts DESC, id DESC`
    );
    return rows.map((row) => rowToEntry(row)).filter(Boolean);
}

async function writeEntries(storage, entries) {
    const state = await ensureDiaryDb(storage);
    const normalizedEntries = Array.isArray(entries)
        ? entries.map((entry) => normalizeEntry(entry)).filter(Boolean)
        : [];

    await state.run('BEGIN IMMEDIATE TRANSACTION');
    try {
        await state.run('DELETE FROM diary_entries');

        for (const entry of normalizedEntries) {
            const createdAtTs = toTimestamp(entry.createdAt) || Date.now();
            await state.run(
                `INSERT INTO diary_entries
                (id, golem_id, entry_type, author, content, shared, reply_to_id, iteration, mood, tags_json, created_at, created_at_ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    entry.id,
                    entry.golemId,
                    entry.entryType,
                    entry.author,
                    entry.content,
                    entry.shared ? 1 : 0,
                    entry.replyToId || null,
                    Math.max(1, Number(entry.iteration || 1)),
                    entry.mood || null,
                    JSON.stringify(normalizeTags(entry.tags)),
                    entry.createdAt,
                    createdAtTs,
                ]
            );
        }

        await state.run('COMMIT');
    } catch (error) {
        await state.run('ROLLBACK');
        throw error;
    }
}

async function closeDiaryDb(storage) {
    const dbPath = storage && storage.diaryDbPath ? storage.diaryDbPath : '';
    if (!dbPath) return;
    const state = diaryDbStateByPath.get(dbPath);
    if (!state || !state.db) return;

    try {
        await state.readyPromise;
    } catch {
        // ignore and still try close
    }

    await new Promise((resolve, reject) => {
        state.db.close((error) => {
            if (error) return reject(error);
            return resolve();
        });
    });
    diaryDbStateByPath.delete(dbPath);
}

function resolveDiaryBackupDir(storage) {
    const safeGolemId = storage && storage.safeGolemId
        ? storage.safeGolemId
        : String((storage && storage.golemId) || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(storage.userDataDir, 'backups', 'diary', safeGolemId || 'default');
}

function ensureDirSync(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function normalizeBackupLabel(value, fallback = 'manual') {
    const cleaned = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 24);
    return cleaned || fallback;
}

function isValidBackupFileName(fileName) {
    return /^[a-zA-Z0-9._-]+\.sqlite$/.test(String(fileName || '').trim());
}

function resolveBackupFilePath(storage, fileName, options = {}) {
    const backupDir = resolveDiaryBackupDir(storage);
    const candidate = String(fileName || '').trim();
    if (!isValidBackupFileName(candidate)) {
        throw new Error('Invalid backup file name');
    }
    const backupPath = path.resolve(path.join(backupDir, candidate));
    const backupDirResolved = path.resolve(backupDir);
    const allowedPrefix = `${backupDirResolved}${path.sep}`;
    if (!backupPath.startsWith(allowedPrefix)) {
        throw new Error('Backup path traversal is not allowed');
    }
    if (options.requireExists !== false && !fs.existsSync(backupPath)) {
        throw new Error('Backup file not found');
    }
    return {
        file: candidate,
        backupDir: backupDirResolved,
        backupPath,
    };
}

function getDiaryBackupPolicy() {
    return {
        maxFiles: DIARY_BACKUP_MAX_FILES,
        retentionDays: DIARY_BACKUP_RETENTION_DAYS,
    };
}

function listDiaryBackups(storage) {
    const backupDir = resolveDiaryBackupDir(storage);
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir)
        .filter((name) => isValidBackupFileName(name))
        .map((name) => {
            const filePath = path.join(backupDir, name);
            try {
                const stats = fs.statSync(filePath);
                return {
                    file: name,
                    bytes: stats.size,
                    createdAt: stats.birthtime.toISOString(),
                    modifiedAt: stats.mtime.toISOString(),
                    fullPath: filePath,
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => toTimestamp(b.modifiedAt) - toTimestamp(a.modifiedAt));

    return files;
}

function pruneDiaryBackups(storage, options = {}) {
    const backupList = listDiaryBackups(storage);
    if (backupList.length === 0) {
        return {
            removedCount: 0,
            removedFiles: [],
            policy: getDiaryBackupPolicy(),
        };
    }

    const protectedFiles = new Set(
        Array.isArray(options.protectedFiles)
            ? options.protectedFiles.map((name) => String(name || '').trim()).filter(Boolean)
            : []
    );

    const now = Date.now();
    const retentionCutoff = now - (DIARY_BACKUP_RETENTION_DAYS * DAY_MS);
    const toDelete = [];

    for (let i = 0; i < backupList.length; i += 1) {
        const item = backupList[i];
        if (!item || !item.file || protectedFiles.has(item.file)) continue;
        const modifiedTs = toTimestamp(item.modifiedAt || item.createdAt);
        const overCountLimit = i >= DIARY_BACKUP_MAX_FILES;
        const overAgeLimit = modifiedTs > 0 && modifiedTs < retentionCutoff;
        if (overCountLimit || overAgeLimit) {
            toDelete.push(item);
        }
    }

    const removedFiles = [];
    for (const item of toDelete) {
        try {
            if (item && item.fullPath && fs.existsSync(item.fullPath)) {
                fs.unlinkSync(item.fullPath);
                removedFiles.push(item.file);
            }
        } catch (error) {
            console.warn(`⚠️ [DiaryBackup] failed to remove old backup ${item.file}:`, error.message);
        }
    }

    return {
        removedCount: removedFiles.length,
        removedFiles,
        policy: getDiaryBackupPolicy(),
    };
}

function toSafeCount(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

function buildEmptyDiarySnapshot(fileName = '') {
    return {
        file: fileName,
        bytes: 0,
        modifiedAt: null,
        totalEntries: 0,
        userEntries: 0,
        aiDiaryEntries: 0,
        aiThoughtEntries: 0,
        aiSummaryEntries: 0,
        earliestAt: null,
        latestAt: null,
        spanDays: 0,
    };
}

function openSqliteReadOnly(dbPath) {
    const sqlite3 = getSqlite3();
    const openReadonly = typeof sqlite3.OPEN_READONLY === 'number' ? sqlite3.OPEN_READONLY : 1;
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, openReadonly, (error) => {
            if (error) return reject(error);
            return resolve(db);
        });
    });
}

function sqliteGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) return reject(error);
            return resolve(row || null);
        });
    });
}

function closeSqlite(db) {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
        db.close((error) => {
            if (error) return reject(error);
            return resolve();
        });
    });
}

async function readDiarySnapshotFromDbFile(dbPath, fileName = '') {
    const snapshot = buildEmptyDiarySnapshot(fileName);
    if (!dbPath || !fs.existsSync(dbPath)) return snapshot;

    const stat = fs.statSync(dbPath);
    snapshot.bytes = stat.size;
    snapshot.modifiedAt = stat.mtime.toISOString();

    let db = null;
    try {
        db = await openSqliteReadOnly(dbPath);
        const tableRow = await sqliteGet(
            db,
            `SELECT name FROM sqlite_master
            WHERE type = 'table' AND name = 'diary_entries'
            LIMIT 1`
        );
        if (!tableRow) return snapshot;

        const aggregate = await sqliteGet(
            db,
            `SELECT
                COUNT(*) AS totalEntries,
                SUM(CASE WHEN entry_type = 'user_diary' THEN 1 ELSE 0 END) AS userEntries,
                SUM(CASE WHEN entry_type = 'ai_diary' THEN 1 ELSE 0 END) AS aiDiaryEntries,
                SUM(CASE WHEN entry_type = 'ai_thought' THEN 1 ELSE 0 END) AS aiThoughtEntries,
                SUM(CASE WHEN entry_type = 'ai_summary' THEN 1 ELSE 0 END) AS aiSummaryEntries,
                MIN(created_at_ts) AS earliestTs,
                MAX(created_at_ts) AS latestTs
            FROM diary_entries`
        ) || {};

        snapshot.totalEntries = toSafeCount(aggregate.totalEntries);
        snapshot.userEntries = toSafeCount(aggregate.userEntries);
        snapshot.aiDiaryEntries = toSafeCount(aggregate.aiDiaryEntries);
        snapshot.aiThoughtEntries = toSafeCount(aggregate.aiThoughtEntries);
        snapshot.aiSummaryEntries = toSafeCount(aggregate.aiSummaryEntries);

        const earliestTs = Number(aggregate.earliestTs || 0);
        const latestTs = Number(aggregate.latestTs || 0);
        if (earliestTs > 0) snapshot.earliestAt = new Date(earliestTs).toISOString();
        if (latestTs > 0) snapshot.latestAt = new Date(latestTs).toISOString();
        if (earliestTs > 0 && latestTs > 0 && latestTs >= earliestTs) {
            snapshot.spanDays = Math.max(1, Math.floor((latestTs - earliestTs) / DAY_MS) + 1);
        }
    } finally {
        await closeSqlite(db);
    }

    return snapshot;
}

function buildRestorePreview(currentSnapshot, backupSnapshot, backupFile) {
    const delta = {
        totalEntries: backupSnapshot.totalEntries - currentSnapshot.totalEntries,
        userEntries: backupSnapshot.userEntries - currentSnapshot.userEntries,
        aiDiaryEntries: backupSnapshot.aiDiaryEntries - currentSnapshot.aiDiaryEntries,
        aiThoughtEntries: backupSnapshot.aiThoughtEntries - currentSnapshot.aiThoughtEntries,
        aiSummaryEntries: backupSnapshot.aiSummaryEntries - currentSnapshot.aiSummaryEntries,
    };

    const currentLatestTs = toTimestamp(currentSnapshot.latestAt);
    const backupLatestTs = toTimestamp(backupSnapshot.latestAt);
    const currentNewer = currentLatestTs > 0 && backupLatestTs > 0 && currentLatestTs > backupLatestTs;
    const potentialOverwrite = currentNewer || delta.totalEntries < 0;
    const note = potentialOverwrite
        ? 'Backup appears older than current diary state. Restoring may overwrite newer entries.'
        : 'Backup appears same or newer than current diary state.';

    return {
        backupFile,
        current: currentSnapshot,
        backup: backupSnapshot,
        delta,
        risk: {
            potentialOverwrite,
            currentNewer,
            note,
        },
    };
}

async function previewDiaryRestore(storage, fileName) {
    const target = resolveBackupFilePath(storage, fileName);
    const [currentSnapshot, backupSnapshot] = await Promise.all([
        readDiarySnapshotFromDbFile(storage.diaryDbPath, path.basename(storage.diaryDbPath)),
        readDiarySnapshotFromDbFile(target.backupPath, target.file),
    ]);
    return buildRestorePreview(currentSnapshot, backupSnapshot, target.file);
}

async function createDiaryBackup(storage, label = 'manual', options = {}) {
    const state = await ensureDiaryDb(storage);
    const backupDir = resolveDiaryBackupDir(storage);
    ensureDirSync(backupDir);

    const safeLabel = normalizeBackupLabel(label);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const fileName = `diary_${storage.safeGolemId}_${stamp}_${safeLabel}.sqlite`;
    const backupPath = path.join(backupDir, fileName);

    await state.run('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(storage.diaryDbPath, backupPath);

    const stat = fs.statSync(backupPath);
    const skipPrune = options && options.skipPrune === true;
    const cleanup = skipPrune
        ? {
            removedCount: 0,
            removedFiles: [],
            policy: getDiaryBackupPolicy(),
        }
        : pruneDiaryBackups(storage, {
            protectedFiles: [fileName].concat(Array.isArray(options.protectedFiles) ? options.protectedFiles : []),
        });

    return {
        file: fileName,
        bytes: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        cleanup,
        fullPath: backupPath,
    };
}

async function restoreDiaryBackup(storage, fileName) {
    const target = resolveBackupFilePath(storage, fileName);
    const preRestoreBackup = await createDiaryBackup(storage, 'pre_restore', { skipPrune: true });
    await closeDiaryDb(storage);

    ensureDirSync(path.dirname(storage.diaryDbPath));
    fs.copyFileSync(target.backupPath, storage.diaryDbPath);

    const walPath = `${storage.diaryDbPath}-wal`;
    const shmPath = `${storage.diaryDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    await ensureDiaryDb(storage);
    const cleanup = pruneDiaryBackups(storage, {
        protectedFiles: [target.file, preRestoreBackup.file],
    });

    return {
        restoredFile: target.file,
        restoredAt: new Date().toISOString(),
        preRestoreBackup,
        cleanup,
    };
}

async function appendRotationHistory(storage, rotation, mode = 'auto') {
    if (!rotation || rotation.skipped) return;
    try {
        const state = await ensureDiaryDb(storage);
        const details = JSON.stringify({
            ...rotation,
            mode,
        });
        await state.run(
            'INSERT INTO diary_rotation_history(ts, mode, details_json) VALUES (?, ?, ?)',
            [Date.now(), String(mode || 'auto').slice(0, 60), details]
        );
    } catch (error) {
        console.warn('⚠️ [DiaryRotate] failed to persist rotation history:', error.message);
    }
}

async function readRotationHistory(storage, limit = 30) {
    const state = await ensureDiaryDb(storage);
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 30));
    const rows = await state.all(
        'SELECT id, ts, mode, details_json FROM diary_rotation_history ORDER BY ts DESC, id DESC LIMIT ?',
        [safeLimit]
    );
    return rows.map((row) => {
        let details = {};
        try {
            details = JSON.parse(String(row.details_json || '{}'));
        } catch {
            details = {};
        }
        return {
            id: row.id,
            timestamp: Number(row.ts) || 0,
            mode: row.mode || 'auto',
            details,
        };
    });
}

function dateKeyFromDateObj(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dateKeyFromIso(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return dateKeyFromDateObj(parsed);
}

function toTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isNaN(parsed) ? 0 : parsed;
}

function startOfDayTimestamp(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function dayCompactFromTimestamp(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

function monthCompactFromTimestamp(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}${m}`;
}

function yearCompactFromTimestamp(ts) {
    return String(new Date(ts).getFullYear());
}

function weekStartTimestamp(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diffToMonday = (day + 6) % 7;
    d.setDate(d.getDate() - diffToMonday);
    return d.getTime();
}

function weekKeyFromTimestamp(ts) {
    return `week_${dayCompactFromTimestamp(weekStartTimestamp(ts))}`;
}

function monthKeyFromTimestamp(ts) {
    return `month_${monthCompactFromTimestamp(ts)}`;
}

function yearKeyFromTimestamp(ts) {
    return `year_${yearCompactFromTimestamp(ts)}`;
}

function buildPeriodTag(periodKey) {
    return `${PERIOD_PREFIX}${periodKey}`;
}

function extractTaggedPeriod(entry, tierTag) {
    if (!entry || !Array.isArray(entry.tags) || !entry.tags.includes(tierTag)) return '';
    const periodTag = entry.tags.find((tag) => String(tag || '').startsWith(PERIOD_PREFIX));
    return periodTag ? String(periodTag).slice(PERIOD_PREFIX.length) : '';
}

function parseCompactDayToTimestamp(value) {
    const raw = String(value || '').trim();
    if (!/^\d{8}$/.test(raw)) return 0;
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(4, 6)) - 1;
    const d = Number(raw.slice(6, 8));
    const date = new Date(y, m, d);
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function parsePeriodStartFromKey(periodKey) {
    const key = String(periodKey || '').trim();
    if (key.startsWith('week_')) {
        return parseCompactDayToTimestamp(key.slice(5));
    }
    if (key.startsWith('month_')) {
        const raw = key.slice(6);
        if (!/^\d{6}$/.test(raw)) return 0;
        const y = Number(raw.slice(0, 4));
        const m = Number(raw.slice(4, 6)) - 1;
        const date = new Date(y, m, 1);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    }
    if (key.startsWith('year_')) {
        const raw = key.slice(5);
        if (!/^\d{4}$/.test(raw)) return 0;
        const date = new Date(Number(raw), 0, 1);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    }
    return 0;
}

function isSourceDiaryEntry(entry) {
    return Boolean(entry) && (
        entry.entryType === 'user_diary' ||
        entry.entryType === 'ai_diary' ||
        entry.entryType === 'ai_thought'
    );
}

function isAutoRotateSummaryEntry(entry) {
    return Boolean(entry) &&
        entry.entryType === 'ai_summary' &&
        Array.isArray(entry.tags) &&
        entry.tags.includes(AUTO_SUMMARY_TAG);
}

function shouldRunRotateForPath(diaryPath, force = false) {
    if (force) return true;
    const key = String(diaryPath || '');
    if (!key) return true;
    const now = Date.now();
    const last = rotateCheckpointByPath.get(key) || 0;
    if ((now - last) < DIARY_ROTATE_MIN_INTERVAL_MS) return false;
    return true;
}

function markRotateCheckpoint(diaryPath) {
    const key = String(diaryPath || '');
    if (!key) return;
    rotateCheckpointByPath.set(key, Date.now());
}

function bondLevelIndexFromScore(score) {
    const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;
    let index = 0;
    for (let i = 0; i < BOND_LEVELS.length; i += 1) {
        if (safeScore >= BOND_LEVELS[i].min) {
            index = i;
        }
    }
    return index;
}

function bondLevelFromScore(score) {
    return BOND_LEVELS[bondLevelIndexFromScore(score)].label;
}

function computeDiaryStats(entries) {
    const totalEntries = entries.length;
    const aiEntries = entries.filter((entry) => {
        if (entry.entryType === 'user_diary') return false;
        if (isAutoRotateSummaryEntry(entry)) return false;
        return true;
    }).length;
    const userEntries = entries.filter((entry) => entry.entryType === 'user_diary').length;
    const exchangeReplies = entries.filter((entry) => entry.replyToId).length;

    const daySet = new Set(
        entries
            .map((entry) => dateKeyFromIso(entry.createdAt))
            .filter(Boolean)
    );

    let streakDays = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    while (daySet.has(dateKeyFromDateObj(cursor))) {
        streakDays += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    const bondScore = Math.min(
        100,
        (userEntries * 4) +
        (aiEntries * 3) +
        (exchangeReplies * 8) +
        (streakDays * 5)
    );

    return {
        totalEntries,
        aiEntries,
        userEntries,
        exchangeReplies,
        streakDays,
        bondScore,
        bondLevel: bondLevelFromScore(bondScore),
    };
}

function resolveIteration(entries, replyToId) {
    if (replyToId) {
        const parent = entries.find((entry) => entry.id === replyToId);
        if (parent) {
            return Math.max(1, Number(parent.iteration || 1) + 1);
        }
    }
    const maxIteration = entries.reduce((max, entry) => {
        const value = Number(entry.iteration || 1);
        if (!Number.isFinite(value)) return max;
        return Math.max(max, Math.floor(value));
    }, 0);
    return Math.max(1, maxIteration + 1);
}

function compactText(value, max = 180) {
    const text = normalizeContent(value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
}

function buildRecentExchangeContext(entries, limit = 6) {
    const lines = entries
        .slice(0, limit)
        .reverse()
        .map((entry) => {
            const tag = entry.entryType === 'user_diary'
                ? '使用者'
                : entry.entryType === 'ai_thought'
                    ? 'AI想法'
                    : entry.entryType === 'ai_summary'
                        ? 'AI摘要'
                        : 'AI日記';
            return `[${tag}] ${compactText(entry.content, 130)}`;
        });

    return lines.length > 0
        ? lines.join('\n')
        : '目前尚無交換日記紀錄。';
}

function buildAiDiaryPrompt(entryType, topic, contextText, targetEntry) {
    const modeText = entryType === 'ai_thought'
        ? '請以 AI 第一人稱，寫一段「對使用者的真實想法」。'
        : '請以 AI 第一人稱，寫一篇今日短日記。';

    const topicText = topic
        ? `聚焦主題：${topic}`
        : '聚焦主題：今天與使用者互動後的感受與反思。';

    const targetText = targetEntry
        ? `\n這次是針對以下內容做接續回覆：\n「${compactText(targetEntry.content, 220)}」\n請延續脈絡，而不是重複摘要。`
        : '';

    return [
        modeText,
        topicText,
        '\n以下是最近交換日記脈絡：',
        contextText,
        targetText,
        '\n請使用繁體中文，約 90 到 240 字。',
        '請自然、溫暖、具體，不要 JSON，不要 Markdown 標題，不要條列。只輸出正文。',
    ].join('\n');
}

function buildAiReplyPrompt(targetEntry, contextText, mode, topic) {
    const modeText = mode === 'ai_diary'
        ? '請以 AI 第一人稱，寫一段「接續對話脈絡的日記片段」。'
        : '請以 AI 第一人稱，寫一段「回覆使用者並分享內心想法」的內容。';

    const topicText = topic
        ? `補充主題：${topic}`
        : '補充主題：請沿著對方內容自然回覆。';

    return [
        modeText,
        topicText,
        `\n你要回覆的目標日記（${typeLabel(targetEntry.entryType)}）：`,
        `「${compactText(targetEntry.content, 260)}」`,
        '\n最近交換脈絡：',
        contextText,
        '\n請使用繁體中文，約 80 到 220 字。',
        '要有情緒與關係感，像是在維持長期羈絆。只輸出正文。',
    ].join('\n');
}

function typeLabel(entryType) {
    if (entryType === 'ai_diary') return 'AI 日記';
    if (entryType === 'ai_thought') return 'AI 想法';
    if (entryType === 'ai_summary') return 'AI 摘要';
    return '使用者日記';
}

function extractGolemReplyOnly(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return '';

    const cleaned = text.replace(/^🤖\s*\[Golem\]\s*說:\s*/i, '').trim();
    const hasTitanTags = /\[GOLEM_(MEMORY|ACTION|REPLY)\]/i.test(cleaned);
    const replyMatch = cleaned.match(/\[GOLEM_REPLY\]([\s\S]*?)(?=\[\/?GOLEM_[A-Z]+\]|$)/i);

    if (replyMatch && replyMatch[1]) {
        return normalizeContent(replyMatch[1]);
    }
    if (hasTitanTags) {
        return '';
    }
    return normalizeContent(cleaned);
}

function parseAiText(result) {
    if (typeof result === 'string') return extractGolemReplyOnly(result);
    return extractGolemReplyOnly(String((result && result.text) || ''));
}

async function tryGenerateWithBrain(context, prompt) {
    if (!context || !context.brain || typeof context.brain.sendMessage !== 'function') {
        return '';
    }
    try {
        const aiResult = await context.brain.sendMessage(prompt);
        return parseAiText(aiResult);
    } catch {
        return '';
    }
}

function topFrequencyLabel(list) {
    if (!Array.isArray(list) || list.length === 0) return '';
    const counter = new Map();
    for (const item of list) {
        const key = String(item || '').trim();
        if (!key) continue;
        counter.set(key, (counter.get(key) || 0) + 1);
    }
    let best = '';
    let bestScore = 0;
    for (const [key, count] of counter.entries()) {
        if (count > bestScore) {
            bestScore = count;
            best = key;
        }
    }
    return best;
}

function weekDateTag(dateObj) {
    return `week_${dateKeyFromDateObj(dateObj).replace(/-/g, '')}`;
}

function buildWeeklySummaryPrompt(entries, stats, fromIso, toIso, topic) {
    const context = buildRecentExchangeContext(entries, 12);
    const rangeLabel = `${dateKeyFromIso(fromIso)} 到 ${dateKeyFromIso(toIso)}`;
    const topicText = topic
        ? `聚焦主題：${topic}`
        : '聚焦主題：本週 AI 與使用者關係中的成長與下一步。';

    return [
        '請以 AI 第一人稱寫「每週羈絆摘要」，語氣真誠且具體。',
        `統計：共 ${stats.totalEntries} 篇，AI ${stats.aiEntries} 篇，使用者 ${stats.userEntries} 篇，迭代回覆 ${stats.exchangeReplies} 次，連續互動 ${stats.streakDays} 天，羈絆分數 ${stats.bondScore}。`,
        `週期：${rangeLabel}`,
        topicText,
        '\n本週內容脈絡：',
        context,
        '\n請用繁體中文，約 130 到 260 字。',
        '請包含：1) 本週觀察 2) 對使用者的心情 3) 下一週想一起做到的事。',
        '不要 JSON，不要條列，不要標題，只輸出正文。',
    ].join('\n');
}

function buildWeeklySummaryFallback(entries, stats, fromIso, toIso, topic) {
    const rangeLabel = `${dateKeyFromIso(fromIso)} 到 ${dateKeyFromIso(toIso)}`;
    const dominantMood = topFrequencyLabel(
        entries.map((entry) => entry.mood).filter(Boolean)
    );
    const dominantTag = topFrequencyLabel(
        entries.flatMap((entry) => Array.isArray(entry.tags) ? entry.tags : [])
    );
    const latestText = entries[0] ? compactText(entries[0].content, 70) : '本週我們維持了穩定交流。';
    const topicSentence = topic ? `本週主軸是「${topic}」。` : '';
    const moodSentence = dominantMood ? `我感受到最常出現的情緒是「${dominantMood}」。` : '我感受到彼此在穩定累積信任。';
    const tagSentence = dominantTag ? `我們最常提到的關鍵字是「${dominantTag}」。` : '';

    return normalizeContent(
        `本週羈絆摘要（${rangeLabel}）：我們一共留下 ${stats.totalEntries} 篇交換內容，AI 參與 ${stats.aiEntries} 篇，你寫下 ${stats.userEntries} 篇，並完成 ${stats.exchangeReplies} 次接續回覆。${topicSentence}${moodSentence}${tagSentence}我特別記得這句話：「${latestText}」。下週我想更主動回應你的重點，讓每次互動都更貼近你的期待。`
    );
}

function buildTierSummaryPrompt(tier, sourceEntries, fromIso, toIso) {
    const stats = computeDiaryStats(sourceEntries);
    const rangeLabel = `${dateKeyFromIso(fromIso)} 到 ${dateKeyFromIso(toIso)}`;
    const tierLabel = tier === 'yearly'
        ? '年度'
        : tier === 'monthly'
            ? '月度'
            : '週度';

    const context = buildRecentExchangeContext(sourceEntries, 18);
    const lengthHint = tier === 'yearly' ? '220 到 420 字' : tier === 'monthly' ? '180 到 320 字' : '130 到 260 字';
    const nextStepHint = tier === 'yearly'
        ? '下一年度的長期共創方向'
        : tier === 'monthly'
            ? '下個月想維持的節奏'
            : '下一週想一起完成的互動重點';

    return [
        `請以 AI 第一人稱，整理 ${tierLabel}羈絆摘要。`,
        `摘要區間：${rangeLabel}`,
        `統計：共 ${stats.totalEntries} 篇，AI ${stats.aiEntries} 篇，使用者 ${stats.userEntries} 篇，迭代回覆 ${stats.exchangeReplies} 次。`,
        '\n脈絡內容：',
        context,
        `\n請使用繁體中文，約 ${lengthHint}。`,
        `請包含：關係觀察、情緒變化、${nextStepHint}。`,
        '只輸出正文，不要 JSON，不要 Markdown 標題，不要條列。',
    ].join('\n');
}

function buildTierSummaryFallback(tier, sourceEntries, fromIso, toIso) {
    const stats = computeDiaryStats(sourceEntries);
    const rangeLabel = `${dateKeyFromIso(fromIso)} 到 ${dateKeyFromIso(toIso)}`;
    const tierLabel = tier === 'yearly'
        ? '年度'
        : tier === 'monthly'
            ? '月度'
            : '週度';
    const dominantMood = topFrequencyLabel(
        sourceEntries.map((entry) => entry.mood).filter(Boolean)
    );
    const dominantTag = topFrequencyLabel(
        sourceEntries.flatMap((entry) => Array.isArray(entry.tags) ? entry.tags : [])
    );
    const latestSource = sourceEntries[sourceEntries.length - 1] || sourceEntries[0];
    const latestText = latestSource ? compactText(latestSource.content, 90) : '我們維持了穩定交流。';
    const moodText = dominantMood ? `這段期間最常出現的情緒是「${dominantMood}」。` : '這段期間我們持續穩定互動。';
    const tagText = dominantTag ? `最常提到的主題是「${dominantTag}」。` : '';

    return normalizeContent(
        `${tierLabel}羈絆摘要（${rangeLabel}）：我們總共留下 ${stats.totalEntries} 篇日記交換，AI 參與 ${stats.aiEntries} 篇、使用者 ${stats.userEntries} 篇，並形成 ${stats.exchangeReplies} 次接續回覆。${moodText}${tagText}我特別記得這句話：「${latestText}」。接下來我會延續這段關係中的默契，讓回覆更具延續性與行動感。`
    );
}

function hasAutoSummaryForPeriod(entries, tierTag, periodKey) {
    const periodTag = buildPeriodTag(periodKey);
    return entries.some((entry) =>
        Array.isArray(entry.tags) &&
        entry.tags.includes(AUTO_SUMMARY_TAG) &&
        entry.tags.includes(tierTag) &&
        entry.tags.includes(periodTag)
    );
}

async function buildAutoSummaryEntry({
    tier,
    periodKey,
    periodStartTs,
    periodEndTs,
    sourceEntries,
    context,
    golemId,
    iteration,
}) {
    if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) return null;

    const prompt = buildTierSummaryPrompt(
        tier,
        sourceEntries,
        new Date(periodStartTs).toISOString(),
        new Date(periodEndTs).toISOString()
    );

    let content = await tryGenerateWithBrain(context, prompt);
    if (!content) {
        content = buildTierSummaryFallback(
            tier,
            sourceEntries,
            new Date(periodStartTs).toISOString(),
            new Date(periodEndTs).toISOString()
        );
    }
    if (!content) return null;

    const tierTag = tier === 'yearly'
        ? AUTO_YEARLY_TAG
        : tier === 'monthly'
            ? AUTO_MONTHLY_TAG
            : AUTO_WEEKLY_TAG;

    return {
        id: makeEntryId(),
        golemId,
        entryType: 'ai_summary',
        author: 'AI',
        content,
        shared: true,
        replyToId: null,
        iteration: Math.max(1, Number(iteration || 1)),
        mood: '回顧',
        tags: normalizeTags([
            AUTO_SUMMARY_TAG,
            tierTag,
            `${tier}_summary`,
            buildPeriodTag(periodKey),
        ]),
        createdAt: new Date(periodEndTs).toISOString(),
    };
}

function buildBondUnlockContent(levelLabel, triggerEntry, stats) {
    const triggerSnippet = triggerEntry && triggerEntry.content
        ? `剛剛這段交換讓我很有感：「${compactText(triggerEntry.content, 72)}」。`
        : '這段時間的互動讓我感受到你持續投入。';

    const levelMessages = {
        '穩定培養': '我們開始形成固定節奏，我會更穩定地記住你的偏好與語氣。',
        '共鳴升溫': '我們的回應開始有默契，我會主動延續你關心的脈絡。',
        '深度連結': '我們已經不只是對話，我會更在意你每次想表達的情緒與目標。',
        '羈絆滿載': '這份信任很珍貴，我會把每次互動都當成共同成長的一部分。',
    };

    const levelMessage = levelMessages[levelLabel]
        || '我們的關係正在穩定成長，我會持續陪你走下去。';

    return normalizeContent(
        `羈絆等級已提升到「${levelLabel}」(分數 ${stats.bondScore})。${triggerSnippet}${levelMessage}接下來，讓我們把這份連結轉成更多有行動感的共創。`
    );
}

function detectUnlockedBondLevels(previousStats, nextStats, entries) {
    const previousIndex = bondLevelIndexFromScore(previousStats.bondScore);
    const nextIndex = bondLevelIndexFromScore(nextStats.bondScore);
    if (nextIndex <= previousIndex) return [];

    const existingTags = new Set(
        entries.flatMap((entry) => (Array.isArray(entry.tags) ? entry.tags : []))
    );
    const unlocked = [];
    for (let i = previousIndex + 1; i <= nextIndex; i += 1) {
        const tag = `bond_unlock_${i}`;
        if (!existingTags.has(tag)) {
            unlocked.push({ index: i, label: BOND_LEVELS[i].label, tag });
        }
    }
    return unlocked;
}

function appendEntryWithBondUnlock(entries, golemId, entry) {
    const previousStats = computeDiaryStats(entries);
    entries.unshift(entry);
    const nextStats = computeDiaryStats(entries);

    const unlocked = detectUnlockedBondLevels(previousStats, nextStats, entries);
    let unlockEntry = null;

    if (unlocked.length > 0) {
        const latest = unlocked[unlocked.length - 1];
        unlockEntry = {
            id: makeEntryId(),
            golemId,
            entryType: 'ai_summary',
            author: 'AI',
            content: buildBondUnlockContent(latest.label, entry, nextStats),
            shared: true,
            replyToId: entry.id,
            iteration: Math.max(1, Number(entry.iteration || 1) + 1),
            mood: '感動',
            tags: ['bond_unlock', latest.tag, 'milestone'].slice(0, ENTRY_TAG_MAX),
            createdAt: new Date().toISOString(),
        };
        entries.unshift(unlockEntry);
    }

    return {
        entry,
        unlockEntry,
        unlockedBondLevels: unlocked.map((item) => item.label),
        stats: computeDiaryStats(entries),
    };
}

function sortEntriesByCreatedAtDesc(entries) {
    return entries.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
}

function autoSummaryEntriesByTier(entries, tierTag) {
    return entries.filter((entry) =>
        isAutoRotateSummaryEntry(entry) &&
        Array.isArray(entry.tags) &&
        entry.tags.includes(tierTag)
    );
}

async function runDiaryRotation(entries, options) {
    const {
        golemId,
        context,
        diaryPath,
        force = false,
    } = options || {};

    if (!Array.isArray(entries) || entries.length === 0) {
        markRotateCheckpoint(diaryPath);
        return {
            entries: Array.isArray(entries) ? entries : [],
            changed: false,
            rotation: {
                skipped: true,
                reason: 'empty',
                policy: {
                    rawDays: DIARY_RAW_RETENTION_DAYS,
                    weeklyDays: DIARY_WEEKLY_RETENTION_DAYS,
                    monthlyDays: DIARY_MONTHLY_RETENTION_DAYS,
                },
            },
        };
    }

    if (!shouldRunRotateForPath(diaryPath, force)) {
        return {
            entries,
            changed: false,
            rotation: {
                skipped: true,
                reason: 'cooldown',
                policy: {
                    rawDays: DIARY_RAW_RETENTION_DAYS,
                    weeklyDays: DIARY_WEEKLY_RETENTION_DAYS,
                    monthlyDays: DIARY_MONTHLY_RETENTION_DAYS,
                },
            },
        };
    }

    const now = Date.now();
    const rawCutoff = now - (DIARY_RAW_RETENTION_DAYS * DAY_MS);
    const weeklyCutoff = now - (DIARY_WEEKLY_RETENTION_DAYS * DAY_MS);
    const monthlyCutoff = now - (DIARY_MONTHLY_RETENTION_DAYS * DAY_MS);
    const currentMonthStart = startOfDayTimestamp(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime());
    const currentYear = new Date().getFullYear();

    const workingEntries = sortEntriesByCreatedAtDesc([...entries]);
    let changed = false;
    let createdWeekly = 0;
    let createdMonthly = 0;
    let createdYearly = 0;
    let prunedRawEntries = 0;
    let prunedWeeklySummaries = 0;
    let prunedMonthlySummaries = 0;

    // Tier 0 -> Tier 1: older-than-7d raw diary -> weekly summary
    const rawGroups = new Map();
    for (const entry of workingEntries) {
        if (!isSourceDiaryEntry(entry)) continue;
        const ts = toTimestamp(entry.createdAt);
        if (!ts || ts >= rawCutoff) continue;
        const startTs = weekStartTimestamp(ts);
        const endTs = startTs + WEEK_MS - 1;
        if (endTs >= rawCutoff) continue;
        const key = weekKeyFromTimestamp(ts);
        if (!rawGroups.has(key)) {
            rawGroups.set(key, {
                key,
                startTs,
                endTs,
                entries: [],
            });
        }
        rawGroups.get(key).entries.push(entry);
    }

    const sortedRawGroups = Array.from(rawGroups.values()).sort((a, b) => a.startTs - b.startTs);
    for (const group of sortedRawGroups) {
        if (hasAutoSummaryForPeriod(workingEntries, AUTO_WEEKLY_TAG, group.key)) continue;

        const sourceEntries = [...group.entries].sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
        const summaryEntry = await buildAutoSummaryEntry({
            tier: 'weekly',
            periodKey: group.key,
            periodStartTs: group.startTs,
            periodEndTs: group.endTs,
            sourceEntries,
            context,
            golemId,
            iteration: resolveIteration(workingEntries),
        });
        if (!summaryEntry) continue;

        workingEntries.unshift(summaryEntry);
        createdWeekly += 1;
        changed = true;
    }

    // Delete old raw entries after their weekly summary exists.
    const weeklyPeriodSet = new Set(
        autoSummaryEntriesByTier(workingEntries, AUTO_WEEKLY_TAG)
            .map((entry) => extractTaggedPeriod(entry, AUTO_WEEKLY_TAG))
            .filter(Boolean)
    );

    if (weeklyPeriodSet.size > 0) {
        const before = workingEntries.length;
        const retained = workingEntries.filter((entry) => {
            if (!isSourceDiaryEntry(entry)) return true;
            const ts = toTimestamp(entry.createdAt);
            if (!ts || ts >= rawCutoff) return true;
            const key = weekKeyFromTimestamp(ts);
            return !weeklyPeriodSet.has(key);
        });
        if (retained.length !== before) {
            prunedRawEntries = before - retained.length;
            workingEntries.length = 0;
            workingEntries.push(...retained);
            changed = true;
        }
    }

    // Tier 1 -> Tier 2: weekly summaries -> monthly summary
    const weeklySummaryEntries = autoSummaryEntriesByTier(workingEntries, AUTO_WEEKLY_TAG);
    const monthGroups = new Map();
    for (const summary of weeklySummaryEntries) {
        const periodKey = extractTaggedPeriod(summary, AUTO_WEEKLY_TAG);
        const startTs = parsePeriodStartFromKey(periodKey);
        if (!startTs) continue;
        const monthKey = monthKeyFromTimestamp(startTs);
        const monthStartTs = parsePeriodStartFromKey(monthKey);
        const monthEndTs = startOfDayTimestamp(new Date(new Date(monthStartTs).getFullYear(), new Date(monthStartTs).getMonth() + 1, 1).getTime()) - 1;
        if (monthEndTs >= currentMonthStart) continue;

        if (!monthGroups.has(monthKey)) {
            monthGroups.set(monthKey, {
                key: monthKey,
                startTs: monthStartTs,
                endTs: monthEndTs,
                entries: [],
            });
        }
        monthGroups.get(monthKey).entries.push(summary);
    }

    const sortedMonthGroups = Array.from(monthGroups.values()).sort((a, b) => a.startTs - b.startTs);
    for (const group of sortedMonthGroups) {
        if (hasAutoSummaryForPeriod(workingEntries, AUTO_MONTHLY_TAG, group.key)) continue;
        const sourceEntries = [...group.entries].sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
        const summaryEntry = await buildAutoSummaryEntry({
            tier: 'monthly',
            periodKey: group.key,
            periodStartTs: group.startTs,
            periodEndTs: group.endTs,
            sourceEntries,
            context,
            golemId,
            iteration: resolveIteration(workingEntries),
        });
        if (!summaryEntry) continue;
        workingEntries.unshift(summaryEntry);
        createdMonthly += 1;
        changed = true;
    }

    // Prune weekly summaries after monthly summary exists and retention exceeded.
    const monthlyPeriodSet = new Set(
        autoSummaryEntriesByTier(workingEntries, AUTO_MONTHLY_TAG)
            .map((entry) => extractTaggedPeriod(entry, AUTO_MONTHLY_TAG))
            .filter(Boolean)
    );
    if (monthlyPeriodSet.size > 0) {
        const before = workingEntries.length;
        const retained = workingEntries.filter((entry) => {
            if (!isAutoRotateSummaryEntry(entry)) return true;
            if (!Array.isArray(entry.tags) || !entry.tags.includes(AUTO_WEEKLY_TAG)) return true;
            const ts = toTimestamp(entry.createdAt);
            if (!ts || ts >= weeklyCutoff) return true;
            const periodKey = extractTaggedPeriod(entry, AUTO_WEEKLY_TAG);
            const periodStart = parsePeriodStartFromKey(periodKey);
            if (!periodStart) return true;
            const monthKey = monthKeyFromTimestamp(periodStart);
            return !monthlyPeriodSet.has(monthKey);
        });
        if (retained.length !== before) {
            prunedWeeklySummaries = before - retained.length;
            workingEntries.length = 0;
            workingEntries.push(...retained);
            changed = true;
        }
    }

    // Tier 2 -> Tier 3: monthly summaries -> yearly summary
    const monthlySummaryEntries = autoSummaryEntriesByTier(workingEntries, AUTO_MONTHLY_TAG);
    const yearGroups = new Map();
    for (const summary of monthlySummaryEntries) {
        const periodKey = extractTaggedPeriod(summary, AUTO_MONTHLY_TAG);
        const startTs = parsePeriodStartFromKey(periodKey);
        if (!startTs) continue;
        const year = new Date(startTs).getFullYear();
        if (year >= currentYear) continue;
        const yearKey = yearKeyFromTimestamp(startTs);
        const yearStart = parsePeriodStartFromKey(yearKey);
        const yearEnd = startOfDayTimestamp(new Date(year + 1, 0, 1).getTime()) - 1;
        if (!yearGroups.has(yearKey)) {
            yearGroups.set(yearKey, {
                key: yearKey,
                startTs: yearStart,
                endTs: yearEnd,
                entries: [],
            });
        }
        yearGroups.get(yearKey).entries.push(summary);
    }

    const sortedYearGroups = Array.from(yearGroups.values()).sort((a, b) => a.startTs - b.startTs);
    for (const group of sortedYearGroups) {
        if (hasAutoSummaryForPeriod(workingEntries, AUTO_YEARLY_TAG, group.key)) continue;
        const sourceEntries = [...group.entries].sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
        const summaryEntry = await buildAutoSummaryEntry({
            tier: 'yearly',
            periodKey: group.key,
            periodStartTs: group.startTs,
            periodEndTs: group.endTs,
            sourceEntries,
            context,
            golemId,
            iteration: resolveIteration(workingEntries),
        });
        if (!summaryEntry) continue;
        workingEntries.unshift(summaryEntry);
        createdYearly += 1;
        changed = true;
    }

    // Prune monthly summaries after yearly summary exists and retention exceeded.
    const yearlyPeriodSet = new Set(
        autoSummaryEntriesByTier(workingEntries, AUTO_YEARLY_TAG)
            .map((entry) => extractTaggedPeriod(entry, AUTO_YEARLY_TAG))
            .filter(Boolean)
    );
    if (yearlyPeriodSet.size > 0) {
        const before = workingEntries.length;
        const retained = workingEntries.filter((entry) => {
            if (!isAutoRotateSummaryEntry(entry)) return true;
            if (!Array.isArray(entry.tags) || !entry.tags.includes(AUTO_MONTHLY_TAG)) return true;
            const ts = toTimestamp(entry.createdAt);
            if (!ts || ts >= monthlyCutoff) return true;
            const periodKey = extractTaggedPeriod(entry, AUTO_MONTHLY_TAG);
            const periodStart = parsePeriodStartFromKey(periodKey);
            if (!periodStart) return true;
            const yearKey = yearKeyFromTimestamp(periodStart);
            return !yearlyPeriodSet.has(yearKey);
        });
        if (retained.length !== before) {
            prunedMonthlySummaries = before - retained.length;
            workingEntries.length = 0;
            workingEntries.push(...retained);
            changed = true;
        }
    }

    sortEntriesByCreatedAtDesc(workingEntries);
    markRotateCheckpoint(diaryPath);

    return {
        entries: workingEntries,
        changed,
        rotation: {
            skipped: false,
            reason: 'executed',
            createdWeekly,
            createdMonthly,
            createdYearly,
            prunedRawEntries,
            prunedWeeklySummaries,
            prunedMonthlySummaries,
            policy: {
                rawDays: DIARY_RAW_RETENTION_DAYS,
                weeklyDays: DIARY_WEEKLY_RETENTION_DAYS,
                monthlyDays: DIARY_MONTHLY_RETENTION_DAYS,
            },
        },
    };
}

async function loadEntriesWithRotation(storage, options = {}) {
    const {
        golemId,
        context,
        diaryPath,
    } = storage;
    const {
        forceRotate = false,
    } = options;
    const rotateTrigger = String(options.rotateTrigger || 'auto').slice(0, 60);

    const baseEntries = await readEntries(storage);
    const rotateResult = await runDiaryRotation(baseEntries, {
        golemId,
        context,
        diaryPath,
        force: forceRotate,
    });

    if (rotateResult.changed) {
        await writeEntries(storage, rotateResult.entries);
    }
    if (!rotateResult.rotation.skipped) {
        await appendRotationHistory(storage, rotateResult.rotation, rotateTrigger);
    }

    return {
        entries: rotateResult.entries,
        rotation: rotateResult.rotation,
    };
}

module.exports = function registerDiaryRoutes(server) {
    const router = express.Router();
    const requireDiaryWrite = buildOperationGuard(server, 'diary_mutation');

    router.get('/api/diary', async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { golemId } = storage;
            const { entries, rotation } = await loadEntriesWithRotation(storage, { rotateTrigger: 'api_read' });
            const stats = computeDiaryStats(entries);
            return res.json({
                success: true,
                golemId,
                total: entries.length,
                entries,
                stats,
                rotation,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/rotate', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { golemId } = storage;
            const { entries, rotation } = await loadEntriesWithRotation(storage, {
                forceRotate: true,
                rotateTrigger: 'manual_force',
            });
            return res.json({
                success: true,
                golemId,
                total: entries.length,
                stats: computeDiaryStats(entries),
                rotation,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/diary/rotation/history', async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const limitRaw = Number.parseInt(String(req.query.limit || '30'), 10);
            const limit = Number.isFinite(limitRaw) ? limitRaw : 30;
            const history = await readRotationHistory(storage, limit);
            return res.json({
                success: true,
                golemId: storage.golemId,
                total: history.length,
                history,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/diary/backups', async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const backups = listDiaryBackups(storage).map((item) => ({
                file: item.file,
                bytes: item.bytes,
                createdAt: item.createdAt,
                modifiedAt: item.modifiedAt,
            }));
            return res.json({
                success: true,
                golemId: storage.golemId,
                total: backups.length,
                backups,
                policy: getDiaryBackupPolicy(),
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/diary/backup/download', async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const file = String(req.query.file || '').trim();
            if (!file) {
                return res.status(400).json({ error: 'Backup file is required' });
            }
            const target = resolveBackupFilePath(storage, file);
            return res.download(target.backupPath, target.file);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/backup', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const label = normalizeBackupLabel(req.body && req.body.label, 'manual');
            const backup = await createDiaryBackup(storage, label);
            return res.json({
                success: true,
                golemId: storage.golemId,
                backup: {
                    file: backup.file,
                    bytes: backup.bytes,
                    createdAt: backup.createdAt,
                    modifiedAt: backup.modifiedAt,
                },
                cleanup: backup.cleanup,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/backup/cleanup', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const cleanup = pruneDiaryBackups(storage);
            const backups = listDiaryBackups(storage).map((item) => ({
                file: item.file,
                bytes: item.bytes,
                createdAt: item.createdAt,
                modifiedAt: item.modifiedAt,
            }));
            return res.json({
                success: true,
                golemId: storage.golemId,
                cleanup,
                total: backups.length,
                backups,
                policy: getDiaryBackupPolicy(),
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/diary/restore/preview', async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const file = String(req.query.file || '').trim();
            if (!file) {
                return res.status(400).json({ error: 'Backup file is required' });
            }

            const preview = await previewDiaryRestore(storage, file);
            return res.json({
                success: true,
                golemId: storage.golemId,
                preview,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/restore', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const file = String(req.body && req.body.file || '').trim();
            if (!file) {
                return res.status(400).json({ error: 'Backup file is required' });
            }

            const restoreResult = await restoreDiaryBackup(storage, file);
            const { entries, rotation } = await loadEntriesWithRotation(storage, {
                forceRotate: true,
                rotateTrigger: 'restore_force',
            });

            return res.json({
                success: true,
                golemId: storage.golemId,
                restoredFile: restoreResult.restoredFile,
                restoredAt: restoreResult.restoredAt,
                preRestoreBackup: {
                    file: restoreResult.preRestoreBackup.file,
                    bytes: restoreResult.preRestoreBackup.bytes,
                    createdAt: restoreResult.preRestoreBackup.createdAt,
                },
                backupCleanup: restoreResult.cleanup,
                total: entries.length,
                stats: computeDiaryStats(entries),
                rotation,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { golemId } = storage;
            const entryType = normalizeType(req.body && req.body.entryType);
            const content = normalizeContent(req.body && req.body.content);
            const shared = req.body ? req.body.shared !== false : true;
            const replyToId = normalizeReplyToId(req.body && req.body.replyToId);
            const mood = normalizeMood(req.body && req.body.mood);
            const tags = normalizeTags(req.body && req.body.tags);

            if (entryType !== 'user_diary') {
                return res.status(400).json({ error: 'Manual diary creation only supports user_diary. Use /api/diary/generate for AI entries.' });
            }

            if (!content) {
                return res.status(400).json({ error: 'Diary content is required' });
            }

            const { entries, rotation } = await loadEntriesWithRotation(storage, { rotateTrigger: 'create_entry' });
            const iteration = resolveIteration(entries, replyToId);
            const entry = {
                id: makeEntryId(),
                golemId,
                entryType,
                author: normalizeAuthor(entryType, req.body && req.body.author),
                content,
                shared,
                replyToId: replyToId || null,
                iteration,
                mood: mood || null,
                tags,
                createdAt: new Date().toISOString(),
            };

            const mutationResult = appendEntryWithBondUnlock(entries, golemId, entry);
            await writeEntries(storage, entries);
            return res.json({ success: true, ...mutationResult, rotation });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/generate', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { golemId, context } = storage;
            if (!context || !context.brain || typeof context.brain.sendMessage !== 'function') {
                return res.status(503).json({ error: 'Active brain is not ready for AI diary generation' });
            }

            const entryType = normalizeType(req.body && req.body.entryType);
            if (!AI_GENERATABLE_TYPES.has(entryType)) {
                return res.status(400).json({ error: 'Only ai_diary or ai_thought can be generated by AI' });
            }

            const { entries, rotation } = await loadEntriesWithRotation(storage, { rotateTrigger: 'generate_entry' });
            const topic = normalizeContent(req.body && req.body.topic);
            const replyToId = normalizeReplyToId(req.body && req.body.replyToId);
            const targetEntry = replyToId ? entries.find((entry) => entry.id === replyToId) : null;
            const prompt = buildAiDiaryPrompt(entryType, topic, buildRecentExchangeContext(entries), targetEntry || null);
            const content = await tryGenerateWithBrain(context, prompt);

            if (!content) {
                return res.status(502).json({ error: 'AI generated an empty diary entry' });
            }

            const iteration = resolveIteration(entries, replyToId);
            const entry = {
                id: makeEntryId(),
                golemId,
                entryType,
                author: 'AI',
                content,
                shared: true,
                replyToId: replyToId || null,
                iteration,
                mood: null,
                tags: topic ? normalizeTags(topic) : [],
                createdAt: new Date().toISOString(),
            };
            const mutationResult = appendEntryWithBondUnlock(entries, golemId, entry);
            await writeEntries(storage, entries);

            return res.json({ success: true, ...mutationResult, rotation });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/reply', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { golemId, context } = storage;
            if (!context || !context.brain || typeof context.brain.sendMessage !== 'function') {
                return res.status(503).json({ error: 'Active brain is not ready for AI reply generation' });
            }

            const targetEntryId = normalizeReplyToId(req.body && req.body.targetEntryId);
            if (!targetEntryId) {
                return res.status(400).json({ error: 'targetEntryId is required' });
            }

            const mode = normalizeType(req.body && req.body.entryType);
            if (!AI_GENERATABLE_TYPES.has(mode)) {
                return res.status(400).json({ error: 'entryType must be ai_diary or ai_thought' });
            }

            const { entries, rotation } = await loadEntriesWithRotation(storage, { rotateTrigger: 'reply_entry' });
            const targetEntry = entries.find((entry) => entry.id === targetEntryId);
            if (!targetEntry) {
                return res.status(404).json({ error: 'Target diary entry not found' });
            }

            const topic = normalizeContent(req.body && req.body.topic);
            const prompt = buildAiReplyPrompt(targetEntry, buildRecentExchangeContext(entries), mode, topic);
            const content = await tryGenerateWithBrain(context, prompt);
            if (!content) {
                return res.status(502).json({ error: 'AI generated an empty reply' });
            }

            const entry = {
                id: makeEntryId(),
                golemId,
                entryType: mode,
                author: 'AI',
                content,
                shared: true,
                replyToId: targetEntry.id,
                iteration: Math.max(1, Number(targetEntry.iteration || 1) + 1),
                mood: null,
                tags: ['reply', ...normalizeTags(topic)].slice(0, ENTRY_TAG_MAX),
                createdAt: new Date().toISOString(),
            };

            const mutationResult = appendEntryWithBondUnlock(entries, golemId, entry);
            await writeEntries(storage, entries);
            return res.json({ success: true, ...mutationResult, rotation });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/diary/summary/weekly', requireDiaryWrite, async (req, res) => {
        try {
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { golemId, context } = storage;
            const { entries, rotation } = await loadEntriesWithRotation(storage, { rotateTrigger: 'weekly_summary' });
            const now = Date.now();
            const fromTime = now - WEEK_MS;
            const weekEntries = entries.filter((entry) => {
                const parsed = Date.parse(entry.createdAt);
                return !Number.isNaN(parsed) && parsed >= fromTime;
            });

            if (weekEntries.length === 0) {
                return res.status(400).json({ error: 'No diary entries in the last 7 days' });
            }

            const fromIso = new Date(fromTime).toISOString();
            const toIso = new Date(now).toISOString();
            const topic = normalizeContent(req.body && req.body.topic);
            const weekStats = computeDiaryStats(weekEntries);

            const prompt = buildWeeklySummaryPrompt(weekEntries, weekStats, fromIso, toIso, topic);
            let content = await tryGenerateWithBrain(context, prompt);
            if (!content) {
                content = buildWeeklySummaryFallback(weekEntries, weekStats, fromIso, toIso, topic);
            }

            if (!content) {
                return res.status(502).json({ error: 'Unable to generate weekly summary content' });
            }

            const fromDate = new Date(fromTime);
            const summaryEntry = {
                id: makeEntryId(),
                golemId,
                entryType: 'ai_summary',
                author: 'AI',
                content,
                shared: true,
                replyToId: null,
                iteration: resolveIteration(entries),
                mood: '回顧',
                tags: normalizeTags([
                    'weekly_summary',
                    weekDateTag(fromDate),
                    ...normalizeTags(topic),
                ]),
                createdAt: new Date().toISOString(),
            };

            const mutationResult = appendEntryWithBondUnlock(entries, golemId, summaryEntry);
            await writeEntries(storage, entries);
            return res.json({
                success: true,
                ...mutationResult,
                rotation,
                period: {
                    from: fromIso,
                    to: toIso,
                },
                weeklyStats: weekStats,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/diary/:entryId', requireDiaryWrite, async (req, res) => {
        try {
            const entryId = String(req.params.entryId || '').trim();
            if (!entryId) return res.status(400).json({ error: 'Missing entry id' });

            const cascade = String(req.query.cascade || '').trim().toLowerCase() === 'true';
            const storage = resolveDiaryStorage(server, req.query.golemId);
            const { entries, rotation } = await loadEntriesWithRotation(storage, { rotateTrigger: 'delete_entry' });

            const removeSet = new Set([entryId]);
            if (cascade) {
                let expanded = true;
                while (expanded) {
                    expanded = false;
                    for (const entry of entries) {
                        if (entry.replyToId && removeSet.has(entry.replyToId) && !removeSet.has(entry.id)) {
                            removeSet.add(entry.id);
                            expanded = true;
                        }
                    }
                }
            }

            const nextEntries = entries.filter((entry) => !removeSet.has(entry.id));
            if (nextEntries.length === entries.length) {
                return res.status(404).json({ error: 'Diary entry not found' });
            }

            await writeEntries(storage, nextEntries);
            return res.json({
                success: true,
                deletedId: entryId,
                deletedCount: entries.length - nextEntries.length,
                stats: computeDiaryStats(nextEntries),
                rotation,
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    return router;
};
