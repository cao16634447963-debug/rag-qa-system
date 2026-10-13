# 任务计划：基于 Vercel AI SDK + TypeScript 的 RAG 问答系统

## 目标
将现有 Express + DeepSeek 项目改造为 AI Agent 开发起点：
- 后端：TypeScript + Vercel AI SDK（`ai` 包 + `@ai-sdk/deepseek`）
- RAG：文档摄取 → 分块 → Embedding → 向量检索 → 生成回答（带引用来源）
- 前端：React（Vite）+ `@ai-sdk/react` 的 `useChat`，流式渲染 + 引用展示

## 技术选型（关键决策）
| 项 | 选择 | 理由 |
|----|------|------|
| 后端框架 | Express（现有，迁移到 TS，用 tsx 运行） | 复用现有代码，降低迁移风险 |
| Chat 模型 | DeepSeek（`@ai-sdk/deepseek`，复用现有 DEEPSEEK_API_KEY） | 现有 Key 可用 |
| Embedding | SiliconFlow BAAI/bge-m3（免费额度，国内直连，需 SILICONFLOW_API_KEY）✅ 已确认 2026-10-13 | DeepSeek 不提供 Embedding API，需另选 |
| 向量存储 | 阶段1先用 JSON 文件 + 余弦相似度（零依赖理解原理）→ 后续升级 LanceDB（嵌入式，免部署） | 先跑通再升级 |
| 前端 | Vite + React + TS + `@ai-sdk/react` | AI SDK 官方 React 绑定 |
| 旧代码处理 | 阶段1完成后删除 public/ 与 index.js，其中 SSE 逻辑以参考注释形式保留在 server/index.ts ✅ 已确认 2026-10-13 | 用户确认 |

## 阶段

### 阶段1：TypeScript 化与项目结构改造 `状态: complete`
- [x] 目录改为 `server/`（后端）+ `web/`（React 前端），根目录放后端配置
- [x] 后端迁移到 TS：`tsconfig.json`（NodeNext）+ `tsx watch` 热更新 + 环境变量检查（/api/health）
- [x] 前端脚手架：Vite React TS（web/），`/api` 代理到后端 3000 端口
- [x] 旧 `public/` 与 `index.js` 已删除，SSE 逻辑以参考注释保留在 server/index.ts
- 备注：Node 已切换到 v22.20.0（Vite 7 / AI SDK v5 要求 >=20.19）；tsc 与 vite build 均通过；/api/health 实测正常

### 阶段2：用 AI SDK 重写流式聊天 `状态: complete`
- [x] 后端：`streamText()` + `createDeepSeek()`，`pipeUIMessageStreamToResponse(res)` 对接 Express，保留 MAX_TURNS 限制
- [x] 前端：`useChat()` + `DefaultChatTransport`，ChatMessage 公共组件（memo）+ react-markdown 渲染，支持停止生成与错误提示
- [x] 验证：curl 实测 /api/chat 返回标准 UI 消息流（start/text-delta/finish），DeepSeek 真实响应
- 备注：实际安装为 AI SDK v7（ai@7.x、@ai-sdk/deepseek@3.x、@ai-sdk/react@4.x），注意 convertToModelMessages 是异步需要 await

### 阶段3：文档摄取管道（Ingestion）`状态: complete`
- [x] 文档解析：支持 .txt/.md（.pdf 后续有需要再加）
- [x] 分块策略：`server/rag/chunk.ts`——段落合并 + 超长滑窗硬切，CHUNK_SIZE=600 / OVERLAP=100（config.ts 可调）
- [x] Embedding：`server/rag/embed.ts`——SiliconFlow bge-m3（@ai-sdk/openai-compatible + embedMany），批大小 16
- [x] 向量入库：`server/rag/store.ts`——JSON 存储（向量+原文+元数据），replaceFileChunks 增量去重
- [x] CLI 脚本：`npm run ingest -- ./docs`，实测通过（1 文件 → 1 块 → 1024 维，重复运行无重复数据）
- 备注：.env 的 Key 有效；曾因 ingest.ts 忘记 import 'dotenv/config' 导致 401（已修）；NodeNext 相对导入必须带 .js 扩展名

