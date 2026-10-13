import 'dotenv/config';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, resolve, dirname } from 'node:path';
import { ingestText, listIndexed } from '../rag/ingest.js';
import { extractPdfText } from '../rag/parse.js';
import { DOC_EXTENSIONS, STORE_PATH } from '../rag/config.js';

/**
 * 文档摄取 CLI：
 *   npm run ingest                # 默认摄取 ./docs
 *   npm run ingest -- ./my-docs   # 指定目录或单个文件
 * 支持增量：同一文件重复摄取会先删旧分块再写入，不会重复。
 */

const collectFiles = async (target: string): Promise<string[]> => {
    const info = await stat(target);
    if (info.isFile()) return [target];

    const entries = await readdir(target, { recursive: true, withFileTypes: true });
    return entries
        .filter((e) => e.isFile() && DOC_EXTENSIONS.includes(extname(e.name).toLowerCase()))
        .map((e) => join(e.parentPath, e.name));
};

const main = async () => {
    const targetArg = process.argv[2] ?? './docs';
    const target = resolve(targetArg);

    const files = await collectFiles(target);
    if (files.length === 0) {
        console.error(`未找到可摄取的文档（支持 ${DOC_EXTENSIONS.join(' / ')}）：${target}`);
        process.exit(1);
    }

    const rootDir = files.length === 1 ? dirname(files[0]) : target;
    let totalChunks = 0;

    for (const filePath of files) {
        const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
        console.log(`摄取：${relPath}`);

        const buffer = await readFile(filePath);
        const text =
            extname(filePath).toLowerCase() === '.pdf'
                ? await extractPdfText(buffer)
                : buffer.toString('utf-8');
        const chunks = await ingestText(relPath, text);
        if (chunks === 0) {
            console.log('  空文档，跳过');
            continue;
        }
        totalChunks += chunks;
        console.log(`  ${chunks} 块完成`);
    }

    const all = await listIndexed(STORE_PATH);
    console.log(`\n完成：本次摄取 ${totalChunks} 个分块`);
    console.log(`向量库：${STORE_PATH}（已索引 ${all.length} 个文件，共 ${all.reduce((n, f) => n + f.chunks, 0)} 块）`);
};

main().catch((err: Error) => {
    console.error(`摄取失败：${err.message}`);
    process.exit(1);
});
