import { Router, Request, Response, NextFunction } from "express";
import axios from "axios";
import { pool } from "../db/connection";
import { logger } from "../logger";

const router = Router();

interface AnalyzeBody {
  query: string;
  context?: {
    region?: string;
    timeframe?: string;
  };
}

/**
 * Gathers a snapshot of current data from the DB to provide as context to the LLM.
 *
 * 查询要点（MySQL 8）：
 *   · 每类目标只取最新一条：ROW_NUMBER() OVER (PARTITION BY x ORDER BY timestamp DESC) 取 rn = 1
 *   · 分类计数：MySQL 不支持 FILTER (WHERE ...)，用 SUM(CASE WHEN ... THEN 1 ELSE 0 END)
 *   · 时间窗口：NOW(3) - INTERVAL 5 MINUTE
 *   · 空值排序：MySQL 不支持 NULLS LAST，用 ORDER BY x IS NULL, x DESC
 *   · SUM(fatalities) 用 COALESCE(SUM(fatalities),0) 兜底，避免空值传到提示词里
 *
 * ⚠ 安全要求：region 必须参数绑定，不得拼进 SQL 文本。
 *   仅对单引号做转义并不足以防御注入；此处以 `?` 绑定 LIKE 模式，
 *   由 mysql2 负责转义，并通过 regionClause 条件片段复用。
 */
