import { readFile, mkdir, writeFile, rename } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
export interface Document {
  id: string;
  title: string;
  text: string;
  source: string;
  url: string;
  publishedAt: string;
  permission: string;
}
export interface Chunk extends Document {
  chunkId: string;
}
export interface Knowledge {
  version: string;
  createdAt: string;
  documents: number;
  chunks: Chunk[];
}
export const dataDir = () =>
  path.resolve(process.env.RAG_DATA_DIR || path.join(__dirname, "../../data"));
export function splitText(text: string): string[] {
  const sentences =
    text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^。！？.!?]+[。！？.!?]?/g) || [];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 500) {
      chunks.push(current.trim());
      const last = current.match(/[^。！？.!?]+[。！？.!?]?$/)?.[0] || "";
      current = last.length <= 80 ? last : "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
export async function buildKnowledge(input: Document[]): Promise<Knowledge> {
  if (!Array.isArray(input) || !input.length) throw new Error("资料不能为空");
  const seen = new Set<string>();
  const chunks: Chunk[] = [];
  let documents = 0;
  for (const doc of input) {
    for (const key of [
      "id",
      "title",
      "text",
      "source",
      "url",
      "publishedAt",
      "permission",
    ] as const) {
      if (typeof doc[key] !== "string" || !doc[key].trim())
        throw new Error(`资料缺少 ${key}`);
    }
    if (
      !/^https?:\/\//.test(doc.url) ||
      !Number.isFinite(Date.parse(doc.publishedAt))
    )
      throw new Error("来源 URL 或日期无效");
    const hash = createHash("sha256").update(doc.text.trim()).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    documents++;
    splitText(doc.text).forEach((text, i) =>
      chunks.push({ ...doc, text, chunkId: `${hash.slice(0, 16)}-${i + 1}` }),
    );
  }
  const knowledge = {
    version: createHash("sha256")
      .update(JSON.stringify(chunks))
      .digest("hex")
      .slice(0, 16),
    createdAt: new Date().toISOString(),
    documents,
    chunks,
  };
  await mkdir(dataDir(), { recursive: true });
  const file = path.join(dataDir(), "knowledge.json");
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(knowledge, null, 2));
  await rename(temp, file);
  return knowledge;
}
export async function loadKnowledge(): Promise<Knowledge> {
  try {
    return JSON.parse(
      await readFile(path.join(dataDir(), "knowledge.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: "empty", createdAt: "", documents: 0, chunks: [] };
    throw e;
  }
}
const stop = new Set([
  "的",
  "了",
  "是",
  "在",
  "和",
  "有哪些",
  "什么",
  "请",
  "总结",
  "根据",
  "新闻",
  "报道",
  "情况",
  "资料",
]);
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
export function tokens(text: string): string[] {
  const clean = text
    .toLowerCase()
    .replace(/\d{2,4}年|\d{1,2}月|\d{1,2}日/g, " ")
    .replace(/美乌/g, "美国 乌克兰")
    .replace(/俄乌/g, "俄罗斯 乌克兰");
  const names = ["泽连斯基", "特朗普", "星盾", "星链", "安理会"].filter(
    (name) => clean.includes(name),
  );
  return [
    ...names,
    ...[...segmenter.segment(clean)]
      .filter(
        (s) =>
          s.isWordLike &&
          s.segment.length > 1 &&
          !/^\d+$/.test(s.segment) &&
          !stop.has(s.segment),
      )
      .map((s) => s.segment),
  ];
}
export function retrieve(
  kb: Knowledge,
  query: string,
  region = "",
  from = "",
  to = "",
) {
  const terms = [...new Set(tokens(query))];
  const docs = kb.chunks.filter(
    (c) =>
      (!region || `${c.title} ${c.text}`.includes(region)) &&
      (!from || Date.parse(c.publishedAt) >= Date.parse(from)) &&
      (!to || Date.parse(c.publishedAt) <= Date.parse(to)),
  );
  const bags = docs.map((c) => tokens(`${c.title} ${c.text}`));
  const avg = bags.reduce((n, b) => n + b.length, 0) / (bags.length || 1) || 1;
  return docs
    .map((chunk, i) => {
      const matched = terms.filter((t) => bags[i].includes(t));
      const score = matched.reduce((sum, term) => {
        const df = bags.filter((b) => b.includes(term)).length;
        const tf = bags[i].filter((t) => t === term).length;
        return (
          sum +
          (Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)) * tf * 2.2) /
            (tf + 1.2 * (0.25 + (0.75 * bags[i].length) / avg))
        );
      }, 0);
      return { ...chunk, score, matched };
    })
    .filter((c) => c.matched.length >= Math.min(2, terms.length) && c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}
