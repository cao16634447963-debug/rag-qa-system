import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import {
    streamText,
    convertToModelMessages,
    createUIMessageStream,
    createUIMessageStreamResponse,
    tool,
    stepCountIs,
    type UIMessage,
} from 'ai';
import { z } from 'zod';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { retrieve } from './rag/retrieve.js';
import { AGENT_SYSTEM_PROMPT } from './rag/prompt.js';
import documentsRouter from './api/documents.js';
import { auth, rateLimit } from './api/middleware.js';

/**
 * ============================================================
 * 参考注释：旧 index.js 手写 SSE 流式逻辑（阶段2 将被 AI SDK 替代）
 * ============================================================
 * 核心要点，供阶段2迁移时对照：
 *
 * 1. 响应头三件套：
 *    Content-Type: text/event-stream; charset=utf-8
 *    Cache-Control: no-cache
 *    Connection: keep-alive
 *    随后 res.flushHeaders() 立即下发，关闭缓冲保持长连接。
 *
 * 2. 消息格式：每条消息为 `data: <JSON>\n\n`，结束时发 `data: [DONE]\n\n`。
 *    AI SDK 中对应 result.toUIMessageStreamResponse()，协议自动处理。
 *
 * 3. 客户端中断处理（易踩坑）：
 *    不能监听 req 的 'close'（Node 15+ 中请求体读完就会触发），
 *    应监听 res 的 'close'，且仅当响应未正常结束时才视为客户端中断：
 *      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
 *    再把 AbortController 的 signal 传给上游 LLM 请求。
 *
 * 4. 多轮对话：前端传完整 messages 数组，服务端校验 role/content
 *    并用 slice(-MAX_TURNS) 限制条数防止 token 爆炸。
 *    AI SDK 中 useChat 自动维护 UIMessage 历史，服务端直接收 UIMessage[]。
 * ============================================================
 */

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use('/api/documents', documentsRouter);

const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

const MAX_TURNS = 20;

app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        time: new Date().toISOString(),
        env: {
            deepseek: process.env.DEEPSEEK_API_KEY ? 'configured' : 'missing',
            siliconflow: process.env.SILICONFLOW_API_KEY ? 'configured' : 'missing',
        },
    });
});

/**
 * Agent 流式聊天接口（阶段6）
 * 检索作为工具暴露给模型：由模型自主判断是否查知识库（tool 调用多步，最多 5 步）。
 * 工具命中时通过 writer 推送 data-sources（引用来源卡片）；检索/生成失败自动降级。
 */
app.post('/api/chat', auth, rateLimit(20, 60_000), async (req, res) => {
    const { messages } = req.body as { messages?: UIMessage[] };
    if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages 必须是非空数组' });
        return;
    }

    // 客户端中断时同步中断上游请求
    const abort = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) abort.abort();
    });

    const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
            const toSource = (c: { file: string; index: number; score: number; text: string }) => ({
                file: c.file,
                index: c.index,
                score: Math.round(c.score * 1000) / 1000,
                text: c.text.slice(0, 120),
            });

            const searchKnowledgeBase = tool({
                description:
                    '在用户的知识库中检索与查询相关的文档片段。当问题可能涉及用户上传的文档或私有资料时调用；通用常识、数学、闲聊不要调用。',
                inputSchema: z.object({
                    query: z.string().describe('用于向量检索的查询语句'),
                }),
                execute: async ({ query }) => {
                    // 近几轮对话文本：用于多轮检索改写（消除指代）
                    const contextText = messages
                        .slice(-6)
                        .map((m) => {
                            const text = m.parts
                                .filter((p) => p.type === 'text')
                                .map((p) => (p.type === 'text' ? p.text : ''))
                                .join('');
                            return `${m.role === 'user' ? '用户' : '助手'}：${text}`;
                        })
                        .filter((line) => line.length > 2)
                        .join('\n');

                    const chunks = await retrieve(query, contextText).catch((err: Error) => {
                        console.error('工具检索失败:', err.message);
                        return [];
                    });
                    if (chunks.length > 0) {
                        writer.write({ type: 'data-sources', data: chunks.map(toSource) });
                    }
                    return {
                        found: chunks.length,
                        chunks: chunks.map((c) => ({
                            source: `${c.file}#${c.index}`,
                            text: c.text,
                        })),
                    };
                },
            });

            const result = streamText({
                model: deepseek('deepseek-chat'),
                system: AGENT_SYSTEM_PROMPT,
                messages: await convertToModelMessages(messages.slice(-MAX_TURNS)),
                tools: { searchKnowledgeBase },
                stopWhen: stepCountIs(5),
                abortSignal: abort.signal,
            });

            writer.merge(result.toUIMessageStream());
        },
        onError: (err) => `接口调用失败：${err instanceof Error ? err.message : String(err)}`,
    });

    // createUIMessageStreamResponse 是 fetch Response，Express 下手动接管响应
    const response = createUIMessageStreamResponse({ stream: uiStream });
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
        Readable.fromWeb(response.body as NodeWebReadableStream).pipe(res);
    } else {
        res.end();
    }
});

// 生产模式：托管前端构建产物（web/dist 存在时启用，Docker 部署使用）
const WEB_DIST = join(process.cwd(), 'web', 'dist');
if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api).*/, (_req, res) => {
        res.sendFile(join(WEB_DIST, 'index.html'));
    });
    console.log('已启用前端静态托管：web/dist');
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
    console.log(`RAG 问答系统后端已启动：http://localhost:${PORT}`);
    if (!process.env.DEEPSEEK_API_KEY) {
        console.warn('警告：缺少 DEEPSEEK_API_KEY，聊天功能将不可用');
    }
    if (!process.env.SILICONFLOW_API_KEY) {
        console.warn('警告：缺少 SILICONFLOW_API_KEY，文档摄取与 RAG 检索将不可用');
    }
});
