/**
 * CNR · 中文新闻 RSS 采集器
 * ----------------------------------------------------------------------------
 * 本采集器直接订阅中文媒体的官方 RSS 源；与 news/gdelt.ts 的境外检索式采集
 * 并列存在，可通过 NEWS_PROVIDER 选择其一运行。
 *
 * ─── 为什么以官方 RSS 源为主 ─────────────────────────────────────────────────
 *   · 境外检索接口的服务器在境外，实测频繁返回 HTTP 429（限流），国内可达性不稳定；
 *   · 检索为英文关键词，且 sourcecountry 为英文，与"中文地区冲突新闻"的
 *     选题定位不符；
 *   · 官方 RSS 源由媒体主动提供，属正常订阅用法，优于爬取网页。
 *
 * ─── 已实测验证的源（HTTP 200，实时更新）─────────────────────────────────────
 *   · 中新网国际新闻  https://www.chinanews.com.cn/rss/world.xml
 *       pubDate 为规范 RFC-822（带 +0800 时区）→ Date 可直接解析；
 *       description 已是 1–2 句纯文本摘要，且**摘要内直接含地名**。
 *   · 人民网国际频道  http://www.people.com.cn/rss/world.xml
 *       pubDate 只有日期（无时间无时区）；
 *       description 为**整篇正文 HTML**（含 <p>/<img>/<script>），必须清洗。
 *
 * ─── 两个源的差异处理 ───────────────────────────────────────────────────────
 *   本模块对每个源单独记录 pubDateFormat 与 descriptionKind，
 *   避免"一套解析走天下"导致人民网的时间精度与摘要质量双双劣化。
 *
 * ─── 去重 ────────────────────────────────────────────────────────────────────
 *   external_id = `${sourceKey}-${sha1(link)}`，配合 INSERT IGNORE，
 *   同一文章重复抓取会被数据库自动跳过，无需在应用层维护去重状态。
 */

import axios from "axios";
import { parseStringPromise } from "xml2js";
import { createHash } from "crypto";
import { pool } from "../db";
import { logger } from "../logger";
import { identifyPlaces, isDomesticPlace } from "./geo-dict";

/** 单条源的配置 */
interface RssSource {
  /** 源的稳定标识，用于 external_id 前缀与日志（换 URL 时应保持不变） */
  key: string;
  /** 媒体名，写入 news_events.source */
  name: string;
  /** RSS 地址 */
  url: string;
  /** 分类，写入 news_events.category */
  category: string;
  /**
   * pubDate 格式：
   *   "rfc822" → 直接 new Date()（中新网）
   *   "date"   → 仅日期 YYYY-MM-DD，按 UTC 当日零点处理
   */
  pubDateFormat: "rfc822" | "date";
  /**
   * description 内容形态：
   *   "summary" → 已是纯文本摘要，轻量清洗即可（中新网）
   *   "html"    → 整篇正文 HTML，需彻底剥标签
   */
  descriptionKind: "summary" | "html";
  /**
   * 是否启用。false 表示该源已知不可用，保留配置仅作记录，
   * 避免每次采集都白白请求一次并污染日志。
   */
  enabled: boolean;
  /** 备注：为何启用/禁用，便于后人判断 */
  note?: string;
}

/**
 * 默认源列表（已按实测新鲜度筛选）。
 *
 * 可通过环境变量 NEWS_RSS_SOURCES 覆盖，格式为分号分隔：
 *   标识|媒体名|RSS地址|分类|pubDate格式|description形态|启用(1/0)
 * 例：
 *   NEWS_RSS_SOURCES=chinanews_world|中新网|https://...|国际|rfc822|summary|1
 */
