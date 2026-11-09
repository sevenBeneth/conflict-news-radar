import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { runAgent, Model, Dependencies, Run } from "./harness";
import {
  AgentFault,
  executeReadTool,
  snapshotRecords,
  validateTool,
  saveBrief,
} from "./tools";
import { Knowledge, dataDir } from "../services/knowledge";

const kb: Knowledge = {
  version: "synthetic-test-v1",
  createdAt: "2026-11-09",
  documents: 2,
  chunks: [
    {
      id: "A",
      chunkId: "A-1",
      title: "测试：乌克兰外交报道",
      text: "自编测试资料，不是真实新闻。",
      source: "测试媒体甲",
      url: "https://example.org/a",
      publishedAt: "2026-10-20",
      permission: "自编测试",
    },
    {
      id: "B",
      chunkId: "B-1",
      title: "测试：乌克兰会议",
      text: "自编测试资料，不是真实新闻。",
      source: "测试媒体乙",
      url: "https://example.org/b",
      publishedAt: "2026-10-20",
      permission: "自编测试",
    },
  ],
};
const query = {
  kind: "tool",
  name: "query_news",
  arguments: { keyword: "乌克兰" },
};
const stats = {
  kind: "tool",
  name: "compute_stats",
  arguments: { ids: ["A", "B"] },
};
const final = {
  kind: "final",
  total: 2,
  bySource: { 测试媒体甲: 1, 测试媒体乙: 1 },
  citations: ["A", "B"],
  answer: "本地测试快照匹配2篇，不代表全部相关新闻。",
};
function script(
  actions: unknown[],
  inspect?: (messages: any[]) => void,
): Model {
  let i = 0;
  return async (messages) => {
    inspect?.(messages);
    return {
      content: JSON.stringify(actions[Math.min(i++, actions.length - 1)]),
      model: "simulated-test-only",
    };
  };
}
test("工具与Harness边界验证（模型及确认故障使用模拟）", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cnr-agent-"));
  const evidence: { name: string; run?: Run; passed: boolean }[] = [];
  async function run(
    name: string,
    actions: unknown[],
    deps: Dependencies = {},
  ) {
    const result = await runAgent({ keyword: "乌克兰", save: false }, kb, {
      directory: dir,
      model: script(actions),
      ...deps,
    });
    evidence.push({ name, run: result, passed: false });
    return result;
  }
  try {
    await t.test("工具直测：正确参数与错误参数", async () => {
      const state = { keyword: "乌克兰", records: snapshotRecords(kb) };
      const result = (await executeReadTool(
        "query_news",
        { keyword: "乌克兰" },
        state,
        new AbortController().signal,
      )) as any;
      assert.equal(result.total, 2);
      assert.throws(
        () => validateTool("query_news", { keyword: 12 }, state),
        AgentFault,
      );
      assert.throws(
        () => validateTool("execute_shell", { command: "whoami" }, state),
        /允许列表/,
      );
      assert.throws(
        () =>
          validateTool(
            "query_news",
            { keyword: "乌克兰", path: "../secret" },
            state,
          ),
        /字段/,
      );
      evidence.push({
        name: "工具直测：正确／错误／未知工具／越权字段",
        passed: true,
      });
    });
    await t.test("正常循环把工具结果加入后续模型上下文", async () => {
      const r = await run("正常模拟循环", [query, stats, final], {
        model: script([query, stats, final], (messages) => {
          if (messages.length > 3)
            assert.ok(
              messages.some((m) => m.content.includes('"type":"tool_result"')),
            );
        }),
      });
      assert.equal(r.status, "succeeded");
      assert.equal(r.steps, 3);
      evidence.at(-1)!.passed = true;
    });
    await t.test("参数错误反馈模型并有限修正", async () => {
      const r = await run("参数错误后修正", [
        { ...query, arguments: { keyword: "其他地区" } },
        query,
        stats,
        final,
      ]);
      assert.equal(r.status, "succeeded");
      assert.ok(
        r.messages.some((m) => m.content.includes('"code":"ACCESS_DENIED"')),
      );
      evidence.at(-1)!.passed = true;
    });
    await t.test("工具异常反馈且可以纠正一次", async () => {
      let fail = true;
      const r = await run("工具异常后恢复", [query, query, stats, final], {
        readTool: async (...args) => {
          if (fail) {
            fail = false;
            throw Error("secret internal details");
          }
          return executeReadTool(...args);
        },
      });
      assert.equal(r.status, "succeeded");
      assert.ok(r.messages.some((m) => m.content.includes("TOOL_ERROR")));
      assert.ok(!JSON.stringify(r).includes("secret internal"));
      evidence.at(-1)!.passed = true;
    });
    await t.test("伪造最终结果不能成功", async () => {
      const r = await run("最终结果不合格", [
        query,
        stats,
        { ...final, total: 999 },
      ]);
      assert.equal(r.status, "failed");
      assert.match(r.reason, /修正/);
      evidence.at(-1)!.passed = true;
    });
    await t.test("未查询即宣称完成不能成功", async () => {
      const r = await run("未经工具直接完成", [final]);
      assert.equal(r.status, "failed");
      evidence.at(-1)!.passed = true;
    });
    await t.test("达到步数上限停止", async () => {
      const r = await run("步数上限", [query], { limits: { maxSteps: 2 } });
      assert.equal(r.status, "step_limit");
      assert.equal(r.modelCalls, 2);
      evidence.at(-1)!.passed = true;
    });
    await t.test("工具超时不接受迟到结果", async () => {
      const r = await run("工具超时", [query], {
        limits: { toolMs: 10 },
        readTool: async () => new Promise(() => {}),
      });
      assert.equal(r.status, "tool_timeout");
      assert.ok(!r.events.some((e) => e.type === "tool_result"));
      evidence.at(-1)!.passed = true;
    });
    await t.test("模型超时停止", async () => {
      const r = await run("模型超时", [], {
        limits: { modelMs: 10 },
        model: async () => new Promise(() => {}),
      });
      assert.equal(r.status, "model_timeout");
      evidence.at(-1)!.passed = true;
    });
    await t.test("总时限中止模型等待", async () => {
      const r = await run("总时限", [], {
        limits: { totalMs: 10 },
        model: async () => new Promise(() => {}),
      });
      assert.equal(r.status, "total_timeout");
      evidence.at(-1)!.passed = true;
    });
    await t.test("模型网络失败仅重试一次", async () => {
      const r = await run("模型重试上限", [], {
        model: async () => {
          throw new AgentFault("MODEL_ERROR", "网络错误");
        },
      });
      assert.equal(r.modelCalls, 2);
      assert.equal(r.status, "failed");
      evidence.at(-1)!.passed = true;
    });
    await t.test("用户停止任务取消运行", async () => {
      const abort = new AbortController();
      abort.abort();
      const r = await run("用户中止", [query], { signal: abort.signal });
      assert.equal(r.status, "cancelled");
      assert.equal(r.modelCalls, 0);
      evidence.at(-1)!.passed = true;
    });
    for (const choice of ["yes", "no", "timeout"] as const)
      await t.test(`人工确认模拟：${choice}`, async () => {
        const r = await runAgent({ keyword: "乌克兰", save: true }, kb, {
          directory: dir,
          model: script([
            query,
            stats,
            { kind: "tool", name: "save_brief", arguments: {} },
            final,
          ]),
          limits: { confirmMs: 10 },
          confirm: async (preview) => {
            assert.match(preview.content, /匹配篇数：2/);
            assert.ok(!existsSync(preview.path));
            return choice === "timeout"
              ? new Promise(() => {})
              : choice === "yes";
          },
        });
        evidence.push({ name: `确认${choice}（模拟）`, run: r, passed: false });
        assert.equal(
          r.status,
          choice === "yes"
            ? "succeeded"
            : choice === "no"
              ? "confirmation_rejected"
              : "confirmation_timeout",
        );
        const file = path.join(dir, "briefs", `${r.runId}.md`);
        assert.equal(existsSync(file), choice === "yes");
        if (choice === "yes") {
          const content = readFileSync(file, "utf8");
          assert.equal(
            saveBrief(path.join(dir, "briefs"), r.runId, content).alreadySaved,
            true,
          );
          assert.throws(
            () => saveBrief(path.join(dir, "briefs"), r.runId, "different"),
            /拒绝覆盖/,
          );
        }
        evidence.at(-1)!.passed = true;
      });
    await t.test("未授权任务不进入保存确认", async () => {
      const r = await run(
        "保存权限拒绝",
        [query, stats, { kind: "tool", name: "save_brief", arguments: {} }],
        {
          confirm: async () => {
            throw Error("should not ask");
          },
        },
      );
      assert.equal(r.status, "failed");
      assert.ok(!r.events.some((e) => e.type === "confirmation_required"));
      assert.ok(!r.savedPath);
      evidence.at(-1)!.passed = true;
    });
    await t.test("任意路径不能作为保存参数", async () => {
      const r = await runAgent({ keyword: "乌克兰", save: true }, kb, {
        directory: dir,
        model: script([
          query,
          stats,
          {
            kind: "tool",
            name: "save_brief",
            arguments: { path: "../../secret" },
          },
        ]),
      });
      assert.equal(r.status, "failed");
      assert.ok(!r.savedPath);
      evidence.push({ name: "保存目录越权", run: r, passed: true });
    });
    await t.test("拒绝包含知识库外或重复ID的统计", () => {
      const state = {
        keyword: "乌克兰",
        records: snapshotRecords(kb),
        queried: snapshotRecords(kb),
      };
      assert.throws(() => validateTool("compute_stats", { ids: ["A"] }, state));
      assert.throws(() =>
        validateTool("compute_stats", { ids: ["A", "A"] }, state),
      );
      assert.throws(() =>
        validateTool("compute_stats", { ids: ["A", "secret"] }, state),
      );
      evidence.push({ name: "统计ID范围检查", passed: true });
    });
  } finally {
    const dest = path.join(dataDir(), "agent-tests");
    mkdirSync(dest, { recursive: true });
    writeFileSync(
      path.join(dest, "latest.json"),
      JSON.stringify(
        { createdAt: new Date().toISOString(), simulation: true, evidence },
        null,
        2,
      ),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
