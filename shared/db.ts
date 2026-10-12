/**
 * CNR · 共享数据库连接层（MySQL 8）
 * ----------------------------------------------------------------------------
 * 驱动选型：使用 `mysql2` 连接 MySQL 8.0，原因：
 *   · MySQL 在国内环境普及度高、部署与运维成本低，且本机已存在 MySQL80 服务；
 *   · MySQL 8.0 原生空间类型 + SPATIAL INDEX 足以覆盖本项目全部空间查询
 *     （已在 MySQL 8.0.34 实测：ST_Within + WKT 多边形走 range 索引扫描）。
 *
 * 放置于 shared/ 而非 backend/ 的原因：
 *   backend 与 workers 是两个独立的 npm 包与独立的 tsconfig/Dockerfile，
 *   共享层必须能被两者同时以相对路径引用而不引入包依赖，故独立成目录。
 *
 * ─── 调用契约（关键）────────────────────────────────────────────────────────
 * 为了让 6 个路由文件与 WebSocket 层**不必改写调用方式**，本模块对外统一暴露
 * 如下查询接口：
 *
 *     const result = await pool.query(sql, params);
 *     result.rows      // 行数组
 *     result.rowCount  // 受影响 / 返回行数
 *
 * 实现要点：
 *   1. 占位符：本模块 query() 会**自动把 $n 转换为 ?**，并按序号重排参数，
 *      因此上层 SQL 写 $1/$2 或 ? 都能正常工作；新 SQL 建议直接用 ?。
 *   2. 数值类型：MySQL 的 DECIMAL/BIGINT 默认以字符串返回。
 *      已开启 decimalNumbers / supportBigNumbers，使 COUNT、SUM 等聚合
 *      直接返回 number，避免前端拿到 "5" 而非 5 造成类型错乱。
 *   3. rowCount：mysql2 对 SELECT 返回行数组、对写操作返回 affectedRows，
 *      本模块统一映射到同一个 rowCount 字段。
 *   4. 时间：以 UTC 读取（timezone: "Z"），与库中 DATETIME 的 UTC 语义一致。
 */

