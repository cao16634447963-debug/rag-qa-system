# 研究发现

## 现有项目状况（2026-10-13 确认）
- `package.json`：ESM（"type": "module"），依赖 express ^5.3.0、openai ^7.32.0、dotenv、nodemon
- `index.js`：单文件 Express 服务，已实现手写 SSE 流式接口 `POST /api/chat/stream`
  - DeepSeek 通过 openai SDK + baseURL 调用，支持多轮 history（最多 20 轮）
  - 无 Key 时回退模拟流；监听 `res.close` 处理客户端中断
- `public/`：托管的原生前端静态页面
- 无 TypeScript、无构建工具、无测试

## 关键事实
- DeepSeek 官方 API 不提供 Embedding 接口 → RAG 的 embedding 需另选供应商
  - 候选：SiliconFlow（BAAI/bge-m3，有免费额度，国内可用）
  - 候选：阿里 DashScope text-embedding-v4（OpenAI 兼容接口）
  - 候选：本地 Ollama（bge-m3 / nomic-embed-text，零成本但要装 Ollama）
- Vercel AI SDK v5 核心 API：
  - 服务端：`streamText({ model, messages, tools })` → `result.toUIMessageStreamResponse()`
  - 客户端：`useChat({ transport })`，消息类型为 `UIMessage`
  - Provider：`@ai-sdk/deepseek` 官方包；Embedding 走 `embed()/embedMany()` + `@ai-sdk/openai-compatible`
  - Agent 多步：`stopWhen: stepCountIs(N)` + tools
