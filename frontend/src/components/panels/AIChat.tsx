"use client";
import { useState } from "react";
import axios from "axios";
import { Bot, Send, Trash2 } from "lucide-react";
interface Source {
  citationId: string;
  title: string;
  text: string;
  url: string;
  source: string;
  publishedAt: string;
  score: number;
  matched: string[];
}
interface Result {
  model: string;
  promptVersion: string;
  estimatedCost: { minUsd: number; maxUsd: number } | null;
  response: string;
  status: string;
  follow_up: string;
  sources: Source[];
  citations: string[];
  elapsedMs: number;
  usage: { total_tokens?: number } | null;
  runId: string;
  knowledgeVersion: string;
}
interface Round {
  id: string;
  question: string;
  result?: Result;
  error?: string;
}
const statusLabels: Record<string, string> = {
  answered: "已回答",
  insufficient_evidence: "资料不足",
  needs_clarification: "需要补充",
  out_of_scope: "超出范围",
};
export default function AIChat() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (busy || !query.trim()) return;
    const question = query.trim();
    const id = crypto.randomUUID();
    setRounds((old) => [...old, { id, question }]);
    setBusy(true);
    setQuery("");
    try {
      const { data } = await axios.post<Result>(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000"}/ai/analyze`,
        {
          query: question,
          context: {
            region,
            from: from ? new Date(`${from}T00:00:00`).toISOString() : "",
            to: to ? new Date(`${to}T23:59:59.999`).toISOString() : "",
          },
        },
        { timeout: 75000 },
      );
      setRounds((old) =>
        old.map((r) => (r.id === id ? { ...r, result: data } : r)),
      );
    } catch (e) {
      const error = axios.isAxiosError(e)
        ? e.response?.data?.error || "请求失败，请稍后重试。"
        : "请求失败，请稍后重试。";
      setRounds((old) => old.map((r) => (r.id === id ? { ...r, error } : r)));
    } finally {
      setBusy(false);
    }
  }
  const field =
    "min-w-0 w-full rounded border border-border bg-background-tertiary p-2 text-xs text-text-primary";
  return (
    <section className="flex h-full flex-col text-text-primary">
      <header className="border-b border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-accent-cyan" />
          <strong className="text-sm">新闻问答</strong>
          <button
            aria-label="清空结果"
            disabled={busy}
            onClick={() => setRounds([])}
            className="ml-auto disabled:opacity-30"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          根据新闻资料回答，提供可查阅的来源。每次提问独立处理。
        </p>
        <input
          aria-label="地区筛选"
          placeholder="地区（可选，例如：加沙）"
          className={field}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          disabled={busy}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-text-muted">
            开始日期
            <input
              type="date"
              className={field}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="text-[10px] text-text-muted">
            结束日期
            <input
              type="date"
              className={field}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-5" aria-live="polite">
        {!rounds.length && (
          <div className="border-l-2 border-accent-cyan pl-3 py-3 space-y-2">
            <p className="text-sm">你想了解哪些新闻动态？</p>
            <p className="text-xs leading-6 text-text-secondary">
              输入问题，可按地区和报道日期筛选。回答附有来源；资料不足时会明确说明。
            </p>
          </div>
        )}
        {rounds.map((round) => (
          <article key={round.id} className="space-y-3">
            <h3 className="text-sm font-semibold border-b border-border pb-2">
              {round.question}
            </h3>
            <div className="rounded border border-border bg-background-panel p-3 space-y-2">
              {round.error ? (
                <p role="alert" className="text-xs text-red-400">
                  {round.error}
                </p>
              ) : round.result ? (
                <>
                  <p className="text-xs leading-6 whitespace-pre-wrap">
                    {round.result.response}
                  </p>
                  {round.result.follow_up && (
                    <p className="text-xs text-amber-400">
                      请补充：{round.result.follow_up}
                    </p>
                  )}
                  {round.result.sources.map((s) => (
                    <details
                      key={s.citationId}
                      className="border-t border-border pt-2 text-xs"
                    >
                      <summary className="cursor-pointer text-text-secondary">
                        [{s.citationId}] {s.title}{" "}
                        {round.result?.citations.includes(s.citationId)
                          ? "· 已引用"
                          : "· 相关来源"}
                      </summary>
                      <p className="mt-2 leading-5">{s.text}</p>
                      <p className="text-[10px] text-text-muted mt-2">
                        {s.source} ·{" "}
                        {new Date(s.publishedAt).toLocaleDateString("zh-CN")}
                      </p>
                      {/^https?:\/\//.test(s.url) && (
                        <a
                          className="text-accent-cyan underline"
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          查看来源
                        </a>
                      )}
                    </details>
                  ))}
                  <p className="text-[11px] text-text-secondary">
                    {statusLabels[round.result.status] || round.result.status}
                  </p>
                </>
              ) : (
                <p className="text-xs text-text-muted animate-pulse">
                  正在生成回答…
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
      <form
        className="border-t border-border p-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="新闻问题"
          maxLength={2000}
          rows={3}
          className={field}
          placeholder="输入地区、时间与想了解的问题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
        <button
          className="w-full flex justify-center items-center gap-2 rounded bg-accent-blue py-2 text-xs disabled:opacity-40"
          disabled={busy || !query.trim() || Boolean(from && to && from > to)}
        >
          <Send className="w-3 h-3" />
          {busy ? "生成中…" : "发送问题"}
        </button>
        {from && to && from > to && (
          <p role="alert" className="text-xs text-red-400">
            开始日期不能晚于结束日期。
          </p>
        )}
      </form>
    </section>
  );
}
