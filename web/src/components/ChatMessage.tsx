import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { UIMessage } from 'ai';
import SourceList, { type Source } from './SourceList';

/**
 * 单条聊天消息：遍历 UIMessage.parts 渲染
 * - data-sources：RAG 引用来源卡片
 * - text：文本部分（Markdown）
 */
const ChatMessage = memo(({ message }: { message: UIMessage }) => {
    const isUser = message.role === 'user';

    // 工具调用前的文本是模型检索前导语（如 "I'll search..."），不渲染
    const firstToolIndex = message.parts.findIndex((p) =>
        p.type.startsWith('tool-'),
    );

    return (
        <div className={`msg ${isUser ? 'msg-user' : 'msg-assistant'}`}>
            <div className="msg-meta">
                <span className={`msg-seal ${isUser ? 'seal-user' : 'seal-ai'}`}>
                    {isUser ? '问' : '答'}
                </span>
                <span className="msg-role">{isUser ? '你' : '助手'}</span>
            </div>
            <div className="msg-body">
                {message.parts.map((part, i) => {
                    if (part.type === 'data-sources') {
                        return <SourceList key={i} sources={part.data as Source[]} />;
                    }
                    // 工具调用状态：渲染为检索状态条
                    if (part.type.startsWith('tool-')) {
                        const toolPart = part as {
                            state?: string;
                            input?: { query?: string };
                        };
                        const done = toolPart.state === 'output-available';
                        return (
                            <div
                                key={i}
                                className={`tool-chip ${done ? 'tool-done' : 'tool-running'}`}
                            >
                                {done ? '已检索知识库' : '正在检索知识库'}
                                {toolPart.input?.query ? `：${toolPart.input.query}` : ''}
                            </div>
                        );
                    }
                    if (part.type === 'text') {
                        if (firstToolIndex >= 0 && i < firstToolIndex) return null;
                        return isUser ? (
                            <p key={i} className="msg-text">{part.text}</p>
                        ) : (
                            <ReactMarkdown key={i}>{part.text}</ReactMarkdown>
                        );
                    }
                    return null;
                })}
            </div>
        </div>
    );
});

ChatMessage.displayName = 'ChatMessage';

export default ChatMessage;
