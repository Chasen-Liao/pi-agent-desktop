"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime, type SessionTreeNode } from "./helpers";
import { useI18n } from "../I18nProvider";

interface SessionTreeItemProps {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  onBranchSession?: (s: SessionInfo) => void;
  onCloneSession?: (s: SessionInfo) => void;
  onExportSession?: (s: SessionInfo) => void;
  depth: number;
}

export function SessionTreeItem({
  node,
  selectedSessionId,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onBranchSession,
  onCloneSession,
  onExportSession,
  depth,
}: SessionTreeItemProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="relative">
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
            style={{
              left: depth * 12 + 6,
            }}
          />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          onBranchSession={onBranchSession}
          onCloneSession={onCloneSession}
          onExportSession={onExportSession}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && (
        <div
          className={`session-tree-children grid transition-[grid-template-rows,opacity] duration-250 ease-[var(--ease-smooth-out)] ${
            collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="overflow-hidden">
            {node.children.map((child) => (
              <SessionTreeItem
                key={child.session.id}
                node={child}
                selectedSessionId={selectedSessionId}
                onSelectSession={onSelectSession}
                onRenamed={onRenamed}
                onSessionDeleted={onSessionDeleted}
                onBranchSession={onBranchSession}
                onCloneSession={onCloneSession}
                onExportSession={onExportSession}
                depth={depth + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SessionItemProps {
  session: SessionInfo;
  isSelected: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  onBranchSession?: (s: SessionInfo) => void;
  onCloneSession?: (s: SessionInfo) => void;
  onExportSession?: (s: SessionInfo) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SessionItem({
  session,
  isSelected,
  onClick,
  onRenamed,
  onDeleted,
  onBranchSession,
  onCloneSession,
  onExportSession,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: SessionItemProps) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [rowFocused, setRowFocused] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
  const actionsVisible = hovered || rowFocused;

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }, []);
  // Fixed-height outer wrapper — content swaps in place so the list never reflows

  const bgClass = confirmDelete
    ? "bg-danger-bg"
    : isSelected
    ? "bg-bg-selected"
    : actionsVisible
    ? "bg-bg-hover"
    : "bg-transparent";

  const borderClass = confirmDelete
    ? "border-l-2 border-danger"
    : isSelected
    ? "border-l-2 border-accent"
    : "border-l-2 border-transparent";

  return (
    <div
      ref={rowRef}
      tabIndex={confirmDelete || renaming ? undefined : 0}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !confirmDelete && !renaming) {
          e.preventDefault();
          onClick?.();
        }
      }}
      onContextMenu={handleContextMenu}
      onFocus={() => setRowFocused(true)}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && rowRef.current?.contains(next)) return;
        setRowFocused(false);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative h-[52px] flex items-center pr-2 transition-[background-color,border-color,opacity] duration-150 gap-1.5 overflow-hidden ${bgClass} ${borderClass} ${
        confirmDelete || renaming ? "cursor-default" : "cursor-pointer"
      } ${deleting ? "opacity-50" : "opacity-100"}`}
      style={{
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div className="flex-1 min-w-0 text-[12px] text-text overflow-hidden text-ellipsis whitespace-nowrap">
            {t("sidebar.deleteSession", { name: `${title.slice(0, 22)}${title.length > 22 ? "…" : ""}` })}
          </div>
          <div className="flex gap-1.25 shrink-0">
            <button
              onClick={handleDeleteConfirm}
              className="flex items-center justify-center gap-1 h-[30px] px-[11px] bg-danger border-none rounded-control text-accent-contrast cursor-pointer text-[12px] font-semibold whitespace-nowrap active:scale-95 transition-[background-color,color,transform] duration-150"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("common.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              className="flex items-center justify-center h-[30px] px-[11px] bg-bg hover:bg-bg-hover border border-border rounded-control text-text-muted cursor-pointer text-[12px] font-medium whitespace-nowrap active:scale-95 transition-[background-color,border-color,color,transform] duration-150"
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          className="flex-1 text-[12px] py-1.25 px-2 border border-accent rounded-control outline-none bg-bg text-text h-[30px]"
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-text-dim shrink-0">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div className="flex-1 min-w-0">
            <div
              className={`text-[12px] leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap ${
                isSelected ? "font-semibold text-text-strong" : "font-medium text-text"
              }`}
              title={title}
            >
              {title}
            </div>
            <div className="mt-0.5 flex gap-2 text-text-dim text-[11px]">
              <span title={session.modified}>{formatRelativeTime(session.modified, locale)}</span>
              <span>{t("common.messages", { count: session.messageCount })}</span>
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              title={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              aria-label={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              className={`flex items-center justify-center w-5 h-5 p-0 shrink-0 bg-transparent border-none text-text-dim cursor-pointer transition-transform duration-150 ${
                collapsed ? "-rotate-90" : ""
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons keep their width reserved so hover does not shift text. */}
          <div
            className={`flex gap-1 shrink-0 transition-opacity duration-150 ${
              actionsVisible || menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenuPos({ x: rect.left, y: rect.bottom + 4 });
                setMenuOpen(true);
              }}
              title={t("common.moreActions")}
              aria-label={t("common.moreActions")}
              tabIndex={actionsVisible ? 0 : -1}
              className="flex items-center justify-center w-7 h-7 p-0 bg-transparent hover:bg-chrome-button-hover border border-transparent hover:border-border rounded-control text-text-dim hover:text-text cursor-pointer shrink-0 transition-[background-color,border-color,color,transform] duration-150 active:scale-95"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>

          </div>

          {/* Context Menu Dropdown */}
          {menuOpen && menuPos && (
            <div
              ref={menuRef}
              style={{
                position: "fixed",
                top: menuPos.y,
                left: menuPos.x,
                zIndex: 1000,
              }}
              className="t-dropdown is-open material-popover w-44 border border-divider rounded-panel shadow-popover py-1 text-[12px] text-text"
              data-origin="top-left"
            >
              {onBranchSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onBranchSession(session);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-left cursor-pointer transition-colors border-none bg-transparent text-text"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {t("sidebar.branchSession")}
                </button>
              )}
              {onCloneSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onCloneSession(session);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-left cursor-pointer transition-colors border-none bg-transparent text-text"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  {t("sidebar.cloneSession")}
                </button>
              )}
              {onExportSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onExportSession(session);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-left cursor-pointer transition-colors border-none bg-transparent text-text"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {t("sidebar.exportSession")}
                </button>
              )}
              <div className="my-1 border-t border-divider" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  startRename(e);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-left cursor-pointer transition-colors border-none bg-transparent text-text"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                {t("sidebar.renameSession")}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  handleDeleteClick(e);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-left cursor-pointer transition-colors border-none bg-transparent text-danger"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-danger">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                {t("sidebar.deleteAction")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
