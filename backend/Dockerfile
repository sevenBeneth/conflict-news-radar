# ============================================================================
#  CNR · 后端镜像（MySQL 8）
# ============================================================================
#  国内化说明：
#    · 基础镜像走国内代理前缀（可直连 Docker Hub 时改用 node:20-alpine）
#    · npm 源固定为 registry.npmmirror.com，避免构建期访问 registry.npmjs.org 超时
#
#  构建上下文说明（重要）：
#    本镜像的构建上下文是**仓库根目录**，而不是 ./backend，
#    因为 backend 与 workers 共用 shared/ 目录下的数据库连接层。
#    根目录下的 .dockerignore 已排除 node_modules / .next / dist 等无关内容。
# ============================================================================

# ─── 构建阶段 ────────────────────────────────────────────────────────────────
FROM docker.1panel.live/library/node:20-alpine AS builder

WORKDIR /app

# 使用国内 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 先复制 package.json 以充分利用层缓存
COPY backend/package*.json ./
RUN npm install

# 复制共享层与后端源码（共享层由 scripts/sync-shared.ps1 同步，此处直接取源）
COPY shared/ ./shared/
COPY backend/ ./

RUN npm run build

# ─── 运行阶段 ────────────────────────────────────────────────────────────────
FROM docker.1panel.live/library/node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN npm config set registry https://registry.npmmirror.com

COPY backend/package*.json ./
RUN npm install --omit=dev

# 产物路径说明（实测确认，勿凭直觉修改）：
#   tsconfig 的 rootDir 为 ./src，源码实际只位于 backend/src 之下
#   （共享层已由构建步骤复制到 backend/src/shared），
#   因此 tsc 会把 ../shared/db.ts 与 ./db/connection.ts 都视为
#   **同一个 rootDir 下的模块**，产物结构为：
#       dist/app.js
#       dist/db/connection.js
#       dist/shared/db.js          <- 共享层被一并编译进来
#   故入口是 dist/app.js，而不是 dist/backend/src/app.js。
#   （本项目在 Docker 中不依赖仓库根的 shared/，故下方不再 COPY shared）
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/app.js"]
