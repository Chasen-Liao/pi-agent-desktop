"use client";

import { useId, type ReactNode } from "react";
import { useI18n } from "../I18nProvider";
import type { SidebarProject } from "./projects";
import { SidebarIcon } from "./SidebarIcon";

export function ProjectGroup({ project, expanded, active, duplicateName, onToggle, onNewSession, children, dragHandle, dragging = false }: {
  project: SidebarProject;
  expanded: boolean;
  active: boolean;
  duplicateName: boolean;
  onToggle: (expanded: boolean) => void;
  onNewSession: () => void;
  children: ReactNode;
  dragHandle?: ReactNode;
  dragging?: boolean;
}) {
  const { t } = useI18n();
  const contentId = useId();
  return (
    <section className="sidebar-project" data-project-key={project.key} data-dragging={dragging || undefined}>
      <div className="sidebar-project-row" data-active={active || undefined}>
        {dragHandle}
        <button
          className="sidebar-project-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          title={project.cwd}
          onClick={() => onToggle(!expanded)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              onToggle(event.key === "ArrowRight");
            }
          }}
        >
          <SidebarIcon name="chevron" size={10} className="sidebar-project-chevron" style={{ transform: expanded ? "rotate(90deg)" : undefined }} />
          <SidebarIcon name={expanded ? "folder-open" : "folder"} size={17} className="sidebar-project-folder" />
          <span className="sidebar-project-name">{project.name || t("sidebar.otherSessions")}</span>
          {duplicateName && <span className="sidebar-project-path">{project.parentPath}</span>}
        </button>
        <span className="sidebar-project-count" aria-hidden="true">{project.sessions.length || ""}</span>
        <button className="sidebar-icon-button sidebar-project-add" title={t("sidebar.newSessionIn", { path: project.cwd })} aria-label={t("sidebar.newSessionIn", { path: project.cwd })} disabled={!project.cwd} onClick={onNewSession}>
          <SidebarIcon name="plus" size={15} />
        </button>
      </div>
      <div className="sidebar-project-content" id={contentId} data-expanded={expanded && !dragging} aria-hidden={!expanded || dragging} inert={!expanded || dragging}>
        <div className="sidebar-project-content-inner">{children}</div>
      </div>
    </section>
  );
}
