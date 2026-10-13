import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EMBED_MODEL, STORE_PATH } from './config.js';
import type { Chunk } from './chunk.js';

export type StoredChunk = Chunk & { embedding: number[] };

export type VectorStore = {
    model: string;
    dims: number;
    updatedAt: string;
    chunks: StoredChunk[];
};

const emptyStore = (): VectorStore => ({
    model: EMBED_MODEL,
    dims: 0,
    updatedAt: new Date().toISOString(),
    chunks: [],
});

/** 读取本地向量库（不存在或损坏时返回空库） */
export const loadStore = async (path = STORE_PATH): Promise<VectorStore> => {
    try {
        const raw = await readFile(path, 'utf-8');
        const store = JSON.parse(raw) as VectorStore;
        if (!Array.isArray(store.chunks)) return emptyStore();
        return store;
    } catch {
        return emptyStore();
    }
};

/** 写回向量库文件 */
export const saveStore = async (store: VectorStore, path = STORE_PATH): Promise<void> => {
    store.updatedAt = new Date().toISOString();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(store), 'utf-8');
};

/**
 * 增量更新：替换某文件的全部分块（先删旧再写新）
 * 重复运行 ingest 不会产生重复数据
 */
export const replaceFileChunks = (
    store: VectorStore,
    file: string,
    chunks: StoredChunk[],
): void => {
    store.chunks = store.chunks.filter((c) => c.file !== file).concat(chunks);
    store.dims = chunks[0]?.embedding.length || store.dims;
};
