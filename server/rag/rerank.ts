import { RERANK_MODEL, SILICONFLOW_BASE_URL, TOP_K } from './config.js';

export type RerankResult = { index: number; score: number };

/**
 * 重排序：用 bge-reranker 对向量召回的候选精排
 * 失败或未配置时返回 null，调用方回退向量排序
 */
export const rerank = async (
    query: string,
    documents: string[],
): Promise<RerankResult[] | null> => {
    if (!process.env.SILICONFLOW_API_KEY || documents.length === 0) return null;

    try {
        const res = await fetch(`${SILICONFLOW_BASE_URL}/rerank`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: RERANK_MODEL, query, documents, top_k: TOP_K }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as {
            results?: { index: number; relevance_score: number }[];
        };
        if (!data.results?.length) return null;

        return data.results.map((r) => ({ index: r.index, score: r.relevance_score }));
    } catch (err) {
        console.error('重排序失败，回退向量排序:', err instanceof Error ? err.message : err);
        return null;
    }
};
