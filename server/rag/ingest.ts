import { chunkText } from './chunk.js';
import { embedTexts } from './embed.js';
import { loadStore, saveStore, replaceFileChunks } from './store.js';
import { STORE_PATH } from './config.js';

/**
 * 摄取核心逻辑（CLI 与 HTTP API 共用）：
 * 分块 → 向量化 → 按文件增量替换入库
 * 返回写入的分块数（空文档为 0）
 */
export const ingestText = async (relPath: string, content: string): Promise<number> => {
    const chunks = chunkText(content, relPath);
    if (chunks.length === 0) return 0;

    const embeddings = await embedTexts(chunks.map((c) => c.text));
    const store = await loadStore(STORE_PATH);
    replaceFileChunks(
        store,
        relPath,
        chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })),
    );
    await saveStore(store, STORE_PATH);
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
export const listIndexed = async (path = STORE_PATH): Promise<IndexedFile[]> => {
    const store = await loadStore(path);
    const map = new Map<string, IndexedFile>();
    for (const c of store.chunks) {
        const entry = map.get(c.file) ?? { file: c.file, chunks: 0, chars: 0 };
        entry.chunks += 1;
        entry.chars += c.text.length;
        map.set(c.file, entry);
    }
    return [...map.values()];
};
