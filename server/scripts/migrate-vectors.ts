import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { replaceFileChunks } from '../rag/store.js';
import { ensureSchema } from '../db/schema.js';

/**
 * 一次性迁移脚本：server/data/vectors.json → Postgres chunks 表
 * 直接复用 JSON 中已有的 embedding，不重新调用 embedding API
 * 运行：npm run migrate:vectors
 * 迁移后 vectors.json 保留作备份，不再被服务读写
 */

type LegacyChunk = { id: string; file: string; index: number; text: string; embedding: number[] };
type LegacyStore = { model: string; dims: number; chunks: LegacyChunk[] };

const main = async () => {
    await ensureSchema();

    const raw = await readFile('server/data/vectors.json', 'utf-8');
    const store = JSON.parse(raw) as LegacyStore;
    if (!Array.isArray(store.chunks) || store.chunks.length === 0) {
        console.log('vectors.json 为空，无需迁移');
        return;
    }
    const dims = store.chunks[0].embedding.length;
    if (dims !== 1024) {
        throw new Error(`向量维度不匹配：JSON 中为 ${dims}，chunks 表要求 1024`);
    }

    // 按文件分组，逐文件整体写入
    const byFile = new Map<string, LegacyChunk[]>();
    for (const chunk of store.chunks) {
        const list = byFile.get(chunk.file) ?? [];
        list.push(chunk);
        byFile.set(chunk.file, list);
    }

    let total = 0;
    for (const [file, chunks] of byFile) {
        await replaceFileChunks(
            file,
            chunks.map((c) => ({ id: c.id, file: c.file, index: c.index, text: c.text, embedding: c.embedding })),
        );
        total += chunks.length;
        console.log(`已迁移：${file}（${chunks.length} 块）`);
    }
    console.log(`迁移完成：${byFile.size} 个文件，共 ${total} 块`);
};

main().catch((err: Error) => {
    console.error(`迁移失败：${err.message}`);
    process.exit(1);
});
