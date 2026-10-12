"use client";

/**
 * 面板尺寸调节手柄。
 *
 * 基础版：渲染一个带无障碍语义的细条，具体的拖动交互在后续迭代中实现。
 * 保留该组件是为了让布局容器不必因手柄是否存在而改动结构。
 */

import { cn } from "@/lib/utils";

export interface ResizeHandleProps {
  /** 手柄方向：vertical 为竖直（左右拖动改宽度），horizontal 为水平（上下拖动改高度） */
  orientation: "vertical" | "horizontal";
  /** 拖动回调（基础版未启用） */
  onDrag?: (delta: number) => void;
  /** 拖动开始回调（基础版未启用） */
  onDragStart?: () => void;
  /** 键盘微调回调（基础版未启用） */
  onNudge?: (delta: number) => void;
  /** 无障碍标签 */
  label: string;
  className?: string;
}

export default function ResizeHandle({
  orientation,
  label,
  className,
}: ResizeHandleProps) {
  const isVertical = orientation === "vertical";

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-label={label}
      className={cn(
        "flex-shrink-0 bg-border",
        isVertical ? "w-1" : "h-1",
        className
      )}
    />
  );
}