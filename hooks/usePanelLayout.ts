"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { clampPanelWidth, getDefaultPanelWidths } from "@/lib/panel-layout";

export function usePanelLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const [panelWidths, setPanelWidths] = useState(() =>
    getDefaultPanelWidths(typeof window === "undefined" ? 1200 : window.innerWidth)
  );

  const panelResizeRef = useRef<{
    side: "left" | "right";
    startX: number;
    startWidth: number;
    pointerId: number;
    target: HTMLDivElement;
  } | null>(null);

  const beginPanelResize = useCallback(
    (side: "left" | "right", e: React.PointerEvent<HTMLDivElement>) => {
      if (window.innerWidth <= 640) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panelResizeRef.current = {
        side,
        startX: e.clientX,
        startWidth: side === "left" ? panelWidths.left : panelWidths.right,
        pointerId: e.pointerId,
        target: e.currentTarget,
      };
      setResizingSide(side);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [panelWidths.left, panelWidths.right]
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const active = panelResizeRef.current;
      if (!active) return;
      const delta = e.clientX - active.startX;
      const nextWidth = active.side === "left" ? active.startWidth + delta : active.startWidth - delta;
      setPanelWidths((prev) => ({
        ...prev,
        [active.side]: clampPanelWidth(active.side, nextWidth, window.innerWidth),
      }));
    };

    const handlePointerUp = () => {
      const active = panelResizeRef.current;
      if (!active) return;
      if (active.target.hasPointerCapture(active.pointerId)) {
        active.target.releasePointerCapture(active.pointerId);
      }
      panelResizeRef.current = null;
      setResizingSide(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPanelWidths((prev) => ({
        left: clampPanelWidth("left", prev.left, window.innerWidth),
        right: clampPanelWidth("right", prev.right, window.innerWidth),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return {
    sidebarOpen,
    setSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
    panelWidths,
    resizingSide,
    beginPanelResize,
  };
}
