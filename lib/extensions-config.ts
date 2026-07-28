import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, isAbsolute, relative, resolve } from "path";
import { DefaultResourceLoader, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type ExtensionScope = "global" | "project" | "user" | "system";

export interface ExtensionInfo {
  id: string;
  name: string;
  path: string;
  source: string;
  scope: ExtensionScope;
  enabled: boolean;
  tools?: string[];
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  scope: ExtensionScope;
  disableModelInvocation?: boolean;
}

export interface ExtensionDiagnostic {
  type: string;
  message: string;
  path?: string;
  scope?: ExtensionScope;
}

export interface ExtensionsListResult {
  extensions: ExtensionInfo[];
  skills: SkillInfo[];
  diagnostics: ExtensionDiagnostic[];
}

export interface GetExtensionsOptions {
  agentDir?: string;
}

export function getExtensionIdAndName(extPath: string): { id: string; name: string } {
  const normalized = extPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "extension";
  if (last === "index.ts" || last === "index.js") {
    const parentFolder = parts[parts.length - 2] ?? last;
    return { id: parentFolder, name: parentFolder };
  }
  const nameWithoutExt = last.replace(/\.[^/.]+$/, "");
  return { id: nameWithoutExt, name: nameWithoutExt };
}

export async function getExtensionsConfig(
  cwd?: string,
  options?: GetExtensionsOptions
): Promise<ExtensionsListResult> {
  const agentDir = options?.agentDir ?? getAgentDir();
  const effectiveCwd = cwd ?? process.cwd();

  const globalSettingsPath = getSettingsPath("global", undefined, agentDir);
  const globalSettings = readSettingsFile(globalSettingsPath);
  const disabledSet = new Set<string>(
    Array.isArray(globalSettings.disabledExtensions) ? (globalSettings.disabledExtensions as string[]) : []
  );

  if (effectiveCwd) {
    try {
      const projPath = getSettingsPath("project", effectiveCwd, agentDir);
      const projSettings = readSettingsFile(projPath);
      if (Array.isArray(projSettings.disabledExtensions)) {
        for (const item of projSettings.disabledExtensions as string[]) {
          disabledSet.add(item);
        }
      }
    } catch {}
  }

  const loader = new DefaultResourceLoader({
    cwd: effectiveCwd,
    agentDir,
  });

  await loader.reload();

  const { extensions: rawExts, errors: rawExtErrors } = loader.getExtensions();
  const { skills: rawSkills, diagnostics: rawSkillDiags } = loader.getSkills();

  const extensions: ExtensionInfo[] = rawExts.map((ext) => {
    const { id, name } = getExtensionIdAndName(ext.path);
    const rawScope = ext.sourceInfo?.scope;
    const scope: ExtensionScope = rawScope === "user" ? "global" : (rawScope as ExtensionScope) ?? "global";
    const tools = ext.tools ? Array.from(ext.tools.keys()) : [];
    const enabled = !disabledSet.has(id) && !disabledSet.has(ext.path);

    return {
      id,
      name,
      path: ext.path,
      source: ext.sourceInfo?.source ?? "auto",
      scope,
      enabled,
      ...(tools.length > 0 ? { tools } : {}),
    };
  });

  const skills: SkillInfo[] = rawSkills.map((skill) => {
    const rawScope = skill.sourceInfo?.scope;
    const scope: ExtensionScope = rawScope === "user" ? "global" : (rawScope as ExtensionScope) ?? "project";

    return {
      name: skill.name,
      description: skill.description ?? "",
      filePath: skill.filePath,
      scope,
      ...(skill.disableModelInvocation !== undefined ? { disableModelInvocation: skill.disableModelInvocation } : {}),
    };
  });

  const diagnostics: ExtensionDiagnostic[] = [];

  if (Array.isArray(rawExtErrors)) {
    for (const err of rawExtErrors) {
      const errObj = typeof err === "object" && err !== null ? ((err as unknown) as Record<string, unknown>) : null;
      const msg = typeof err === "string" ? err : String(errObj?.error ?? errObj?.message ?? String(err));
      const errPath = errObj && typeof errObj.path === "string" ? errObj.path : undefined;
      diagnostics.push({
        type: "extension_error",
        message: msg,
        ...(errPath ? { path: errPath } : {}),
      });
    }
  }

  if (Array.isArray(rawSkillDiags)) {
    for (const diag of rawSkillDiags) {
      const diagObj = typeof diag === "object" && diag !== null ? ((diag as unknown) as Record<string, unknown>) : null;
      const msg = typeof diag === "string" ? diag : String(diagObj?.error ?? diagObj?.message ?? String(diag));
      const diagPath = diagObj && typeof diagObj.path === "string" ? diagObj.path : undefined;
      diagnostics.push({
        type: "skill_error",
        message: msg,
        ...(diagPath ? { path: diagPath } : {}),
      });
    }
  }

  return {
    extensions,
    skills,
    diagnostics,
  };
}
export interface MutateExtensionOptions {
  action: "toggle" | "add" | "remove";
  type: "extension" | "skill";
  nameOrPath: string;
  scope: "global" | "project";
  cwd?: string;
  enabled?: boolean;
  agentDir?: string;
}

export function getSettingsPath(
  scope: "global" | "project",
  cwd?: string,
  agentDir?: string
): string {
  if (scope === "global") {
    return join(agentDir ?? getAgentDir(), "settings.json");
  }
  if (!cwd) {
    throw new Error("cwd is required for project scope settings");
  }
  return join(cwd, ".pi", "settings.json");
}

export function readSettingsFile(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    return {};
  }
  try {
    const raw = readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeSettingsFile(settingsPath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf8");
}

export async function mutateExtensionOrSkill(
  options: MutateExtensionOptions
): Promise<{ success: boolean }> {
  const { action, type, nameOrPath, scope, cwd, enabled, agentDir } = options;

  if (!nameOrPath || typeof nameOrPath !== "string") {
    throw new Error("nameOrPath is required");
  }

  if (type === "skill") {
    if (action === "toggle") {
      const config = await getExtensionsConfig(cwd, { agentDir });
      const found = config.skills.find(
        (s) => s.name === nameOrPath || s.filePath === nameOrPath || resolve(s.filePath) === resolve(nameOrPath)
      );

      const filePath = found ? found.filePath : nameOrPath;
      const resolvedTarget = resolve(filePath);

      if (!existsSync(resolvedTarget)) {
        throw new Error(`Skill file not found: ${nameOrPath}`);
      }

      const effectiveCwd = cwd ?? process.cwd();
      const effectiveAgentDir = agentDir ?? getAgentDir();

      const projectSkillsDir = resolve(effectiveCwd, ".pi", "skills");
      const agentSkillsDir = resolve(effectiveAgentDir, "skills");

      const isSubpath = (parent: string, child: string) => {
        const p = resolve(parent);
        const c = resolve(child);
        const rel = relative(p, c);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      };

      const isDiscovered = config.skills.some(
        (s) => resolve(s.filePath).toLowerCase() === resolvedTarget.toLowerCase()
      );

      const isValidLocation =
        isDiscovered ||
        isSubpath(projectSkillsDir, resolvedTarget) ||
        isSubpath(agentSkillsDir, resolvedTarget);

      if (!isValidLocation) {
        throw new Error(`Skill target outside allowed skill directories: ${nameOrPath}`);
      }

      const content = readFileSync(resolvedTarget, "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
      const key = "disable-model-invocation";
      const disableModel = enabled === false;
      const alreadySet = Boolean(frontmatter[key]);

      let updated = content;
      if (disableModel && !alreadySet) {
        updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
        if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
      } else if (!disableModel && alreadySet) {
        updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
      }

      writeFileSync(resolvedTarget, updated, "utf8");
      return { success: true };
    }

    const settingsPath = getSettingsPath(scope, cwd, agentDir);
    const settings = readSettingsFile(settingsPath);
    const skillsList = Array.isArray(settings.skills)
      ? [...(settings.skills as string[])]
      : [];

    if (action === "add") {
      if (!skillsList.includes(nameOrPath)) {
        skillsList.push(nameOrPath);
      }
    } else if (action === "remove") {
      const idx = skillsList.indexOf(nameOrPath);
      if (idx !== -1) {
        skillsList.splice(idx, 1);
      }
    } else {
      throw new Error(`Invalid action: ${action}`);
    }

    settings.skills = skillsList;
    writeSettingsFile(settingsPath, settings);
    return { success: true };
  }

  if (type === "extension") {
    const settingsPath = getSettingsPath(scope, cwd, agentDir);
    const settings = readSettingsFile(settingsPath);

    if (action === "add") {
      const extsList = Array.isArray(settings.extensions)
        ? [...(settings.extensions as string[])]
        : [];
      if (!extsList.includes(nameOrPath)) {
        extsList.push(nameOrPath);
      }
      settings.extensions = extsList;
    } else if (action === "remove") {
      const extsList = Array.isArray(settings.extensions)
        ? [...(settings.extensions as string[])]
        : [];
      const filtered = extsList.filter(
        (e) => e !== nameOrPath && getExtensionIdAndName(e).id !== nameOrPath
      );
      settings.extensions = filtered;
    } else if (action === "toggle") {
      const disabledList = Array.isArray(settings.disabledExtensions)
        ? [...(settings.disabledExtensions as string[])]
        : [];
      if (enabled === false) {
        if (!disabledList.includes(nameOrPath)) {
          disabledList.push(nameOrPath);
        }
      } else {
        const idx = disabledList.indexOf(nameOrPath);
        if (idx !== -1) {
          disabledList.splice(idx, 1);
        }
      }
      settings.disabledExtensions = disabledList;
    } else {
      throw new Error(`Invalid action: ${action}`);
    }

    writeSettingsFile(settingsPath, settings);
    return { success: true };
  }

  throw new Error(`Invalid type: ${type}`);
}
