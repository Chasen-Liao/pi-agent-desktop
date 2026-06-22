"use client";

import { useState, useCallback } from "react";
import type { Tab } from "@/components/TabBar";

/**
 * 纯函数：关闭一个 tab 后，下一个 active tab id 应该是什么。
 * 不读取任何外层闭包，便于单元测试。
 *
 * - 若关闭的不是当前 active，active 不变
 * - 若关闭的是当前 active，切到剩余 tab 列表的最后一个
 * - 若剩余 tab 为空，返回 null
 */
export function computeNextActiveId(
  currentActiveId: string | null,
  closingTabId: string,
  remainingTabs: Tab[]
): string | null {
  if (currentActiveId !== closingTabId) return currentActiveId;
  return remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
}

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
        // 在 setFileTabs 的 updater 内同步派生下一个 active id（不读闭包 fileTabs）
        setActiveFileTabId((cur) => computeNextActiveId(cur, tabId, next));
        if (next.length === 0) {
          onAllTabsClosed?.();
        }
        return next;
      });
    },
    [onAllTabsClosed]
  );

  return {
    fileTabs,
    activeFileTabId,
    setActiveFileTabId,
    handleOpenFile,
    handleCloseFileTab,
  };
}
