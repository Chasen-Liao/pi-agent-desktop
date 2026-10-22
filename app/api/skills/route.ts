import { NextResponse } from "next/server.js";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { errorMessage, getRequestId, jsonError, logApiError } from "../../../lib/api-error.ts";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
//
// Toggling a skill is NOT done here: it goes through POST /api/extensions, which
// validates that the target is a discovered skill inside an allowed skill
// directory. The former PATCH /api/skills here wrote whatever path the client
// sent, with no allowlist at all.
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return jsonError(req, 400, "cwd required");

  try {
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    return NextResponse.json({ skills, diagnostics });
  } catch (error) {
    logApiError({ route: "/api/skills", method: "GET", requestId, error, params: { cwd } });
    return jsonError(req, 500, errorMessage(error));
  }
}
