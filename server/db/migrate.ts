import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './pool.js';

/**
 * 简易 SQL 迁移机制：
 * - 迁移文件放在 server/db/migrations/ 下，命名为 001_xxx.sql、002_xxx.sql（按序号执行）
 * - 已执行的版本号记录在 schema_migrations 表，重复启动自动跳过
 * - 基础表结构由 schema.ts 的 ensureSchema 保证，迁移文件只做增量变更（加列/加索引等）
 */

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

const runMigrations = async (): Promise<void> => {
    await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    let files: string[];
    try {
        files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
        return; // 目录不存在视为无迁移
    }

    const applied = await query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map((r) => r.version as string));

    for (const file of files) {
        if (appliedSet.has(file)) continue;
        const sql = await readFile(path.join(migrationsDir, file), 'utf-8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
            await client.query('COMMIT');
            console.log(`已应用迁移: ${file}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`迁移 ${file} 执行失败:`, err instanceof Error ? err.message : err);
            throw err;
        } finally {
            client.release();
        }
    }
};

export { runMigrations };
