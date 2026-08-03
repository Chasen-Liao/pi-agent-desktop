import { createHash } from "node:crypto";
import path from "node:path";

export function projectIdFromCwd(cwd: string): string {
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new Error("cwd is required for projectId");
  }
  const resolved = path.resolve(cwd.trim());
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const hex = createHash("sha256").update(key, "utf8").digest("hex");
  return `proj_${hex.slice(0, 16)}`;
}
