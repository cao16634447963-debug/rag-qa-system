import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import BookmarkModal, { type BookmarkPayload } from './BookmarkModal';

export type Category = { id: string; name: string; color: string | null; count: number };

export type Bookmark = {
    id: string;
    title: string;
    url: string;
    description: string | null;
    categoryId: string | null;
    categoryName?: string | null;
    categoryColor?: string | null;
    createdAt: string;
};

/** 书签页：左侧分类 + 右侧搜索与卡片网格 */
const BookmarksPage = () => {
    const [categories, setCategories] = useState<Category[]>([]);
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [activeCat, setActiveCat] = useState(''); // '' = 全部
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState(''); // 防抖后的搜索词
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modal, setModal] = useState<{ open: boolean; initial: Bookmark | null }>({
        open: false,
        initial: null,
    });

    // 搜索防抖 300ms
    useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const loadCategories = useCallback(async () => {
        try {
            const res = await apiFetch('/api/categories');
            if (!res.ok) throw new Error();
            const data = (await res.json()) as { categories: Category[] };
            setCategories(data.categories);
        } catch {
            setError('分类加载失败，请刷新重试');
        }
    }, []);

    const loadBookmarks = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (query) params.set('q', query);
            if (activeCat) params.set('categoryId', activeCat);
            const res = await apiFetch(`/api/bookmarks?${params.toString()}`);
            if (!res.ok) throw new Error();
            const data = (await res.json()) as { bookmarks: Bookmark[] };
            setBookmarks(data.bookmarks);
            setError('');
        } catch {
            setError('书签加载失败，请刷新重试');
        } finally {
            setLoading(false);
        }
    }, [query, activeCat]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    useEffect(() => {
        loadBookmarks();
    }, [loadBookmarks]);

    /** 新建分类（名称用输入框获取） */
    const addCategory = async () => {
        const name = window.prompt('新分类名称：');
        if (!name?.trim()) return;
        const res = await apiFetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() }),
        });
        if (!res.ok) {
            const data = (await res.json()) as { error?: string };
            window.alert(data.error ?? '创建失败');
            return;
        }
        loadCategories();
    };

    const deleteCategory = async (id: string, name: string) => {
        if (!window.confirm(`删除分类「${name}」？其下书签将变为未分类。`)) return;
        const res = await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
        if (!res.ok) return;
        if (activeCat === id) setActiveCat('');
        loadCategories();
        loadBookmarks();
    };

    /** 保存书签（新增或编辑），返回是否成功（供弹窗决定是否关闭） */
    const saveBookmark = async (payload: BookmarkPayload, id?: string): Promise<boolean> => {
        const res = await apiFetch(id ? `/api/bookmarks/${id}` : '/api/bookmarks', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, categoryId: payload.categoryId || null }),
        });
        if (!res.ok) {
            const data = (await res.json()) as { error?: string };
            window.alert(data.error ?? '保存失败');
            return false;
        }
        loadBookmarks();
        loadCategories(); // 分类计数可能变化
        return true;
    };

    const deleteBookmark = async (id: string, title: string) => {
        if (!window.confirm(`删除书签「${title}」？`)) return;
        const res = await apiFetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
        if (!res.ok) return;
        loadBookmarks();
        loadCategories();
    };

    const total = categories.reduce((n, c) => n + c.count, 0);

    return (
        <div className="bm-page">
            <aside className="bm-sidebar">
                <div className={`bm-cat ${activeCat === '' ? 'bm-cat-active' : ''}`}>
                    <button type="button" className="bm-cat-main" onClick={() => setActiveCat('')}>
                        <span className="bm-cat-name">全部</span>
                        <span className="bm-count">{total}</span>
                    </button>
                </div>
                {categories.map((c) => (
                    <div key={c.id} className={`bm-cat ${activeCat === c.id ? 'bm-cat-active' : ''}`}>
                        <button
                            type="button"
                            className="bm-cat-main"
                            onClick={() => setActiveCat(c.id)}
                        >
                            <span
                                className="bm-dot"
                                style={{ background: c.color ?? 'var(--green)' }}
                            />
                            <span className="bm-cat-name">{c.name}</span>
                            <span className="bm-count">{c.count}</span>
                        </button>
                        <button
                            type="button"
                            className="bm-cat-del"
                            title="删除分类"
                            onClick={() => deleteCategory(c.id, c.name)}
                        >
                            ×
                        </button>
                    </div>
                ))}
                <button type="button" className="bm-cat-add" onClick={addCategory}>
                    ＋ 新建分类
                </button>
            </aside>

            <div className="bm-main">
                <div className="bm-toolbar">
                    <input
                        className="bm-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索标题、链接、备注…"
                    />
                    <button
                        type="button"
                        className="bm-add"
                        onClick={() => setModal({ open: true, initial: null })}
                    >
                        ＋ 添加书签
                    </button>
                </div>

                {error && <div className="kb-error">{error}</div>}

                {loading ? (
                    <p className="bm-empty">加载中…</p>
                ) : bookmarks.length === 0 ? (
                    <p className="bm-empty">{query ? '没有匹配的书签' : '还没有书签，点击右上角添加'}</p>
                ) : (
                    <div className="bm-grid">
                        {bookmarks.map((b) => (
                            <a
                                key={b.id}
                                className="bm-card"
                                href={b.url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <div className="bm-card-head">
                                    {b.categoryName && (
                                        <span
                                            className="bm-tag"
                                            style={b.categoryColor ? { color: b.categoryColor } : undefined}
                                        >
                                            {b.categoryName}
                                        </span>
                                    )}
                                    <span className="bm-card-actions">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                setModal({ open: true, initial: b });
                                            }}
                                        >
                                            编辑
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                deleteBookmark(b.id, b.title);
                                            }}
                                        >
                                            删除
                                        </button>
                                    </span>
                                </div>
                                <div className="bm-card-title">{b.title}</div>
                                <div className="bm-card-url">{b.url}</div>
                                {b.description && <div className="bm-card-desc">{b.description}</div>}
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {modal.open && (
                <BookmarkModal
                    categories={categories}
                    initial={modal.initial}
                    onClose={() => setModal({ open: false, initial: null })}
                    onSave={saveBookmark}
                />
            )}
        </div>
    );
};

export default BookmarksPage;
