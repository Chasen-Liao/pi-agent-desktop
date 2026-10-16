"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime, type SessionTreeNode } from "./helpers";
import { sessionTitle } from "./projects";
import { SidebarIcon } from "./SidebarIcon";
import { useI18n } from "../I18nProvider";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";

interface SessionTreeItemProps {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  onBranchSession?: (session: SessionInfo) => void;
  onCloneSession?: (session: SessionInfo) => void;
  onExportSession?: (session: SessionInfo) => void;
  depth: number;
  searching?: boolean;
}

function containsSession(nodes: SessionTreeNode[], id: string | null): boolean {
  return nodes.some((node) => node.session.id === id || containsSession(node.children, id));
}

export function SessionTreeItem(props: SessionTreeItemProps) {
  const { node, selectedSessionId, depth, searching } = props;
  const [collapsed, setCollapsed] = useState(false);
  const containsSelection = containsSession(node.children, selectedSessionId);
  useEffect(() => {
    if (containsSelection || searching) setCollapsed(false);
  }, [selectedSessionId, containsSelection, searching]);
  const expanded = !collapsed;

  return (
    <div className="sidebar-session-node">
      <SessionItem {...props} collapsed={!expanded} onToggleCollapse={() => setCollapsed(expanded)} />
      {node.children.length > 0 && <div className="session-tree-children" hidden={!expanded}>
        {node.children.map((child) => <SessionTreeItem {...props} key={child.session.id} node={child} depth={depth + 1} />)}
      </div>}
    </div>
  );
}

function SessionItem({
  node, selectedSessionId, onSelectSession, onRenamed, onSessionDeleted,
  onBranchSession, onCloneSession, onExportSession, depth, collapsed, onToggleCollapse,
}: SessionTreeItemProps & { collapsed: boolean; onToggleCollapse: () => void }) {
  const session = node.session;
  const isSelected = session.id === selectedSessionId;
  const { locale, t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRenameRef = useRef(false);
  const title = sessionTitle(session);
  const menuOpen = menuPos !== null;

  useEffect(() => {
    if (renaming) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [renaming]);
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menuOpen]);
  useDismissOnOutsideClick(menuRef, menuOpen, (reason) => {
    setMenuPos(null);
    if (reason === "escape") triggerRef.current?.focus();
  });

  const commitRename = useCallback(async () => {
    setRenaming(false);
    if (cancelRenameRef.current) return;
    const name = renameValue.trim();
    if (name === (session.name ?? "")) return;
    try {
      const response = await fetch("/api/sessions/" + encodeURIComponent(session.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(t("common.failed"));
      onRenamed?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("common.failed"));
    }
  }, [renameValue, session.id, session.name, onRenamed, t]);

  const deleteSession = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const response = await fetch("/api/sessions/" + encodeURIComponent(session.id), { method: "DELETE" });
      if (!response.ok) throw new Error(t("common.failed"));
      onSessionDeleted?.(session.id);
    } catch (error) {
      setDeleting(false);
      setActionError(error instanceof Error ? error.message : t("common.failed"));
    }
  };

  const actions = [
    ...(onBranchSession ? [{ label: t("sidebar.branchSession"), icon: "branch" as const, run: () => onBranchSession(session) }] : []),
    ...(onCloneSession ? [{ label: t("sidebar.cloneSession"), icon: "copy" as const, run: () => onCloneSession(session) }] : []),
    ...(onExportSession ? [{ label: t("sidebar.exportSession"), icon: "download" as const, run: () => onExportSession(session) }] : []),
    { label: t("sidebar.renameSession"), icon: "pencil" as const, run: () => {
      cancelRenameRef.current = false;
      setRenameValue(session.name ?? "");
      setRenaming(true);
    } },
    { label: t("sidebar.deleteAction"), icon: "trash" as const, run: () => setConfirmDelete(true) },
  ];
  const openMenu = (x: number, y: number) => {
    setActionError(null);
    setMenuPos({
      x: Math.max(8, Math.min(x, window.innerWidth - 198)),
      y: Math.max(8, Math.min(y, window.innerHeight - actions.length * 34 - 18)),
    });
  };

  return (
    <>
      <div className="sidebar-session-row" data-selected={isSelected || undefined} data-menu-open={menuOpen || undefined} data-confirming={confirmDelete || undefined} aria-busy={deleting} style={{ paddingLeft: Math.min(depth, 6) * 12 + 22 }} onContextMenu={(event) => {
        if (renaming || confirmDelete) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}>
        {confirmDelete ? <>
          <span className="sidebar-delete-label">{t("sidebar.deleteSession", { name: title })}</span>
          <button className="sidebar-confirm-delete" onClick={() => void deleteSession()}>{t("common.delete")}</button>
          <button className="sidebar-cancel-delete" onClick={() => { setConfirmDelete(false); selectRef.current?.focus(); }}>{t("common.cancel")}</button>
        </> : renaming ? <input ref={inputRef} aria-label={t("sidebar.renameSession")} className="sidebar-rename-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => void commitRename()} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { cancelRenameRef.current = true; setRenaming(false); }
        }} /> : <>
          {node.children.length > 0 ? <button className="sidebar-fork-toggle" onClick={onToggleCollapse} aria-expanded={!collapsed} aria-label={t(collapsed ? "sidebar.expandForks" : "sidebar.collapseForks")} title={t(collapsed ? "sidebar.expandForks" : "sidebar.collapseForks")}><SidebarIcon name="chevron" size={10} style={{ transform: collapsed ? undefined : "rotate(90deg)" }} /></button> : <span className="sidebar-fork-spacer" />}
          <button ref={selectRef} className="sidebar-session-select" aria-current={isSelected ? "page" : undefined} onClick={() => onSelectSession(session)} disabled={deleting} title={title + "\n" + formatRelativeTime(session.modified, locale) + " · " + t("common.messages", { count: session.messageCount })}>
            {depth > 0 && <SidebarIcon name="branch" size={11} className="sidebar-fork-icon" />}
            <span className="sidebar-session-title">{title}</span>
            <time className="sidebar-session-time" dateTime={session.modified}>{formatRelativeTime(session.modified, locale, true)}</time>
          </button>
          <button ref={triggerRef} className="sidebar-icon-button sidebar-session-actions" aria-label={t("common.moreActions")} title={t("common.moreActions")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => {
            if (menuOpen) { setMenuPos(null); return; }
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.right - 190, rect.bottom + 4);
          }}><SidebarIcon name="more" size={14} /></button>
        </>}
      </div>
      {actionError && <p className="sidebar-action-error" role="alert">{actionError}</p>}
      {menuPos && createPortal(
        <div ref={menuRef} role="menu" aria-label={t("common.moreActions")} className="sidebar-session-menu material-popover shadow-popover t-dropdown is-open" data-origin="top-right" style={{ position: "fixed", top: menuPos.y, left: menuPos.x, zIndex: 1000 }} onKeyDown={(event) => {
          if (event.key === "Tab") { setMenuPos(null); triggerRef.current?.focus(); return; }
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
          if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
        }}>
          {actions.map((action) => <button key={action.icon} role="menuitem" tabIndex={-1} className={action.icon === "trash" ? "sidebar-menu-danger" : undefined} onClick={() => { setMenuPos(null); setActionError(null); action.run(); }}><SidebarIcon name={action.icon} size={14} />{action.label}</button>)}
        </div>, document.body
      )}
    </>
  );
}
