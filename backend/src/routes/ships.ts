import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../db/connection";

const router = Router();

/**
 * GET /ships
 * Returns recent vessel positions.
 *
 * 查询要点（MySQL 8，与 aircraft 路由同构）：
 *   · 每艘船只取最新一条位置：窗口函数按 mmsi 分组、timestamp 倒序取 rn = 1。
 *   · 时间窗口：NOW(3) - INTERVAL ? MINUTE（参数绑定）。
 *   · 空间过滤：MySQL 没有 ST_MakeEnvelope，改用闭合 WKT 多边形
 *     + ST_GeomFromText(?)。
 *   · 大小写匹配：utf8mb4_0900_ai_ci 排序规则不敏感，LIKE 即可。
 *
 * 船舶功能按需求**完整保留**：路由、字段、返回结构均未删减。
 * 接入国内 AIS 数据源后无需改动本文件即可生效（见 data_sources 表）。
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const minutes = Math.min(Number(req.query.minutes) || 30, 120);
    const vesselType = req.query.type as string | undefined;
    const bbox = req.query.bbox as string | undefined;

    // 动态条件与参数按同一顺序累积，保证 ? 与 params 下标严格对应
    const params: unknown[] = [];
    let whereExtra = "";

    params.push(minutes);
    whereExtra += ` AND timestamp >= NOW(3) - INTERVAL ? MINUTE`;

    if (vesselType) {
      params.push(`%${vesselType}%`);
      whereExtra += ` AND vessel_type LIKE ?`;
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

    params.push(2000);

    const query = `
      SELECT
        id, mmsi, name, vessel_type, flag,
        latitude, longitude, speed, course, heading,
        destination, status, length, timestamp
      FROM (
        SELECT
          id, mmsi, name, vessel_type, flag,
          latitude, longitude, speed, course, heading,
          destination, status, length, timestamp,
          ROW_NUMBER() OVER (PARTITION BY mmsi ORDER BY timestamp DESC) AS rn
        FROM vessels
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
          ${whereExtra}
      ) latest
      WHERE rn = 1
      ORDER BY mmsi, timestamp DESC
      LIMIT ?
    `;

    const result = await pool.query(query, params);
    res.json({ data: result.rows, count: result.rowCount, updated_at: new Date() });
  } catch (err) {
    next(err);
  }
});

export default router;
