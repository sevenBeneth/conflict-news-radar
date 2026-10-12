/**
 * CNR Worker Process
 * Manages all data ingestion workers with configurable poll intervals.
 *
 * 国内化说明：
 *   四个采集器（航班 / 船舶 / 冲突 / 新闻）按需求**全部保留**，调度逻辑未变。
 *   各采集器内部的数据源端点可独立替换（见 database/02-seed.sql 的
 *   data_sources 表 replace_target 字段），替换时无需改动本文件。
 *
 * 新闻采集器已于本次改造完成国内化替换：
 *   GDELT（境外、实测频繁 429）→ 中新网 + 人民网 官方 RSS（境内）。
 *   GDELT 实现保留在 news/gdelt.ts，可通过 NEWS_PROVIDER=gdelt 回退，
 *   便于对照与应急。
 */

import "dotenv/config";
import { fetchAircraft } from "./aircraft/opensky";
import { fetchShips } from "./ships/aisstream";
import { fetchConflicts } from "./conflicts/acled";
import { fetchNewsRss } from "./news/rss";
import { fetchNews as fetchNewsGdelt } from "./news/gdelt";
import { detectAnomalies } from "./anomalies/detector";
import { connectDB, pool } from "./db";
import { logger } from "./logger";

const INTERVALS = {
  aircraft: Number(process.env.POLL_INTERVAL_AIRCRAFT) || 30_000,
  ships: Number(process.env.POLL_INTERVAL_SHIPS) || 60_000,
  conflicts: Number(process.env.POLL_INTERVAL_CONFLICTS) || 300_000,
  news: Number(process.env.POLL_INTERVAL_NEWS) || 120_000,
  anomalies: 300_000, // every 5 minutes
};

/**
 * 选择新闻采集实现。
 *
 * 默认走国内 RSS；设 NEWS_PROVIDER=gdelt 可切回原 GDELT 实现，
 * 便于在 RSS 源临时不可用时应急，或做两者对比。
 */
function resolveNewsFetcher(): { name: string; fn: () => Promise<void> } {
  const provider = (process.env.NEWS_PROVIDER ?? "rss").toLowerCase();
  if (provider === "gdelt") {
    return { name: "news(gdelt)", fn: fetchNewsGdelt };
  }
  return { name: "news(rss)", fn: fetchNewsRss };
}

async function waitForDB(retries = 10): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      // 共享层已封装 MySQL 连接与空间类型自检
      await connectDB();
      return;
    } catch {
      logger.warn(`Workers: DB not ready, retry ${i}/${retries}...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("Workers: Could not connect to MySQL after retries");
}

function scheduleWorker(
  name: string,
  fn: () => Promise<void>,
  interval: number
): void {
  const run = async () => {
    try {
      logger.info(`Worker [${name}] starting`);
      await fn();
      logger.info(`Worker [${name}] completed`);
    } catch (err) {
      logger.error(`Worker [${name}] error:`, err);
    }
  };

  // Run immediately, then on interval
  run();
  setInterval(run, interval);
  logger.info(`Worker [${name}] scheduled every ${interval / 1000}s`);
}

async function main(): Promise<void> {
  logger.info("CNR Workers starting...");

  await waitForDB();

  const news = resolveNewsFetcher();

  scheduleWorker("aircraft", fetchAircraft, INTERVALS.aircraft);
  scheduleWorker("ships", fetchShips, INTERVALS.ships);
  scheduleWorker("conflicts", fetchConflicts, INTERVALS.conflicts);
  scheduleWorker(news.name, news.fn, INTERVALS.news);
  scheduleWorker("anomalies", detectAnomalies, INTERVALS.anomalies);

  logger.info("All workers scheduled. Running...");
}

main().catch((err) => {
  logger.error("Fatal worker error:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Workers: SIGTERM received, shutting down gracefully");
  await pool.end();
  process.exit(0);
});