import mysql from "mysql2";
import type {
  Pool as MySQLCallbackPool,
  PoolConnection as MySQLCallbackConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";
import type { Pool as MySQLPromisePool } from "mysql2/promise";

/** 统一的查询返回结构：行数组 + 受影响/返回行数 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/** 极简日志接口，避免 shared 层依赖各端的 logger 实现 */
export interface SharedLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

let sharedLogger: SharedLogger = {
  info: (m, ...a) => console.log(m, ...a),
  warn: (m, ...a) => console.warn(m, ...a),
  debug: () => undefined,
  error: (m, ...a) => console.error(m, ...a),
};

/** 各端启动时注入自己的 logger（backend 用 winston，workers 同） */
export function setDbLogger(l: SharedLogger): void {
  sharedLogger = l;
}

/**
 * 把 $1/$2 形式的占位符转换为 MySQL 的位置占位符 ?。
 *
 * $n 写法允许占位符乱序（如 `$2, $1`），而 MySQL 是位置绑定，
 * 因此转换时按序号升序重排参数，保持语义等价。
 */
export function convertPlaceholders(
  sql: string,
  params: unknown[]
): { sql: string; params: unknown[] } {
  if (!sql.includes("$")) return { sql, params };

  const order: number[] = [];
  const converted = sql.replace(/\$(\d+)/g, (_m, d: string) => {
    order.push(Number(d));
    return "?";
  });

  const isSequential = order.every((n, i) => n === i + 1);
  if (isSequential) return { sql: converted, params };

  const reordered = order.map((n) => params[n - 1]);
  return { sql: converted, params: reordered };
}

class DatabaseClient {
  /**
   * 使用回调版 mysql2 建池，原因：
   *   1. `pool.on("connection")` 事件仅在回调版 Pool 上可用（promise 版无此事件），
   *      而我们需要在每条新连接上设置会话时区；
   *   2. 查询仍走 promise 版接口（promise() 共享同一连接池），
   *      两者指向同一批物理连接，不存在重复建池问题。
   */
  private rawPool: MySQLCallbackPool;
  private mysqlPool: MySQLPromisePool;

  constructor(connectionLimit = Number(process.env.MYSQL_POOL_SIZE ?? 10)) {
    this.rawPool = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "cnr",
      password: process.env.MYSQL_PASSWORD ?? "cnr_password",
      database: process.env.MYSQL_DATABASE ?? "cnr",

      // 字符集：utf8mb4 支持中文地名与生僻字
      charset: "utf8mb4_0900_ai_ci",

      // 连接池
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,

      // 类型处理：让 COUNT / SUM 等聚合直接返回 number
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,

      // 时间：以 UTC 解释库中 DATETIME
      timezone: "Z",

      multipleStatements: false,
    });

    this.mysqlPool = this.rawPool.promise();

    // 关键：统一会话时区。
    //
    // MySQL 的 NOW() / CURDATE() 取的是**会话时区**下的当前时间，而宿主机的
    // MySQL 服务通常按本地时区（如东八区）运行。若不干预会出现：
    //   · NOW(3) 写入的是本地时间（如 23:53），
    //   · 驱动按 timezone:"Z" 读回时又当成 UTC 处理，
    // 同一记录写入与读回的语义相差 8 小时。实测已复现：种子数据时间戳与
    // API 返回时间不一致，进而使 `timestamp >= NOW(3) - INTERVAL 5 MINUTE`
    // 这类「近 N 分钟」过滤全部落空，航班/船舶图层恒为空。
    //
    // 会话级设为 '+00:00'，使 SQL 时间函数与驱动解释一致，全项目统一以 UTC
    // 为基准（前端按本地时区渲染）。每建一条新连接都执行，故用连接事件。
    this.rawPool.on("connection", (conn: MySQLCallbackConnection) => {
      conn.query("SET time_zone = '+00:00'", (err: Error | null) => {
        if (err) {
          sharedLogger.warn(
            "设置会话时区失败，可能导致时间过滤异常（请确认 MySQL 已加载时区表）：",
            err
          );
        }
      });
    });

    this.rawPool.on("error", (err: Error) => {
      sharedLogger.error("MySQL 连接池错误：", err);
    });
  }

  /** 执行查询，返回 { rows, rowCount }；自动处理 $n → ? 转换 */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const { sql: finalSql, params: finalParams } = convertPlaceholders(sql, params);
    const [result] = await this.mysqlPool.query(finalSql, finalParams);

    if (Array.isArray(result)) {
      return { rows: result as T[], rowCount: result.length };
    }
    const header = result as ResultSetHeader;
    return { rows: [] as T[], rowCount: header?.affectedRows ?? 0 };
  }

  /** 取单行（等价于 rows[0]）；无结果返回 undefined */
  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    const { rows } = await this.query<T>(sql, params);
    return rows[0];
  }

  /** 获取底层连接（事务场景使用） */
  async getConnection() {
    return this.mysqlPool.getConnection();
  }

  async end(): Promise<void> {
    // 两个接口共享同一底层连接池，只需关闭一次
    await new Promise<void>((resolve, reject) => {
      this.rawPool.end((err: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

export const pool = new DatabaseClient();

/**
 * 启动时连通性检查，供 backend 与 workers 的启动流程调用。
 */
export async function connectDB(): Promise<void> {
  const row = await pool.queryOne<{ ok: number; ver: string }>(
    "SELECT 1 AS ok, VERSION() AS ver"
  );
  sharedLogger.info(
    `MySQL 连接成功（版本 ${row?.ver ?? "unknown"}，库 ${process.env.MYSQL_DATABASE ?? "cnr"}）`
  );

  // 空间类型自检：提前暴露 geom / SRID 配置问题，避免运行时才发现 bbox 查询失效
  try {
    const geom = await pool.queryOne<{ pt: string }>(
      "SELECT ST_AsText(ST_GeomFromText('POINT(116.4074 39.9042)')) AS pt"
    );
    sharedLogger.debug(`空间类型自检通过：${geom?.pt}`);
  } catch (err) {
    sharedLogger.warn("空间类型自检失败，bbox 范围查询可能不可用：", err);
  }
}

export type { RowDataPacket };
