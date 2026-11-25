import { pool } from '../db/pool.js';
import type { Chunk } from './chunk.js';

/**
 * RAG 向量库存储层（Postgres + pgvector）
 * chunks 表主键 (file, idx)，按文件整体替换，pgvector HNSW 余弦索引检索
 */

export type StoredChunk = Chunk & { embedding: number[] };

/** number[] → pgvector 字面量（'[1,2,3]'），SQL 中以 ::vector 传入 */
export const toVectorLiteral = (embedding: number[]): string => `[${embedding.join(',')}]`;

/** pgvector 返回的字面量字符串 → number[] */
export const fromVectorLiteral = (value: string): number[] => JSON.parse(value) as number[];

/**
 * 替换某文件的全部分块（事务：先删旧再批量插入，重复摄取不产生重复数据）
 */
export const replaceFileChunks = async (file: string, chunks: StoredChunk[]): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM chunks WHERE file = $1', [file]);
        if (chunks.length > 0) {
            const values = chunks
                .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}::vector)`)
                .join(',');
            const params = chunks.flatMap((c) => [c.file, c.index, c.text, toVectorLiteral(c.embedding)]);
            await client.query(
                `INSERT INTO chunks (file, idx, text, embedding) VALUES ${values}`,
                params,
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/** 删除某文件的全部分块，返回删除的块数 */
export const deleteFileChunks = async (file: string): Promise<number> => {
    const result = await pool.query('DELETE FROM chunks WHERE file = $1', [file]);
    return result.rowCount ?? 0;
};
