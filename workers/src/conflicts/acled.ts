/**
 * ACLED (Armed Conflict Location & Event Data) Worker
 * Docs: https://acleddata.com/acleddatanew/wp-content/uploads/dlm_uploads/2017/10/API-User-Guide.pdf
 *
 * Free tier requires registration at https://acleddata.com/register/
 * Without credentials, demo data is injected.
 */

import axios from "axios";
import { pool } from "../db";
import { logger } from "../logger";

const ACLED_BASE = "https://api.acleddata.com/acled/read";

interface ACLEDEvent {
  data_id: string;
  event_type: string;
  sub_event_type: string;
  country: string;
  region: string;
  location: string;
  latitude: string;
  longitude: string;
  notes: string;
  source: string;
  source_scale: string;
  fatalities: string;
  event_date: string;
  timestamp: string;
}

function mapSeverity(eventType: string, fatalities: number): string {
  if (fatalities >= 50) return "critical";
  if (fatalities >= 10) return "high";
  const highTypes = ["Battles", "Remote violence", "Violence against civilians"];
  if (highTypes.includes(eventType) && fatalities > 0) return "high";
  if (highTypes.includes(eventType)) return "medium";
  return "low";
}

export async function fetchConflicts(): Promise<void> {
  const apiKey = process.env.ACLED_API_KEY;
  const email = process.env.ACLED_EMAIL;

  if (!apiKey || !email) {
    logger.info("No ACLED credentials — using demo conflict data");
    await refreshDemoConflicts();
    return;
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().slice(0, 10).replace(/-/g, "");

    const response = await axios.get(ACLED_BASE, {
      params: {
        key: apiKey,
        email,
        event_date: dateStr,
        event_date_where: ">=",
        fields: "data_id|event_date|event_type|sub_event_type|country|region|location|latitude|longitude|notes|source|source_scale|fatalities",
        limit: 1000,
        format: "json",
      },
      timeout: 60_000,
    });

    const events: ACLEDEvent[] = response.data?.data ?? [];
    logger.info(`ACLED: received ${events.length} events`);

    if (events.length === 0) return;

    const chunkSize = 100;
    for (let i = 0; i < events.length; i += chunkSize) {
      const chunk = events.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((e) => {
        const fat = parseInt(e.fatalities, 10) || 0;
        const lat = parseFloat(e.latitude);
        const lon = parseFloat(e.longitude);
        // MySQL 下 event_date 以真实参数绑定传入
        const eventDate = e.event_date ? new Date(e.event_date) : null;
        values.push(
          `ACLED-${e.data_id}`,
          e.event_type,
          e.sub_event_type,
          e.country,
          e.region,
          e.location,
          Number.isNaN(lat) ? null : lat,
          Number.isNaN(lon) ? null : lon,
          e.notes?.slice(0, 2000) ?? null,
          e.source,
          mapSeverity(e.event_type, fat),
          fat,
          // conflict_events.geom 为 NOT NULL，缺坐标时用 (0 0) 占位
          `POINT(${Number.isNaN(lon) ? 0 : lon} ${Number.isNaN(lat) ? 0 : lat})`,
          eventDate,
          new Date()
        );
        // 共 15 个占位符，与上方 values 顺序一一对应
        return "(?,?,?,?,?,?,?,?,?,?,?,?,ST_GeomFromText(?),?,?)";
      });

      await pool.query(
        `INSERT INTO conflict_events
           (external_id, event_type, sub_event_type, country, region, location,
            latitude, longitude, description, source, severity, fatalities, geom, event_date, timestamp)
         VALUES ${placeholders.join(",")}
         ON DUPLICATE KEY UPDATE
           description = VALUES(description),
           fatalities  = VALUES(fatalities),
           severity    = VALUES(severity),
           timestamp   = VALUES(timestamp)`,
        values
      );
    }

    logger.info(`ACLED: processed ${events.length} conflict events`);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      logger.warn("ACLED: authentication failed — check API key");
      return;
    }
    logger.error("ACLED fetch error:", err);
  }
}

/**
 * Refreshes demo conflict data for use without API credentials.
 * Updates timestamps so the data appears "fresh".
 */
async function refreshDemoConflicts(): Promise<void> {
  // 演示数据由 database/02-seed.sql 灌入，external_id 前缀为 DEMO-
  // （与 news/aircraft/vessels 的演示数据前缀保持一致）
  await pool.query(`
    UPDATE conflict_events
    SET timestamp = NOW(3)
    WHERE external_id LIKE 'DEMO-%'
  `);
  logger.info("Demo conflict timestamps refreshed");
}
