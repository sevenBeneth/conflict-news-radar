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
interface Card {
  mode: "direct" | "rag";
  result?: Result;
  error?: string;
}
interface Round {
  id: string;
  question: string;
  cards: Card[];
}
const labels = { direct: "直接问答", rag: "RAG 问答" };
const statusLabels: Record<string, string> = {
  answered: "已回答",
  insufficient_evidence: "资料不足",
  needs_clarification: "需要补充",
  out_of_scope: "超出范围",
};
export default function AIChat({ wide = false }: { wide?: boolean }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<"direct" | "rag" | "compare">("compare");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  async function send() {
    if (busy || !query.trim()) return;
    const question = query.trim();
    const id = crypto.randomUUID();
    const modes: Array<"direct" | "rag"> =
      mode === "compare" ? ["direct", "rag"] : [mode];
    setRounds((old) => [
      ...old,
      { id, question, cards: modes.map((mode) => ({ mode })) },
    ]);
    setBusy(true);
    setQuery("");
    try {
      await Promise.all(
        modes.map(async (chosen) => {
          let card: Card;
          try {
            const { data } = await axios.post<Result>(
              `${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000"}/ai/analyze`,
              {
                query: question,
                mode: chosen,
                context: {
                  region,
                  from: from ? new Date(`${from}T00:00:00`).toISOString() : "",
                  to: to ? new Date(`${to}T23:59:59.999`).toISOString() : "",
                },
              },
              { timeout: 75000 },
            );
            card = { mode: chosen, result: data };
            if (chosen === "rag") setKnowledge(data.knowledgeVersion);
          } catch (e) {
            card = {
              mode: chosen,
              error: axios.isAxiosError(e)
                ? e.response?.data?.error ||
                  "请求失败，请检查后端与 DeepSeek 配置。"
                : "请求失败。",
            };
          }
          setRounds((old) =>
            old.map((r) =>
              r.id === id
                ? {
                    ...r,
                    cards: r.cards.map((c) => (c.mode === chosen ? card : c)),
                  }
                : r,
            ),
          );
        }),
      );
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
          <strong className="text-sm">新闻问答实验室</strong>
          <span className="text-[10px] text-amber-400">非正式演示</span>
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
          DeepSeek · 本地知识库 · 每次提问使用独立上下文
        </p>
        <div
          className="grid grid-cols-3 gap-1"
          role="group"
          aria-label="问答模式"
        >
          {(["direct", "rag", "compare"] as const).map((m) => (
            <button
              key={m}
              disabled={busy}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded border px-2 py-2 text-xs ${mode === m ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan" : "border-border text-text-secondary"}`}
            >
              {m === "compare" ? "同时对比" : labels[m]}
            </button>
          ))}
        </div>
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
            <p className="text-sm">同一个问题，两种回答依据。</p>
            <p className="text-xs leading-6 text-text-secondary">
              直接问答使用模型已有知识；RAG
              问答使用本地资料并展示出处。资料不足时应明确提示，不代表事件没有发生。
            </p>
            <p className="text-[11px] text-text-muted">
              先通过命令行导入新闻知识库，再输入问题。对比模式通常调用两次 API。
            </p>
          </div>
        )}
        {rounds.map((round) => (
          <article key={round.id} className="space-y-3">
            <h3 className="text-sm font-semibold border-b border-border pb-2">
              {round.question}
            </h3>
            <div
              className={`grid gap-3 ${wide && round.cards.length > 1 ? "md:grid-cols-2" : ""}`}
            >
              {round.cards.map((card) => (
                <div
                  key={card.mode}
                  className="rounded border border-border bg-background-panel p-3 space-y-2"
                >
                  <h4 className="text-xs text-accent-cyan">
                    {labels[card.mode]}
                  </h4>
                  {card.error ? (
                    <p role="alert" className="text-xs text-red-400">
                      {card.error}
                    </p>
                  ) : card.result ? (
                    <>
                      <p className="text-xs leading-6 whitespace-pre-wrap">
                        {card.result.response}
                      </p>
                      {card.result.follow_up && (
                        <p className="text-xs text-amber-400">
                          请补充：{card.result.follow_up}
                        </p>
                      )}
                      {card.result.sources.map((s) => (
                        <details
                          key={s.citationId}
                          className="border-t border-border pt-2 text-xs"
                        >
                          <summary className="cursor-pointer text-text-secondary">
                            [{s.citationId}] {s.title}{" "}
                            {card.result?.citations.includes(s.citationId)
                              ? "· 已引用"
                              : "· 检索候选"}
                          </summary>
                          <p className="mt-2 leading-5">{s.text}</p>
                          <p className="text-[10px] text-text-muted mt-2">
                            {s.source} · {s.publishedAt} · BM25{" "}
                            {s.score.toFixed(3)} · 命中：{s.matched.join("、")}
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
                        {(card.result.elapsedMs / 1000).toFixed(1)} 秒 · Token{" "}
                        {card.result.usage?.total_tokens ?? "未返回"} ·{" "}
                        {statusLabels[card.result.status] || card.result.status}
                      </p>
                      <p className="text-[11px] text-text-secondary">
                        {card.result.model}
                        {card.result.estimatedCost &&
                          ` · 估算 $${card.result.estimatedCost.minUsd.toFixed(6)}–$${card.result.estimatedCost.maxUsd.toFixed(6)}`}
                      </p>
                      <details className="text-[11px] text-text-secondary">
                        <summary>实验记录</summary>
                        <p className="break-all">{card.result.runId}</p>
                        <p>知识库：{card.result.knowledgeVersion}</p>
                        <p>
                          Prompt：{card.result.promptVersion} ·
                          费用按峰谷价格估算，以平台账单为准。
                        </p>
                      </details>
                    </>
                  ) : (
                    <p className="text-xs text-text-muted animate-pulse">
                      正在生成回答…
                    </p>
                  )}
                </div>
              ))}
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
          {busy ? "生成中…" : mode === "compare" ? "运行两组对比" : "发送问题"}
        </button>
        {from && to && from > to && (
          <p role="alert" className="text-xs text-red-400">
            开始日期不能晚于结束日期。
          </p>
        )}
        {knowledge && (
          <p className="text-[9px] text-text-muted">知识库版本：{knowledge}</p>
        )}
      </form>
    </section>
  );
}