### 阶段4：向量检索 + RAG 问答接口 `状态: complete`
- [x] 检索模块 `server/rag/retrieve.ts`：query embedding → 余弦相似度（prompt.ts）→ Top-K + 阈值过滤
- [x] RAG 接口 `/api/chat`：createUIMessageStream + writer 推送 data-sources，检索结果注入 system prompt，命中失败自动降级普通对话
- [x] 引用来源（文件名、块序号、相似度、摘要）随流先于正文推送
- [x] 无命中兜底：阈值过滤后不注入上下文，走普通对话
- [x] 前端 `SourceList.tsx` 公共组件：来源卡片（墨绿边框、相似度徽标、摘要两行截断）
- 备注：SIM_THRESHOLD 实测调优 0.35→0.5（无关 ~0.44 / 相关 ~0.60）；后续可加重排序模型提升精度

### 阶段5：前端 RAG 体验 `状态: complete`
- [x] 摄取逻辑抽为 `server/rag/ingest.ts` 公共模块（CLI 与 API 复用，消除重复）
- [x] 后端 `/api/documents`：GET 列表 / POST 上传+自动摄取（文件名校验、2MB 限制、失败回滚）/ DELETE 删除（索引+源文件）
- [x] 前端标签页布局（问答 / 知识库）：聊天逻辑抽为 `ChatPage`，新增 `KnowledgePage`
- [x] 知识库页：上传区（多文件、状态提示）、已索引列表（块数/字数）、删除按钮
- [x] 引用来源卡片（阶段4 已完成的 SourceList 在聊天页生效）
- 备注：上传采用前端读文本 + JSON 提交（免 multer 依赖）；DELETE 同步清理 docs/ 源文件

### 阶段6：Agent 化与升级 `状态: complete`
- [x] `searchKnowledgeBase` 工具（zod inputSchema）：命中时 writer 推送 data-sources，返回 { found, chunks }
- [x] streamText 配置 `tools` + `stopWhen: stepCountIs(5)` 多步循环
- [x] 提示词调优：初版"通用问题不调用"导致该查不查 → 改为"不确定优先检索"策略
- [x] 前端 tool-chip：正在检索/已检索状态条；过滤工具调用前的模型前导语文本
- [x] 冒烟测试脚本 server/scripts/test-agent.ts（可复用回归）
- [ ] 向量存储升级 LanceDB（数据量增长时再做）
- [ ] 重排序模型（bge-reranker）提升检索精度（误命中增多时再做）
- 备注：DeepSeek 会在工具调用前输出英文前导语，提示词压不住，已在渲染层过滤

### 阶段7：补足竞品差距 `状态: complete`
- [x] ① 多轮检索改写：rewriteQuery（历史 ≥2 轮且问题 ≤30 字触发，generateText 改写，失败回退原查询）——实测"它的向量是多少维？"成功改写并命中
- [x] ② bge-reranker 精排：向量召回 Top-20 → SiliconFlow bge-reranker-v2-m3 精排取 Top-4；实测相关 0.999 / 无关 0.00002；失败自动回退向量排序
- [x] ③ 会话持久化：localStorage 保存 UIMessage[]，刷新恢复；"新对话"按钮清空
- [x] ④ PDF 支持：pdf-parse v2（PDFParse 类），前端 base64 上传，PDF 10MB / 文本 2MB 限制，空文本校验；CLI 摄取同样支持
- [x] ⑤ API 鉴权 + 限流：API_TOKEN 可选启用（前端 api.ts 自动带 x-api-token）；按 IP 滑动窗口限流（chat 20/min、documents 30/min）——实测 429 正常触发
- [x] ⑥ Docker：多阶段构建 Dockerfile + compose.yml（数据卷挂载 server/data 与 docs）+ 服务端静态托管 web/dist（生产模式单端口部署）——已实测：镜像构建、容器内 health/前端托管/RAG 聊天（工具+来源+引用）全部通过
- [x] 测试 PDF 已清理；test-agent.ts 扩展为三场景（单轮知识库/通用/多轮指代）
- 备注：Docker 坑——.env 值带单引号时 dotenv 会剥离而 docker --env-file 不会，导致容器内 Key 无效；已去引号修复。新增 .dockerignore 防止 .env/源码产物进镜像
- 暂缓：用户体系/知识库隔离、评测集、混合检索 BM25（需要时再做）

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
