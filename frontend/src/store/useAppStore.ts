/**
 * Global application state using Zustand.
 * Single store for all map data, layers, filters and UI state.
 */

import { create } from "zustand";
import type {
  Aircraft,
  Vessel,
  ConflictEvent,
  NewsEvent,
  AnomalyAlert,
  LayerState,
  Filters,
  EventFeedItem,
  ChatMessage,
  PanelTab,
} from "@/types";
import { genId } from "@/lib/utils";
import { DEFAULT_TILE_KEY } from "@/lib/constants";

export const PANEL_TABS = ["ai", "filter", "stats"] as const;

/** 数值收敛到 [min, max]，用于约束面板尺寸不被拖到不可用的极端值 */
function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// ── 面板尺寸约束 ─────────────────────────────────────────────────────────────
//  下限保证内容不被压扁到无法阅读（右侧面板至少要放得下一个下拉框，
//  底部事件流至少要露出标题栏与一行卡片）；上限避免面板吃掉整个地图。
export const RIGHT_PANEL_MIN_W = 220;
export const RIGHT_PANEL_MAX_W = 720;
export const FEED_PANEL_MIN_H = 40;
export const FEED_PANEL_MAX_H = 480;

interface AppState {
  // ── Connection ─────────────────────────────────────────────────────────────
  connected: boolean;
  lastUpdate: Date | null;
  setConnected: (v: boolean) => void;

  // ── Data ───────────────────────────────────────────────────────────────────
  aircraft: Aircraft[];
  vessels: Vessel[];
  conflicts: ConflictEvent[];
  news: NewsEvent[];
  anomalies: AnomalyAlert[];
  setAircraft: (data: Aircraft[]) => void;
  addAircraft: (data: Aircraft[]) => void;
  setVessels: (data: Vessel[]) => void;
  setConflicts: (data: ConflictEvent[]) => void;
  addConflicts: (data: ConflictEvent[]) => void;
  setNews: (data: NewsEvent[]) => void;
  addNews: (data: NewsEvent[]) => void;
  setAnomalies: (data: AnomalyAlert[]) => void;

  // ── Stats ──────────────────────────────────────────────────────────────────
  stats: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    total_fatalities: number;
    countries_affected: number;
  } | null;
  setStats: (stats: AppState["stats"]) => void;

  // ── Layers ─────────────────────────────────────────────────────────────────
  layers: LayerState;
  toggleLayer: (layer: keyof LayerState) => void;
  setLayer: (layer: keyof LayerState, value: boolean) => void;

  // ── Satellite tile ─────────────────────────────────────────────────────────
  activeTileLayer: string;
  setActiveTileLayer: (name: string) => void;

  // ── Filters ────────────────────────────────────────────────────────────────
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;

  // ── Event Feed ─────────────────────────────────────────────────────────────
  feedItems: EventFeedItem[];
  addFeedItem: (item: Omit<EventFeedItem, "id">) => void;

  // ── AI Chat ────────────────────────────────────────────────────────────────
  chatMessages: ChatMessage[];
  addChatMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
  updateChatMessage: (id: string, content: string, loading?: boolean) => void;
  clearChat: () => void;

  // ── UI ─────────────────────────────────────────────────────────────────────
  activePanel: PanelTab;
  setActivePanel: (tab: PanelTab) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (v: boolean) => void;

  // ── 面板尺寸（可拖动调整）────────────────────────────────────────────────
  /** 右侧面板宽度（像素） */
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;
  /** 底部事件流面板高度（像素，含标题栏） */
  feedPanelHeight: number;
  setFeedPanelHeight: (h: number) => void;

  selectedAircraft: Aircraft | null;
  selectedVessel: Vessel | null;
  selectedConflict: ConflictEvent | null;
  selectedNews: NewsEvent | null;
  setSelectedAircraft: (a: Aircraft | null) => void;
  setSelectedVessel: (v: Vessel | null) => void;
  setSelectedConflict: (c: ConflictEvent | null) => void;
  setSelectedNews: (n: NewsEvent | null) => void;

  // ── Timeline ───────────────────────────────────────────────────────────────
  timelineHours: number;
  setTimelineHours: (h: number) => void;
}

const DEFAULT_FILTERS: Filters = {
  region: "",
  severity: "",
  vesselType: "",
  altitudeMin: 0,
  altitudeMax: 15000,
  timeWindowHours: 24,
  onGroundAircraft: false,
};

