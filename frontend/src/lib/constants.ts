/**
 * CNR · 地图与常量配置
 * ============================================================================
 *
 * ─── 底图选型说明 ────────────────────────────────────────────────────────────
 * 底图一律选用国内服务，以满足可达性与合规要求；默认选天地图：
 *   · 天地图是国家地理信息公共服务平台，官方权威、境内可达性好；
 *   · 其坐标系为 CGCS2000，与项目入库的 WGS-84 在民用精度下一致，
 *     **无需坐标偏移**，因此设为默认，可避免标记错位风险；
 *   · 备选高德（免 Key），但其为 GCJ-02 坐标系，必须配合 coords.ts 做偏移，
 *     否则冲突事件标记会偏移数百米。
 *
 * 未采用的境外服务及原因：OpenStreetMap 标准瓦片（官方使用政策明确禁止批量
 * 抓取）、CartoDB / Esri World Imagery / OpenTopoMap / NASA GIBS
 * （国内访问存在可达性与合规风险）。
 *
 * 每个底图都显式标注 coordSystem，供图层组件决定是否需要坐标换算。
 *
 * ─── 天地图 Key 申请（免费，需实名）────────────────────────────────────────
 *   1. 访问 https://console.tianditu.gov.cn/ 注册并创建应用
 *   2. 获得「浏览器端」Key
 *   3. 写入 frontend/.env.local：NEXT_PUBLIC_TIANDITU_KEY=你的Key
 *   未配置 Key 时，前端自动回退到免 Key 的高德底图（并自动启用坐标偏移）。
 */

import type { CoordSystem } from "./coords";

// ─── 后端地址（沿用既有环境变量名，既有部署无需改动）────────────────────────
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

/** 天地图 Key（浏览器端），未配置时为空串 */
export const TIANDITU_KEY = process.env.NEXT_PUBLIC_TIANDITU_KEY ?? "";

// ─── 业务常量（取值与既有视觉、筛选逻辑保持一致）───────────────────────────
export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ff0033",
  high: "#ff6600",
  medium: "#ffcc00",
  low: "#00cc66",
};

export const SEVERITY_LABELS_ZH: Record<string, string> = {
  critical: "致命",
  high: "高危",
  medium: "中等",
  low: "低危",
};

export const VESSEL_TYPE_ICONS: Record<string, string> = {
  Military: "🛡️",
  Tanker: "🛢️",
  Cargo: "📦",
  Passenger: "🚢",
  Fishing: "🎣",
  Research: "🔬",
  Tug: "⚓",
  Unknown: "❓",
};

export const DEFAULT_MAP_CENTER: [number, number] = [20, 10];
export const DEFAULT_MAP_ZOOM = 3;

// ─── 底图图层定义 ────────────────────────────────────────────────────────────
export interface TileLayerConfig {
  /** Leaflet 的 L.tileLayer 模板；{s} 为子域占位，{x}/{y}/{z} 为标准瓦片坐标 */
  url: string;
  /** 版权署名 */
  attribution: string;
  /** 显示名 */
  name: string;
  /** 最大缩放级别 */
  maxZoom?: number;
  /**
   * 该底图所属坐标系。
   * 绘制 WGS-84 数据前必须按其调用 toMapCoord()，
   * 否则在 GCJ-02 底图下会产生数百米的系统性偏移。
   */
  coordSystem: CoordSystem;
  /** 是否需要在 URL 中携带天地图 Key；为 true 且未配置 Key 时该图层不可用 */
  requiresKey?: boolean;
}

/**
 * 天地图瓦片 URL 构造。
 *
 * 天地图提供两种投影方案：
 *   · vec_w / img_w / ter_w / cva_w / cia_w —— Web 墨卡托（EPSG:3857）
 *   · vec_c / img_c / ...                   —— 经纬度直投（EPSG:4326）
 * Leaflet 默认 EPSG:3857，故一律采用 _w 系列。
 *
 * 子域 t0–t7 用于分散请求压力，{s} 由 Leaflet 自动替换。
 */
function tiandituUrl(layer: string): string {
  return (
    `https://t{s}.tianditu.gov.cn/${layer}_w/wmts` +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}` +
    `&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
    `&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_KEY}`
  );
}

/**
 * 底图集合。
 *
 * 键名固定为 osm / dark / satellite / terrain / nightLights 等，
 * 使 MapContainer、LayerControls、useAppStore 中的既有引用保持一致；
 * 各键统一指向国内服务。
 */
