import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { Knowledge } from "../services/knowledge";

export class AgentFault extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface NewsRecord {
  id: string;
  title: string;
  text: string;
  source: string;
  url: string;
  publishedAt: string;
}
export interface Statistics {
  total: number;
  bySource: Record<string, number>;
  ids: string[];
}
export interface ToolState {
  keyword: string;
  records: NewsRecord[];
  queried?: NewsRecord[];
  statistics?: Statistics;
  savedPath?: string;
}
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
function keys(
  x: unknown,
  required: string[],
): asserts x is Record<string, unknown> {
  if (
    !object(x) ||
    Object.keys(x).length !== required.length ||
    required.some((k) => !(k in x))
  )
    throw new AgentFault(
      "INVALID_ARGUMENTS",
      `只允许且必须提供字段：${required.join(",") || "无"}`,
    );
}
export const toolSchemas = [
  {
    name: "query_news",
    description:
      "本地冻结快照按任务keyword精确子串匹配标题或摘要，返回全部匹配文章（最多100），不是实时联网查询。只读，可重复。",
    parameters: {
      type: "object",
      properties: { keyword: { type: "string", minLength: 1, maxLength: 80 } },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
  {
    name: "compute_stats",
    description:
      "对最近一次query_news的完整文章ID集合统计篇数及各媒体篇数。必须覆盖全部结果，空结果使用空数组。只读，可重复。",
    parameters: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string" },
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "save_brief",
    description:
      "将程序根据已核验统计生成的简报保存到固定本地目录。仅任务开启保存且用户明确同意后执行。无参数，同一任务重复执行不重复写文件。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
] as const;

export function snapshotRecords(kb: Knowledge): NewsRecord[] {
  if (!Array.isArray(kb.chunks) || kb.chunks.length > 500)
    throw new AgentFault("DATA_LIMIT", "知识库必须为最多500片段的JSON快照");
  const records = new Map<string, NewsRecord>();
  for (const c of kb.chunks) {
    if (
      ![c.id, c.title, c.text, c.source, c.url, c.publishedAt].every(
        (v) => typeof v === "string",
      ) ||
      c.text.length > 10000
    )
      throw new AgentFault("INVALID_DATA", "知识库字段无效或片段超长");
    const previous = records.get(c.id);
    if (previous) previous.text += "\n" + c.text;
    else
      records.set(c.id, {
        id: c.id,
        title: c.title,
        text: c.text,
        source: c.source,
        url: c.url,
        publishedAt: c.publishedAt,
      });
  }
  return [...records.values()];
}
export function validateTool(name: string, args: unknown, state: ToolState) {
  if (name === "query_news") {
    keys(args, ["keyword"]);
    if (args.keyword !== state.keyword)
      throw new AgentFault(
        "ACCESS_DENIED",
        "keyword必须等于本次任务关键词，模型不能扩大查询范围",
      );
  } else if (name === "compute_stats") {
    keys(args, ["ids"]);
    if (
      !Array.isArray(args.ids) ||
      args.ids.length > 100 ||
      args.ids.some((x) => typeof x !== "string") ||
      new Set(args.ids).size !== args.ids.length
    )
      throw new AgentFault(
        "INVALID_ARGUMENTS",
        "ids必须为最多100个不重复字符串",
      );
    if (!state.queried)
      throw new AgentFault("PRECONDITION", "先查询资料再统计");
    const ids = state.queried.map((r) => r.id);
    if (
      ids.length !== args.ids.length ||
      args.ids.some((id) => !ids.includes(id))
    )
      throw new AgentFault(
        "ACCESS_DENIED",
        "统计ID必须完整等于本次查询结果，不允许遗漏或访问其他文章",
      );
  } else if (name === "save_brief") {
    keys(args, []);
    if (!state.statistics)
      throw new AgentFault("PRECONDITION", "先取得有效统计结果再申请保存");
  } else throw new AgentFault("UNKNOWN_TOOL", "工具不在允许列表中");
}
export async function executeReadTool(
  name: string,
  args: unknown,
  state: ToolState,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  validateTool(name, args, state);
  if (name === "query_news") {
    const matches = state.records.filter((r) =>
      `${r.title}\n${r.text}`.includes(state.keyword),
    );
    if (matches.length > 100)
      throw new AgentFault(
        "RESULT_LIMIT",
        "匹配超过100篇，请缩小任务范围后重启",
      );
    return {
      total: matches.length,
      records: matches.map(({ text, ...r }) => ({
        ...r,
        excerpt: text.slice(0, 300),
      })),
    };
  }
  if (name === "compute_stats") {
    const bySource: Record<string, number> = Object.create(null);
    for (const r of state.queried!)
      bySource[r.source] = (bySource[r.source] || 0) + 1;
    return {
      total: state.queried!.length,
      bySource,
      ids: state.queried!.map((r) => r.id),
    };
  }
  throw new AgentFault("ACCESS_DENIED", "写入工具只能由Harness确认流程执行");
}
export function briefText(state: ToolState, version: string): string {
  const s = state.statistics!;
  return `# 新闻统计简报\n\n关键词：${state.keyword}\n快照：${version}\n匹配篇数：${s.total}\n\n${Object.entries(
    s.bySource,
  )
    .map(([name, n]) => `- ${name}：${n}篇`)
    .join(
      "\n",
    )}\n\n${state.queried!.map((r) => `- [${r.id}] ${r.title}（${r.publishedAt}）\n  ${r.url}`).join("\n")}\n\n范围：本地冻结快照中的标题与摘要精确匹配；不代表全部相关新闻或现实事件数量。\n`;
}
export function saveBrief(directory: string, runId: string, content: string) {
  if (!/^[a-f0-9-]{36}$/.test(runId))
    throw new AgentFault("INVALID_PATH", "任务编号无效");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${runId}.md`);
  if (existsSync(file)) {
    if (readFileSync(file, "utf8") !== content)
      throw new AgentFault(
        "WRITE_CONFLICT",
        "同一任务文件已存在且内容不同，拒绝覆盖",
      );
    return { path: file, alreadySaved: true };
  }
  writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
  return {
    path: file,
    alreadySaved: false,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
