"use client";

import { useState, useCallback, useRef } from "react";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime, type SessionTreeNode } from "./helpers";

interface SessionTreeItemProps {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}

export function SessionTreeItem({
  node,
  selectedSessionId,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
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
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
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
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: SessionItemProps) {
  const [hovered, setHovered] = useState(false);
  const [rowFocused, setRowFocused] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

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
        if (confirmDelete || renaming || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onFocus={() => setRowFocused(true)}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && rowRef.current?.contains(next)) return;
        setRowFocused(false);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`h-[52px] flex items-center pr-2 transition-all duration-120 gap-1.5 overflow-hidden ${bgClass} ${borderClass} ${
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
            Delete <span className="font-semibold">&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</span>?
          </div>
          <div className="flex gap-1.25 shrink-0">
            <button
              onClick={handleDeleteConfirm}
              className="flex items-center justify-center gap-1 h-[30px] px-[11px] bg-danger border-none rounded-control text-accent-contrast cursor-pointer text-[12px] font-semibold whitespace-nowrap"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete
            </button>
            <button
              onClick={handleDeleteCancel}
              className="flex items-center justify-center h-[30px] px-[11px] bg-bg hover:bg-bg-hover border border-border rounded-control text-text-muted cursor-pointer text-[12px] font-medium whitespace-nowrap"
            >
              Cancel
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
              <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
              <span>{session.messageCount} msgs</span>
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              title={collapsed ? "Expand forks" : "Collapse forks"}
              aria-label={collapsed ? "Expand forks" : "Collapse forks"}
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
            className={`flex gap-1 shrink-0 transition-opacity duration-120 ${
              actionsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
          >
            <button
              onClick={startRename}
              title="Rename"
              aria-label="Rename session"
              tabIndex={actionsVisible ? 0 : -1}
              className="flex items-center justify-center w-7 h-7 p-0 bg-chrome-button-bg hover:bg-chrome-button-hover border border-border hover:border-focus-ring rounded-control text-text-muted hover:text-accent cursor-pointer shrink-0 transition-all duration-120"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
            <button
              onClick={handleDeleteClick}
              title="Delete"
              aria-label="Delete session"
              tabIndex={actionsVisible ? 0 : -1}
              className="flex items-center justify-center w-7 h-7 p-0 bg-chrome-button-bg hover:bg-danger-bg border border-border hover:border-danger-border rounded-control text-text-muted hover:text-danger cursor-pointer shrink-0 transition-all duration-120"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
