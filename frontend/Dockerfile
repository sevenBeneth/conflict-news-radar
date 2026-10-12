# ============================================================================
#  地区冲突资讯雷达 · 前端镜像（Next.js 14）
# ============================================================================
#  · 基础镜像走国内代理前缀（可直连 Docker Hub 时改用 node:20-alpine）
#  · npm 源固定为 registry.npmmirror.com
#  · 通过构建参数传入天地图 Key（NEXT_PUBLIC_TIANDITU_KEY）
#
#  ⚠ 构建期变量会被内联进前端产物，修改 NEXT_PUBLIC_* 后必须重新 build。
# ============================================================================

# ─── 构建阶段 ────────────────────────────────────────────────────────────────
FROM docker.1panel.live/library/node:20-alpine AS builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000
ARG NEXT_PUBLIC_TIANDITU_KEY=

ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_TIANDITU_KEY=$NEXT_PUBLIC_TIANDITU_KEY
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ─── 运行阶段 ────────────────────────────────────────────────────────────────
FROM docker.1panel.live/library/node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 以非 root 用户运行
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
