# 进度日志

## 会话 2026-10-13
- 已确认现有项目结构：Express 单文件 + 手写 SSE + 原生前端
- 已创建 task_plan.md / findings.md / progress.md
- 用户决策：Embedding 用 SiliconFlow bge-m3；旧代码改造完成后删除（仅保留 SSE 参考注释）

## 会话 2026-10-13（阶段1完成）
- 用户手动将 Node 切换到 v22.20.0（原 v18 不满足 Vite 7 / AI SDK v5 要求）
- 后端 TS 化：server/index.ts（含 /api/health 与旧 SSE 参考注释），根 package.json 换用 tsx，移除 openai/nodemon
- 前端脚手架：web/（Vite 7 + React 19 + TS），/api 代理到 3000
- 删除 public/index.html 与旧 index.js；.env 增加 SILICONFLOW_API_KEY 占位（当前为空，阶段3前需填写）
- 验证：tsc 与 vite build 通过；后端临时启动后 /api/health 返回 ok，deepseek=configured，siliconflow=missing
- 下一步：阶段2 用 AI SDK 重写流式聊天（需安装 ai、@ai-sdk/deepseek、@ai-sdk/react）

## 会话 2026-10-13（阶段2完成）
- 安装 ai@7.0.138、@ai-sdk/deepseek@3.0.64、@ai-sdk/react@4.0.140、react-markdown
- 服务端：POST /api/chat（streamText + pipeUIMessageStreamToResponse），旧 SSE 的要点已留作参考注释
- 前端：useChat + DefaultChatTransport，新增 ChatMessage 公共组件，聊天页样式
- 错误记录：convertToModelMessages 在 AI SDK v7 中返回 Promise，需 await（tsc 报 TS2740，已修复，1次）
- 验证：tsc 与 vite build 通过；curl 实测 /api/chat 流式返回 UI 消息流，DeepSeek 响应"测试成功"
- 下一步：阶段3 文档摄取管道（需要用户先在 .env 填入 SILICONFLOW_API_KEY）

## 会话 2026-10-13（前端美化）
- 设计方向："书房/宣纸"主题：暖纸底色 + 稿纸纹理 + 墨绿主色 + 朱砂点缀
- index.css 全量重写（设计变量、印章元素、消息入场动画、墨点输入动画、自定义滚动条、Markdown 全套样式）
- App.tsx：印章页头、空状态建议问题（点击即问）、流式自动滚动到底、印章式"发/止"按钮、页脚注
- ChatMessage.tsx：增加印章式角色标识（问/答）
- 验证：vite build 通过

## 会话 2026-10-13（阶段3完成）
- 新增依赖 @ai-sdk/openai-compatible；新增 server/rag/{config,chunk,embed,store}.ts 与 server/scripts/ingest.ts；测试文档 docs/rag-入门.md
- 错误记录：
  1. NodeNext 下相对导入缺 .js 扩展名（TS2835 ×8）→ 补全扩展名，1次修复
  2. Dirent 无 path 属性（用 e.parentPath）→ 1次修复
  3. 单文件摄取相对路径为空 → rootDir 改用 dirname，1次修复
  4. ingest 401 Unauthorized → 直接 node 调 API 验证 Key 有效（200），定位为 ingest.ts 缺 import 'dotenv/config'，1次修复
- 验证：tsc 通过；真实摄取 docs/rag-入门.md 成功（1 块，bge-m3 1024 维）；重复运行增量去重正常
- 下一步：阶段4 向量检索 + RAG 问答接口（余弦 Top-K、注入 prompt、引用来源随流返回、无命中兜底）

## 会话 2026-10-13（阶段4完成）
- 新增 server/rag/{retrieve,prompt}.ts，config 增加 TOP_K=4、SIM_THRESHOLD；server/index.ts 改用 createUIMessageStream + createUIMessageStreamResponse（Express 下手动 pipe）
- 前端新增 SourceList 公共组件，ChatMessage 渲染 data-sources 部分
- 错误记录：
  1. retrieve.ts 首次写入失败被遗漏（TS2307 找不到模块）→ 补建，1次
  2. convertToModelMessages 忘记 await（v7 异步）→ 捕获于编译前主动修复
  3. 阈值 0.35 过低：无关问题"1加1"也命中知识库（0.44）→ 实测相关问题 0.60，阈值调至 0.5，复测兜底正常
  4. PowerShell 对 curl JSON/JS 正则转义极易出错 → 改用 node -e 发请求调试
