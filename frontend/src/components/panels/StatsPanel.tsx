"use client";

import { useAppStore } from "@/store/useAppStore";
import { AlertTriangle, Plane, Ship, Newspaper, Skull, Globe } from "lucide-react";

const VESSEL_TYPE_ZH: Record<string, string> = {
  Military: "军用",
  Tanker: "油轮",
  Cargo: "货船",
  Passenger: "客船",
};

export default function StatsPanel() {
  const { stats, aircraft, vessels, conflicts, news, anomalies } = useAppStore();

  const airborne = aircraft.filter((a) => !a.on_ground).length;
  const onGround = aircraft.filter((a) => a.on_ground).length;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <span className="font-mono text-[9px] text-text-secondary tracking-widest block">
        态势汇总
      </span>

      {/* Conflict stats */}
      {stats && (
        <Section title="冲突事件 · 30天">
          <StatRow
            icon={<AlertTriangle className="w-3 h-3 text-accent-red" />}
            label="事件总数"
            value={Number(stats.total ?? 0).toLocaleString()}
            valueColor="text-accent-red"
          />
          <StatRow
            icon={<div className="w-2 h-2 rounded-full bg-severity-critical" />}
            label="致命"
            value={Number(stats.critical ?? 0).toLocaleString()}
            valueColor="text-severity-critical"
          />
          <StatRow
            icon={<div className="w-2 h-2 rounded-full bg-severity-high" />}
            label="高危"
            value={Number(stats.high ?? 0).toLocaleString()}
            valueColor="text-severity-high"
          />
          <StatRow
            icon={<div className="w-2 h-2 rounded-full bg-severity-medium" />}
            label="中等"
            value={Number(stats.medium ?? 0).toLocaleString()}
            valueColor="text-severity-medium"
          />
          <StatRow
            icon={<div className="w-2 h-2 rounded-full bg-severity-low" />}
            label="低危"
            value={Number(stats.low ?? 0).toLocaleString()}
            valueColor="text-severity-low"
          />
          <div className="border-t border-border pt-2 mt-2 space-y-1.5">
            <StatRow
              icon={<Skull className="w-3 h-3 text-accent-red" />}
              label="死亡人数"
              value={Number(stats.total_fatalities ?? 0).toLocaleString()}
              valueColor="text-accent-red"
            />
            <StatRow
              icon={<Globe className="w-3 h-3 text-accent-yellow" />}
              label="涉及国家"
              value={Number(stats.countries_affected ?? 0).toLocaleString()}
              valueColor="text-accent-yellow"
            />
          </div>
        </Section>
      )}

      {/* Aircraft stats */}
      <Section title="航空器 · 实时">
        <StatRow
          icon={<Plane className="w-3 h-3 text-accent-cyan" />}
          label="追踪总数"
          value={(aircraft.length ?? 0).toLocaleString()}
          valueColor="text-accent-cyan"
        />
        <StatRow
          icon={<div className="w-2.5 h-2.5 rounded-full bg-accent-cyan" />}
          label="空中"
          value={(airborne ?? 0).toLocaleString()}
          valueColor="text-accent-cyan"
        />
        <StatRow
          icon={<div className="w-2.5 h-2.5 rounded-full bg-text-muted" />}
          label="地面"
          value={(onGround ?? 0).toLocaleString()}
          valueColor="text-text-secondary"
        />
      </Section>

      {/* Vessel stats */}
      <Section title="海上目标 · 实时">
        <StatRow
          icon={<Ship className="w-3 h-3 text-accent-blue" />}
          label="追踪船舶"
          value={(vessels.length ?? 0).toLocaleString()}
          valueColor="text-accent-blue"
        />
        {/* Vessel type breakdown */}
        {["Military", "Tanker", "Cargo", "Passenger"].map((type) => {
          const count = vessels.filter((v) =>
            v.vessel_type?.toLowerCase().includes(type.toLowerCase())
          ).length;
          if (count === 0) return null;
          return (
            <StatRow
              key={type}
              icon={<div className="w-2 h-2 rounded bg-accent-blue/50" />}
              label={VESSEL_TYPE_ZH[type] ?? type}
              value={count.toString()}
              valueColor="text-accent-blue"
            />
          );
        })}
      </Section>

      {/* News */}
      <Section title="新闻情报 · 24小时">
        <StatRow
          icon={<Newspaper className="w-3 h-3 text-accent-yellow" />}
          label="追踪文章"
          value={(news.length ?? 0).toLocaleString()}
          valueColor="text-accent-yellow"
        />
      </Section>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <Section title="活跃异常">
          {anomalies.slice(0, 5).map((a) => (
            <div
              key={a.id}
              className="bg-background-panel border border-border rounded p-2 space-y-0.5"
            >
              <p className="font-mono text-[9px] text-accent-orange">{a.title}</p>
              {a.description && (
                <p className="font-mono text-[8px] text-text-muted leading-relaxed">
                  {a.description.slice(0, 120)}
                </p>
              )}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[8px] text-text-muted tracking-widest border-b border-border pb-1">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function StatRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-4 flex items-center justify-center flex-shrink-0">{icon}</div>
      <span className="font-mono text-[9px] text-text-secondary flex-1">{label}</span>
      <span className={`font-mono text-[10px] font-bold ${valueColor}`}>{value}</span>
    </div>
  );
}
