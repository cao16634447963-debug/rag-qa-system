/**
 * 引用来源列表（公共组件）：展示 RAG 命中的知识库分块
 * 数据来自服务端 data-sources 消息部分
 */
export type Source = {
    file: string;
    index: number;
    score: number;
    text: string;
};

const SourceList = ({ sources }: { sources: Source[] }) => (
    <div className="sources">
        <div className="sources-title">
            引用来源<em>{sources.length}</em>
        </div>
        <div className="source-cards">
            {sources.map((s, i) => (
                <div key={`${s.file}#${s.index}`} className="source-card">
                    <div className="source-head">
                        <span className="source-no">[{i + 1}]</span>
                        <span className="source-file" title={`${s.file}#${s.index}`}>
                            {s.file}
                        </span>
                        <span className="source-score">{(s.score * 100).toFixed(0)}%</span>
                    </div>
                    <p className="source-text">{s.text}…</p>
                </div>
            ))}
        </div>
    </div>
);

export default SourceList;
