# ============================================================================
#  CNR · 采集器镜像（MySQL 8）
# ============================================================================
#  国内化说明：
#    · 基础镜像走国内代理前缀（可直连 Docker Hub 时改用 node:20-alpine）
#    · npm 源固定为 registry.npmmirror.com
#
#  构建上下文为**仓库根目录**，原因同 backend：workers 与 backend 共用
#  shared/ 下的数据库连接层。
# ============================================================================

# ─── 构建阶段 ────────────────────────────────────────────────────────────────
FROM docker.1panel.live/library/node:20-alpine AS builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY workers/package*.json ./
RUN npm install

COPY shared/ ./shared/
COPY workers/ ./

RUN npm run build

# ─── 运行阶段 ────────────────────────────────────────────────────────────────
FROM docker.1panel.live/library/node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN npm config set registry https://registry.npmmirror.com

COPY workers/package*.json ./
RUN npm install --omit=dev

# 产物路径说明（实测确认，勿凭直觉修改）：
#   tsconfig 的 rootDir 为 ./src，源码实际只位于 workers/src 之下
#   （共享层已由构建步骤复制到 workers/src/shared），
#   因此产物结构为：
#       dist/index.js
#       dist/db.js
#       dist/shared/db.js          <- 共享层被一并编译进来
#   故入口是 dist/index.js，而不是 dist/workers/src/index.js。
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
