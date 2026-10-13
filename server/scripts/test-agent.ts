/**
 * Agent 冒烟测试：验证知识库问题触发工具调用、通用问题不触发
 * 用法：npm run ingest 之外另开终端 → npx tsx server/scripts/test-agent.ts
 */

type TestMessage = { id: string; role: 'user' | 'assistant'; parts: { type: string; text?: string }[] };

const chat = async (label: string, history: TestMessage[]): Promise<void> => {
    const res = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
    });
    const raw = await res.text();

    const events = raw
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .filter((data) => data !== '[DONE]')
        .map((data) => JSON.parse(data) as { type: string; delta?: string; input?: unknown });

    const types = [...new Set(events.map((e) => e.type))];
    const text = events
        .filter((e) => e.type === 'text-delta')
        .map((e) => e.delta ?? '')
        .join('');

    const toolCalls = events.filter((e) => e.type.startsWith('tool-'));
    const toolInputs = toolCalls
        .map((e) => (e as { input?: { query?: string } }).input?.query)
        .filter(Boolean);
    const hasSources = events.some((e) => e.type === 'data-sources');

    console.log(`\n场景：${label}`);
    console.log(`事件类型：${types.join(', ')}`);
    if (toolInputs.length > 0) console.log(`工具检索词：${toolInputs.join(' / ')}`);
    console.log(`引用来源：${hasSources ? '有' : '无'}`);
    console.log(`正文：${text.slice(0, 200)}`);
};

const userMsg = (id: string, text: string): TestMessage => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
});

const main = async (): Promise<void> => {
    await chat('知识库问题（单轮）', [userMsg('1', '什么是 RAG？')]);
    await chat('通用问题（单轮）', [userMsg('1', '1加1等于几？只回答数字')]);
    // 多轮：第二问只有指代，必须靠检索改写才能命中
    await chat('多轮指代检索', [
        userMsg('1', '这个项目用什么 Embedding 模型？'),
        { id: '2', role: 'assistant', parts: [{ type: 'text', text: '这个项目使用 SiliconFlow 的 BAAI/bge-m3 模型生成文本向量。' }] },
        userMsg('3', '它的向量是多少维？'),
    ]);
};

main().catch((err: Error) => {
    console.error('测试失败：', err.message);
    process.exit(1);
});
