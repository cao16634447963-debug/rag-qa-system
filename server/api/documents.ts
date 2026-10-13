import { Router } from 'express';
import { writeFile, unlink } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { ingestText, listIndexed } from '../rag/ingest.js';
import { loadStore, saveStore, replaceFileChunks } from '../rag/store.js';
import { extractPdfText } from '../rag/parse.js';
import { DOC_EXTENSIONS, STORE_PATH } from '../rag/config.js';
import { auth, rateLimit } from './middleware.js';

/**
 * 知识库文档管理 API
 * GET    /api/documents        已索引文件列表
 * POST   /api/documents        上传并摄取（JSON: { filename, content, encoding? }）
 * DELETE /api/documents/:name  删除文档（移除索引与源文件）
 * PDF 走 base64 编码上传，纯文本走 utf8（默认）
 */

const DOCS_DIR = 'docs';
/** 上传大小上限：纯文本 2MB，PDF 10MB */
const MAX_TEXT_LENGTH = 2_000_000;
const MAX_PDF_LENGTH = 10_000_000;

const router = Router();
router.use(auth, rateLimit(30, 60_000));

router.get('/', async (_req, res) => {
    res.json({ files: await listIndexed(STORE_PATH) });
});

router.post('/', async (req, res) => {
    const { filename, content, encoding } = req.body as {
        filename?: string;
        content?: string;
        encoding?: 'utf8' | 'base64';
    };

    if (typeof filename !== 'string' || typeof content !== 'string' || !filename.trim()) {
        res.status(400).json({ error: '需要提供 filename 和 content' });
        return;
    }
    if (content.length === 0) {
        res.status(400).json({ error: '文档内容为空' });
        return;
    }
    // 只保留文件名，拒绝路径穿越；扩展名白名单
    const safeName = basename(filename);
    const ext = extname(safeName).toLowerCase();
    if (!DOC_EXTENSIONS.includes(ext)) {
        res.status(400).json({ error: `仅支持 ${DOC_EXTENSIONS.join(' / ')} 格式` });
        return;
    }

    const isPdf = ext === '.pdf';
    if (!isPdf && content.length > MAX_TEXT_LENGTH) {
        res.status(413).json({ error: '文档过大（纯文本上限 2MB）' });
        return;
    }
    if (isPdf && encoding !== 'base64') {
        res.status(400).json({ error: 'PDF 需以 base64 编码上传' });
        return;
    }
    if (encoding === 'base64' && Buffer.from(content, 'base64').length > MAX_PDF_LENGTH) {
        res.status(413).json({ error: '文档过大（PDF 上限 10MB）' });
        return;
    }

    // 提取待摄取文本与写入磁盘的数据
    let text: string;
    let fileData: string | Buffer = content;
    if (isPdf) {
        try {
            text = await extractPdfText(Buffer.from(content, 'base64'));
        } catch (err) {
            res.status(400).json({
                error: `PDF 解析失败：${err instanceof Error ? err.message : String(err)}`,
            });
            return;
        }
        fileData = Buffer.from(content, 'base64');
    } else {
        text = content;
    }

    if (!text.trim()) {
        res.status(400).json({ error: '未能从文档中提取到文本（可能是扫描件/空文档）' });
        return;
    }

    await writeFile(join(DOCS_DIR, safeName), fileData);
    try {
        const chunks = await ingestText(safeName, text);
        res.json({ ok: true, file: safeName, chunks });
    } catch (err) {
        // 摄取失败：回滚源文件
        await unlink(join(DOCS_DIR, safeName)).catch(() => {});
        res.status(500).json({ error: `摄取失败：${err instanceof Error ? err.message : String(err)}` });
    }
});

router.delete('/:name', async (req, res) => {
    const name = basename(decodeURIComponent(req.params.name));

    const store = await loadStore(STORE_PATH);
    const before = store.chunks.length;
    replaceFileChunks(store, name, []);
    await saveStore(store, STORE_PATH);

    const removed = before - store.chunks.length;
    if (removed === 0) {
        res.status(404).json({ error: `知识库中不存在：${name}` });
        return;
    }

    // 同步删除源文件（不存在则忽略）
    await unlink(join(DOCS_DIR, name)).catch(() => {});
    res.json({ ok: true, file: name, removedChunks: removed });
});

export default router;
