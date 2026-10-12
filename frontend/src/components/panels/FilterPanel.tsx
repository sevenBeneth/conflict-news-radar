"use client";

import { RotateCcw } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

const SEVERITY_OPTIONS = ["", "critical", "high", "medium", "low"];
const VESSEL_TYPES = ["", "Military", "Tanker", "Cargo", "Passenger", "Fishing", "Research", "Tug"];

/** 严重程度取值的中文显示映射（仅用于显示，数据值与逻辑判定保持英文原值） */
const SEVERITY_ZH: Record<string, string> = {
  critical: "致命",
  high: "高危",
  medium: "中等",
  low: "低危",
};

/** 船舶类型的中文显示映射（value 必须保持英文，与数据库 vessel_type 一致） */
const VESSEL_TYPE_ZH: Record<string, string> = {
  Military: "军用",
  Tanker: "油轮",
  Cargo: "货轮",
  Passenger: "客轮",
  Fishing: "渔船",
  Research: "科考船",
  Tug: "拖船",
};

/**
 * 地区清单。中文既是显示文字也是提交给后端的 value：
 * 采集器写入的 country 字段为中文地名，GET /api/news?country= 用 LIKE '%值%' 匹配，
 * 若此处仍传英文将永远匹配不到数据。
 */
const REGIONS = [
  "", "乌克兰", "俄罗斯", "加沙", "以色列", "叙利亚", "也门", "苏丹",
  "缅甸", "埃塞俄比亚", "索马里", "马里", "尼日利亚", "菲律宾",
  "台湾", "中国", "朝鲜", "伊朗",
];

export default function FilterPanel() {
  const { filters, setFilter, resetFilters } = useAppStore();

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] text-text-secondary tracking-widest">
          数据筛选
        </span>
        <button
          onClick={resetFilters}
          className="flex items-center gap-1 text-text-muted hover:text-accent-orange transition-colors font-mono text-[8px]"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          重置
        </button>
      </div>

      {/* Region */}
      <FilterGroup label="地区">
        <select
          value={filters.region}
          onChange={(e) => setFilter("region", e.target.value)}
          className="w-full bg-background-tertiary border border-border rounded px-2 py-1.5 font-mono text-[10px] text-text-primary focus:outline-none focus:border-accent-blue/50"
        >
          {REGIONS.map((r) => (
            <option key={r} value={r} className="bg-background-secondary">
              {r || "全部地区"}
            </option>
          ))}
        </select>
      </FilterGroup>

      {/* Severity */}
      <FilterGroup label="事件严重程度">
        <div className="grid grid-cols-2 gap-1">
          {SEVERITY_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter("severity", s)}
              className={`px-2 py-1 rounded font-mono text-[9px] border transition-colors ${
                filters.severity === s
                  ? "bg-accent-blue/20 border-accent-blue/50 text-accent-cyan"
                  : "border-border text-text-muted hover:border-border-bright hover:text-text-secondary"
              }`}
            >
              {s ? SEVERITY_ZH[s] ?? s : "全部"}
            </button>
          ))}
        </div>
      </FilterGroup>

      {/* Vessel type */}
      <FilterGroup label="船舶类型">
        <select
          value={filters.vesselType}
          onChange={(e) => setFilter("vesselType", e.target.value)}
          className="w-full bg-background-tertiary border border-border rounded px-2 py-1.5 font-mono text-[10px] text-text-primary focus:outline-none focus:border-accent-blue/50"
        >
          {VESSEL_TYPES.map((t) => (
            <option key={t} value={t} className="bg-background-secondary">
              {t ? VESSEL_TYPE_ZH[t] ?? t : "全部类型"}
            </option>
          ))}
        </select>
      </FilterGroup>

      {/* Altitude */}
      <FilterGroup label={`高度: ${(filters.altitudeMin ?? 0).toLocaleString()}m – ${(filters.altitudeMax ?? 15000).toLocaleString()}m`}>
        <div className="space-y-2">
          <div>
            <label className="font-mono text-[8px] text-text-muted">最小</label>
            <input
              type="range"
              min={0}
              max={15000}
              step={500}
              value={filters.altitudeMin}
              onChange={(e) => setFilter("altitudeMin", Number(e.target.value))}
              className="w-full accent-accent-cyan"
            />
          </div>
          <div>
            <label className="font-mono text-[8px] text-text-muted">最大</label>
            <input
              type="range"
              min={0}
              max={15000}
              step={500}
              value={filters.altitudeMax}
              onChange={(e) => setFilter("altitudeMax", Number(e.target.value))}
              className="w-full accent-accent-cyan"
            />
          </div>
        </div>
      </FilterGroup>

      {/* Time window */}
      <FilterGroup label={`时间范围: ${filters.timeWindowHours} 小时`}>
        <input
          type="range"
          min={1}
          max={72}
          step={1}
          value={filters.timeWindowHours}
          onChange={(e) => setFilter("timeWindowHours", Number(e.target.value))}
          className="w-full accent-accent-cyan"
        />
        <div className="flex justify-between font-mono text-[8px] text-text-muted">
          <span>1小时</span>
          <span>24小时</span>
          <span>72小时</span>
        </div>
      </FilterGroup>

      {/* On-ground aircraft */}
      <FilterGroup label="航班选项">
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => setFilter("onGroundAircraft", !filters.onGroundAircraft)}
            className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${
              filters.onGroundAircraft ? "bg-accent-cyan" : "bg-border"
            }`}
          >
            <div
              className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                filters.onGroundAircraft ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </div>
          <span className="font-mono text-[9px] text-text-secondary">
            显示地面航空器
          </span>
        </label>
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="font-mono text-[8px] text-text-muted tracking-widest block">
        {label}
      </label>
      {children}
    </div>
  );
}
