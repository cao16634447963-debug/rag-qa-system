import { CHUNK_SIZE, CHUNK_OVERLAP } from './config.js';

export type Chunk = {
    /** 唯一 ID：`${file}#${index}` */
    id: string;
    /** 来源文件（相对文档根目录） */
    file: string;
    /** 分块序号 */
    index: number;
    /** 分块文本 */
    text: string;
};

/**
 * 将文档文本分块：
 * 1. 按空行切成段落块；
 * 2. 依次合并段落，直到达到 CHUNK_SIZE；
 * 3. 超长段落按固定窗口硬切，带 CHUNK_OVERLAP 重叠。
 */
export const chunkText = (text: string, file: string): Chunk[] => {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const blocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

    const pieces: string[] = [];
    let current = '';

    const flush = () => {
        if (current.trim()) pieces.push(current.trim());
        current = '';
    };

    for (const block of blocks) {
        // 超长块：滑窗硬切（带重叠）
        if (block.length > CHUNK_SIZE) {
            flush();
            const step = CHUNK_SIZE - CHUNK_OVERLAP;
            for (let i = 0; i < block.length; i += step) {
                const piece = block.slice(i, i + CHUNK_SIZE);
                if (piece.length > CHUNK_OVERLAP || i === 0) pieces.push(piece.trim());
                if (i + CHUNK_SIZE >= block.length) break;
            }
            continue;
        }

        // 常规块：合并段落
        if (current && current.length + block.length + 2 > CHUNK_SIZE) {
            flush();
            // 携带上文尾部作为重叠上下文
            current = current.length > CHUNK_OVERLAP ? current.slice(-CHUNK_OVERLAP) : current;
        }
        current = current ? `${current}\n\n${block}` : block;
    }
    flush();

    return pieces.map((piece, i) => ({ id: `${file}#${i}`, file, index: i, text: piece }));
};