export const useAppStore = create<AppState>((set) => ({
  // Connection
  connected: false,
  lastUpdate: null,
  setConnected: (connected) => set({ connected, lastUpdate: new Date() }),

  // Data
  aircraft: [],
  vessels: [],
  conflicts: [],
  news: [],
  anomalies: [],

  setAircraft: (aircraft) =>
    set({ aircraft, lastUpdate: new Date() }),

  addAircraft: (incoming) =>
    set((state) => {
      const map = new Map(state.aircraft.map((a) => [a.icao24, a]));
      incoming.forEach((a) => map.set(a.icao24, a));
      return { aircraft: Array.from(map.values()), lastUpdate: new Date() };
    }),

  setVessels: (vessels) => set({ vessels, lastUpdate: new Date() }),

  setConflicts: (conflicts) => set({ conflicts, lastUpdate: new Date() }),

  addConflicts: (incoming) =>
    set((state) => {
      const map = new Map(state.conflicts.map((c) => [c.id, c]));
      incoming.forEach((c) => map.set(c.id, c));
      return { conflicts: Array.from(map.values()) };
    }),

  setNews: (news) => set({ news, lastUpdate: new Date() }),

  addNews: (incoming) =>
    set((state) => {
      const map = new Map(state.news.map((n) => [n.id, n]));
      incoming.forEach((n) => map.set(n.id, n));
      const sorted = Array.from(map.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return { news: sorted.slice(0, 200) };
    }),

  setAnomalies: (anomalies) => set({ anomalies }),

  stats: null,
  setStats: (stats) => set({ stats }),

  // Layers
  layers: {
    aircraft: true,
    vessels: true,
    conflicts: true,
    news: true,
    satellite: false,
    heatmap: false,
  },
  toggleLayer: (layer) =>
    set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  setLayer: (layer, value) =>
    set((state) => ({ layers: { ...state.layers, [layer]: value } })),

  // 默认底图按是否配置天地图 Key 自动选择
  // （有 Key → 天地图矢量；无 Key → 免 Key 的高德矢量）
  activeTileLayer: DEFAULT_TILE_KEY,
  setActiveTileLayer: (name) => set({ activeTileLayer: name }),

  // Filters
  filters: { ...DEFAULT_FILTERS },
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  // Feed
  feedItems: [],
  addFeedItem: (item) =>
    set((state) => ({
      feedItems: [{ ...item, id: genId() }, ...state.feedItems].slice(0, 500),
    })),

  // Chat
  chatMessages: [],
  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        { ...msg, id: genId(), timestamp: new Date() },
      ],
    })),
  updateChatMessage: (id, content, loading = false) =>
    set((state) => ({
      chatMessages: state.chatMessages.map((m) =>
        m.id === id ? { ...m, content, loading } : m
      ),
    })),
  clearChat: () => set({ chatMessages: [] }),

  // UI
  activePanel: "ai",
  setActivePanel: (activePanel) => set({ activePanel }),
  rightPanelOpen: true,
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),

  /**
   * 面板尺寸（可拖动调整）。
   *
   * 初值取一个在 1366×768 笔记本上也能正常显示的常用尺寸；
   * 上下限的收紧放在 setter 内统一处理，保证无论从拖拽、键盘还是
   * 将来的"重置布局"按钮进入，都不会出现面板被拖到不可用的极端尺寸。
   */
  rightPanelWidth: 320,
  setRightPanelWidth: (w) =>
    set({ rightPanelWidth: clamp(w, RIGHT_PANEL_MIN_W, RIGHT_PANEL_MAX_W) }),

  feedPanelHeight: 84,
  setFeedPanelHeight: (h) =>
    set({ feedPanelHeight: clamp(h, FEED_PANEL_MIN_H, FEED_PANEL_MAX_H) }),
  selectedAircraft: null,
  selectedVessel: null,
  selectedConflict: null,
  selectedNews: null,
  setSelectedAircraft: (selectedAircraft) => set({ selectedAircraft }),
  setSelectedVessel: (selectedVessel) => set({ selectedVessel }),
  setSelectedConflict: (selectedConflict) => set({ selectedConflict }),
  setSelectedNews: (selectedNews) => set({ selectedNews }),

  // Timeline
  timelineHours: 24,
  setTimelineHours: (timelineHours) => set({ timelineHours }),
}));
