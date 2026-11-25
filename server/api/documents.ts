import { Router } from 'express';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { ingestText, listIndexed } from '../rag/ingest.js';
import { deleteFileChunks } from '../rag/store.js';
import { extractPdfText } from '../rag/parse.js';
import { DOC_EXTENSIONS } from '../rag/config.js';
import { requireAuth } from '../auth/middleware.js';
import { rateLimit } from './middleware.js';

/**
 * 知识库文档管理 API
 * GET    /api/documents        已索引文件列表
 * POST   /api/documents        上传并摄取（JSON: { filename, content, encoding? }）
 * DELETE /api/documents/:name  删除文档（移除索引与源文件）
 * PDF 走 base64 编码上传，纯文本走 utf8（默认）
 */

// 源文件目录：可用 DOCS_DIR 覆盖（只读文件系统环境如容器/云部署写 /tmp）
const DOCS_DIR = process.env.DOCS_DIR || 'docs';
/** 上传大小上限：纯文本 2MB，PDF 10MB */
const MAX_TEXT_LENGTH = 2_000_000;
const MAX_PDF_LENGTH = 10_000_000;

/** 确保源文件目录存在（目录可能随环境变化或被清理） */
const ensureDocsDir = async (): Promise<void> => {
    await mkdir(DOCS_DIR, { recursive: true });
};

const router = Router();
router.use(requireAuth, rateLimit(30, 60_000));

router.get('/', async (_req, res) => {
    res.json({ files: await listIndexed() });
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

    await ensureDocsDir();
    await writeFile(join(DOCS_DIR, safeName), fileData);
    try {
        const chunks = await ingestText(safeName, text);
        res.json({ ok: true, file: safeName, chunks });
    } catch (err) {
        // 摄取失败：回滚源文件
        await unlink(join(DOCS_DIR, safeName)).catch((e: unknown) =>
            console.error('摄取失败后清理源文件出错:', e instanceof Error ? e.message : e),
        );
        res.status(500).json({ error: `摄取失败：${err instanceof Error ? err.message : String(err)}` });
    }
});

router.delete('/:name', async (req, res) => {
    const name = basename(decodeURIComponent(req.params.name));

    const removed = await deleteFileChunks(name);
    if (removed === 0) {
        res.status(404).json({ error: `知识库中不存在：${name}` });
        return;
    }

    // 同步删除源文件（不存在则忽略，其他错误记录日志便于发现磁盘残留）
    await unlink(join(DOCS_DIR, name)).catch((e: unknown) => {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
            console.error(`删除源文件失败 ${name}:`, e instanceof Error ? e.message : e);
        }
    });
    res.json({ ok: true, file: name, removedChunks: removed });
});

export default router;
