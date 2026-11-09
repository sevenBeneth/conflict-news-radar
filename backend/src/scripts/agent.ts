import "../config";
import { createInterface } from "readline";
import { loadKnowledge } from "../services/knowledge";
import { runAgent } from "../agent/harness";

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const keywords = args.filter((a) => a !== "--save");
  if (keywords.length !== 1 || keywords[0].startsWith("--"))
    throw new Error('用法：npm run agent -- "乌克兰" [--save]');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  try {
    const result = await runAgent(
      { keyword: keywords[0], save },
      await loadKnowledge(),
      {
        signal: controller.signal,
        onEvent: (e) =>
          console.log(
            `[${e.time}] step=${e.step} ${e.type} ${JSON.stringify(e.detail)}`,
          ),
        confirm: (preview, signal) =>
          new Promise<boolean>((resolve) => {
            console.log(
              `\n将新建本地简报（不会覆盖其他任务文件）\n路径：${preview.path}\n内容：\n${preview.content}\n`,
            );
            if (!process.stdin.isTTY) {
              console.log("非交互终端：默认拒绝保存。请在终端手动运行。");
              resolve(false);
              return;
            }
            const rl = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            let done = false;
            const finish = (value: boolean) => {
              if (done) return;
              done = true;
              signal.removeEventListener("abort", abort);
              rl.close();
              resolve(value);
            };
            const abort = () => finish(false);
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) {
              abort();
              return;
            }
            rl.question(
              "明确同意请键入 yes，其他输入拒绝（30秒内）：",
              (input) => finish(input.trim() === "yes"),
            );
            rl.on("close", () => finish(false));
          }),
      },
    );
    console.log(
      `\n任务 ${result.runId}\n状态 ${result.status}\n原因 ${result.reason}\n耗时 ${result.elapsedMs}ms，决策 ${result.steps} 步，模型请求 ${result.modelCalls} 次`,
    );
    if (result.result) console.log(JSON.stringify(result.result, null, 2));
    if (result.status !== "succeeded") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
