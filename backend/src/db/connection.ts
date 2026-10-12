/**
 * CNR · 后端数据库入口
 * ----------------------------------------------------------------------------
 * 实现位于共享层 shared/db.ts，构建前由 scripts/sync-shared.ps1 同步到
 * backend/src/shared/，使 backend 与 workers 两个独立包共用同一份 MySQL
 * 连接逻辑（避免两个包各写一份配置而出现漂移）。
 *
 * 本文件只做三件事：注入后端 logger、重导出、保留 connectDB() 名称。
 */

import { pool, connectDB as sharedConnect, setDbLogger } from "../shared/db";
import { logger } from "../logger";

// 把 winston logger 注入共享层，使日志格式与后端其余部分一致
setDbLogger(logger);

export { pool };

/** 启动时连通性检查，app.ts 直接调用 */
export async function connectDB(): Promise<void> {
  await sharedConnect();
}

export type { QueryResult } from "../shared/db";
