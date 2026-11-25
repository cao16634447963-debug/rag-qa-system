import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ChatMessage from './ChatMessage';
import { apiFetch } from '../api';

// headers 用函数形式：每次请求动态携带当前会话 id（登录态由 Cookie 自动承载）
let currentSessionId: string | null = null;
const transport = new DefaultChatTransport({
    api: '/api/chat',
    credentials: 'same-origin',
    headers: (): Record<string, string> =>
        currentSessionId ? { 'x-session-id': currentSessionId } : {},
});

type ChatSession = { id: string; title: string; updatedAt: string };

/** 会话时间的友好显示：当天内的相对时间，跨天显示日期 */
const formatSessionTime = (iso: string): string => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '';
    const now = new Date();
    const diff = now.getTime() - t.getTime();
    const minute = 60_000;
    if (diff < minute) return '刚刚';
    if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
    const sameDay = t.toDateString() === now.toDateString();
    if (sameDay) {
        return `今天 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (t.toDateString() === yesterday.toDateString()) {
        return `昨天 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    }
    const y = t.getFullYear() === now.getFullYear() ? '' : `${t.getFullYear()}年`;
    return `${y}${t.getMonth() + 1}月${t.getDate()}日`;
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

/** 聊天页：左侧历史会话列表 + 右侧流式问答（会话持久化在 Postgres） */
const ChatPage = () => {
    const { messages, sendMessage, status, stop, error, setMessages } = useChat({ transport });
    const [input, setInput] = useState('');
    const [showJump, setShowJump] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    // 用户是否贴底：贴底才自动跟随，上翻查看历史时不打扰
    const stickRef = useRef(true);

    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    // 会话重命名：editingId 为当前编辑中的会话
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');

    const isLoading = status === 'submitted' || status === 'streaming';

    /** 拉取会话列表；offset=0 时整体刷新，否则追加（加载更多） */
    const fetchSessions = useCallback(async (offset: number) => {
        const res = await apiFetch(`/api/chat/sessions?offset=${offset}`);
        if (!res.ok) return null;
        const data = (await res.json()) as { sessions: ChatSession[]; hasMore: boolean };
        setHasMore(data.hasMore);
        setSessions((prev) => (offset === 0 ? data.sessions : [...prev, ...data.sessions]));
        return data.sessions;
    }, []);

    const refreshSessions = useCallback(() => fetchSessions(0), [fetchSessions]);

    const loadMoreSessions = () => fetchSessions(sessions.length);

    /** 打开某个历史会话：中止进行中的流，拉取消息回填 */
    const openSession = useCallback(
        async (id: string) => {
            stop();
            const res = await apiFetch(`/api/chat/sessions/${id}/messages`);
            if (!res.ok) return;
            const data = (await res.json()) as {
                messages: { role: 'user' | 'assistant'; content: string }[];
            };
            setActiveId(id);
            currentSessionId = id;
            setMessages(
                data.messages.map((m, i) => ({
                    id: `${id}-${i}`,
                    role: m.role,
                    parts: [{ type: 'text' as const, text: m.content }],
                })),
            );
            stickRef.current = true;
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        },
        [stop, setMessages],
    );

    // 首次进入：加载会话列表并自动打开最近一个会话
    useEffect(() => {
        (async () => {
            const list = await refreshSessions();
            if (list && list.length > 0) openSession(list[0].id);
        })();
        // 仅首次挂载执行
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 回复生成结束后刷新会话列表（标题/排序可能变化）
    const prevStatus = useRef(status);
    useEffect(() => {
        if (prevStatus.current === 'streaming' && status === 'ready') {
            refreshSessions();
        }
        prevStatus.current = status;
    }, [status, refreshSessions]);

    const handleNewChat = () => {
        stop();
        setActiveId(null);
        currentSessionId = null;
        setMessages([]);
        stickRef.current = true;
    };

    const startRename = (s: ChatSession, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(s.id);
        setEditTitle(s.title);
    };

    const commitRename = async () => {
        const id = editingId;
        if (!id) return;
        const title = editTitle.trim();
        setEditingId(null);
        if (!title) return;
        const res = await apiFetch(`/api/chat/sessions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { session: ChatSession };
        setSessions((prev) => prev.map((s) => (s.id === data.session.id ? data.session : s)));
    };

    const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('删除该会话及其全部消息？')) return;
        const res = await apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
        if (!res.ok) return;
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeId === id) {
            setActiveId(null);
            currentSessionId = null;
            setMessages([]);
        }
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

    /** 发送前确保会话存在：首条消息先创建会话，后续消息通过 transport 头携带会话 id */
    const send = async (text: string) => {
        if (!text || isLoading) return;
        if (!activeId) {
            const res = await apiFetch('/api/chat/sessions', { method: 'POST' });
            if (res.ok) {
                const data = (await res.json()) as { session: ChatSession };
                setActiveId(data.session.id);
                currentSessionId = data.session.id;
                setSessions((prev) => [data.session, ...prev]);
            }
        }
        sendMessage({ text });
        // 发送新消息后强制吸底
        scrollToBottom(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || isLoading) return;
        setInput('');
        await send(text);
    };

    return (
        <div className="chat-layout">
            <aside className="chat-sidebar">
                <button type="button" className="chat-new-btn" onClick={handleNewChat} title="开启新对话">
                    ＋ 开启新对话
                </button>
                <div className="chat-side-list">
                    {sessions.length === 0 && <p className="chat-side-empty">还没有对话记录</p>}
                    {sessions.map((s) => (
                        <div
                            key={s.id}
                            className={`chat-side-item ${activeId === s.id ? 'chat-side-active' : ''}`}
                            onClick={() => openSession(s.id)}
                        >
                            <div className="chat-side-info">
                                {editingId === s.id ? (
                                    <input
                                        className="chat-side-edit"
                                        value={editTitle}
                                        autoFocus
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        onBlur={commitRename}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') commitRename();
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                    />
                                ) : (
                                    <>
                                        <span className="chat-side-title">{s.title}</span>
                                        <span className="chat-side-time">{formatSessionTime(s.updatedAt)}</span>
                                    </>
                                )}
                            </div>
                            {editingId !== s.id && (
                                <>
                                    <button
                                        type="button"
                                        className="chat-side-del"
                                        onClick={(e) => startRename(s, e)}
                                        title="重命名"
                                    >
                                        ✎
                                    </button>
                                    <button
                                        type="button"
                                        className="chat-side-del"
                                        onClick={(e) => handleDeleteSession(s.id, e)}
                                        title="删除会话"
                                    >
                                        ×
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                    {hasMore && (
                        <button type="button" className="chat-load-more" onClick={loadMoreSessions}>
                            加载更多
                        </button>
                    )}
                </div>
            </aside>

            <div className="chat-main">
                <div className="chat-area">
                    <section className="chat-window" ref={scrollRef} onScroll={handleScroll}>
                        {messages.length === 0 && !isLoading && (
                            <div className="chat-empty">
                                <div className="empty-mark">“</div>
                                <p className="empty-title">有问必答</p>
                                <p className="empty-sub">先随便问点什么，回答会逐字流出。</p>
                                <div className="chips">
                                    {SUGGESTIONS.map((s) => (
                                        <button key={s} type="button" onClick={() => send(s)}>
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
                            ↑
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};

export default ChatPage;
