import "../config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { loadKnowledge, dataDir } from "../services/knowledge";
import { runAgent } from "../agent/harness";

async function main() {
  const kb = await loadKnowledge();
  if (!kb.chunks.length) throw new Error("先准备本地知识库");
  const results = [];
  for (const keyword of ["乌克兰", "安理会", "不存在的新闻关键词XYZ"]) {
    // Independent oracle: count matching document IDs directly from the frozen source.
    const expected = [
      ...new Set(
        kb.chunks
          .filter((c) => `${c.title}\n${c.text}`.includes(keyword))
          .map((c) => c.id),
      ),
    ].sort();
    const run = await runAgent({ keyword, save: false }, kb);
    const result = run.result as
      | { total: number; citations: string[] }
      | undefined;
    const passed =
      run.status === "succeeded" &&
      result?.total === expected.length &&
      JSON.stringify([...result.citations].sort()) ===
        JSON.stringify(expected) &&
      run.events.some(
        (e) =>
          e.type === "tool_result" && (e.detail as any).name === "query_news",
      ) &&
      run.events.some(
        (e) =>
          e.type === "tool_result" &&
          (e.detail as any).name === "compute_stats",
      );
    results.push({
      keyword,
      expected: expected.length,
      passed,
      runId: run.runId,
      status: run.status,
      steps: run.steps,
      modelCalls: run.modelCalls,
      elapsedMs: run.elapsedMs,
      result: run.result,
    });
    console.log(JSON.stringify(results.at(-1), null, 2));
  }
  const dir = path.join(dataDir(), "agent-evidence");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "live-verification.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        knowledgeVersion: kb.version,
        simulation: false,
        results,
      },
      null,
      2,
    ),
  );
  assert.ok(
    results.every((r) => r.passed),
    "真实模型循环未全部通过，请检查任务日志",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
