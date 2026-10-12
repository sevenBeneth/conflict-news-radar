/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 供 Dockerfile 的运行阶段使用 .next/standalone 产物
  output: "standalone",
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Allow images from any domain (for news thumbnails etc.)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // Expose build-time env vars
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000",
    // 国内化新增：天地图 Key 必须在构建期内联，Docker 构建时通过 build args 传入。
    // 未配置时前端自动回退到免 Key 的高德底图（见 src/lib/constants.ts）。
    NEXT_PUBLIC_TIANDITU_KEY: process.env.NEXT_PUBLIC_TIANDITU_KEY ?? "",
    NEXT_TELEMETRY_DISABLED: "1",
  },
};

module.exports = nextConfig;
