"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useAppStore } from "@/store/useAppStore";
import { WS_URL } from "@/lib/constants";
import type { Aircraft, Vessel, ConflictEvent, NewsEvent } from "@/types";

export function useWebSocket(): void {
  const socketRef = useRef<Socket | null>(null);
  const {
    setConnected,
    setAircraft,
    addAircraft,
    setVessels,
    setConflicts,
    addConflicts,
    setNews,
    addNews,
    addFeedItem,
  } = useAppStore();

  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      console.info("[WS] Connected to CNR backend");
    });

    socket.on("disconnect", (reason) => {
      setConnected(false);
      console.warn("[WS] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.warn("[WS] Connection error:", err.message);
    });

    // Full dataset on first connect
    socket.on("aircraft:update", (data: Aircraft[]) => {
      setAircraft(data);
    });

    socket.on("vessels:update", (data: Vessel[]) => {
      setVessels(data);
    });

    socket.on("conflicts:update", (data: ConflictEvent[]) => {
      setConflicts(data);
    });

    socket.on("news:update", (data: NewsEvent[]) => {
      setNews(data);
    });

    // Incremental updates
    socket.on("conflicts:new", (data: ConflictEvent[]) => {
      addConflicts(data);
      data.forEach((e) =>
        addFeedItem({
          type: "conflict",
          // 事件类型与地点：地点为空时回退到国家，再回退到"未知地点"
          title: `${e.event_type ?? "冲突事件"} — ${e.location ?? e.country ?? "未知地点"}`,
          subtitle: e.description?.slice(0, 80) ?? null,
          severity: e.severity,
          timestamp: e.timestamp,
          lat: e.latitude,
          lon: e.longitude,
          source: e.source ?? null,
        })
      );
    });

    socket.on("news:new", (data: NewsEvent[]) => {
      addNews(data);
      data.forEach((n) =>
        addFeedItem({
          type: "news",
          title: n.headline,
          // 副标题保留摘要片段，悬停浮层里会给出完整标题与原文链接
          subtitle: n.summary?.slice(0, 80) ?? n.source ?? null,
          timestamp: n.timestamp,
          lat: n.latitude ?? undefined,
          lon: n.longitude ?? undefined,
          url: n.url ?? null,
          source: n.source ?? null,
        })
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    setConnected,
    setAircraft,
    addAircraft,
    setVessels,
    setConflicts,
    addConflicts,
    setNews,
    addNews,
    addFeedItem,
  ]);
}
