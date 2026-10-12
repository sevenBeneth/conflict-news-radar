"use client";

/**
 * CNR · 地图标记的悬停弹出行为
 * ============================================================================
 *
 * 让标记点在**鼠标悬停**时弹出信息框（含可点击的原文链接），而不是必须单击。
 *
 * ─── 为什么不用单击弹出 ──────────────────────────────────────────────────────
 *   单击弹出有两个问题：
 *     1. 发现性差 —— 用户不知道标记点里有什么，得逐个点开试探；
 *     2. 与"选中"语义冲突 —— 单击本应表示选中该目标，却被弹窗占用。
 *   改为悬停弹出后，浏览情报的动线是「扫视 → 悬停看详情 → 需要时点链接进原文」。
 *
 * ─── 关键：为什么链接点得到（踩过的坑）──────────────────────────────────────
 *   若用跟随鼠标位置的自绘浮层来显示详情，浮层会始终跟着光标跑，
 *   用户永远无法把指针移到链接上点击 —— 实测确认。
 *
 *   因此本模块使用 Leaflet 自身的 Popup：
 *     · Popup 锚定在**标记点的地理坐标**上，位置固定，不跟随鼠标；
 *     · 鼠标可以从标记点平滑移到 Popup 上，途中不会被关闭。
 *   因此链接天然可点。这也说明"详情浮层不应跟随光标"是交互上的硬要求。
 *
 * ─── 关闭时机的处理 ──────────────────────────────────────────────────────────
 *   · 移出标记点 → 检查指针是否已进入 Popup 内，若在则**不关闭**；
 *   · 移出 Popup → 关闭；
 *   · 点击 Popup 内的链接 → Popup 会保持到指针移出，不影响新窗口打开。
 */

import L from "leaflet";

/** Leaflet Popup 常用选项：统一样式与行为 */
export const POPUP_OPTIONS: L.PopupOptions = {
  // 关闭按钮会占据标题位置，悬停场景下用不到（移开即关）
  closeButton: false,
  // 悬停弹出不该抢焦点/滚动
  autoPan: true,
  autoPanPadding: [24, 24],
  // 让 Popup 在极窄屏幕下也能完整显示
  maxWidth: 340,
  minWidth: 220,
  className: "cnr-popup",
};

/**
 * 给标记绑定「悬停打开 / 移开关闭」的行为。
 *
 * @param marker 目标标记
 * @param content 弹出内容（HTML 字符串或元素）
 * @param onClick 可选：单击标记时的额外动作（如记录选中项），
 *                与弹窗互不干扰
 */
export function bindHoverPopup(
  marker: L.Marker,
  content: string | HTMLElement,
  onClick?: () => void
): void {
  marker.bindPopup(content, POPUP_OPTIONS);

  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelClose = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  /**
   * 延时关闭。
   * 之所以不立即关闭：用户从标记点移向 Popup 的过程中指针会短暂离开标记点，
   * 若立刻关闭，Popup 会在指针到达前消失，链接就永远点不到。
   * 200ms 足以覆盖这段移动，又不至于让用户觉得"关不掉"。
   */
  const scheduleClose = () => {
    cancelClose();
    closeTimer = setTimeout(() => {
      marker.closePopup();
      closeTimer = null;
    }, 200);
  };

  marker.on("mouseover", () => {
    cancelClose();
    marker.openPopup();
  });

  marker.on("mouseout", scheduleClose);

  // Popup 打开后把事件挂到其 DOM 上：进入 Popup 取消关闭，离开则关闭。
  // 注意要在 popupopen 时绑定，因为 DOM 节点是每次打开时新建的。
  marker.on("popupopen", (e: L.PopupEvent) => {
    const el = e.popup.getElement();
    if (!el) return;
    el.addEventListener("mouseenter", cancelClose);
    el.addEventListener("mouseleave", scheduleClose);
  });

  if (onClick) {
    marker.on("click", onClick);
  }
}
