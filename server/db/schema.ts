import { query } from './pool.js';

/**
 * 数据库schema：服务启动时幂等执行（CREATE TABLE IF NOT EXISTS）
 * - users/categories/bookmarks：书签系统
 * - chunks：RAG 向量库（pgvector，bge-m3 1024 维，HNSW 余弦索引）
 */

const ensureVectorExtension = async (): Promise<void> => {
    await query('CREATE EXTENSION IF NOT EXISTS vector');
};

export const ensureSchema = async (): Promise<void> => {
    await ensureVectorExtension();

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS categories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            color TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS bookmarks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            description TEXT,
            category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id)`);

    // 问答历史：会话 + 消息（角色仅 user/assistant）
    await query(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT '新对话',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
    await query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at)`);

    // RAG 向量库：file+idx 唯一，按文件整体替换
    await query(`
        CREATE TABLE IF NOT EXISTS chunks (
            file TEXT NOT NULL,
            idx INT NOT NULL,
            text TEXT NOT NULL,
            embedding vector(1024) NOT NULL,
            PRIMARY KEY (file, idx)
        )
    `);
    await query(
        `CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)`,
    );

    console.log('数据库 schema 已就绪');
};
