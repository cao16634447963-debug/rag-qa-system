import { lazy, Suspense, useEffect, useState } from "react";
import Login from "./components/Login";
import { apiFetch, logout } from "./api";

// 页面组件按需分包，避免一次性加载全部 JS
const ChatPage = lazy(() => import("./components/ChatPage"));
const KnowledgePage = lazy(() => import("./components/KnowledgePage"));
const BookmarksPage = lazy(() => import("./components/BookmarksPage"));

type Tab = "chat" | "kb" | "bm";

const TABS: { key: Tab; label: string }[] = [
  { key: "chat", label: "问答" },
  { key: "kb", label: "知识库" },
  { key: "bm", label: "书签" },
];

const App = () => {
  // 登录态由 HttpOnly Cookie 决定，页面加载时向服务端确认
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("chat");

  useEffect(() => {
    apiFetch("/api/auth/me").then((res) => setAuthed(res.ok));
  }, []);

  return (
    <main className="chat-app">
      <header className="app-header">
        <div className="seal">问</div>
        <div>
          <h1>RAG 智能问答</h1>
          <p className="subtitle">
            基于知识库的流式问答<em>·</em>个人书签管理
          </p>
        </div>
        {authed && (
          <button
            type="button"
            className="logout-btn"
            onClick={async () => {
              await logout();
              setAuthed(false);
            }}
          >
            退出
          </button>
        )}
      </header>

      {authed === null ? (
        <div className="page-loading">加载中…</div>
      ) : !authed ? (
        <Login onSuccess={() => setAuthed(true)} />
      ) : (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tab ${tab === t.key ? "tab-active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <Suspense fallback={<div className="page-loading">加载中…</div>}>
            {tab === "chat" && <ChatPage />}
            {tab === "kb" && <KnowledgePage />}
            {tab === "bm" && <BookmarksPage />}
          </Suspense>
        </>
      )}

      <p className="footnote">
        回答由 AI 生成，请注意甄别<em>·</em>书签数据仅本人可见
      </p>
    </main>
  );
};

export default App;
