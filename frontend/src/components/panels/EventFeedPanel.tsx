"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, ChevronUp, AlertTriangle, Newspaper, Plane, Ship, Zap } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { formatTimestamp, getSeverityColor } from "@/lib/utils";
import ResizeHandle from "@/components/ui/ResizeHandle";
import type { EventFeedItem } from "@/types";

const TYPE_CONFIG = {
  conflict: { icon: AlertTriangle, color: "text-accent-red", label: "冲突" },
  news: { icon: Newspaper, color: "text-accent-yellow", label: "新闻" },
  aircraft: { icon: Plane, color: "text-accent-cyan", label: "航班" },
  vessel: { icon: Ship, color: "text-accent-blue", label: "船舶" },
  anomaly: { icon: Zap, color: "text-accent-purple", label: "异常" },
};

/** 标题栏高度（与下方 h-8 对应），折叠时只保留它 */
const HEADER_H = 32;

export default function EventFeedPanel() {
  const { feedItems, feedPanelHeight, setFeedPanelHeight } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * 拖动起点高度。
   * 与右侧面板同理：记录 pointerdown 时刻的高度，按位移计算绝对高度，
   * 而不是逐次累加增量，避免事件丢失导致的累积误差。
   */
  const startHeightRef = useRef(feedPanelHeight);
  const displayItems = feedItems.slice(0, 100);

  // 高度下限由 store 的 setter 统一收敛；此处额外保证折叠时不残留内容区
  const effectiveHeight = collapsed ? HEADER_H : feedPanelHeight;

  // Auto-scroll to top when new items arrive
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [feedItems, paused]);

  const handleDragStart = useCallback(() => {
    startHeightRef.current = feedPanelHeight;
  }, [feedPanelHeight]);

  /**
   * 手柄位于面板**上边缘**：向上拖（delta 为负）应使面板变高，
   * 因此新高度 = 起始高度 - 位移。
   */
  const handleDrag = useCallback(
    (delta: number) => {
      setFeedPanelHeight(startHeightRef.current - delta);
    },
    [setFeedPanelHeight]
  );

  /** 键盘微调：下方向键变高，上方向键变矮 */
  const handleNudge = useCallback(
    (delta: number) => {
      setFeedPanelHeight(feedPanelHeight + delta);
    },
    [feedPanelHeight, setFeedPanelHeight]
  );

  return (
    <div
      className="flex-shrink-0 flex flex-col bg-background-secondary border-t border-border"
      style={{ height: effectiveHeight }}
    >
      {/* 拖动改变高度（折叠时隐藏） */}
      {!collapsed && (
        <ResizeHandle
          orientation="horizontal"
          label="事件流高度"
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onNudge={handleNudge}
        />
      )}

      {/* Feed header */}
      <div className="flex items-center px-4 h-8 border-b border-border gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-accent-green animate-pulse-slow" />
          <span className="font-mono text-[9px] tracking-widest text-text-secondary">
            实时事件流
          </span>
          <span className="font-mono text-[9px] text-accent-cyan bg-accent-cyan/10 px-1.5 rounded">
            {feedItems.length}
          </span>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setPaused((v) => !v)}
          className={`font-mono text-[9px] px-2 py-0.5 rounded border transition-colors ${
            paused
              ? "border-accent-orange/50 text-accent-orange bg-accent-orange/10"
              : "border-border text-text-muted hover:text-text-secondary"
          }`}
        >
          {paused ? "已暂停" : "暂停"}
        </button>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-text-muted hover:text-text-secondary ml-2"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="flex gap-2 px-3 py-2 overflow-x-auto flex-1 min-h-0"
        >
          {displayItems.length === 0 ? (
            <div className="flex items-center text-text-muted font-mono text-[10px]">
              等待事件…
            </div>
          ) : (
            displayItems.map((item) => (
              <FeedItem key={item.id} item={item} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FeedItem({ item }: { item: EventFeedItem }) {
  const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.conflict;
  const Icon = config.icon;
  const severityColor = item.severity ? getSeverityColor(item.severity) : undefined;

  return (
    <div
      className="flex-shrink-0 flex items-start gap-2 bg-background-panel border border-border rounded px-3 py-1.5 min-w-[280px] max-w-[360px] hover:border-border-bright transition-colors cursor-default"
      style={{ borderLeftColor: severityColor, borderLeftWidth: severityColor ? 2 : 1 }}
    >
      <Icon
        className={`w-3 h-3 mt-0.5 flex-shrink-0 ${config.color}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`font-mono text-[8px] tracking-widest ${config.color}`}>
            {config.label}
          </span>
          <span className="font-mono text-[8px] text-text-muted ml-auto flex-shrink-0">
            {formatTimestamp(item.timestamp)}
          </span>
        </div>
        <p className="font-mono text-[9px] text-text-primary leading-tight truncate">
          {item.title}
        </p>
        {item.subtitle && (
          <p className="font-mono text-[8px] text-text-muted truncate">
            {item.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
