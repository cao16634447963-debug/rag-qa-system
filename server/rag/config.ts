/**
 * RAG 公共配置：Embedding 模型、分块参数、存储路径
 */

export const EMBED_MODEL = 'BAAI/bge-m3';

export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';

/** 单个分块的目标长度（字符），bge-m3 上下文 8192 token，中文 1 字 ≈ 1 token，取保守值 */
export const CHUNK_SIZE = 600;

/** 相邻分块的重叠长度（字符），避免语义在边界被切断 */
export const CHUNK_OVERLAP = 100;

/** 单次 Embedding 请求的最大文本条数（供应商批量上限内取保守值） */
export const EMBED_BATCH_SIZE = 16;

/** 向量存储文件 */
export const STORE_PATH = 'server/data/vectors.json';

/** 支持摄取的文档扩展名 */
export const DOC_EXTENSIONS = ['.txt', '.md', '.pdf'];

/** 检索返回的最大分块数 */
export const TOP_K = 4;

/** 余弦相似度阈值（未启用重排序时的兜底过滤；实测无关 ~0.44 / 相关 ~0.60） */
export const SIM_THRESHOLD = 0.5;

/** 向量召回候选数量（进入重排序池的规模） */
export const CANDIDATE_K = 20;

/** 重排序模型（SiliconFlow，提高检索精度；失败自动回退纯向量排序） */
export const RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';

/** 最新问题短于该长度且有历史对话时，先做检索改写（消除指代） */
export const REWRITE_MAX_QUERY_LENGTH = 30;
