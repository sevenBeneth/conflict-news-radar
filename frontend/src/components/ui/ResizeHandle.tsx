"use client";

/**
 * CNR · 可复用拖拽手柄
 * ============================================================================
 *
 * 用于把界面各栏调整为可拖动改变尺寸的布局。
 *
 * ─── 设计要点 ───────────────────────────────────────────────────────────────
 *   1. 使用 **Pointer Events**（pointerdown/move/up）而非 Mouse Events，
 *      这样鼠标、触控板、触摸屏、手写笔都能工作，无需分别处理。
 *   2. 在 pointerdown 时调用 setPointerCapture，把手势绑定到该元素上。
 *      这样拖动过程中即使指针移出手柄元素甚至移出窗口，事件依然能收到，
 *      不会出现"鼠标一快就丢拖拽"的常见问题。
 *   3. 拖动期间给 body 加 cursor 与 user-select 控制（见 usePanelResize），
 *      避免出现文本被选中的拖影，并让光标在整页保持一致。
 *   4. 手柄视觉很细（1px 线 + 较大的透明命中区域），
 *      既不大幅占用空间，又保证容易点中。
 *
 * ─── 无障碍 ─────────────────────────────────────────────────────────────────
 *   手柄带 role="separator" 与 aria-orientation，并支持键盘方向键微调
 *   （每次 16px，按住 Shift 时 64px），使不依赖鼠标的用户也能调整布局。
 */

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface ResizeHandleProps {
  /** 拖动方向：vertical 表示手柄竖直、左右拖动改变宽度；horizontal 表示上下拖动改变高度 */
  orientation: "vertical" | "horizontal";
  /**
   * 拖动回调，参数为指针相对本次拖动起点的位移（像素）。
   * 由调用方决定如何换算成尺寸（不同栏的增减方向不同）。
   */
  onDrag: (delta: number) => void;
  /**
   * 拖动即将开始时触发。
   * 调用方通常用它记录"起始尺寸"，配合 onDrag 计算绝对尺寸，
   * 避免用增量累加导致的事件丢失误差。
   */
  onDragStart?: () => void;
  /** 键盘方向键微调回调，参数为尺寸增量（像素） */
  onNudge?: (delta: number) => void;
  /** 无障碍标签 */
  label: string;
  className?: string;
}

export default function ResizeHandle({
  orientation,
  onDrag,
  onDragStart,
  onNudge,
  label,
  className,
}: ResizeHandleProps) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const isVertical = orientation === "vertical";

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // 绑定指针：拖动中即使移出元素也能持续收到事件
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY };
      onDragStart?.();

      // 全局光标与禁止选中：避免拖拽时选中文本造成视觉拖影
      document.body.style.cursor = isVertical ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isVertical, onDragStart]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!start) return;
      e.preventDefault();
      // 竖直手柄 → 取水平位移（改变宽度）；水平手柄 → 取垂直位移（改变高度）
      const delta = isVertical ? e.clientX - start.x : e.clientY - start.y;
      onDrag(delta);
    },
    [isVertical, onDrag]
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return;
      startRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!onNudge) return;
      // Shift 加速，便于快速调整
      const step = e.shiftKey ? 64 : 16;
      const decreaseKey = isVertical ? "ArrowLeft" : "ArrowUp";
      const increaseKey = isVertical ? "ArrowRight" : "ArrowDown";

      if (e.key === decreaseKey) {
        e.preventDefault();
        onNudge(-step);
      } else if (e.key === increaseKey) {
        e.preventDefault();
        onNudge(step);
      }
    },
    [isVertical, onNudge]
  );

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      title={`拖动调整${label}（聚焦后可用方向键微调，Shift 加速）`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={cn(
        // 细线 + 较大命中区：宽/高 1px 的可见线，但用 padding 扩大可点区域
        "group relative z-20 flex-shrink-0 transition-colors",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-cyan",
        isVertical
          ? "w-1 cursor-col-resize hover:bg-accent-cyan/60 focus-visible:bg-accent-cyan/60"
          : "h-1 cursor-row-resize hover:bg-accent-cyan/60 focus-visible:bg-accent-cyan/60",
        "bg-border",
        className
      )}
    >
      {/*
        视觉抓手：默认半透明可见，hover / 聚焦时高亮。
        之所以默认就显示而不是完全隐藏：1px 的边线几乎看不出可以拖动，
        用户不会主动去试；保留一个淡淡的短横/短竖作为可拖动的视觉提示。
      */}
      <div
        className={cn(
          "absolute rounded-full bg-text-muted/70 transition-all",
          "opacity-40 group-hover:bg-accent-cyan group-hover:opacity-100 group-focus-visible:bg-accent-cyan group-focus-visible:opacity-100",
          isVertical
            ? "left-1/2 top-1/2 h-7 w-0.5 -translate-x-1/2 -translate-y-1/2"
            : "left-1/2 top-1/2 h-0.5 w-7 -translate-x-1/2 -translate-y-1/2"
        )}
      />
      {/* 扩大命中区域：向外扩展 3px，不改变可见宽度，避免细线难以点中 */}
      <div
        className={cn(
          "absolute",
          isVertical ? "-left-1 top-0 h-full w-3" : "-top-1 left-0 w-full h-3"
        )}
      />
    </div>
  );
}
