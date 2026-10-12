"use client";

import { useCallback, useRef, type ElementType } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, SlidersHorizontal, BarChart2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { PanelTab } from "@/types";
import { cn } from "@/lib/utils";
import ResizeHandle from "@/components/ui/ResizeHandle";
import AIChat from "./AIChat";
import FilterPanel from "./FilterPanel";
import StatsPanel from "./StatsPanel";

const TABS: { id: PanelTab; label: string; icon: ElementType }[] = [
  { id: "ai", label: "AI", icon: MessageSquare },
  { id: "filter", label: "筛选", icon: SlidersHorizontal },
  { id: "stats", label: "统计", icon: BarChart2 },
];

/** 折叠后的宽度（仅剩切换按钮的竖条） */
const COLLAPSED_W = 40;

export default function RightPanel() {
  const {
    activePanel,
    setActivePanel,
    rightPanelOpen: open,
    setRightPanelOpen: setOpen,
    rightPanelWidth,
    setRightPanelWidth,
  } = useAppStore();

  /**
   * 拖动起点宽度。
   *
   * 用 ref 记录 pointerdown 那一刻的宽度，配合手柄给的回调计算绝对宽度
   * （而不是每次 move 都做增量累加）。这样即使某次 pointermove 事件丢失，
   * 也不会产生累积误差导致面板"越拖越偏"。
   */
  const startWidthRef = useRef(rightPanelWidth);

  const handleDragStart = useCallback(() => {
    startWidthRef.current = rightPanelWidth;
  }, [rightPanelWidth]);

  /**
   * 手柄在面板**左边缘**：向左拖（delta 为负）应使面板变宽，
   * 因此新宽度 = 起点宽度 - 位移。
   */
  const handleDrag = useCallback(
    (delta: number) => {
      setRightPanelWidth(startWidthRef.current - delta);
    },
    [setRightPanelWidth]
  );

  /** 键盘微调：右方向键加宽，左方向键变窄（与手柄方向语义一致） */
  const handleNudge = useCallback(
    (delta: number) => {
      setRightPanelWidth(rightPanelWidth + delta);
    },
    [rightPanelWidth, setRightPanelWidth]
  );

  return (
    <div
      className="flex-shrink-0 flex relative z-10"
      // 展开时使用可调宽度；折叠时固定为窄条。
      // 注意这里不再使用 transition-all：拖动时若带过渡会造成明显拖影滞后。
      style={{ width: open ? rightPanelWidth : COLLAPSED_W }}
    >
      {/*
        左侧竖条：由上「拖动手柄」+ 下「折叠按钮」组成，二者竖向排布、互不重叠。
        ⚠ 不可把折叠按钮做成 absolute -left-3 top-1/2（悬浮在面板左边缘中央）：
        那个位置正好压在拖动手柄上，且按钮 z-index 更高，会把 pointerdown 全部
        吃掉，导致拖动完全无效（宽度恒为初值）。并排布局后两者各自独立可点。
      */}
      <div className="w-3 h-full flex flex-col flex-shrink-0">
        {open ? (
          <>
            <ResizeHandle
              orientation="vertical"
              label="右侧面板宽度"
              onDragStart={handleDragStart}
              onDrag={handleDrag}
              onNudge={handleNudge}
              className="flex-1 min-h-0"
            />
            <button
              onClick={() => setOpen(false)}
              title="折叠右侧面板"
              aria-label="折叠右侧面板"
              className="h-12 w-3 bg-background-secondary border-y border-l border-border rounded-l flex items-center justify-center text-text-muted hover:text-text-secondary hover:bg-background-tertiary transition-colors opacity-60 hover:opacity-100"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setOpen(true)}
            title="展开右侧面板"
            aria-label="展开右侧面板"
            className="h-12 w-3 bg-background-secondary border-y border-l border-border rounded-l flex items-center justify-center text-text-muted hover:text-text-secondary hover:bg-background-tertiary transition-colors my-auto"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="w-full bg-background-secondary border-l border-border flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border flex-shrink-0">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActivePanel(id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2.5 font-mono text-[9px] tracking-widest transition-colors",
                  activePanel === id
                    ? "text-accent-cyan border-b-2 border-accent-cyan bg-background-panel"
                    : "text-text-muted hover:text-text-secondary"
                )}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {activePanel === "ai" && <AIChat />}
            {activePanel === "filter" && <FilterPanel />}
            {activePanel === "stats" && <StatsPanel />}
          </div>
        </div>
      )}
    </div>
  );
}
