/**
 * 地区冲突资讯雷达 · 数据采集调度器
 * ----------------------------------------------------------------------------
 * 按可配置周期触发各数据域的采集任务。每个采集任务独立捕获异常，
 * 单个数据源不可用不影响其他数据域。
 */

import "dotenv/config";
import { fetchAircraft } from "./aircraft/opensky";
import { fetchShips } from "./ships/aisstream";
import { fetchConflicts } from "./conflicts/acled";
import { detectAnomalies } from "./anomalies/detector";
import { connectDB, pool } from "./db";
import { logger } from "./logger";

const INTERVALS = {
  aircraft: Number(process.env.POLL_INTERVAL_AIRCRAFT) || 30_000,
  ships: Number(process.env.POLL_INTERVAL_SHIPS) || 60_000,
  conflicts: Number(process.env.POLL_INTERVAL_CONFLICTS) || 300_000,
  anomalies: 300_000,
};

async function waitForDB(retries = 10): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      await connectDB();
      return;
    } catch {
      logger.warn("Workers: DB not ready, retry " + i + "/" + retries + "...");
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
      logger.info("Worker [" + name + "] starting");
      await fn();
      logger.info("Worker [" + name + "] completed");
    } catch (err) {
      logger.error("Worker [" + name + "] error:", err);
    }
  };
  run();
  setInterval(run, interval);
  logger.info("Worker [" + name + "] scheduled every " + interval / 1000 + "s");
}

async function main(): Promise<void> {
  logger.info("Workers starting...");
  await waitForDB();
  scheduleWorker("aircraft", fetchAircraft, INTERVALS.aircraft);
  scheduleWorker("ships", fetchShips, INTERVALS.ships);
  scheduleWorker("conflicts", fetchConflicts, INTERVALS.conflicts);
  scheduleWorker("anomalies", detectAnomalies, INTERVALS.anomalies);
  logger.info("All workers scheduled. Running...");
}

main().catch((err) => {
  logger.error("Fatal worker error:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  logger.info("Workers: SIGTERM received, shutting down gracefully");
  await pool.end();
  process.exit(0);
});