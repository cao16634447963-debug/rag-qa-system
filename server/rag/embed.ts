import { embedMany } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { EMBED_MODEL, EMBED_BATCH_SIZE, SILICONFLOW_BASE_URL } from './config.js';

const siliconflow = createOpenAICompatible({
    name: 'siliconflow',
    baseURL: SILICONFLOW_BASE_URL,
    apiKey: process.env.SILICONFLOW_API_KEY,
});

/**
 * 批量生成文本向量（bge-m3，1024 维）
 * 分批请求，避免超出供应商单次条数限制
 */
export const embedTexts = async (values: string[]): Promise<number[][]> => {
    if (values.length === 0) return [];

    const embeddings: number[][] = [];
    for (let i = 0; i < values.length; i += EMBED_BATCH_SIZE) {
        const batch = values.slice(i, i + EMBED_BATCH_SIZE);
        const { embeddings: batchEmbeddings } = await embedMany({
            model: siliconflow.textEmbeddingModel(EMBED_MODEL),
            values: batch,
        });
        embeddings.push(...batchEmbeddings);
        if (i + EMBED_BATCH_SIZE < values.length) {
            console.log(`  已向量化 ${Math.min(i + EMBED_BATCH_SIZE, values.length)}/${values.length} 块`);
        }
    }
    return embeddings;
};
