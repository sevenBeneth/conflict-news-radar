import type { Metadata, Viewport } from "next";
import "./globals.css";

// 语言标记与站点元信息（中文）
export const metadata: Metadata = {
  title: "地区冲突资讯雷达（CNR）",
  description:
    "面向个人使用的本地部署地区冲突资讯雷达：订阅中文新闻源，自动识别地名并落图，提供时间轴筛选、态势统计与原文溯源。",
  keywords: ["地区冲突", "资讯聚合", "地名识别", "态势感知", "天地图", "本地部署"],
  robots: "noindex, nofollow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050a0f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased overflow-hidden">{children}</body>
    </html>
  );
}
