/**
 * CNR · Workers 数据库入口
 * ----------------------------------------------------------------------------
 * 与 backend 共用共享层 shared/db.ts 的同一实现（构建前由
 * scripts/sync-shared.ps1 同步到 workers/src/shared/），仅注入 workers
 * 自己的 logger。两个包统一使用这一份实现，避免各自维护一套连接配置。
 */

import { pool, connectDB as sharedConnect, setDbLogger } from "./shared/db";
import { logger } from "./logger";

setDbLogger(logger);

export { pool };

/** worker 侧连通性检查（index.ts 的 waitForDB 会调用） */
export async function connectDB(): Promise<void> {
  await sharedConnect();
}
