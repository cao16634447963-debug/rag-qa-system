import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
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
import authRouter from './api/auth.js';
import bookmarksRouter from './api/bookmarks.js';
import categoriesRouter from './api/categories.js';
import chatSessionsRouter from './api/chat-sessions.js';
import { requireAuth, type AuthedRequest } from './auth/middleware.js';
import { rateLimit } from './api/middleware.js';
import { ensureSchema } from './db/schema.js';
import { runMigrations } from './db/migrate.js';
import { query } from './db/pool.js';

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
app.use(cookieParser());
app.use(express.json({ limit: '4mb' }));
// 请求日志（跳过静态文件与健康检查，避免刷屏）
app.use((req, res, next) => {
    if (!req.path.startsWith('/api') || req.path === '/api/health') return next();
    const start = Date.now();
    res.on('finish', () => {
        if (res.statusCode >= 400 || !req.path.startsWith('/api/chat')) {
            console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
        }
    });
    next();
});
app.use('/api/documents', documentsRouter);
app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/chat/sessions', chatSessionsRouter);

const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

const MAX_TURNS = 20;

/** 提取 UIMessage 的纯文本内容 */
const textOf = (m: UIMessage): string =>
    m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join('');

app.get('/api/health', async (_req, res) => {
    let db = 'up';
    try {
        await query('SELECT 1');
    } catch {
        db = 'down';
    }
    res.status(db === 'up' ? 200 : 503).json({
        ok: db === 'up',
        db,
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
app.post('/api/chat', requireAuth, rateLimit(20, 60_000), async (req, res) => {
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

    // 问答历史：客户端在首条消息前创建会话并以 x-session-id 传入，无该头则不落库
    const { userId } = req as AuthedRequest;
    const headerSessionId = req.header('x-session-id') ?? '';
    let session: { id: string } | null = null;
    if (headerSessionId) {
        const owned = await query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
            [headerSessionId, userId],
        );
        session = owned.rows[0] ?? null;
    }

    // 落库用户消息（重试场景按最后一条去重）；首条用户消息同时作为会话标题
    if (session) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const text = lastUser ? textOf(lastUser).trim() : '';
        if (text) {
            const lastRow = await query(
                'SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
                [session.id],
            );
            const prev = lastRow.rows[0] as { role: string; content: string } | undefined;
            if (!prev || prev.role !== 'user' || prev.content !== text) {
                await query(
                    'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
                    [session.id, 'user', text],
                );
                await query(
                    `UPDATE chat_sessions SET updated_at = now(),
                     title = CASE WHEN title = '新对话' THEN $2 ELSE title END
                     WHERE id = $1`,
                    [session.id, text.slice(0, 24)],
                );
            }
        }
    }

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

            // 助手回复落库（正常结束或用户中断均保存已生成的文本，并刷新会话时间戳）
            const saveAssistant = async (text: string): Promise<void> => {
                if (!session || !text.trim()) return;
                try {
                    await query(
                        'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
                        [session.id, 'assistant', text],
                    );
                    await query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [session.id]);
                } catch (err) {
                    console.error('保存问答记录失败:', err instanceof Error ? err.message : err);
                }
            };

            // tee 上游流：一路给客户端，一路累积文本；onFinish 在中断时不触发，
            // 因此独立消费支流，在流关闭（含 abort 导致的异常关闭）后落库部分文本
            const [forClient, forSave] = result.toUIMessageStream().tee();
            void (async () => {
                let assistantText = '';
                const reader = forSave.getReader();
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value?.type === 'text-delta') assistantText += value.delta;
                    }
                } catch {
                    // 中断/异常关闭：保留已累积的部分文本
                } finally {
                    await saveAssistant(assistantText);
                }
            })();

            writer.merge(forClient);
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

// 先确保数据库 schema 就绪并应用迁移，再启动 HTTP 服务
ensureSchema()
    .then(runMigrations)
    .then(() => {
        app.listen(PORT, () => {
            console.log(`RAG 问答系统后端已启动：http://localhost:${PORT}`);
            if (!process.env.DEEPSEEK_API_KEY) {
                console.warn('警告：缺少 DEEPSEEK_API_KEY，聊天功能将不可用');
            }
            if (!process.env.SILICONFLOW_API_KEY) {
                console.warn('警告：缺少 SILICONFLOW_API_KEY，文档摄取与 RAG 检索将不可用');
            }
        });
    })
    .catch((err: Error) => {
        console.error(`数据库初始化失败，服务未启动：${err.message}`);
        process.exit(1);
    });
