"use client";

import { useAppStore } from "@/store/useAppStore";

export default function StatusBar() {
  const { connected, aircraft, vessels, conflicts, news } = useAppStore();

  return (
    <div className="flex-shrink-0 h-6 bg-background-secondary border-t border-border flex items-center px-4 gap-6 z-50">
      <span className="font-mono text-[9px] text-text-muted tracking-widest">
        系统:{" "}
        <span className={connected ? "text-accent-green" : "text-accent-red"}>
          {connected ? "正常" : "异常"}
        </span>
      </span>
      <span className="font-mono text-[9px] text-text-muted">
        航班:{" "}
        <span className="text-accent-cyan">{aircraft.length}</span>
      </span>
      <span className="font-mono text-[9px] text-text-muted">
        船舶:{" "}
        <span className="text-accent-blue">{vessels.length}</span>
      </span>
      <span className="font-mono text-[9px] text-text-muted">
        冲突:{" "}
        <span className="text-accent-red">{conflicts.length}</span>
      </span>
      <span className="font-mono text-[9px] text-text-muted">
        新闻:{" "}
        <span className="text-accent-yellow">{news.length}</span>
      </span>
      <div className="flex-1" />
      <span className="font-mono text-[9px] text-text-muted">
        数据源: 中新网 · OpenSky · ACLED · AIS
      </span>
      <span className="font-mono text-[9px] text-text-muted">
        v1.0.0 © CNR
      </span>
    </div>
  );
}