const DEFAULT_SOURCES: RssSource[] = [
  {
    key: "chinanews_world",
    name: "中新网",
    url: "https://www.chinanews.com.cn/rss/world.xml",
    category: "国际",
    pubDateFormat: "rfc822",
    descriptionKind: "summary",
    enabled: true,
    note: "实测首条距今 0 天；pubDate 带 +0800 时区；摘要纯文本且含地名",
  },
  {
    key: "chinanews_scroll",
    name: "中新网",
    url: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    category: "要闻",
    pubDateFormat: "rfc822",
    descriptionKind: "summary",
    enabled: true,
    note: "实测首条距今 0 天；滚动即时新闻，覆盖国际新闻之外的冲突相关条目",
  },
  {
    key: "chinanews_import",
    name: "中新网",
    url: "https://www.chinanews.com.cn/rss/importnews.xml",
    category: "要闻",
    pubDateFormat: "rfc822",
    descriptionKind: "summary",
    enabled: true,
    note: "实测首条距今 0.3 天；要闻导读，与滚动新闻存在部分重叠（靠 INSERT IGNORE 去重）",
  },

  // ─── 以下源经实测不可用，默认关闭，仅作记录 ───────────────────────────────
  {
    key: "people_world",
    name: "人民网",
    url: "http://www.people.com.cn/rss/world.xml",
    category: "国际",
    pubDateFormat: "date",
    descriptionKind: "html",
    enabled: false,
    note:
      "【已停更】实测 HTTP 200 且返回 100 条，但 channel 时间戳永久停在 2025-06-05，" +
      "首条新闻距今 494 天；HTTP 与 HTTPS 返回字节完全相同，说明是静态缓存副本。" +
      "同站其他频道同样陈旧（edu 停在 2016、bbs 停在 2008），判断该站 RSS 已停止维护。" +
      "若日后恢复更新，把 enabled 改为 true 即可启用。",
  },
  {
    key: "xinhuanet_world",
    name: "新华网",
    url: "http://www.xinhuanet.com/world/news_world.xml",
    category: "国际",
    pubDateFormat: "rfc822",
    descriptionKind: "summary",
    enabled: false,
    note:
      "【待验证】返回 300 条但 XML 中**没有 pubDate 字段**，无法判断时效，也无法填充" +
      "published_at（会退化为入库时间，使'近 N 小时'筛选失真）。" +
      "如需启用，应先确认其时间字段名（可能是 dc:date 命名空间），并补上对应解析分支。",
  },
];

/**
 * 从环境变量解析源列表；未配置或解析失败时回退到默认值。
 * 环境变量中未指定启用位时默认启用。
 */
function resolveSources(): RssSource[] {
  const raw = process.env.NEWS_RSS_SOURCES?.trim();
  if (!raw) return DEFAULT_SOURCES.filter((s) => s.enabled);

  const parsed: RssSource[] = [];
  for (const entry of raw.split(";")) {
    const parts = entry.split("|").map((s) => s.trim());
    if (parts.length < 4) {
      logger.warn(`NEWS_RSS_SOURCES 条目格式不正确，已跳过：${entry}`);
      continue;
    }
    const [key, name, url, category, fmt, kind, enabled] = parts;
    parsed.push({
      key,
      name,
      url,
      category,
      pubDateFormat: fmt === "date" ? "date" : "rfc822",
      descriptionKind: kind === "html" ? "html" : "summary",
      // 未写第 7 段时默认启用，避免用户配置因缺省而静默失效
      enabled: enabled === undefined ? true : enabled === "1" || enabled === "true",
    });
  }

  const active = parsed.filter((s) => s.enabled);
  return active.length > 0 ? active : DEFAULT_SOURCES.filter((s) => s.enabled);
}

/** 新鲜度告警阈值：源内最新一条超过该小时数即告警（默认 48 小时） */
const STALE_WARN_HOURS = Number(process.env.NEWS_STALE_WARN_HOURS ?? 48);

/** RSS 条目的原始字段（xml2js 默认把子元素解析为数组） */
interface RawRssItem {
  title?: string[];
  link?: string[];
  description?: string[];
  pubDate?: string[];
  category?: string[];
}

