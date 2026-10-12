import { Router, Request, Response, NextFunction } from "express";
import { pool } from "../db/connection";

const router = Router();

/**
 * GET /anomalies
 * Returns recent unresolved anomaly alerts.
 *
 * 查询要点（MySQL 8）：
 *   · 时间窗口：NOW(3) - INTERVAL ? HOUR。hours 一律参数绑定，
 *     不拼进 SQL 文本（虽经 Number() 收敛，仍不应拼串）。
 *   · resolved = 0（MySQL 布尔以 0/1 表示）。
 *   · 严重度排序用显式 CASE 映射为数值等级：critical/high/medium/low
 *     的字典序（c < h < l < m）并非严重度顺序，
 *     若直接按文本排序，low 会排在 medium 之前。
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 6, 48);
    const result = await pool.query(
      `SELECT id, alert_type, title, description, severity,
              latitude, longitude, metadata, timestamp
       FROM anomaly_alerts
       WHERE timestamp >= NOW(3) - INTERVAL ? HOUR
         AND resolved = 0
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high'     THEN 2
           WHEN 'medium'   THEN 3
           WHEN 'low'      THEN 4
           ELSE 5
         END,
         timestamp DESC
       LIMIT 50`,
      [hours]
    );
    res.json({ data: result.rows, count: result.rowCount });
  } catch (err) {
    next(err);
  }
});

export default router;
