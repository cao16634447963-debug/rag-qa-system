import { PDFParse } from 'pdf-parse';

/**
 * 从 PDF 提取纯文本（pdf-parse v2 API）
 */
export const extractPdfText = async (buffer: Buffer): Promise<string> => {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        const result = await parser.getText();
        return result.text;
    } finally {
        await parser.destroy();
    }
};