/**
 * 清洗文本。
 *
 * 处理内容：
 *   1. 剥离 HTML 标签（人民网的 description 是整篇正文）
 *   2. 移除 <script>/<style> 的内容块 —— 必须在剥标签**之前**做，
 *      否则脚本正文会被当成可见文本留下来
 *   3. 解码常见 HTML 实体
 *   4. 移除残缺实体（实测中新网描述中存在 `#8195;` `#8203;` 这类
 *      缺失 `&#` 前缀的段落标记/零宽字符残留）
 *   5. 压缩连续空白
 */
export function cleanText(input = ""): string {
  let s = String(input);

  // 2) 先整体删除脚本与样式块及其内容
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");

  // 1) 剥标签
  s = s.replace(/<[^>]+>/g, " ");

  // 3) 常见实体
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)));

  // 4) 残缺实体残留（如 #8195; #8203;）
  s = s.replace(/#\d+;/g, " ");

  // 5) 压缩空白
  return s.replace(/\s+/g, " ").trim();
}

/**
 * 解析发布时间。
 *
 * 必须按源区分，否则会出现两类错误：
 *   · 对人民网的纯日期串强行解析 → 得到 UTC 零点，尚可接受但精度只到天；
 *   · 解析失败时若直接 new Date()，会把陈年旧闻标成"刚刚发生"，
 *     误导"近 N 小时"筛选。因此失败时返回 null，由调用方回退到入库时间。
 */
