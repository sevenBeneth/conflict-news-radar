import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios, { AxiosError } from "axios";
import { buildKnowledge, splitText, retrieve, Document } from "./knowledge";
import { answer, AnswerError } from "./answer";
import { estimateCost } from "./cost";
const fixture: Document = {
  id: "test-1",
  title: "测试资料：港口停航",
  text: "测试地区港口因风暴暂停航运。恢复日期尚未公布。",
  source: "本地测试夹具（非真实新闻）",
  url: "https://example.org/test",
  publishedAt: "2026-10-19T00:00:00Z",
  permission: "自编测试文本",
};
test("local knowledge, independent contexts, citation validation and network failures", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnr-rag-"));
  const oldDir = process.env.RAG_DATA_DIR;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  const adapter = axios.defaults.adapter;
  process.env.RAG_DATA_DIR = dir;
  process.env.DEEPSEEK_API_KEY = "test-not-a-real-key";
  try {
    const kb = await buildKnowledge([fixture, fixture]);
    await t.test("deduplication, relevance and date filters", () => {
      assert.equal(kb.documents, 1);
      assert.equal(retrieve(kb, "港口航运为什么暂停").length, 1);
      assert.equal(retrieve(kb, "巧克力蛋糕配方").length, 0);
      assert.equal(retrieve(kb, "港口航运", "", "2026-10-20").length, 0);
    });
    await t.test("sentence boundaries survive chunking", () => {
      const chunks = splitText("港口暂停航运，等待恢复通知。".repeat(90));
      assert.ok(chunks.length > 1);
      assert.ok(chunks.every((c) => c.endsWith("。") && c.length <= 500));
    });
    await t.test(
      "shared publication dates do not count as topic relevance",
      () => {
        assert.equal(retrieve(kb, "2026年10月19日巧克力蛋糕配方").length, 0);
      },
    );
    await t.test(
      "RAG contains evidence while direct requests contain none",
      async () => {
        axios.defaults.adapter = async (config) => {
          const body = JSON.parse(config.data);
          assert.ok(
            body.messages[0].content.includes("当前日期（Asia/Hong_Kong）"),
          );
          assert.deepEqual(body.thinking, { type: "disabled" });
          const context = JSON.parse(body.messages[1].content);
          assert.equal(body.messages.length, 2);
          const rag = Array.isArray(context.sources);
          if (rag) assert.equal(context.sources.length, 1);
          else assert.equal(context.knowledgeVersion, undefined);
          return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      status: "answered",
                      answer: rag
                        ? "港口因风暴暂停航运。[S1]"
                        : "无法确定实时情况。",
                      citations: rag ? ["S1"] : [],
                      follow_up: "",
                    }),
                  },
                },
              ],
              usage: { total_tokens: 100 },
            },
          };
        };
        const rag = await answer({ query: "港口航运为什么暂停", mode: "rag" });
        const direct = await answer({
          query: "港口航运为什么暂停",
          mode: "direct",
        });
        assert.equal(rag.sources.length, 1);
        assert.equal(direct.sources.length, 0);
      },
    );
    await t.test("invented citations are rejected", async () => {
      axios.defaults.adapter = async (config) => ({
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "answered",
                  answer: "错误引用 [S99]",
                  citations: ["S99"],
                  follow_up: "",
                }),
              },
            },
          ],
        },
      });
      await assert.rejects(
        answer({ query: "港口航运", mode: "rag" }),
        (e: unknown) => e instanceof AnswerError && e.status === 502,
      );
    });
    await t.test("malformed JSON is rejected", async () => {
      axios.defaults.adapter = async (config) => ({
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: { choices: [{ message: { content: "not json" } }] },
      });
      await assert.rejects(
        answer({ query: "港口航运", mode: "rag" }),
        /有效 JSON/,
      );
    });
    await t.test(
      "cached input cost and unknown models are handled explicitly",
      () => {
        const cost = estimateCost("deepseek-flash", {
          prompt_tokens: 1000,
          completion_tokens: 100,
          prompt_cache_hit_tokens: 800,
          prompt_cache_miss_tokens: 200,
        });
        assert.ok(cost);
        assert.ok(Math.abs(cost.minUsd - 0.0000924) < 1e-10);
        assert.equal(cost.maxUsd, cost.minUsd * 2);
        assert.equal(
          estimateCost("unknown", { prompt_tokens: 10, completion_tokens: 10 }),
          null,
        );
      },
    );
    await t.test(
      "connection failures are explicit and logged without credentials",
      async () => {
        axios.defaults.adapter = async () => {
          throw new AxiosError("refused", "ECONNREFUSED");
        };
        await assert.rejects(
          answer({ query: "港口航运", mode: "direct" }),
          /ECONNREFUSED/,
        );
        const logs = await Promise.all(
          (await readdir(path.join(dir, "runs"))).map((f) =>
            readFile(path.join(dir, "runs", f), "utf8"),
          ),
        );
        assert.ok(logs.some((s) => s.includes("ECONNREFUSED")));
        assert.ok(logs.every((s) => !s.includes("test-not-a-real-key")));
      },
    );
    await t.test(
      "timeouts and missing configuration have distinct errors",
      async () => {
        axios.defaults.adapter = async () => {
          throw new AxiosError("timeout", "ECONNABORTED");
        };
        await assert.rejects(
          answer({ query: "港口", mode: "direct" }),
          (e: unknown) => e instanceof AnswerError && e.status === 504,
        );
        delete process.env.DEEPSEEK_API_KEY;
        await assert.rejects(
          answer({ query: "港口", mode: "direct" }),
          (e: unknown) => e instanceof AnswerError && e.status === 503,
        );
      },
    );
  } finally {
    axios.defaults.adapter = adapter;
    if (oldDir === undefined) delete process.env.RAG_DATA_DIR;
    else process.env.RAG_DATA_DIR = oldDir;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});
