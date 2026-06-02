import { NextResponse } from "next/server";
import { runNpx } from "@/lib/npx";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";

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
    if (!pkg?.trim()) return NextResponse.json({ error: "package required" }, { status: 400, headers: { "x-request-id": requestId } });

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
      return NextResponse.json({ error: output.slice(-300) || "Install failed" }, { status: 500, headers: { "x-request-id": requestId } });
    }
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
    logApiError({ route: "/api/skills/install", method: "POST", requestId, error: e, params: { package: pkg } });
    return NextResponse.json(
      { error: output || errorMessage(e) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
