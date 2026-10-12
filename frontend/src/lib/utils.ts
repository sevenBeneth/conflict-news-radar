import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { SEVERITY_COLORS } from "./constants";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function getSeverityColor(severity: string): string {
  return SEVERITY_COLORS[severity.toLowerCase()] ?? SEVERITY_COLORS.medium;
}

/**
 * 把时间戳格式化为中文相对时间。
 *
 * 输出形如「刚刚 / 16 分钟前 / 3 小时前」，与整体中文界面一致；
 * 7 天内显示「N 天前」，更早则回退为「MM-DD」式日期。
 */
export function formatTimestamp(ts: string | Date | null | undefined): string {
  if (ts == null) return "无";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "无";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function formatAltitude(alt: number | null | undefined): string {
  if (alt == null) return "无";
  return `${Math.round(alt).toLocaleString()} m`;
}

export function formatSpeed(speed: number | null | undefined, unit: "ms" | "kts" = "ms"): string {
  if (speed == null) return "无";
  if (unit === "kts") return `${speed.toFixed(1)} kts`;
  return `${(speed * 1.944).toFixed(1)} kts`; // convert m/s to knots
}

export function formatHeading(heading: number | null | undefined): string {
  if (heading == null) return "无";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(heading / 45) % 8;
  return `${Math.round(heading)}° ${dirs[idx]}`;
}

/** Generate a unique ID for events/chat messages */
export function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
