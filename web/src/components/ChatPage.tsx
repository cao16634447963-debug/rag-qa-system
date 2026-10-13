import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import ChatMessage from './ChatMessage';
import { apiHeaders } from '../api';

const transport = new DefaultChatTransport({ api: '/api/chat', headers: apiHeaders() });

// 会话持久化：localStorage 保存对话，刷新不丢
const STORAGE_KEY = 'rag-chat-messages';

const loadStoredMessages = (): UIMessage[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as UIMessage[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const SUGGESTIONS = [
    '什么是 RAG？用通俗的例子解释',
    '一句话说明向量检索的原理',
    '帮我写一段 TypeScript 快速排序',
];

/** 距底部多少像素以内视为"贴底"，此时流式输出自动跟随 */
const STICK_THRESHOLD = 80;

/** 距底部超过该距离时显示"回到底部"按钮 */
const JUMP_THRESHOLD = 240;

/** 聊天页：流式问答 + 引用来源展示 */
const ChatPage = () => {
    const { messages, sendMessage, status, stop, error, setMessages } = useChat({
        transport,
        messages: loadStoredMessages(),
    });
    const [input, setInput] = useState('');
    const [showJump, setShowJump] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    // 用户是否贴底：贴底才自动跟随，上翻查看历史时不打扰
    const stickRef = useRef(true);

    const isLoading = status === 'submitted' || status === 'streaming';

    // 会话持久化
    useEffect(() => {
        if (messages.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
        }
    }, [messages]);

    const handleNewChat = () => {
        setMessages([]);
        localStorage.removeItem(STORAGE_KEY);
        stickRef.current = true;
    };

    // 用户滚动时更新贴底状态与回底按钮显隐
    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickRef.current = dist < STICK_THRESHOLD;
        setShowJump(dist > JUMP_THRESHOLD);
    }, []);

    const scrollToBottom = useCallback((force = false) => {
        const el = scrollRef.current;
        if (!el || (!force && !stickRef.current)) return;
        stickRef.current = true;
        el.scrollTop = el.scrollHeight;
    }, []);

    // 流式更新时：仅贴底状态跟随
    useEffect(() => {
        scrollToBottom();
    }, [messages, status, scrollToBottom]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || isLoading) return;
        sendMessage({ text });
        setInput('');
        // 发送新消息后强制吸底
        scrollToBottom(true);
    };

    return (
        <>
            <div className="chat-area">
                {messages.length > 0 && (
                    <button type="button" className="new-chat-btn" onClick={handleNewChat} title="清空当前对话">
                        新对话
                    </button>
                )}
                <section className="chat-window" ref={scrollRef} onScroll={handleScroll}>
                    {messages.length === 0 && !isLoading && (
                        <div className="chat-empty">
                            <div className="empty-mark">“</div>
                            <p className="empty-title">有问必答</p>
                            <p className="empty-sub">先随便问点什么，回答会逐字流出。</p>
                            <div className="chips">
                                {SUGGESTIONS.map((s) => (
                                    <button key={s} type="button" onClick={() => sendMessage({ text: s })}>
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {messages.map((m) => (
                        <ChatMessage key={m.id} message={m} />
                    ))}
                    {isLoading && messages[messages.length - 1]?.role === 'user' && (
                        <div className="chat-typing" aria-label="正在输入">
                            <span className="dot" />
                            <span className="dot" />
                            <span className="dot" />
                        </div>
                    )}
                </section>

                {showJump && (
                    <button
                        type="button"
                        className="jump-btn"
                        onClick={() => scrollToBottom(true)}
                        title="回到底部"
                    >
                        ↓
                    </button>
                )}
            </div>

            {error && <p className="chat-error">出错了：{error.message}</p>}

            <form className="chat-form" onSubmit={handleSubmit}>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="输入你的问题…"
                    autoFocus
                />
                {isLoading ? (
                    <button type="button" onClick={stop} className="btn-stop" title="停止生成">
                        止
                    </button>
                ) : (
                    <button type="submit" className="btn-send" disabled={!input.trim()} title="发送">
                        发
                    </button>
                )}
            </form>
        </>
    );
};

export default ChatPage;
