import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../db/connection";

const router = Router();

/**
 * GET /news
 * Returns recent conflict-related news events.
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 72);
    const country = req.query.country as string | undefined;
    const source = req.query.source as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const bbox = req.query.bbox as string | undefined;

    let query = `
      SELECT
        id, external_id, headline, summary, url, source,
        category, language, latitude, longitude, country, published_at, timestamp
      FROM news_events
      WHERE timestamp >= NOW(3) - INTERVAL ? HOUR
    `;

    // 参数顺序必须与 SQL 中 ? 的出现顺序严格一致
    const params: unknown[] = [hours];

    if (country) {
      // utf8mb4_0900_ai_ci 排序规则大小写不敏感，LIKE 即可满足不区分大小写的匹配
      params.push(`%${country}%`);
      query += ` AND country LIKE ?`;
    }

    if (source) {
      params.push(`%${source}%`);
      query += ` AND source LIKE ?`;
    }

    if (bbox) {
      const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
      if ([minLon, minLat, maxLon, maxLat].every((n) => !isNaN(n))) {
        // MySQL 没有 ST_MakeEnvelope，改用闭合 WKT 多边形 + ST_GeomFromText；
        // 轴序沿用 GIS 惯例 POINT(经度 纬度)，SRID 0。多边形环必须闭合。
        query += ` AND latitude IS NOT NULL
          AND ST_Within(geom, ST_GeomFromText(?))`;
        params.push(
          `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`
        );
      }
    }

    params.push(limit);
    // MySQL 不支持 NULLS LAST，等价写法：先按是否为空排序，再按值排序
    query += ` ORDER BY published_at IS NULL, published_at DESC, timestamp DESC LIMIT ?`;

    const result = await pool.query(query, params);
    res.json({ data: result.rows, count: result.rowCount, updated_at: new Date() });
  } catch (err) {
    next(err);
  }
});

export default router;
