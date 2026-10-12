import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../db/connection";

const router = Router();

/**
 * GET /conflicts
 * Returns conflict events with optional filters.
 *
 * 查询要点（MySQL 8）：
 *   · 时间范围：CURDATE() - INTERVAL ? DAY（参数绑定）。
 *   · 大小写匹配：utf8mb4_0900_ai_ci 排序规则不敏感，LIKE 即可。
 *   · 空间过滤：MySQL 没有 ST_MakeEnvelope，改用闭合 WKT 多边形
 *     + ST_GeomFromText(?)。
 *
 * ⚠ SELECT 列表**不可**加入 `source_url`：
 *   conflict_events 表没有该列（见 database/01-schema.sql），一旦引用，
 *   任何 GET /api/conflicts 调用都会因 `Unknown column 'source_url'` 而 500。
 *   事件溯源所需的来源链接由 news_events.url 承担。
 *
 * 冲突事件功能按需求**完整保留**，接入数据源后无需改动本文件。
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const severity = req.query.severity as string | undefined;
    const country = req.query.country as string | undefined;
    const region = req.query.region as string | undefined;
    const bbox = req.query.bbox as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 500, 2000);

    // 动态条件与参数按同一顺序累积，保证 ? 与 params 下标严格对应
    const params: unknown[] = [];
    let whereExtra = "";

    params.push(days);
    whereExtra += ` AND event_date >= CURDATE() - INTERVAL ? DAY`;

    if (severity) {
      params.push(severity);
      whereExtra += ` AND severity = ?`;
    }

    if (country) {
      params.push(`%${country}%`);
      whereExtra += ` AND country LIKE ?`;
    }

    if (region) {
      params.push(`%${region}%`);
      whereExtra += ` AND region LIKE ?`;
    }

    if (bbox) {
      const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
      if ([minLon, minLat, maxLon, maxLat].every((n) => !isNaN(n))) {
        params.push(
          `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`
        );
        whereExtra += ` AND ST_Within(geom, ST_GeomFromText(?))`;
      }
    }

    params.push(limit);

    const query = `
      SELECT
        id, external_id, event_type, sub_event_type, country, region,
        location, latitude, longitude, description, source,
        severity, fatalities, event_date, timestamp
      FROM conflict_events
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        ${whereExtra}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const result = await pool.query(query, params);
    res.json({ data: result.rows, count: result.rowCount, updated_at: new Date() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /conflicts/stats
 * Returns aggregated statistics for the dashboard.
 *
 * 查询要点（MySQL 8）：
 *   · 分类计数：MySQL 不支持 FILTER (WHERE ...) 聚合过滤，
 *     用 SUM(CASE WHEN ... THEN 1 ELSE 0 END) 等价表达。
 *   · SUM(fatalities) 在无匹配行时返回 NULL，前端会拿到 null 而非 0；
 *     用 COALESCE(...,0) 保证始终为数值。
 *   · 时间范围：CURDATE() - INTERVAL 30 DAY
 */
router.get("/stats", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                                AS total,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)  AS critical,
        SUM(CASE WHEN severity = 'high'     THEN 1 ELSE 0 END)  AS high,
        SUM(CASE WHEN severity = 'medium'   THEN 1 ELSE 0 END)  AS medium,
        SUM(CASE WHEN severity = 'low'      THEN 1 ELSE 0 END)  AS low,
        COALESCE(SUM(fatalities), 0)                            AS total_fatalities,
        COUNT(DISTINCT country)                                 AS countries_affected
      FROM conflict_events
      WHERE event_date >= CURDATE() - INTERVAL 30 DAY
    `);
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
