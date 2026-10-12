"use client";

import { useEffect, useRef } from "react";
import {
  MapContainer as LeafletMap,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useAppStore } from "@/store/useAppStore";
import {
  MAP_TILE_LAYERS,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  DEFAULT_TILE_KEY,
  TIANDITU_KEY,
  getTileSubdomains,
} from "@/lib/constants";
import AircraftLayer from "./AircraftLayer";
import VesselLayer from "./VesselLayer";
import ConflictLayer from "./ConflictLayer";
import NewsLayer from "./NewsLayer";
import LayerControls from "./LayerControls";
import TimelineControl from "./TimelineControl";

/**
 * 同步底图图层。
 *
 * 要点：
 *   · 天地图瓦片使用 t0–t7 共 8 个子域，高德使用 1–4，需按底图传入
 *     subdomains，否则 {s} 占位不会被替换，瓦片全部 404。
 *   · 未配置天地图 Key 时，若当前底图属于天地图系列（requiresKey），
 *     自动回退到免 Key 的高德底图，避免地图整片空白。
 *   · 底图若为 GCJ-02（高德），数据图层需按其坐标系偏移绘制；
 *     该换算在各数据图层内通过 getTileCoordSystem() + toMapCoord() 完成。
 */
function resolveTileLayer(activeTileLayer: string) {
  const requested =
    MAP_TILE_LAYERS[activeTileLayer] ?? MAP_TILE_LAYERS[DEFAULT_TILE_KEY];
  // 天地图 Key 缺失时回退，保证地图始终有底图可显示
  if (requested?.requiresKey && !TIANDITU_KEY) {
    return MAP_TILE_LAYERS.amapVector;
  }
  return requested;
}

/** Syncs the tile layer when activeTileLayer changes */
function TileLayerSync() {
  const activeTileLayer = useAppStore((s) => s.activeTileLayer);
  const layers = useAppStore((s) => s.layers);
  const map = useMap();

  // Nothing to sync here for TileLayer — handled by conditional rendering
  return null;
}

export default function MapContainer() {
  const { layers, activeTileLayer } = useAppStore();

  const tileConfig = resolveTileLayer(activeTileLayer);
  const tileSubdomains = getTileSubdomains(
    Object.keys(MAP_TILE_LAYERS).find(
      (k) => MAP_TILE_LAYERS[k] === tileConfig
    ) ?? DEFAULT_TILE_KEY
  );

  // 卫星叠加层：同样需要子域；天地图 Key 缺失时回退高德影像
  const satelliteConfig =
    TIANDITU_KEY || !MAP_TILE_LAYERS.satellite.requiresKey
      ? MAP_TILE_LAYERS.satellite
      : MAP_TILE_LAYERS.amapSatellite;
  const satelliteSubdomains = satelliteConfig.url.includes("tianditu.gov.cn")
    ? "01234567"
    : "1234";
  const satelliteKey = satelliteConfig.url.includes("tianditu.gov.cn")
    ? "satellite"
    : "amapSatellite";

  return (
    <div className="relative w-full h-full">
      <LeafletMap
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        zoomControl={false}
        className="w-full h-full"
        preferCanvas
        maxBoundsViscosity={0.8}
        worldCopyJump
      >
        {/* 底图 */}
        <TileLayer
          key={activeTileLayer}
          url={tileConfig.url}
          attribution={tileConfig.attribution}
          maxZoom={tileConfig.maxZoom ?? 19}
          subdomains={tileSubdomains}
        />

        {/* 卫星叠加层（可切换）*/}
        {layers.satellite && activeTileLayer !== "satellite" && (
          <TileLayer
            key={satelliteKey}
            url={satelliteConfig.url}
            attribution={satelliteConfig.attribution}
            maxZoom={satelliteConfig.maxZoom ?? 19}
            subdomains={satelliteSubdomains}
            opacity={0.5}
          />
        )}

        <ZoomControl position="bottomright" />
        <TileLayerSync />

        {/* Data layers */}
        {layers.aircraft && <AircraftLayer />}
        {layers.vessels && <VesselLayer />}
        {layers.conflicts && <ConflictLayer />}
        {layers.news && <NewsLayer />}
      </LeafletMap>

      {/* Layer toggle controls overlay */}
      <div className="absolute top-4 left-4 z-[1000]">
        <LayerControls />
      </div>

      {/* Timeline control */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[1000]">
        <TimelineControl />
      </div>
    </div>
  );
}
