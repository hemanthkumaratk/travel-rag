"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Source = {
  title: string;
  similarity: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

type ChatResponse = {
  answer?: string;
  sources?: Source[];
  error?: string;
};

const SUGGESTIONS = [
  "Best beaches in Kerala",
  "Heritage sites in Rajasthan",
  "Hill stations for trekking",
  "Pilgrimage destinations in Tamil Nadu",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = listRef.current;

    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  async function send(question: string) {
    const trimmed = question.trim();

    if (!trimmed || loading) {
      return;
    }

    setInput("");
    setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      const data = (await response.json().catch(() => ({}))) as ChatResponse;

      if (!response.ok) {
        throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      }

      if (!data.answer) {
        throw new Error("The assistant returned an empty answer.");
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: data.answer as string,
          sources: data.sources ?? [],
        },
      ]);
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? `Sorry — ${error.message}`
              : "Sorry — something went wrong.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  function applySuggestion(suggestion: string) {
    setInput(suggestion);
    inputRef.current?.focus();
  }

  const conversationStarted = messages.length > 0;

  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      <style>{`
        @keyframes drift-a {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(70px, 50px, 0) scale(1.15); }
        }
        @keyframes drift-b {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1.1); }
          50% { transform: translate3d(-60px, 40px, 0) scale(0.9); }
        }
        @keyframes drift-c {
          0%, 100% { transform: translate3d(0, 0, 0) scale(0.95); }
          50% { transform: translate3d(50px, -45px, 0) scale(1.12); }
        }
      `}</style>

      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-indigo-500/20 blur-3xl animate-[drift-a_28s_ease-in-out_infinite] motion-reduce:animate-none" />
        <div className="absolute -right-24 top-1/3 h-[26rem] w-[26rem] rounded-full bg-violet-500/15 blur-3xl animate-[drift-b_34s_ease-in-out_infinite] motion-reduce:animate-none" />
        <div className="absolute -bottom-32 left-1/3 h-[24rem] w-[24rem] rounded-full bg-teal-400/10 blur-3xl animate-[drift-c_24s_ease-in-out_infinite] motion-reduce:animate-none" />
      </div>

      <header className="shrink-0 border-b border-white/5 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto w-full max-w-[800px] px-4 py-4 sm:px-6 sm:py-5">
          <h1 className="bg-gradient-to-r from-indigo-300 via-violet-200 to-teal-200 bg-clip-text text-xl font-semibold tracking-tight text-transparent sm:text-2xl">
            India Travel RAG
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Ask about destinations, seasons, and travel tips
          </p>
        </div>
      </header>

      <main ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-4 px-4 py-6 sm:px-6">
          {!conversationStarted && !loading && (
            <p className="mt-16 text-center text-sm text-slate-500">
              Ask a question below to get started.
            </p>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "max-w-[85%] self-end rounded-2xl rounded-br-md bg-indigo-500 px-4 py-3 text-sm leading-relaxed text-white shadow-lg shadow-indigo-950/40"
                  : "max-w-[85%] self-start rounded-2xl rounded-bl-md border border-white/5 bg-slate-900/80 px-4 py-3 text-sm leading-relaxed text-slate-100 shadow-lg shadow-black/20"
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>

              {message.sources && message.sources.length > 0 && (
                <div className="mt-3 border-t border-white/5 pt-2 text-xs text-slate-400">
                  <span className="font-medium text-slate-300">Sources:</span>{" "}
                  {message.sources.map((source, sourceIndex) => (
                    <span key={`${source.title}-${sourceIndex}`}>
                      {source.title} ({source.similarity.toFixed(3)})
                      {sourceIndex < (message.sources?.length ?? 0) - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="max-w-[85%] self-start rounded-2xl rounded-bl-md border border-white/5 bg-slate-900/80 px-4 py-3 shadow-lg shadow-black/20">
              <span className="sr-only">Thinking…</span>
              <span className="flex items-center gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-300 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-300 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-300" />
              </span>
            </div>
          )}
        </div>
      </main>

      <div className="shrink-0 border-t border-white/5 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto w-full max-w-[800px] px-4 py-4 sm:px-6">
          {!conversationStarted && (
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => applySuggestion(suggestion)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition duration-200 hover:scale-[1.03] hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={loading}
              placeholder="Ask about destinations, seasons, and travel tips…"
              aria-label="Ask about destinations, seasons, and travel tips"
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-indigo-400/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="rounded-full bg-indigo-500 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:bg-indigo-500/40 disabled:text-white/60 disabled:shadow-none"
            >
              Send
            </button>
          </form>

          <p className="mt-2 text-center text-[11px] text-slate-500">
            Answers are drawn from the India travel dataset.
          </p>
        </div>
      </div>
    </div>
  );
}
