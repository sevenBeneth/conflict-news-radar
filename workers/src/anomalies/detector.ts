/**
 * Anomaly Detector
 * Runs simple statistical checks on recent data to surface alerts.
 *
 * ─── 查询要点（MySQL 8）──────────────────────────────────────────────────────
 *   · 分桶聚合：ROUND(latitude / 2) * 2，MySQL 的 ROUND 可直接作用于数值列。
 *   · 每类目标只取最新一条：ROW_NUMBER() OVER (PARTITION BY x ORDER BY timestamp DESC) 取 rn = 1
 *   · 时间窗口：NOW(3) - INTERVAL 5 MINUTE
 *   · 布尔列以 0/1 表示：on_ground = 0
 *   · 几何写入用 WKT 文本 + ST_GeomFromText('POINT(lon lat)')，SRID 0
 *
 * ─── 告警幂等（关键，勿破坏）────────────────────────────────────────────────
 *   一、同一异常不得重复插入。
 *     anomaly_alerts 以 external_id 为唯一键（见 database/01-schema.sql）：
 *     本文件为每条告警生成**按时段收敛的确定性 external_id**，
 *     同一异常在同一时间桶内只保留一条（见 buildAlertKey），
 *     写入统一用 ON DUPLICATE KEY UPDATE 覆盖标题/描述/元数据。
 *     若缺少该唯一键，5 分钟一轮的检测会持续堆积重复告警。
 *   二、几何轴序必须显式。
 *     geom 一律写成显式 WKT 字符串 POINT(经度 纬度)，不依赖按位置重复绑定的
 *     参数；否则一旦参数顺序被调整，经度与纬度会静默互换，
 *     而这一点很难从 SQL 文本上看出来。
 */

import { pool } from "../db";
import { logger } from "../logger";

export async function detectAnomalies(): Promise<void> {
  await Promise.allSettled([
    detectConflictSpike(),
    detectAircraftCluster(),
    detectVesselConcentration(),
  ]);
}

/**
 * 生成按时段收敛的告警幂等键。
 *
 * 目的：同一类异常在同一时间桶内只落一条记录，避免 5 分钟一次的轮询
 * 持续堆积重复告警。时间桶默认按小时取整（可传入自定义桶大小）。
 *
 * 例：conflict_spike@2026-10-10T14  → 该小时内无论检测多少次，只留一条
 */
function buildAlertKey(alertType: string, bucketMs = 3_600_000): string {
  const bucket = Math.floor(Date.now() / bucketMs);
  return `${alertType}@${bucket}`;
}

/** Alert if conflict events in the last 3 hours exceed 2× the 7-day hourly average */
async function detectConflictSpike(): Promise<void> {
  try {
    interface SpikeRow {
      recent_count: number;
      avg_per_hour: number | string;
      recent_per_hour: number | string;
    }
    const result = await pool.query<SpikeRow>(`
      WITH hourly_avg AS (
        SELECT COUNT(*) / 168.0 AS avg_per_hour
        FROM conflict_events
        WHERE timestamp >= NOW(3) - INTERVAL 7 DAY
      ),
      recent AS (
        SELECT COUNT(*) AS recent_count
        FROM conflict_events
        WHERE timestamp >= NOW(3) - INTERVAL 3 HOUR
      )
      SELECT recent_count, avg_per_hour,
             (recent_count / 3.0) AS recent_per_hour
      FROM hourly_avg, recent
    `);

    const row = result.rows[0];
    if (!row) return;

    const recentPerHour = parseFloat(String(row.recent_per_hour));
    const avgPerHour = parseFloat(String(row.avg_per_hour));

    if (avgPerHour > 0 && recentPerHour > avgPerHour * 2 && recentPerHour > 3) {
      const ratio = recentPerHour / avgPerHour;
      await pool.query(
        `INSERT INTO anomaly_alerts
           (external_id, alert_type, title, description, severity, metadata, timestamp)
         VALUES (?, 'conflict_spike', ?, ?, 'high', ?, NOW(3))
         ON DUPLICATE KEY UPDATE
           title       = VALUES(title),
           description = VALUES(description),
           metadata    = VALUES(metadata)`,
        [
          buildAlertKey("conflict_spike"),
          "冲突事件数量激增",
          `近期冲突报道速率（${recentPerHour.toFixed(1)} 条/小时）达到 7 日均值（${avgPerHour.toFixed(1)} 条/小时）的 ${ratio.toFixed(1)} 倍。`,
          JSON.stringify({ recentPerHour, avgPerHour, window: "3h" }),
        ]
      );
      logger.warn(`Anomaly: conflict spike detected — ${recentPerHour.toFixed(1)} events/hr`);
    }
  } catch (err) {
    logger.error("Conflict spike detection error:", err);
  }
}

/**
 * 格式化经纬度为可读文本，按正负自动选择半球后缀。
 *
 * ⚠ 半球后缀必须按数值符号判定：若固定输出 `${lat}°N, ${lon}°E`，
 * 西经/南纬会被显示成东经/北纬。实测症状：
 * 旧金山（37.96, -121.96）被写成「37.96°N, -121.96°E」，
 * 而 -121.96° 实为**西经**。坐标数值本身与地图定位都是对的，
 * 但文案会误导阅读告警的人，故按半球分别标注。
 */