- 验证：tsc + vite build 通过；实测"什么是RAG"命中来源（0.627）且回答带 [来源1]；无关问题无来源正常回答
- 下一步：阶段5 前端 RAG 体验（知识库管理页：上传/摄取/列表；引用卡片已就绪）

## 会话 2026-10-13（阶段5完成）
- 重构：摄取核心抽为 server/rag/ingest.ts（ingestText/listIndexed），CLI 改为薄封装
- 新增 server/api/documents.ts 路由（列表/上传摄取/删除），index.ts 挂载并把 JSON body 限制提到 4mb
- 前端：App 改标签页（问答/知识库），聊天抽为 ChatPage，新增 KnowledgePage（上传/列表/删除）
- 错误记录：write_to_file 两次漏传 filePath 参数失败 → 重发即成功（工具调用问题，非代码问题）
- 验证：tsc + vite build 通过；API 实测上传→列表→删除→删除后列表全通过；CLI 回归正常；测试源文件确认已清理
- 下一步：阶段6 Agent 化（AI SDK tools + stopWhen，模型自主决定是否检索）

## 会话 2026-10-13（阶段6完成 —— 全项目收官）
- index.ts：/api/chat 改为 Agent 模式（tool + stopWhen: stepCountIs(5)），工具命中时 writer 推 data-sources
- prompt.ts：新增 AGENT_SYSTEM_PROMPT；调优过程：初版模型把"RAG"当通用概念不查库 → 改为"不确定优先检索"后正常（检索词甚至扩展成同义改写）
- ChatMessage：渲染 tool 状态条（正在/已检索知识库）；过滤 tool 前的前导语文本（DeepSeek 习惯先说 "I'll search..."，提示词压不住，渲染层解决）
- 新增 server/scripts/test-agent.ts 冒烟测试（两场景回归）
- 验证：tsc + vite build 通过；"什么是RAG"触发工具调用→来源卡片→[来源1] 引用；"1加1"不调用直接答"2"
- 全项目 6 阶段完成：TS 化 → AI SDK 流式 → 摄取管道 → 检索 RAG → 知识库管理页 → Agent 化

## 会话 2026-10-13（阶段7：补足竞品差距）
- 新增 server/rag/{rerank,parse}.ts、server/api/middleware.ts、web/src/api.ts；retrieve.ts 升级为改写→召回→精排流水线；documents/CLI 支持 PDF；index.ts 挂中间件与静态托管；Dockerfile + compose.yml
- 错误记录：
  1. pdf-parse 装到 v2.4.5（v1 的 lib 子路径 require 失效 + 无 pdf 导出）→ 改用 v2 的 PDFParse 类（getText/destroy），卸载 @types/pdf-parse，2次修复
  2. pdf-parse npm 包不含 test 目录，测试 PDF 用脚本手工生成最小 PDF
  3. Docker 引擎未运行无法实测构建（CLI 存在）→ 诚实标注待验证
- 验证：tsc/vite build 通过；三场景 Agent 测试全过（多轮指代"它的向量是多少维"改写为独立查询命中两来源）；rerank 实测相关 0.999/无关 0.00002；PDF 上传摄取成功（1块）后删除；限流 40 请求 429×36 触发正常；静态托管返回前端页面
- write_to_file 工具多次"missing filePath"故障 → 部分文件改用 node -e 写入

## 会话 2026-10-13（Docker 实测验证）
- 用户启动 Docker Desktop 后实测：镜像构建成功；容器内 health/前端托管正常，但 RAG 聊天报 AI_APICallError invalid_request_error
- 根因：.env 值带单引号，dotenv 剥离引号而 docker --env-file 保留 → 容器内 Key 无效；去引号修复
- 顺手加固：新增 .dockerignore（.env/node_modules/dist/server/data 等不进镜像）
- 复测：容器内工具调用 + 引用来源 + 带引用回答全部正常
- 本地 3000 端口被用户 dev 服务占用，容器测试用 3100:3000 映射
