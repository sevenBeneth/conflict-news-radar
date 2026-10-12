"use client";

/**
 * 地图标记的弹出行为（基础版）。
 *
 * 统一 Popup 的通用选项，避免各图层各自设置。
 */

import L from "leaflet";

/** Leaflet Popup 常用选项：统一样式与行为 */
export const POPUP_OPTIONS: L.PopupOptions = {
  closeButton: false,
  autoPan: true,
  autoPanPadding: [24, 24],
  maxWidth: 340,
  minWidth: 220,
  className: "cnr-popup",
};

/**
 * 给标记绑定弹出内容。
 *
 * @param marker  目标标记
 * @param content 弹出内容（HTML 字符串或元素）
 * @param onClick 可选：单击标记时的额外动作（如记录选中项）
 */
export function bindHoverPopup(
  marker: L.Marker,
  content: string | HTMLElement,
  onClick?: () => void
): void {
  marker.bindPopup(content, POPUP_OPTIONS);
  if (onClick) {
    marker.on("click", onClick);
  }
}