function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** Alert if >50 aircraft are clustered within a 2° grid cell */
async function detectAircraftCluster(): Promise<void> {
  try {
    interface ClusterRow {
      lat_bucket: number | string;
      lon_bucket: number | string;
      count: number;
      center_lat: number | string;
      center_lon: number | string;
    }
    const result = await pool.query<ClusterRow>(`
      SELECT
        ROUND(latitude / 2) * 2 AS lat_bucket,
        ROUND(longitude / 2) * 2 AS lon_bucket,
        COUNT(DISTINCT icao24) AS count,
        AVG(latitude) AS center_lat,
        AVG(longitude) AS center_lon
      FROM (
        SELECT * FROM (
          SELECT
            icao24, latitude, longitude,
            ROW_NUMBER() OVER (PARTITION BY icao24 ORDER BY timestamp DESC) AS rn
          FROM aircraft
          WHERE timestamp >= NOW(3) - INTERVAL 5 MINUTE
            AND on_ground = 0
            AND latitude IS NOT NULL
        ) t WHERE t.rn = 1
      ) sub
      GROUP BY lat_bucket, lon_bucket
      HAVING COUNT(DISTINCT icao24) > 50
      ORDER BY count DESC
      LIMIT 5
    `);

    for (const row of result.rows) {
      const centerLat = parseFloat(String(row.center_lat));
      const centerLon = parseFloat(String(row.center_lon));
      await pool.query(
        `INSERT INTO anomaly_alerts
           (external_id, alert_type, title, description, severity,
            latitude, longitude, geom, metadata, timestamp)
         VALUES (?, 'aircraft_cluster', ?, ?, 'medium', ?, ?, ST_GeomFromText(?), ?, NOW(3))
         ON DUPLICATE KEY UPDATE
           title       = VALUES(title),
           description = VALUES(description),
           metadata    = VALUES(metadata)`,
        [
          buildAlertKey(`aircraft_cluster:${row.lat_bucket}:${row.lon_bucket}`),
          `航空器聚集：${row.count} 架空中目标`,
          `在中心位于 ${formatCoord(centerLat, centerLon)} 的 2° 网格内检测到 ${row.count} 架空中航空器。`,
          centerLat,
          centerLon,
          // 轴序 POINT(经度 纬度)，SRID 0
          `POINT(${centerLon} ${centerLat})`,
          JSON.stringify({ count: row.count, lat_bucket: row.lat_bucket, lon_bucket: row.lon_bucket }),
        ]
      );
    }

    if (result.rowCount && result.rowCount > 0) {
      logger.info(`Anomaly: ${result.rowCount} aircraft cluster(s) detected`);
    }
  } catch (err) {
    logger.error("Aircraft cluster detection error:", err);
  }
}

/** Alert if >20 vessels are within a 1° grid cell */
async function detectVesselConcentration(): Promise<void> {
  try {
    interface ClusterRow {
      lat_bucket: number | string;
      lon_bucket: number | string;
      count: number;
      center_lat: number | string;
      center_lon: number | string;
    }
    const result = await pool.query<ClusterRow>(`
      SELECT
        ROUND(latitude) AS lat_bucket,
        ROUND(longitude) AS lon_bucket,
        COUNT(DISTINCT mmsi) AS count,
        AVG(latitude) AS center_lat,
        AVG(longitude) AS center_lon
      FROM (
        SELECT * FROM (
          SELECT
            mmsi, latitude, longitude,
            ROW_NUMBER() OVER (PARTITION BY mmsi ORDER BY timestamp DESC) AS rn
          FROM vessels
          WHERE timestamp >= NOW(3) - INTERVAL 30 MINUTE
            AND latitude IS NOT NULL
        ) t WHERE t.rn = 1
      ) sub
      GROUP BY lat_bucket, lon_bucket
      HAVING COUNT(DISTINCT mmsi) > 20
      ORDER BY count DESC
      LIMIT 3
    `);

    for (const row of result.rows) {
      const centerLat = parseFloat(String(row.center_lat));
      const centerLon = parseFloat(String(row.center_lon));
      await pool.query(
        `INSERT INTO anomaly_alerts
           (external_id, alert_type, title, description, severity,
            latitude, longitude, geom, metadata, timestamp)
         VALUES (?, 'vessel_concentration', ?, ?, 'low', ?, ?, ST_GeomFromText(?), ?, NOW(3))
         ON DUPLICATE KEY UPDATE
           title       = VALUES(title),
           description = VALUES(description),
           metadata    = VALUES(metadata)`,
        [
          buildAlertKey(`vessel_concentration:${row.lat_bucket}:${row.lon_bucket}`),
          `船舶聚集：${row.count} 艘`,
          `在中心位于 ${formatCoord(centerLat, centerLon)} 的 1° 网格内检测到 ${row.count} 艘船舶。`,
          centerLat,
          centerLon,
          `POINT(${centerLon} ${centerLat})`,
          JSON.stringify({ count: row.count }),
        ]
      );
    }
  } catch (err) {
    logger.error("Vessel concentration detection error:", err);
  }
}
