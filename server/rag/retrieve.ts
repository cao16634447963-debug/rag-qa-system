import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { cosine, RAG_PROMPT } from './prompt.js';
import { loadStore } from './store.js';
import { embedTexts } from './embed.js';
import { rerank } from './rerank.js';
import { TOP_K, SIM_THRESHOLD, CANDIDATE_K, REWRITE_MAX_QUERY_LENGTH } from './config.js';

const rewriteModel = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

export type RetrievedChunk = {
    file: string;
    index: number;
    text: string;
    /** 重排序相关性分（0~1）或回退时的余弦相似度 */
    score: number;
};

/**
 * 多轮检索改写：把带指代的最新问题（"它的原理呢？"）改写为独立查询
 * 仅在有多轮历史且问题较短时触发；失败回退原查询
 */
const rewriteQuery = async (query: string, contextText?: string): Promise<string> => {
    if (!contextText?.trim() || query.length > REWRITE_MAX_QUERY_LENGTH) return query;
    try {
        const { text } = await generateText({
            model: rewriteModel('deepseek-chat'),
            system:
                '把用户带指代的最新问题改写为独立、完整、可直接用于向量检索的查询。只输出改写后的查询本身，不要解释；若无需改写则原样输出。',
            prompt: `对话历史：\n${contextText}\n\n最新问题：${query}`,
            maxOutputTokens: 100,
        });
        return text.trim() || query;
    } catch (err) {
        console.error('检索改写失败，使用原查询:', err instanceof Error ? err.message : err);
        return query;
    }
};

/**
 * 检索流水线：改写 → 向量召回 Top-20 → 重排序取 Top-4
 * rerank 失败时回退：向量排序 + SIM_THRESHOLD 过滤
 * @param query 最新问题
 * @param contextText 近几轮对话文本（用于多轮改写，可选）
 */
export const retrieve = async (query: string, contextText?: string): Promise<RetrievedChunk[]> => {
    if (!query.trim()) return [];

    const store = await loadStore();
    if (store.chunks.length === 0) return [];

    const finalQuery = await rewriteQuery(query, contextText);
    const [queryEmbedding] = await embedTexts([finalQuery]);

    // 向量召回候选池
    const candidates = store.chunks
        .map((c) => ({
            file: c.file,
            index: c.index,
            text: c.text,
            cosine: cosine(queryEmbedding, c.embedding),
        }))
        .sort((a, b) => b.cosine - a.cosine)
        .slice(0, CANDIDATE_K);

    // 重排序精排
    const reranked = await rerank(finalQuery, candidates.map((c) => c.text));
    if (reranked) {
        return reranked.map((r) => ({
            file: candidates[r.index].file,
            index: candidates[r.index].index,
            text: candidates[r.index].text,
            score: r.score,
        }));
    }

    // 回退：向量排序 + 阈值过滤
    return candidates
        .filter((c) => c.cosine >= SIM_THRESHOLD)
        .slice(0, TOP_K)
        .map((c) => ({ file: c.file, index: c.index, text: c.text, score: c.cosine }));
};

/** 拼装带知识库上下文的 system prompt */
export const buildRagSystem = (chunks: RetrievedChunk[]): string =>
    RAG_PROMPT +
    chunks
        .map((c, i) => `\n[${i + 1}]（来源：${c.file}#${c.index}）\n${c.text}`)
        .join('\n');
