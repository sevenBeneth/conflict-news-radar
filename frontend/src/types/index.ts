// ─── Shared Domain Types ──────────────────────────────────────────────────────

export interface Aircraft {
  id?: string;
  icao24: string;
  callsign: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  vertical_rate: number | null;
  on_ground: boolean;
  timestamp: string;
}

export interface Vessel {
  id?: string;
  mmsi: string;
  name: string | null;
  vessel_type: string | null;
  flag: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  heading: number | null;
  destination: string | null;
  status: string | null;
  length: number | null;
  timestamp: string;
}

export interface ConflictEvent {
  id: string;
  external_id?: string;
  event_type: string | null;
  sub_event_type?: string | null;
  country: string | null;
  region?: string | null;
  location: string | null;
  latitude: number;
  longitude: number;
  description: string | null;
  source: string | null;
  source_url?: string | null;
  severity: "critical" | "high" | "medium" | "low";
  fatalities: number;
  event_date: string | null;
  timestamp: string;
}

export interface NewsEvent {
  id: string;
  external_id?: string;
  headline: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  category?: string | null;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  published_at: string | null;
  timestamp: string;
}

export interface AnomalyAlert {
  id: string;
  alert_type: string;
  title: string;
  description: string | null;
  severity: string;
  latitude: number | null;
  longitude: number | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

// ─── Map Layer Types ──────────────────────────────────────────────────────────

export type LayerName = "aircraft" | "vessels" | "conflicts" | "news" | "satellite" | "heatmap";

export interface LayerState {
  aircraft: boolean;
  vessels: boolean;
  conflicts: boolean;
  news: boolean;
  satellite: boolean;
  heatmap: boolean;
}

// ─── Filter Types ─────────────────────────────────────────────────────────────

export interface Filters {
  region: string;
  severity: string;
  vesselType: string;
  altitudeMin: number;
  altitudeMax: number;
  timeWindowHours: number;
  onGroundAircraft: boolean;
}

// ─── UI Types ────────────────────────────────────────────────────────────────

export type SeverityLevel = "critical" | "high" | "medium" | "low";

export type PanelTab = "ai" | "filter" | "stats";

export interface EventFeedItem {
  id: string;
  type: "conflict" | "news" | "aircraft" | "vessel" | "anomaly";
  title: string;
  subtitle: string | null;
  severity?: SeverityLevel;
  timestamp: string;
  lat?: number;
  lon?: number;
  /**
   * 原文链接（新闻事件用）。
   * 用于事件流卡片的悬停浮层，提供"可追溯性"——用户能一键核对原文，
   * 而不只是看到系统给出的标题。
   */
  url?: string | null;
  /** 来源媒体名（新闻事件用），悬停浮层中显示 */
  source?: string | null;
}

// ─── AI Chat Types ────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  loading?: boolean;
}
