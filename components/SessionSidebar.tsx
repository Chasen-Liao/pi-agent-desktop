"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { SessionInfo } from "@/lib/types";
import { FileExplorer } from "./FileExplorer";
import { SidebarHeader } from "./session-sidebar/SidebarHeader";
import { SessionTreeItem } from "./session-sidebar/SessionTree";
import { ProjectGroup } from "./session-sidebar/ProjectGroup";
import { SidebarIcon } from "./session-sidebar/SidebarIcon";
import { groupProjects, projectKey, projectName, searchProjects, sortProjects } from "./session-sidebar/projects";
import { SortableProjects } from "./session-sidebar/SortableProjects";
import { useSidebarPreferences } from "./session-sidebar/useSidebarPreferences";
import { useI18n } from "./I18nProvider";
import { apiJson } from "./apiJson";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  onBranchSession?: (session: SessionInfo) => void;
  onCloneSession?: (session: SessionInfo) => void;
  onExportSession?: (session: SessionInfo) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string) => void;
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, onBranchSession, onCloneSession, onExportSession, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention }: Props) {
  const { t, locale } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [animateProjectSorting, setAnimateProjectSorting] = useState(true);
  const [preferences, setPreferences] = useSidebarPreferences();
  const selectedCwd = selectedCwdProp ?? null;
  const { explorerOpen } = preferences;
  const [explorerKey, setExplorerKey] = useState(0);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectListRef = useRef<HTMLElement>(null);
  const pendingProjectRef = useRef<string | null>(null);
  const scrolledSessionRef = useRef<string | null>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const data = await apiJson<{ sessions: SessionInfo[] }>("/api/sessions", undefined, { fallback: t("common.failed") });
      setAllSessions(data.sessions);
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [t]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((key) => key + 1);
  }, [explorerRefreshKey]);

  const projects = useMemo(() => groupProjects(allSessions, [...preferences.paths, ...(selectedCwd ? [selectedCwd] : [])]), [allSessions, preferences.paths, selectedCwd]);
  const sortedProjects = useMemo(() => sortProjects(projects, preferences.sortMode, preferences.projectOrder, locale), [projects, preferences.sortMode, preferences.projectOrder, locale]);
  const visibleProjects = useMemo(() => searchProjects(sortedProjects, searchQuery), [sortedProjects, searchQuery]);
  const searching = !!searchQuery.trim();
  const activeProjectKey = selectedCwd ? projectKey(selectedCwd) : null;
  const setExpanded = useCallback((key: string, expanded: boolean) => {
    setPreferences((previous) => ({ ...previous, expanded: { ...previous.expanded, [key]: expanded } }));
  }, [setPreferences]);

  const addProject = useCallback((cwd: string) => {
    const key = projectKey(cwd);
    pendingProjectRef.current = key;
    setPreferences((previous) => ({
      ...previous,
      paths: previous.paths.some((path) => projectKey(path) === key) ? previous.paths : [...previous.paths, cwd],
      expanded: { ...previous.expanded, [key]: true },
    }));
  }, [setPreferences]);

  const newSession = useCallback((cwd: string) => {
    setSearchQuery("");
    setExpanded(projectKey(cwd), true);
    onNewSession?.("", cwd);
  }, [onNewSession, setExpanded]);

  // Reveal a restored URL or fork once; refresh must respect manual collapse.
  const revealedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSessionId || revealedSessionRef.current === selectedSessionId) return;
    const session = allSessions.find((item) => item.id === selectedSessionId);
    if (!session) return;
    revealedSessionRef.current = selectedSessionId;
    setExpanded(projectKey(session.cwd), true);
  }, [selectedSessionId, allSessions, setExpanded]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (loading || error) return;
    if (initialSessionId && !restoredRef.current) {
      restoredRef.current = true;
      if (selectedSessionId === initialSessionId) return;
      const target = allSessions.find((session) => session.id === initialSessionId);
      if (target) {
        onSelectSession(target, true);
        return;
      }
      onInitialRestoreDone?.();
    }
    if (selectedCwd === null && projects[0]?.cwd) onCwdChange?.(projects[0].cwd);
  }, [loading, error, allSessions, projects, selectedCwd, initialSessionId, selectedSessionId, onCwdChange, onSelectSession, onInitialRestoreDone]);

  useEffect(() => {
    const list = projectListRef.current;
    if (!list) return;
    if (pendingProjectRef.current) {
      const project = [...list.querySelectorAll<HTMLElement>(".sidebar-project")]
        .find((element) => element.dataset.projectKey === pendingProjectRef.current);
      if (project) {
        project.querySelector(".sidebar-project-row")?.scrollIntoView({ block: "nearest" });
        pendingProjectRef.current = null;
      }
    }
    if (selectedSessionId && scrolledSessionRef.current !== selectedSessionId) {
      const selected = list.querySelector<HTMLElement>(".sidebar-session-row[data-selected]");
      if (selected?.getClientRects().length) {
        selected.scrollIntoView({ block: "nearest" });
        scrolledSessionRef.current = selectedSessionId;
      }
    }
  }, [projects, preferences.expanded, selectedSessionId]);

  useEffect(() => () => {
    if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
    if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
  }, []);

  return (
    <div className="sidebar-workspace">
      <SidebarHeader selectedCwd={selectedCwd ?? projects[0]?.cwd ?? null} onNewSession={newSession} onAddProject={addProject} loadSessions={loadSessions} sessionRefreshDone={sessionRefreshDone} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} sortMode={preferences.sortMode} onSortModeChange={(sortMode, animate) => {
        setAnimateProjectSorting(animate);
        setPreferences((previous) => ({ ...previous, sortMode }));
      }} />
      <nav ref={projectListRef} className="sidebar-project-list" aria-label={t("sidebar.projects")} aria-busy={loading}>
        {loading && <div className="sidebar-empty" role="status">{t("common.loading")}</div>}
        {error && <div className="sidebar-empty text-danger" role="alert">{error}</div>}
        {!loading && !error && visibleProjects.length === 0 && <div className="sidebar-empty" role="status">{t(searching ? "sidebar.noSearchResults" : "sidebar.noProjects")}</div>}
        <SortableProjects projects={visibleProjects} disabled={searching || loading} animateChanges={animateProjectSorting && !searching} listRef={projectListRef} onReorder={(projectOrder) => {
          setPreferences((previous) => ({ ...previous, sortMode: "manual", projectOrder }));
        }} renderProject={(project, dragHandle, dragging) => (
          <ProjectGroup project={project} dragHandle={dragHandle} dragging={dragging} expanded={searching || (preferences.expanded[project.key] ?? project.key === activeProjectKey)} active={project.key === activeProjectKey} duplicateName={projects.some((other) => other.key !== project.key && other.name === project.name)} onToggle={(expanded) => {
            if (searching) setSearchQuery("");
            setExpanded(project.key, expanded);
          }} onNewSession={() => newSession(project.cwd)}>
            {project.sessions.length === 0 && <button className="sidebar-empty-project" onClick={() => newSession(project.cwd)}>{t("sidebar.startFirstSession")}<SidebarIcon name="plus" size={13} /></button>}
            {project.tree.map((node) => <SessionTreeItem key={node.session.id} node={node} selectedSessionId={selectedSessionId} onSelectSession={onSelectSession} onRenamed={loadSessions} onSessionDeleted={(id) => { onSessionDeleted?.(id); void loadSessions(); }} onBranchSession={onBranchSession} onCloneSession={onCloneSession} onExportSession={onExportSession} depth={0} searching={searching} />)}
          </ProjectGroup>
        )} />
      </nav>
      {selectedCwd && <section className="sidebar-explorer" data-open={explorerOpen}>
        <div className="sidebar-explorer-heading">
          <button className="sidebar-explorer-toggle" onClick={() => setPreferences((previous) => ({ ...previous, explorerOpen: !previous.explorerOpen }))} aria-expanded={explorerOpen} aria-controls="sidebar-explorer-content" title={selectedCwd}>
            <SidebarIcon name="chevron" size={11} style={{ transform: explorerOpen ? "rotate(90deg)" : undefined }} />
            <span>{t("sidebar.projectFiles")}</span>
            <span className="sidebar-explorer-cwd">{projectName(selectedCwd)}</span>
          </button>
          <button className="sidebar-icon-button sidebar-refresh-button" data-done={explorerRefreshDone || undefined} onClick={() => {
            setExplorerKey((key) => key + 1);
            setExplorerRefreshDone(true);
            if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
            explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
          }} title={t("sidebar.refreshExplorer")} aria-label={t("sidebar.refreshExplorer")}><SidebarIcon name={explorerRefreshDone ? "check" : "refresh"} size={14} /></button>
        </div>
        <div id="sidebar-explorer-content" className="sidebar-explorer-content" hidden={!explorerOpen}>
          {explorerOpen && <FileExplorer key={selectedCwd} cwd={selectedCwd} onOpenFile={onOpenFile ?? (() => {})} refreshKey={explorerKey} onAtMention={onAtMention} />}
        </div>
      </section>}
    </div>
  );
}
