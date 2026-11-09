import "../config";
import { writeFile } from "fs/promises";
import path from "path";
import { answer } from "../services/answer";
import { dataDir } from "../services/knowledge";
async function main() {
  const query =
    "综合2026年10月19日美乌双方关于谈判和武器交付的报道，双方分别表达了什么立场？";
  const results = [];
  for (const contextFormat of ["full", "compact"] as const) {
    const result = await answer({
      query,
      promptVersion: "v3",
      contextFormat,
    });
    results.push({ contextFormat, result });
    console.log(contextFormat, result.contextChars, result.status);
  }
  const target = path.join(dataDir(), `context-comparison-${Date.now()}.json`);
  await writeFile(target, JSON.stringify(results, null, 2));
  console.log(target);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
