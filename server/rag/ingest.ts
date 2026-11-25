import { chunkText } from './chunk.js';
import { embedTexts } from './embed.js';
import { replaceFileChunks } from './store.js';
import { query } from '../db/pool.js';

/**
 * 摄取核心逻辑（CLI 与 HTTP API 共用）：
 * 分块 → 向量化 → 按文件增量替换入库
 * 返回写入的分块数（空文档为 0）
 */
export const ingestText = async (relPath: string, content: string): Promise<number> => {
    const chunks = chunkText(content, relPath);
    if (chunks.length === 0) return 0;

    const embeddings = await embedTexts(chunks.map((c) => c.text));
    await replaceFileChunks(
        relPath,
        chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })),
    );
    return chunks.length;
};

export type IndexedFile = {
    file: string;
    /** 分块数 */
    chunks: number;
    /** 索引文本总字符数 */
    chars: number;
};

/** 列出向量库中已索引的文件及统计 */
export const listIndexed = async (): Promise<IndexedFile[]> => {
    const result = await query(
        `SELECT file, COUNT(*)::int AS chunks, COALESCE(SUM(LENGTH(text)), 0)::int AS chars
         FROM chunks GROUP BY file ORDER BY file`,
    );
    return result.rows.map((row) => ({
        file: row.file as string,
        chunks: row.chunks as number,
        chars: row.chars as number,
    }));
};