export const MAP_TILE_LAYERS: Record<string, TileLayerConfig> = {
  // ── 默认：天地图矢量底图 + 中文注记 ──────────────────────────────────────
  vec: {
    url: tiandituUrl("vec"),
    attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图</a>',
    name: "天地图·矢量",
    maxZoom: 18,
    coordSystem: "WGS84", // CGCS2000 ≈ WGS-84，民用精度下无需偏移
    requiresKey: true,
  },
  vecLabel: {
    url: tiandituUrl("cva"),
    attribution: "&copy; 天地图",
    name: "天地图·矢量注记",
    maxZoom: 18,
    coordSystem: "WGS84",
    requiresKey: true,
  },

  // ── 卫星影像：天地图影像 + 中文注记 ─────────────────────────────────────
  satellite: {
    url: tiandituUrl("img"),
    attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图影像</a>',
    name: "天地图·卫星影像",
    maxZoom: 18,
    coordSystem: "WGS84",
    requiresKey: true,
  },
  satelliteLabel: {
    url: tiandituUrl("cia"),
    attribution: "&copy; 天地图",
    name: "天地图·影像注记",
    maxZoom: 18,
    coordSystem: "WGS84",
    requiresKey: true,
  },

  // ── 地形：天地图地形晕渲 ────────────────────────────────────────────────
  terrain: {
    url: tiandituUrl("ter"),
    attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图地形</a>',
    name: "天地图·地形",
    maxZoom: 14,
    coordSystem: "WGS84",
    requiresKey: true,
  },

  // ── 免 Key 备选：高德矢量底图（GCJ-02，组件会自动启用坐标偏移）─────────
  amapVector: {
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
    name: "高德·矢量（免 Key）",
    maxZoom: 18,
    coordSystem: "GCJ02",
  },

  // ── 免 Key 备选：高德卫星影像（GCJ-02）─────────────────────────────────
  amapSatellite: {
    url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
    attribution: '&copy; <a href="https://www.amap.com/">高德影像</a>',
    name: "高德·卫星影像（免 Key）",
    maxZoom: 18,
    coordSystem: "GCJ02",
  },

  // ── 兼容保留键：映射到国内实现，避免既有引用失效 ────────────────────────
  osm: {
    url: tiandituUrl("vec"),
    attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图</a>',
    name: "天地图·矢量",
    maxZoom: 18,
    coordSystem: "WGS84",
    requiresKey: true,
  },
  dark: {
    url: tiandituUrl("vec"),
    attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图</a>',
    name: "天地图·矢量（深色界面适配）",
    maxZoom: 18,
    coordSystem: "WGS84",
    requiresKey: true,
  },
  // 天地图无夜光图，以影像替代，使 nightLights 键仍然可用
  nightLights: {
    url: tiandituUrl("img"),
    attribution: '&copy; <a href="https://www.tianditu.gov.cn/">天地图影像</a>',
    name: "天地图·影像",
    maxZoom: 18,
    coordSystem: "WGS84",
    requiresKey: true,
  },
};

/** 默认底图键：有 Key 用天地图矢量，无 Key 自动回退高德矢量 */
export const DEFAULT_TILE_KEY = TIANDITU_KEY ? "vec" : "amapVector";

/** 判断某底图当前是否可用（天地图系列需要 Key，未配置时置灰） */
export function isTileLayerAvailable(key: string): boolean {
  const layer = MAP_TILE_LAYERS[key];
  if (!layer) return false;
  if (layer.requiresKey && !TIANDITU_KEY) return false;
  return true;
}

/** 取得某底图的坐标系，未知时保守按 WGS84 处理 */
export function getTileCoordSystem(key: string): CoordSystem {
  return MAP_TILE_LAYERS[key]?.coordSystem ?? "WGS84";
}

/** 子域配置：天地图 t0–t7，高德 1–4，与 URL 中的 {s} 占位配合 */
export const TILE_SUBDOMAINS = {
  tianditu: "01234567",
  amap: "1234",
} as const;

/** 根据底图键推断其子域串 */
export function getTileSubdomains(key: string): string | undefined {
  const layer = MAP_TILE_LAYERS[key];
  if (!layer) return undefined;
  return layer.url.includes("tianditu.gov.cn")
    ? TILE_SUBDOMAINS.tianditu
    : TILE_SUBDOMAINS.amap;
}
