import { NextResponse } from "next/server.js";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveSessionPath, getSessionEntriesAsync } from "../../../../../lib/session-reader.ts";
import { exportSessionToHtml, formatEntriesToMarkdown } from "../../../../../lib/session-export.ts";
import { errorMessage, getRequestId, jsonError, logApiError } from "../../../../../lib/api-error.ts";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
  try {
    const sessionFile = await resolveSessionPath(id);
    if (!sessionFile || !existsSync(sessionFile)) {
      return jsonError(req, 404, "Session not found");
    }

    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "html";
    const download =
      url.searchParams.get("download") === "true" || url.searchParams.get("download") === "1";
    const theme = url.searchParams.get("theme") || undefined;

    if (format !== "html" && format !== "markdown") {
      return jsonError(req, 400, "Invalid export format. Must be 'html' or 'markdown'.");
    }

    if (format === "html") {
      let resPath: string | undefined;
      let content: string;
      try {
        const tmpPath = join(tmpdir(), `export-${id}-${Date.now()}.html`);
        resPath = await exportSessionToHtml(sessionFile, {
          outputPath: tmpPath,
          themeName: theme,
        });
        content = await readFile(resPath, "utf-8");
      } finally {
        if (resPath) {
          await unlink(resPath).catch(() => {});
        }
      }
      const headers: Record<string, string> = {
        "Content-Type": "text/html; charset=utf-8",
        "x-request-id": requestId,
      };
      if (download) {
        headers["Content-Disposition"] = `attachment; filename="session-${id}.html"`;
      }

      return new NextResponse(content, { headers });
    } else {
      const entries = await getSessionEntriesAsync(sessionFile);
      const content = formatEntriesToMarkdown(entries);

      const headers: Record<string, string> = {
        "Content-Type": "text/markdown; charset=utf-8",
        "x-request-id": requestId,
      };
      if (download) {
        headers["Content-Disposition"] = `attachment; filename="session-${id}.md"`;
      }

      return new NextResponse(content, { headers });
    }
  } catch (error) {
    logApiError({ route: `/api/sessions/${id}/export`, method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
