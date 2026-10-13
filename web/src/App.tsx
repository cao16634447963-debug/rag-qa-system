import { useState } from "react";
import ChatPage from "./components/ChatPage";
import KnowledgePage from "./components/KnowledgePage";

type Tab = "chat" | "kb";

const TABS: { key: Tab; label: string }[] = [
  { key: "chat", label: "问答" },
  { key: "kb", label: "知识库" },
];

const App = () => {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <main className="chat-app">
      <header className="app-header">
        <div className="seal">问</div>
        <div>
          <h1>RAG 智能问答</h1>
          <p className="subtitle">
            基于知识库的流式问答<em>·</em>Vercel AI SDK
          </p>
        </div>
      </header>

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

      {tab === "chat" ? <ChatPage /> : <KnowledgePage />}

      <p className="footnote">
        回答由 AI 生成，请注意甄别<em>·</em>引用来源可在问答页查看
      </p>
    </main>
  );
};

export default App;