export function parsePubDate(raw: string | undefined, format: RssSource["pubDateFormat"]): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  if (format === "date") {
    // 仅日期：按 UTC 当日零点，保证与库中其他 DATETIME(3) 的 UTC 语义一致
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 生成去重键：**仅由链接决定**，不含源标识。
 *
 * ─── 为什么刻意不含 sourceKey（实测教训）────────────────────────────────────
 *   若按 `${sourceKey}-${sha1(link)}`（源 + 链接）去重，会出问题：
 *   中新网的「国际频道」与「要闻频道」存在大量**同一篇文章**（链接完全相同），
 *   按源去重会导致同一新闻在库中出现两条、地图上出现两个重叠标记。
 *
 *   因此改为**按链接全局去重**：
 *     · 同一文章无论出现在几个频道，只入库一次（先到者胜，保留其频道分类）；
 *     · 换源或调整频道配置也不会产生重复。
 *   代价是丢失"该文章还被哪些频道收录"的信息 —— 对本项目的展示目标而言无影响。
 */
function buildExternalId(link: string): string {
  const hash = createHash("sha1").update(link).digest("hex").slice(0, 40);
  return `news-${hash}`;
}

/**
 * 抓取并解析单个源。
 *
 * 只做网络与解析工作，**不触碰数据库** —— 这是为了把抓取与写库解耦，
 * 从而支持"并发抓取、串行写库"（原因见 fetchNewsRss 的说明）。
 *
 * 返回待写入的扁平参数数组与条目数。
 */
async function fetchSource(
  src: RssSource
): Promise<{ values: unknown[]; placeholders: number }> {
  const response = await axios.get(src.url, {
    timeout: 30_000,
    responseType: "text",
    // 带明确的 UA，避免被当作爬虫拦截；同时便于对方识别流量来源
    headers: {
      "User-Agent": "CNR/1.1 (regional conflict news aggregator; personal use)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    // RSS 为 XML 文本，不能让 axios 尝试解析 JSON
    transformResponse: [(data: unknown) => data],
  });

  const xml = typeof response.data === "string" ? response.data : String(response.data);

  const parsed = await parseStringPromise(xml, {
    // 每个子元素都解析为数组，便于统一按 item.title[0] 取值
    explicitArray: true,
    // 去除元素文本首尾空白
    trim: true,
    // 说明：xml2js 没有 cdata 选项，它对 CDATA 的处理是**默认拼接**其文本内容，
    // 因此人民网用 <![CDATA[...]]> 包裹的 title 无需额外配置即可正确取值。
  });

  const items: RawRssItem[] = parsed?.rss?.channel?.[0]?.item ?? [];
  if (items.length === 0) {
    logger.warn(`${src.name}：未解析到任何条目（URL=${src.url}）`);
    return { values: [], placeholders: 0 };
  }

  const now = new Date();
  const values: unknown[] = [];
  const placeholders: string[] = [];

  // 记录源内最新一条的发布时间，用于新鲜度自检
  let newestPublished: Date | null = null;

  // 地名识别统计，用于评估规则抽取的质量并暴露歧义比例
  const geoStat = { matched: 0, sportsExcluded: 0, lowConfidence: 0, domesticSkipped: 0 };

  for (const item of items) {
    const link = cleanText(item.link?.[0] ?? "");
    const title = cleanText(item.title?.[0] ?? "");
    // 无链接或无标题的条目直接丢弃：链接是溯源的核心字段，标题为空则无展示价值
    if (!link || !title) continue;

    const rawDesc = item.description?.[0] ?? "";
    const summary = cleanText(rawDesc).slice(0, 500) || null;

    const publishedAt = parsePubDate(item.pubDate?.[0], src.pubDateFormat);
    if (publishedAt && (!newestPublished || publishedAt > newestPublished)) {
      newestPublished = publishedAt;
    }

    // 地名识别（纯规则，不依赖 AI）：
    // 标题在前、摘要随后；返回带置信度的候选列表，取最高分候选落库。
    const geo = identifyPlaces(title, summary ?? "");
    if (geo.place) geoStat.matched++;
    if (geo.excludedAsSports) geoStat.sportsExcluded++;
    if (geo.confidence > 0 && geo.confidence < 0.6) geoStat.lowConfidence++;

    /**
     * 国内新闻过滤。
     *
     * 本项目选题是「地区冲突资讯雷达」，关注境外冲突地区。
     * 中新网的「要闻/即时」频道含大量国内地方新闻（赛事洽谈、文旅活动、
     * 天气、演讲比赛、体育赛事……），既无冲突信息，又会把标记堆到国内，
     * 因此整体丢弃，不写入数据库。
     *
     * 判定依据是地名条目的 isDomestic 标记（显式清单），
     * 而非坐标包围盒 —— 后者会把朝鲜、韩国、越南等邻国误判为国内。
     */
    if (isDomesticPlace(geo.place)) {
      geoStat.domesticSkipped++;
      continue;
    }

    values.push(
      buildExternalId(link),
      title.slice(0, 500),
      summary,
      link.slice(0, 1000),
      src.name,
      src.category,
      "zh",
      // country 写入命中的规范地名，使「按国家/地区筛选」可用
      geo.place,
      geo.lat, // latitude
      geo.lon, // longitude
      publishedAt, // 允许为 null，库里该列可空
      now, // timestamp 入库时间
      // geom：仅在有坐标时构造，轴序为 POINT(经度 纬度)
      geo.lat !== null && geo.lon !== null ? `POINT(${geo.lon} ${geo.lat})` : null
    );

    // 13 个占位符：前 12 个普通字段 + 最后 1 个包在 ST_GeomFromText 内
    placeholders.push("(?,?,?,?,?,?,?,?,?,?,?,?,ST_GeomFromText(?))");
  }

  if (placeholders.length === 0) {
    logger.warn(`${src.name}：所有条目均缺少链接或标题，已跳过`);
    return { values, placeholders: 0 };
  }

  // 新鲜度自检（写库前完成，与写库解耦）
  if (newestPublished) {
    const ageHours = (now.getTime() - newestPublished.getTime()) / 3_600_000;
    if (ageHours > STALE_WARN_HOURS) {
      logger.warn(
        `${src.name}（${src.key}）数据可能已停更：源内最新一条发布于 ` +
          `${newestPublished.toISOString()}，距今 ${ageHours.toFixed(0)} 小时 ` +
          `（阈值 ${STALE_WARN_HOURS} 小时）。该源返回了 ${items.length} 条数据，` +
          `但内容陈旧，建议核查是否仍为有效订阅源。`
      );
    }
  } else {
    logger.warn(
      `${src.name}（${src.key}）的条目中没有任何可解析的发布时间，` +
        `published_at 将退化为入库时间，可能影响"近 N 小时"筛选的准确性。`
    );
  }

  // 地名识别质量小结：便于判断规则方案的实际覆盖能力，
  // 也为后续"是否真的需要引入 AI"提供量化依据。
  logger.info(
    `${src.name} 地名识别：命中 ${geoStat.matched}/${items.length} 条` +
      `（其中低置信度 ${geoStat.lowConfidence} 条），` +
      `因体育/文体语境排除 ${geoStat.sportsExcluded} 条，` +
      `因属国内新闻过滤 ${geoStat.domesticSkipped} 条`
  );

  return { values, placeholders: placeholders.length };
}

/**
 * 写入一批新闻。
 *
 * 由 fetchNewsRss **串行调用**（原因见该函数说明）。
 * 使用 INSERT IGNORE：external_id 重复的条目由数据库直接跳过，
 * 返回值为实际插入行数。
 */
async function insertItems(values: unknown[], count: number): Promise<number> {
  const placeholders = Array.from(
    { length: count },
    () => "(?,?,?,?,?,?,?,?,?,?,?,?,ST_GeomFromText(?))"
  );

  const result = await pool.query(
    `INSERT IGNORE INTO news_events
       (external_id, headline, summary, url, source, category, language, country,
        latitude, longitude, published_at, timestamp, geom)
     VALUES ${placeholders.join(",")}`,
    values
  );

  return result.rowCount;
}

/**
 * 采集入口：**并发抓取、串行写库**。
 *
 * ─── 为什么写库必须串行（实测教训）──────────────────────────────────────────
 *   最初实现是"整条链路并发"（抓取 + 写库都在 map 里）。三个源同时向
 *   news_events 做批量 INSERT IGNORE 时，InnoDB 在唯一键 external_id 的
 *   重复检查上会申请**间隙锁**，两个事务互相持有对方需要的锁，实测报出：
 *       Deadlock found when trying to get lock; try restarting transaction
 *
 *   修复思路：把"网络抓取"与"数据库写入"解耦。
 *     · 抓取阶段并发 —— 耗时由网络往返决定（数百毫秒），并发收益明显；
 *     · 写入阶段串行 —— 单批 30 条本地插入仅数毫秒，串行代价可忽略，
 *       且彻底消除死锁，无需引入重试逻辑带来的复杂度。
 *
 * 单源抓取失败不影响其他源。
 */
export async function fetchNewsRss(): Promise<void> {
  const sources = resolveSources();

  // ── 阶段一：并发抓取与解析（不触碰数据库）──
  const fetched = await Promise.allSettled(
    sources.map(async (src) => ({ src, payload: await fetchSource(src) }))
  );

  // ── 阶段二：串行写库 ──
  let total = 0;
  let failed = 0;

  for (const outcome of fetched) {
    if (outcome.status === "rejected") {
      failed++;
      logger.error(`新闻源抓取失败：`, outcome.reason);
      continue;
    }

    const { src, payload } = outcome.value;
    if (payload.placeholders === 0) continue;

    try {
      const result = await insertItems(payload.values, payload.placeholders);
      total += result;
      logger.info(`${src.name}：新增 ${result} 条新闻（源 ${src.key}）`);
    } catch (err) {
      failed++;
      logger.error(`${src.name} 写库失败（源 ${src.key}）：`, err);
    }
  }

  // 保留策略：与 GDELT 采集器一致，仅保留最近 48 小时
  await pool.query(`DELETE FROM news_events WHERE timestamp < NOW(3) - INTERVAL 48 HOUR`);

  logger.info(
    `新闻采集完成：共新增 ${total} 条（源 ${sources.length} 个，失败 ${failed} 个）`
  );
}
