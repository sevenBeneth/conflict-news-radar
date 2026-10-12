import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../db/connection";

const router = Router();

/**
 * 解析 on_ground 查询参数。
 *
 * 前端 FilterPanel 传递的是 `on_ground=1`；若只按 `=== "true"` 判定，
 * 传 `1` 会被解析为 false，过滤**完全反向**——用户勾选「显示地面航空器」
 * 反而看到的是空中目标。故兼容 true/1/yes/on 等常见写法，且大小写不敏感。
 */
function parseOnGround(raw: unknown): boolean {
  const v = String(raw).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * GET /aircraft
 * Returns aircraft positions from the last N minutes (default 5).
 *
 * 查询要点（MySQL 8）：
 *   · 每架航空器只取最新一条位置：用窗口函数按 icao24 分组，
 *     按 timestamp 倒序取 rn = 1，即同组内时间最新的一行。
 *     注意：排序必须写在窗口函数内部；外层仅按最终结果排序。
 *   · 时间窗口：NOW(3) - INTERVAL ? MINUTE（参数绑定，不拼串）。
 *   · 空间过滤：MySQL 没有 ST_MakeEnvelope，改用闭合 WKT 多边形
 *     + ST_GeomFromText(?)（多边形环必须闭合）。
 *   · 大小写匹配：utf8mb4_0900_ai_ci 排序规则不敏感，LIKE 即可。
 *   · 外层显式列出字段，避免 ROW_NUMBER 的 rn 列泄漏到 API 响应中。
 *
 * 航班功能按需求**完整保留**：路由、字段、返回结构均未删减。
 * 数据源变更（见 data_sources 表 replace_target）无需改动本文件即可生效。
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const minutes = Math.min(Number(req.query.minutes) || 5, 60);
    const bbox = req.query.bbox as string | undefined;
    const onGround = req.query.on_ground;

    // 动态条件与参数按同一顺序累积，保证 ? 与 params 下标严格对应
    const params: unknown[] = [];
    let whereExtra = "";

    params.push(minutes);
    whereExtra += ` AND timestamp >= NOW(3) - INTERVAL ? MINUTE`;

    if (onGround !== undefined) {
      // MySQL 以 0/1 表示布尔；mysql2 会将 JS 布尔自动转为 1/0
      params.push(parseOnGround(onGround));
      whereExtra += ` AND on_ground = ?`;
    }

    if (bbox) {
      const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
      if ([minLon, minLat, maxLon, maxLat].every((n) => !isNaN(n))) {
        // MySQL 无 ST_MakeEnvelope，改用闭合 WKT 多边形（SRID 0，轴序 经度 纬度）
        params.push(
          `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`
        );
        whereExtra += ` AND ST_Within(geom, ST_GeomFromText(?))`;
      }
    }

    params.push(5000);

    const query = `
      SELECT
        id, icao24, callsign, country,
        latitude, longitude, altitude, velocity,
        heading, vertical_rate, on_ground, timestamp
      FROM (
        SELECT
          id, icao24, callsign, country,
          latitude, longitude, altitude, velocity,
          heading, vertical_rate, on_ground, timestamp,
          ROW_NUMBER() OVER (PARTITION BY icao24 ORDER BY timestamp DESC) AS rn
        FROM aircraft
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
          ${whereExtra}
      ) latest
      WHERE rn = 1
      ORDER BY icao24, timestamp DESC
      LIMIT ?
    `;

    const result = await pool.query(query, params);
    res.json({ data: result.rows, count: result.rowCount, updated_at: new Date() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /aircraft/:icao24/trail
 * Returns the last 30 minutes of positions for a specific aircraft.
 */
router.get("/:icao24/trail", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { icao24 } = req.params;
    const result = await pool.query(
      `SELECT latitude, longitude, altitude, heading, timestamp
       FROM aircraft
       WHERE icao24 = ?
         AND timestamp >= NOW(3) - INTERVAL 30 MINUTE
       ORDER BY timestamp ASC
       LIMIT 200`,
      [icao24.toUpperCase()]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
