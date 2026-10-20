import dotenv from "dotenv";
import path from "path";
import { readFile, writeFile } from "fs/promises";
import {
  buildKnowledge,
  loadKnowledge,
  dataDir,
  Document,
  retrieve,
} from "../services/knowledge";
import { answer } from "../services/answer";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();
async function main() {
  const [command, file] = process.argv.slice(2);
  if (command === "import") {
    if (!file) throw new Error("请提供 JSON 资料文件路径");
    const kb = await buildKnowledge(
      JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")),
    );
    console.log(
      JSON.stringify(
        {
          version: kb.version,
          documents: kb.documents,
          chunks: kb.chunks.length,
          sample: kb.chunks.slice(0, 3),
        },
        null,
        2,
      ),
    );
  } else if (command === "export-news") {
    const { pool } = await import("../db/connection");
    try {
      const result = await pool.query<{
        id: string;
        headline: string;
        summary: string;
        source: string;
        url: string;
        published_at: Date;
      }>(
        "SELECT id, headline, summary, source, url, published_at FROM news_events WHERE summary IS NOT NULL AND url IS NOT NULL AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30",
      );
      const docs: Document[] = result.rows.map((r) => ({
        id: r.id,
        title: r.headline,
        text: r.summary,
        source: r.source,
        url: r.url,
        publishedAt: new Date(r.published_at).toISOString(),
        permission: "待人工核实来源使用条款，核实前勿导入或上传云端",
      }));
      await writeFile(file || "news-draft.json", JSON.stringify(docs, null, 2));
      console.log(
        "已导出待审核资料，请核实来源、隐私和使用权限后执行 import。",
      );
    } finally {
      await pool.end();
    }
  } else if (command === "inspect") {
    const kb = await loadKnowledge();
    if (!kb.chunks.length) throw new Error("请先导入知识库");
    const questions = file
      ? JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""))
      : [];
    const output = {
      version: kb.version,
      documents: kb.documents,
      chunks: kb.chunks.length,
      sample: kb.chunks.slice(0, 3),
      queries: questions.map((q: { id: string; question: string }) => ({
        ...q,
        sources: retrieve(kb, q.question),
      })),
    };
    await writeFile(
      path.join(dataDir(), "inspection.json"),
      JSON.stringify(output, null, 2),
    );
    console.log(JSON.stringify(output, null, 2));
  } else if (command === "evaluate") {
    if (!file) throw new Error("请提供固定问题集 JSON 路径");
    const questions = JSON.parse(
      (await readFile(file, "utf8")).replace(/^\uFEFF/, ""),
    );
    const kb = await loadKnowledge();
    if (!kb.chunks.length) throw new Error("请先导入知识库");
    const results = [];
    const output = path.join(
      dataDir(),
      `evaluation-${process.env.PROMPT_VERSION || "v3"}-${Date.now()}`,
    );
    for (const q of questions)
      for (const mode of ["direct", "rag"] as const) {
        try {
          results.push({
            ...q,
            mode,
            result: await answer({
              query: q.question,
              mode,
              promptVersion:
                process.env.PROMPT_VERSION === "v1"
                  ? "v1"
                  : process.env.PROMPT_VERSION === "v2"
                    ? "v2"
                    : "v3",
            }),
            humanJudgment: null,
          });
        } catch (e) {
          results.push({
            ...q,
            mode,
            error: (e as Error).message,
            humanJudgment: null,
          });
        }
        await writeFile(`${output}.json`, JSON.stringify(results, null, 2));
        console.log(
          `${q.id} ${mode}: ${"result" in results[results.length - 1] ? "OK" : "FAILED"}`,
        );
      }
    if (results.some((r) => "error" in r)) process.exitCode = 1;
    await writeFile(`${output}.json`, JSON.stringify(results, null, 2));
    const cell = (v: unknown) =>
      String(v ?? "")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, "<br>");
    const rows = results.map(
      (r) =>
        `| ${cell(r.id)} | ${cell(r.mode)} | ${cell("result" in r ? r.result.response : r.error)} | ${cell("result" in r ? r.result.elapsedMs : "")} | ${cell("result" in r ? r.result.usage?.total_tokens : "")} | 待人工判断 |`,
    );
    await writeFile(
      `${output}.md`,
      `# 两组问答对比（人工评分待完成）\n\n知识库：${kb.version}\n\n| 问题 | 模式 | 回答或错误 | 毫秒 | Token | 正确性／遗漏／无依据内容／引用支持 |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`,
    );
    console.log(`${output}.json\n${output}.md`);
  } else
    throw new Error(
      "用法：npm run rag -- import <资料.json> | export-news <输出.json> | inspect [问题集.json] | evaluate <问题集.json>",
    );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