async function buildOSINTContext(region?: string): Promise<string> {
  // 参数化后，region 以 LIKE 模式注入，不再参与 SQL 文本拼接
  const regionLike = region ? `%${region}%` : null;
  const regionClause = regionLike ? "AND country LIKE ?" : "";
  const regionParams = regionLike ? [regionLike] : [];

  // 行类型显式声明：连接层的 query<T>() 支持泛型，
  // 避免 mysql2 默认推导为 Record<string, unknown> 后无法安全取值。
  interface AircraftStat {
    total: number;
    airborne: number | null;
    countries: number;
  }
  interface VesselStat {
    total: number;
    types: number;
    flags: number;
  }
  interface ConflictStat {
    total: number;
    critical: number | null;
    high: number | null;
    countries: number;
    fatalities: number;
  }
  interface NewsRow {
    headline: string | null;
    source: string | null;
    country: string | null;
    published_at: Date | string | null;
  }

  const [aircraftResult, vesselResult, conflictResult, newsResult] = await Promise.all([
    pool.query<AircraftStat>(
      `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN on_ground = 0 THEN 1 ELSE 0 END) AS airborne,
             COUNT(DISTINCT country) AS countries
      FROM (
        SELECT icao24, on_ground, country,
               ROW_NUMBER() OVER (PARTITION BY icao24 ORDER BY timestamp DESC) AS rn
        FROM aircraft
        WHERE timestamp >= NOW(3) - INTERVAL 5 MINUTE
      ) sub
      WHERE sub.rn = 1
    `
    ),
    pool.query<VesselStat>(
      `
      SELECT COUNT(*) AS total,
             COUNT(DISTINCT vessel_type) AS types,
             COUNT(DISTINCT flag) AS flags
      FROM (
        SELECT mmsi, vessel_type, flag,
               ROW_NUMBER() OVER (PARTITION BY mmsi ORDER BY timestamp DESC) AS rn
        FROM vessels
        WHERE timestamp >= NOW(3) - INTERVAL 30 MINUTE
      ) sub
      WHERE sub.rn = 1
    `
    ),
    pool.query<ConflictStat>(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity = 'high'     THEN 1 ELSE 0 END) AS high,
        COUNT(DISTINCT country) AS countries,
        COALESCE(SUM(fatalities), 0) AS fatalities
      FROM conflict_events
      WHERE event_date >= CURDATE() - INTERVAL 7 DAY
      ${regionClause}
    `,
      regionParams
    ),
    pool.query<NewsRow>(
      `
      SELECT headline, source, country, published_at
      FROM news_events
      WHERE timestamp >= NOW(3) - INTERVAL 24 HOUR
      ${regionClause}
      ORDER BY published_at IS NULL, published_at DESC
      LIMIT 10
    `,
      regionParams
    ),
  ]);

  // COUNT/SUM 在无匹配行时可能为 null（如空库场景），统一兜底为 0，
  // 避免提示词里出现 "undefined" 误导本地模型。
  const ac = aircraftResult.rows[0] ?? { total: 0, airborne: 0, countries: 0 };
  const vs = vesselResult.rows[0] ?? { total: 0, types: 0, flags: 0 };
  const cf = conflictResult.rows[0] ?? {
    total: 0,
    critical: 0,
    high: 0,
    countries: 0,
    fatalities: 0,
  };
  const news = newsResult.rows;

  const newsText = news.length
    ? news
        .map(
          (n) =>
            `- [${n.source ?? "未知来源"}] ${n.headline ?? "(无标题)"} (${
              n.country ?? "全球"
            }, ${
              n.published_at
                ? new Date(n.published_at).toISOString().slice(0, 10)
                : "时间未知"
            })`
        )
        .join("\n")
    : "暂无近期新闻条目。";

  // 上下文块改为中文：本地中文模型的指令遵循在中文语境下更稳定，
  // 也便于最终中文回答直接引用板块名称。
  return `
=== OSINT 态势感知摘要 ===
生成时间（UTC）：${new Date().toUTCString()}
${region ? `区域筛选：${region}` : "范围：全球"}

--- 航班 ---
追踪航空器数（近 5 分钟）：${ac.total}
其中空中：${ac.airborne ?? 0}
涉及国家/地区数：${ac.countries}

--- 海事 ---
追踪船舶数（近 30 分钟）：${vs.total}
船舶类型数：${vs.types}
船旗数：${vs.flags}

--- 冲突事件（近 7 天）---
事件总数：${cf.total}
致命级：${cf.critical ?? 0}
高危级：${cf.high ?? 0}
涉及国家/地区数：${cf.countries}
报告死亡人数合计：${cf.fatalities}

--- 近期新闻标题 ---
${newsText}

===========================================
`.trim();
}

/**
 * POST /ai/analyze
 * Sends a user query + live OSINT context to the local Ollama LLM.
 */
router.post("/analyze", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, context } = req.body as AnalyzeBody;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    if (query.trim().length > 2000) {
      res.status(400).json({ error: "query too long (max 2000 characters)" });
      return;
    }

    const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

    // Build OSINT context from DB
    const osintContext = await buildOSINTContext(context?.region);

    // 提示词要求中文输出，并明确「仅依据给定数据、不臆测」的边界。
    // 本地模型（Ollama）在中文语境下更容易补全未经证实的内容，因此显式约束。
    const systemPrompt = `你是一名情报分析助手，服务于「地区冲突资讯雷达（CNR）」。
你可以获取航班轨迹、海事 AIS、冲突事件库与新闻情报的实时数据。
要求：
1. 一律使用简体中文回答，地名使用中文常用译名（必要时在括号内附原文）。
2. 只依据下方提供的数据作答，不得补充数据中不存在的事实、数字或地名。
3. 结论需可追溯：引用数据时说明来自哪个数据板块。
4. 若数据不足以支撑结论，必须明确指出"数据不足"，不要给出推测性结论。
5. 结构清晰，善用要点罗列；语言简洁但完整。
当前时间（UTC）：${new Date().toUTCString()}`;

    const userPrompt = `${osintContext}

USER QUERY: ${query}

Provide an analytical response based on the situational awareness data above.`;

    logger.info(`AI analyze request: model=${model}, query="${query.slice(0, 80)}..."`);

    // Stream response from Ollama
    const ollamaResponse = await axios.post(
      `${ollamaUrl}/api/generate`,
      {
        model,
        prompt: userPrompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 1024,
        },
      },
      { timeout: 120_000 }
    );

    const response = ollamaResponse.data.response as string;

    res.json({
      response,
      model,
      context_summary: {
        query,
        region: context?.region ?? "Global",
        generated_at: new Date(),
      },
    });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        res.status(503).json({
          error: "本地大模型服务不可用，请确认 Ollama 已启动。",
          details: "请先安装并启动 Ollama（https://ollama.com/download），然后执行：ollama pull qwen2.5:7b",
        });
        return;
      }
    }
    next(err);
  }
});

/**
 * GET /ai/status
 * Check if Ollama is available.
 */
router.get("/status", async (_req: Request, res: Response) => {
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
  try {
    const response = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 5000 });
    const models = (response.data?.models ?? []) as Array<{ name: string }>;
    res.json({
      available: true,
      model,
      installed_models: models.map((m) => m.name),
    });
  } catch {
    res.json({ available: false, model });
  }
});

export default router;
