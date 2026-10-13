/**
 * Prompt 拼装与相似度计算
 */

/** 余弦相似度：两向量方向一致性，0~1，越接近 1 语义越相似 */
export const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
};

const RAG_INSTRUCTION = `你是基于知识库的中文问答助手，回答使用 Markdown 格式。请遵守：
1. 优先依据下方【知识库片段】回答用户问题；
2. 引用知识库信息时标注来源编号，如 [来源1]；
3. 若知识库片段不足以回答，先明确说明"知识库中暂无相关内容"，再基于通用知识谨慎补充，并注明"以下为通用知识，仅供参考"；
4. 不要编造知识库中不存在的内容。

【知识库片段】`;

export const RAG_PROMPT = RAG_INSTRUCTION;

/** Agent 模式系统提示词：模型自主决定是否检索 */
export const AGENT_SYSTEM_PROMPT = `你是智能问答助手，回答使用 Markdown 格式。你可以使用 searchKnowledgeBase 工具检索用户的知识库。判断规则：
1. 只要问题可能出现在知识库文档中（技术概念、专业术语、用户资料等），就必须先调用工具检索，即使你自认为知道答案，也要检索核对并优先依据检索结果回答；
2. 只有明确的数学计算、日常闲聊这类显然与知识库无关的问题才可以直接回答；
3. 依据检索结果回答时，引用来源标注为 [来源1]、[来源2]（按检索结果顺序编号）；
4. 工具检索结果为空或与问题无关时，明确说明"知识库中暂无相关内容"，再基于通用知识谨慎补充并注明仅供参考；
5. 不要编造知识库中不存在的内容；
6. 不要输出检索过程的说明文字（如"让我搜索一下"），最终回复只包含对用户问题的回答。`;
