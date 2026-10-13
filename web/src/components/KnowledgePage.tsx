import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';

/** 文件读取为 base64（PDF 上传用） */
const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
    });

type IndexedFile = {
    file: string;
    chunks: number;
    chars: number;
};

/**
 * 知识库管理页：上传文档（自动摄取）、查看已索引列表、删除
 */
const KnowledgePage = () => {
    const [files, setFiles] = useState<IndexedFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/documents');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as { files: IndexedFile[] };
            setFiles(data.files);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleUpload = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        setBusy(true);
        setMessage(null);
        setError(null);

        for (const file of Array.from(fileList)) {
            try {
                const isPdf = file.name.toLowerCase().endsWith('.pdf');
                const content = isPdf ? await readAsBase64(file) : await file.text();
                const res = await apiFetch('/api/documents', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: file.name,
                        content,
                        ...(isPdf ? { encoding: 'base64' } : {}),
                    }),
                });
                const data = (await res.json()) as { ok?: boolean; chunks?: number; error?: string };
                if (!res.ok || !data.ok) {
                    setError(`${file.name}：${data.error ?? `HTTP ${res.status}`}`);
                } else {
                    setMessage(`${file.name} 已入库（${data.chunks} 块）`);
                }
            } catch (err) {
                setError(`${file.name}：${err instanceof Error ? err.message : '上传失败'}`);
            }
        }
        setBusy(false);
        await refresh();
    };

    const handleDelete = async (name: string) => {
        setBusy(true);
        setMessage(null);
        setError(null);
        try {
            const res = await apiFetch(`/api/documents/${encodeURIComponent(name)}`, { method: 'DELETE' });
            const data = (await res.json()) as { ok?: boolean; error?: string };
            if (!res.ok || !data.ok) {
                setError(data.error ?? `HTTP ${res.status}`);
            } else {
                setMessage(`${name} 已删除`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '删除失败');
        }
        setBusy(false);
        await refresh();
    };

    return (
        <section className="kb-page">
            <label className={`upload-area ${busy ? 'upload-busy' : ''}`}>
                <input
                    type="file"
                    accept=".txt,.md,.pdf"
                    multiple
                    disabled={busy}
                    onChange={(e) => handleUpload(e.target.files)}
                />
                <div className="upload-mark">＋</div>
                <p className="upload-title">{busy ? '正在摄取…' : '点击或拖入文档'}</p>
                <p className="upload-sub">
                    支持 .txt / .md / .pdf（文本 2MB、PDF 10MB 以内），上传后自动分块入库
                </p>
            </label>

            {message && <p className="kb-ok">{message}</p>}
            {error && <p className="kb-error">{error}</p>}

            <div className="kb-list">
                <div className="kb-list-head">
                    <span>已索引文档</span>
                    <span>{files.length} 个</span>
                </div>
                {loading ? (
                    <p className="kb-empty">加载中…</p>
                ) : files.length === 0 ? (
                    <p className="kb-empty">知识库还是空的，先上传一份文档吧。</p>
                ) : (
                    files.map((f) => (
                        <div key={f.file} className="doc-row">
                            <div className="doc-info">
                                <span className="doc-name">{f.file}</span>
                                <span className="doc-meta">
                                    {f.chunks} 块 · {f.chars.toLocaleString('zh-CN')} 字
                                </span>
                            </div>
                            <button
                                type="button"
                                className="doc-del"
                                disabled={busy}
                                onClick={() => handleDelete(f.file)}
                                title="从知识库删除"
                            >
                                删
                            </button>
                        </div>
                    ))
                )}
            </div>
        </section>
    );
};

export default KnowledgePage;
