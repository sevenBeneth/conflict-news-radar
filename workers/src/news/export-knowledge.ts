import axios from "axios";
import { parseStringPromise } from "xml2js";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
async function main() {
  const url = "https://www.chinanews.com.cn/rss/world.xml";
  const response = await axios.get(url, { timeout: 20000 });
  const xml = await parseStringPromise(response.data);
  const items = xml?.rss?.channel?.[0]?.item;
  if (!Array.isArray(items)) throw new Error("RSS 格式无效");
  const docs = items
    .filter(
      (x) =>
        x.title?.[0] &&
        x.description?.[0] &&
        /^https?:\/\//.test(x.link?.[0]) &&
        Number.isFinite(Date.parse(x.pubDate?.[0])),
    )
    .slice(0, 30)
    .map((x) => ({
      id: createHash("sha256").update(x.link[0]).digest("hex").slice(0, 16),
      title: x.title[0],
      text: String(x.description[0])
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .trim(),
      source: "中新网国际 RSS",
      url: x.link[0],
      publishedAt: new Date(x.pubDate[0]).toISOString(),
      permission:
        "公开 RSS 摘要，仅限本地教学演示；版权归原发布方，未获全文再分发授权。",
      collectedAt: new Date().toISOString(),
      feedUrl: url,
    }));
  const target = path.resolve(process.argv[2] || "../backend/data/news.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(docs, null, 2));
  console.log(
    `已保存 ${docs.length} 条 RSS 摘要至 ${target}。实验开始后请冻结快照。`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
