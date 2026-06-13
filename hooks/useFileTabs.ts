"use client";

import { useState, useCallback } from "react";
import type { Tab } from "@/components/TabBar";

export function useFileTabs(onTabOpened?: () => void, onAllTabsClosed?: () => void) {
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);

  const handleOpenFile = useCallback(
    (filePath: string, fileName: string) => {
      const tabId = `file:${filePath}`;
      setFileTabs((prev) => {
        if (prev.find((t) => t.id === tabId)) return prev;
        return [...prev, { id: tabId, label: fileName, filePath }];
      });
      setActiveFileTabId(tabId);
      onTabOpened?.();
    },
    [onTabOpened]
  );

  const handleCloseFileTab = useCallback(
    (tabId: string) => {
      setFileTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) {
          onAllTabsClosed?.();
        }
        return next;
      });
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        const remaining = fileTabs.filter((t) => t.id !== tabId);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
    },
    [fileTabs, onAllTabsClosed]
  );

  return {
    fileTabs,
    activeFileTabId,
    setActiveFileTabId,
    handleOpenFile,
    handleCloseFileTab,
  };
}
