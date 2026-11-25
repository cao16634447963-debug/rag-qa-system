import { Pool } from 'pg';

/**
 * Postgres 连接池单例
 * 连接串来自 .env 的 DATABASE_URL（本地 docker compose 中的 postgres 服务）
 */
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
    console.error('Postgres 连接池异常:', err.message);
});

/** 执行单条参数化 SQL 的快捷方式 */
export const query = (text: string, params?: unknown[]) => pool.query(text, params);
