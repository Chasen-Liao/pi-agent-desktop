import { NextResponse } from "next/server";
import { stat, writeFile, rename, unlink, readdir, readFile } from "fs/promises";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  invalidateSessionPathCache,
  buildSessionContext,
  listAllSessions,
  getSessionEntriesAsync,
  buildTree,
  getLeafId,
  getSessionName,
  readFirstLineAsync,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { rewriteChildHeader } from "@/lib/session-cascade";
import { withFileLock } from "@/lib/session-lock";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }

    const entries = await getSessionEntriesAsync(filePath);
    const tree = buildTree(entries);
    const leafId = getLeafId(entries);
    const context = buildSessionContext(entries, leafId);

    const header = entries.length > 0 && (entries[0] as unknown as { type: string }).type === "session" ? entries[0] as unknown as { id: string; cwd?: string; timestamp: string } : null;
    let modified = header?.timestamp ?? new Date().toISOString();
    try {
      const fileStat = await stat(filePath);
      modified = fileStat.mtime.toISOString();
    } catch { /* use header timestamp */ }
    const allSessions = await listAllSessions();
    const parentSessionId = allSessions.find((s) => s.id === id)?.parentSessionId;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: getSessionName(entries),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
    } : null;

    const url = new URL(req.url);
    let agentState: { running: boolean; state?: unknown } | undefined;
    if (url.searchParams.has("includeState")) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        // peekState() is read-only and does NOT reset the idle timer —
        // polling this endpoint must not keep idle sessions alive forever.
        const state = rpc.peekState();
        agentState = { running: true, state };
      } else {
        agentState = { running: false };
      }
    }

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      tree,
      leafId,
      context,
      ...(agentState !== undefined ? { agentState } : {}),
    });
  } catch (error) {
    logApiError({ route: "/api/sessions/[id]", method: "GET", requestId, error, params: { id } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400, headers: { "x-request-id": requestId } });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    logApiError({ route: "/api/sessions/[id]", method: "PATCH", requestId, error, params: { id } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(_req);
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }

    // 1. Read parent's first line to get grandparent path
    let parentSessionPath: string | null = null;
    try {
      const firstLine = await readFirstLineAsync(filePath);
      if (firstLine) {
        const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
        if (header.type === "session") parentSessionPath = header.parentSession ?? null;
      }
    } catch { /* malformed parent — grandparent remains null */ }

    // 2. Enumerate siblings
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    const siblingFiles: string[] = [];
    try {
      const files = await readdir(dir);
      siblingFiles.push(
        ...files
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(dir, f))
          .filter((p) => p !== filePath)
      );
    } catch { /* dir unreadable — no cascade possible */ }

    // 3. Identify and rewrite children (under per-file lock, atomic write)
    for (const childPath of siblingFiles) {
      let content: string;
      try { content = await readFile(childPath, "utf8"); }
      catch { continue; /* race: child deleted between readdir and read */ }

      const { newContent, changed } = rewriteChildHeader(content, filePath, parentSessionPath);
      if (!changed) continue;

      await withFileLock(childPath, () => atomicWriteFile(childPath, newContent));
    }

    // 4. Destroy any active RPC wrapper for this session
    getRpcSession(id)?.destroy();

    // 5. Unlink parent (under lock, swallow race-condition unlink failure)
    await withFileLock(filePath, async () => {
      try { await unlink(filePath); } catch { /* race: already deleted */ }
    });
    invalidateSessionPathCache(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logApiError({ route: "/api/sessions/[id]", method: "DELETE", requestId, error, params: { id } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

async function atomicWriteFile(p: string, content: string): Promise<void> {
  const tmp = `${p}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, p);
  } catch (e) {
    try { await unlink(tmp); } catch { /* best effort */ }
    throw e;
  }
}
