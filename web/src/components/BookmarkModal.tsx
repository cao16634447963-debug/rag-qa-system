import { useState } from 'react';
import type { Bookmark, Category } from './BookmarksPage';

type Props = {
    categories: Category[];
    /** 编辑目标；null 表示新增 */
    initial: Bookmark | null;
    onClose: () => void;
    onSave: (payload: BookmarkPayload, id?: string) => Promise<boolean>;
};

export type BookmarkPayload = {
    title: string;
    url: string;
    description: string;
    categoryId: string;
};

/** 书签新增 / 编辑弹窗 */
const BookmarkModal = ({ categories, initial, onClose, onSave }: Props) => {
    const [title, setTitle] = useState(initial?.title ?? '');
    const [url, setUrl] = useState(initial?.url ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        const ok = await onSave(
            { title: title.trim(), url: url.trim(), description: description.trim(), categoryId },
            initial?.id,
        );
        setBusy(false);
        if (!ok) onClose();
    };

    return (
        <div className="bm-overlay" onClick={onClose}>
            <div className="bm-modal" onClick={(e) => e.stopPropagation()}>
                <h3 className="bm-modal-title">{initial ? '编辑书签' : '添加书签'}</h3>
                <form className="bm-form" onSubmit={submit}>
                    <label>
                        标题
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="书签名称"
                            required
                            maxLength={120}
                            autoFocus
                        />
                    </label>
                    <label>
                        链接
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://…"
                            required
                        />
                    </label>
                    <label>
                        分类
                        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                            <option value="">未分类</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        备注
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="可选：记录这个书签的用途"
                            rows={3}
                            maxLength={500}
                        />
                    </label>
                    {error && <div className="kb-error">{error}</div>}
                    <div className="bm-form-actions">
                        <button type="button" className="bm-cancel" onClick={onClose}>
                            取消
                        </button>
                        <button type="submit" className="bm-save" disabled={busy}>
                            {busy ? '保存中…' : '保存'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BookmarkModal;
