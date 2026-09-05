import { NextResponse } from "next/server";
import { runNpx } from "@/lib/npx";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import { validateSkillsPackage } from "@/lib/skills-policy";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

// POST /api/skills/install  body: { package: string; scope: "global" | "project"; cwd?: string }
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  let pkg: string | undefined;
  let scope: string | undefined;
  let cwd: string | undefined;
  try {
    ({ package: pkg, scope, cwd } = await req.json() as { package?: string; scope?: string; cwd?: string });
    if (!pkg?.trim()) return jsonError(req, 400, "package required");

    // Reject anything that isn't a valid skills.sh package identifier (owner/repo[@skill]).
    // Prevents shell metacharacter / path traversal / arbitrary-npm-package RCE surface
    // even though runNpx uses execFile (defense in depth).
    const pkgError = validateSkillsPackage(pkg);
    if (pkgError) {
      return jsonError(req, 400, pkgError);
    }

    const isGlobal = scope !== "project";
    const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi"];
    if (isGlobal) args.push("-g");

    console.log(`[skills/install] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: 60000,
      cwd: !isGlobal && cwd ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const output = (stdout + stderr).replace(ANSI_RE, "");
    const success = /Installation complete|Installed \d+ skill/.test(output);
    if (!success) {
      return jsonError(req, 500, output.slice(-300) || "Install failed");
    }
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
    logApiError({ route: "/api/skills/install", method: "POST", requestId, error: e, params: { package: pkg } });
    return jsonError(req, 500, output || errorMessage(e));
  }
}
