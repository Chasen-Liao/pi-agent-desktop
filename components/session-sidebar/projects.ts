import type { SessionInfo } from "../../lib/types";
import { buildSessionTree, type SessionTreeNode } from "./helpers.ts";

export interface SidebarProject {
  key: string;
  cwd: string;
  name: string;
  parentPath: string;
  sessions: SessionInfo[];
  tree: SessionTreeNode[];
  modified: string;
}

// Only Windows paths are case-insensitive. Keep the original cwd for all actions.
export function projectKey(cwd: string): string {
  const path = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "") || (cwd.trim() ? "/" : "");
  // WSL's host/distribution names are Windows identifiers; its Linux suffix is not.
  const wsl = path.match(/^(\/\/(?:wsl\.localhost|wsl\$)\/[^/]+)(\/.*)?$/i);
  if (wsl) return wsl[1].toLowerCase() + (wsl[2] ?? "");
  return /^(?:[a-z]:|\/\/)/i.test(path) ? path.toLowerCase() : path;
}

export function projectName(cwd: string): string {
  const path = cwd.replace(/[\\/]+$/, "");
  return path.split(/[\\/]/).pop() || cwd;
}

export function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

export function groupProjects(sessions: SessionInfo[], paths: string[] = []): SidebarProject[] {
  const byPath = new Map<string, SidebarProject>();
  const ensureProject = (cwd: string) => {
    const key = projectKey(cwd);
    let project = byPath.get(key);
    if (!project) {
      project = {
        key, cwd, name: projectName(cwd),
        parentPath: cwd.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, ""),
        sessions: [], tree: [], modified: "",
      };
      byPath.set(key, project);
    }
    return project;
  };
  for (const session of sessions) {
    const project = ensureProject(session.cwd);
    project.sessions.push(session);
    if (session.modified > project.modified) project.modified = session.modified;
  }
  for (const cwd of paths) {
    if (cwd.trim()) ensureProject(cwd);
  }
  for (const project of byPath.values()) project.tree = buildSessionTree(project.sessions);
  return [...byPath.values()].sort((a, b) => b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name));
}

function filterTree(nodes: SessionTreeNode[], matches: (session: SessionInfo) => boolean): SessionTreeNode[] {
  return nodes.flatMap((node) => {
    if (matches(node.session)) return [node];
    const children = filterTree(node.children, matches);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function searchProjects(projects: SidebarProject[], query: string): SidebarProject[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return projects;
  return projects.flatMap((project) => {
    const projectText = `${project.name} ${project.cwd}`.toLocaleLowerCase();
    if (terms.every((term) => projectText.includes(term))) return [project];
    const tree = filterTree(project.tree, (session) => {
      const text = `${projectText} ${sessionTitle(session)}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
    return tree.length ? [{ ...project, tree }] : [];
  });
}

export interface SidebarPreferences {
  paths: string[];
  expanded: Record<string, boolean>;
  explorerOpen: boolean;
  sortMode: ProjectSortMode;
  projectOrder: string[];
}

export type ProjectSortMode = "name" | "recent" | "manual";

export const defaultSidebarPreferences: SidebarPreferences = {
  paths: [], expanded: {}, explorerOpen: true, sortMode: "name", projectOrder: [],
};

export function sortProjects(projects: SidebarProject[], mode: ProjectSortMode, order: string[] = [], locale = "en"): SidebarProject[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const byName = (a: SidebarProject, b: SidebarProject) =>
    collator.compare(a.name, b.name) || a.key.localeCompare(b.key);
  const positions = new Map(order.map((key, index) => [key, index]));
  return [...projects].sort((a, b) => {
    if (mode === "recent") return b.modified.localeCompare(a.modified) || byName(a, b);
    if (mode === "manual") {
      const delta = (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity);
      if (delta && !Number.isNaN(delta)) return delta;
    }
    return byName(a, b);
  });
}

export function moveProject(keys: string[], source: string, target: string): string[] {
  const from = keys.indexOf(source);
  const to = keys.indexOf(target);
  if (from < 0 || to < 0 || from === to) return keys;
  const next = [...keys];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function parseSidebarPreferences(value: string | null): SidebarPreferences {
  try {
    const data: unknown = JSON.parse(value ?? "null");
    if (!data || typeof data !== "object") return defaultSidebarPreferences;
    const saved = data as Partial<SidebarPreferences>;
    return {
      paths: Array.isArray(saved.paths) ? saved.paths.filter((path): path is string => typeof path === "string" && !!path.trim()) : [],
      expanded: saved.expanded && typeof saved.expanded === "object" && !Array.isArray(saved.expanded)
        ? Object.fromEntries(Object.entries(saved.expanded).filter(([, open]) => typeof open === "boolean")) : {},
      explorerOpen: typeof saved.explorerOpen === "boolean" ? saved.explorerOpen : true,
      sortMode: saved.sortMode === "recent" || saved.sortMode === "manual" ? saved.sortMode : "name",
      projectOrder: Array.isArray(saved.projectOrder)
        ? [...new Set(saved.projectOrder.filter((key): key is string => typeof key === "string"))] : [],
    };
  } catch {
    return defaultSidebarPreferences;
  }
}
