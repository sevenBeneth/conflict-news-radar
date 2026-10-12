"use client";

import { useState } from "react";
import {
  Plane,
  Ship,
  AlertTriangle,
  Newspaper,
  Satellite,
  Layers,
  Map,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import {
  MAP_TILE_LAYERS,
  TIANDITU_KEY,
  isTileLayerAvailable,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { LayerState } from "@/types";

const LAYER_CONFIG: Array<{
  key: keyof LayerState;
  label: string;
  icon: React.ElementType;
  color: string;
}> = [
  { key: "aircraft", label: "航班", icon: Plane, color: "text-accent-cyan" },
  { key: "vessels", label: "船舶", icon: Ship, color: "text-accent-blue" },
  { key: "conflicts", label: "冲突", icon: AlertTriangle, color: "text-accent-red" },
  { key: "news", label: "新闻", icon: Newspaper, color: "text-accent-yellow" },
  { key: "satellite", label: "卫星叠加", icon: Satellite, color: "text-accent-purple" },
];

/**
 * 供用户选择的底图清单。
 *
 * 要点：不能把 MAP_TILE_LAYERS 的全部键都铺开 —— 其中包含 vecLabel /
 * satelliteLabel 等**注记层**与内部用键，直接铺开会造成重复项与
 * 用户无法理解的选项。因此此处显式列出面向用户的底图，
 * 并用 isTileLayerAvailable 过滤掉缺少 Key 的天地图项，
 * 同时在列表底部给出申请 Key 的提示。
 */
const SELECTABLE_TILE_KEYS = [
  "vec",
  "satellite",
  "terrain",
  "amapVector",
  "amapSatellite",
] as const;

const TILE_LAYERS = SELECTABLE_TILE_KEYS.map((key) => ({
  key,
  name: MAP_TILE_LAYERS[key]?.name ?? key,
  available: isTileLayerAvailable(key),
}));

export default function LayerControls() {
  const { layers, toggleLayer, activeTileLayer, setActiveTileLayer } = useAppStore();
  const [open, setOpen] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="panel-glass rounded shadow-panel min-w-[160px]">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-text-secondary hover:text-text-primary"
      >
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-accent-cyan" />
          <span className="font-mono text-[10px] tracking-widest">图层</span>
        </div>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open && (
        <div className="border-t border-border px-2 py-2 space-y-1">
          {LAYER_CONFIG.map(({ key, label, icon: Icon, color }) => (
            <button
              key={key}
              onClick={() => toggleLayer(key)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                layers[key]
                  ? "bg-background-tertiary"
                  : "hover:bg-background-tertiary opacity-50"
              )}
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full border",
                  layers[key] ? "bg-current border-current" : "bg-transparent border-current"
                )}
                style={{ color: layers[key] ? undefined : "#3a5472" }}
              />
              <Icon className={cn("w-3 h-3", layers[key] ? color : "text-text-muted")} />
              <span
                className={cn(
                  "font-mono text-[9px] tracking-widest",
                  layers[key] ? "text-text-primary" : "text-text-muted"
                )}
              >
                {label}
              </span>
            </button>
          ))}

          {/* Map tile selector */}
          <div className="border-t border-border mt-2 pt-2">
            <button
              onClick={() => setMapOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2 py-1 text-text-muted hover:text-text-secondary"
            >
              <div className="flex items-center gap-2">
                <Map className="w-3 h-3" />
                <span className="font-mono text-[9px] tracking-widest">底图</span>
              </div>
              {mapOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            {mapOpen && (
              <div className="mt-1 space-y-0.5">
                {TILE_LAYERS.map(({ key, name, available }) => (
                  <button
                    key={key}
                    onClick={() => available && setActiveTileLayer(key)}
                    disabled={!available}
                    title={
                      available
                        ? name
                        : "未配置天地图 Key，无法使用；可在 frontend/.env.local 设置 NEXT_PUBLIC_TIANDITU_KEY"
                    }
                    className={cn(
                      "w-full text-left px-3 py-1 rounded font-mono text-[9px] transition-colors",
                      !available && "opacity-40 cursor-not-allowed",
                      activeTileLayer === key
                        ? "bg-accent-blue/20 text-accent-cyan border border-accent-blue/30"
                        : "text-text-muted hover:text-text-secondary hover:bg-background-tertiary"
                    )}
                  >
                    {name}
                    {!available && " （需 Key）"}
                  </button>
                ))}

                {/* 未配置天地图 Key 时给出申请指引，避免用户误以为地图坏了 */}
                {!TIANDITU_KEY && (
                  <p className="px-3 pt-1.5 text-[9px] leading-relaxed text-text-muted">
                    天地图需免费申请 Key（需实名）：
                    <br />
                    console.tianditu.gov.cn
                    <br />
                    配置 NEXT_PUBLIC_TIANDITU_KEY 后启用。
                    <br />
                    当前已自动使用免 Key 的高德底图。
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
