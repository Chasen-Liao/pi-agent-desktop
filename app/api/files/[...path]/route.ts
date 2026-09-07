import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import { getAllowedRoots, isPathAllowed, isWindowsAbsolutePath, normalizeSlashes } from "@/lib/allowed-roots";
import { validateWritablePath } from "@/lib/path-policy";
import {
  DEFAULT_DIR_LIST_LIMIT,
  filterDirEntryNames,
  finalizeDirListEntries,
  getAudioMime,
  getImageMime,
  getLanguage,
  parseByteRange,
  type DirListEntry,
} from "@/lib/file-browser";

/**
 * Resolves a path to its canonical form via realpath(3), then re-validates
 * against allowedRoots. This closes a symlink-bypass vector: string-based
 * isPathAllowed cannot detect a symlink inside an allowed root pointing
 * to a forbidden target, but realpath follows the final symlink target.
 * fs.promises.stat/writeFile also follow symlinks, so the original check
 * was vulnerable to symlink redirection in all three handlers (GET/PUT/watch).
 */
async function resolveAuthorizedPath(
  filePath: string,
  allowedRoots: Set<string>,
): Promise<string> {
  const realPath = await fs.promises.realpath(filePath);
  if (!isPathAllowed(realPath, allowedRoots)) {
    throw new Error("Access denied");
  }
  return realPath;
}

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
const TEXT_WRITE_MAX_BYTES = 512 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

function filePathFromSegments(segments: string[]): string {
  const joined = segments.join("/");
  const slashJoined = normalizeSlashes(joined);
  if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
  return "/" + joined.replace(/^\/+/, "");
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const fileStream = fs.createReadStream(filePath, range);
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk: Uint8Array | string) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
        } catch {
          closed = true;
          fileStream.destroy();
        }
      });
      fileStream.once("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may cancel media probes before the file stream ends.
        }
      });
      fileStream.once("error", (error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(error);
        } catch {
          // The response was already abandoned by the client.
        }
      });
    },
    cancel() {
      closed = true;
      fileStream.destroy();
    },
  });
}

function streamFile(filePath: string, stat: fs.Stats, contentType: string, rangeHeader: string | null): Response {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
  };

  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: {
        ...headers,
        "Content-Length": String(stat.size),
      },
    });
  }

  const parsed = parseByteRange(rangeHeader, stat.size);
  if (!parsed.ok) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  const { start, end } = parsed;
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const requestId = getRequestId(request);
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    const type = request.nextUrl.searchParams.get("type") ?? "list";

    const allowedRoots = await getAllowedRoots();
    let realPath: string;
    try {
      realPath = await resolveAuthorizedPath(filePath, allowedRoots);
    } catch {
      return jsonError(request, 403, "Access denied");
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(realPath);
    } catch {
      return jsonError(request, 404, "Not found");
    }

    if (stat.isSymbolicLink()) {
      return jsonError(request, 403, "Symlinks are not accessible");
    }

    if (type === "read") {
      if (!stat.isFile()) {
        return jsonError(request, 400, "Not a file");
      }
      const imageMime = getImageMime(realPath);
      if (imageMime) {
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
          return jsonError(request, 413, "Image too large (>10MB)");
        }
        return streamFile(realPath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(realPath);
      if (audioMime) {
        return streamFile(realPath, stat, audioMime, request.headers.get("range"));
      }
      if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
        return jsonError(request, 413, "File too large for preview (>256KB)");
      }
      const content = await fs.promises.readFile(realPath, "utf-8");
      const language = getLanguage(realPath);
      return NextResponse.json({ content, language, size: stat.size });
    }

    if (type === "watch") {
      if (!stat.isFile()) {
        return jsonError(request, 400, "Not a file");
      }
      let watcher: fs.FSWatcher | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const send = (eventName: string, data: Record<string, unknown>) => {
            const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            try {
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              // client disconnected
            }
          };
          // Send initial ping so client knows connection is live
          send("connected", { filePath: realPath });
          try {
            watcher = fs.watch(realPath, () => {
              fs.promises.stat(realPath)
                .then((s) => {
                  send("change", { mtime: s.mtime.toISOString(), size: s.size });
                })
                .catch(() => {
                  send("change", { mtime: new Date().toISOString(), size: 0 });
                });
            });
            watcher.on("error", () => {
              try { controller.close(); } catch { /* ignore */ }
            });
          } catch {
            send("error", { message: "Failed to watch file" });
            controller.close();
          }
        },
        cancel() {
          try { watcher?.close(); } catch { /* ignore */ }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // type === "list"
    if (!stat.isDirectory()) {
      return jsonError(request, 400, "Not a directory");
    }

    const names = await fs.promises.readdir(realPath);
    const { names: limitedNames, truncated: nameTruncated } = filterDirEntryNames(
      names,
      DEFAULT_DIR_LIST_LIMIT
    );
    const entryPromises = limitedNames.map(async (name) => {
      const full = path.join(realPath, name);
      try {
        const s = await fs.promises.stat(full);
        return {
          name,
          isDir: s.isDirectory(),
          size: s.isFile() ? s.size : 0,
          modified: s.mtime.toISOString(),
        } satisfies DirListEntry;
      } catch {
        return null;
      }
    });
    const raw = (await Promise.all(entryPromises)).filter(
      (e): e is DirListEntry => e !== null
    );
    const { entries, truncated: finalizeTruncated } = finalizeDirListEntries(
      raw,
      DEFAULT_DIR_LIST_LIMIT
    );
    const truncated = nameTruncated || finalizeTruncated;

    return NextResponse.json({ entries, path: realPath, truncated });
  } catch (error) {
    logApiError({ route: "/api/files/[...path]", method: "GET", requestId, error });
    return jsonError(request, 500, errorMessage(error));
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const requestId = getRequestId(request);
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);

    const allowedRoots = await getAllowedRoots();

    // Resolve symlinks before any operation — symlinks pointing outside
    // allowed roots bypass string-based isPathAllowed checks.
    let realPath: string;
    try {
      realPath = await resolveAuthorizedPath(filePath, allowedRoots);
    } catch {
      return jsonError(request, 403, "Access denied");
    }

    // Reject writes to version-control metadata, node_modules internals, and
    // .env files even when the path is inside an allowed root. Prevents a
    // compromised agent from planting a postinstall hook or overwriting
    // .git/config to establish persistence. (GET intentionally not restricted.)
    const writeError = validateWritablePath(realPath);
    if (writeError) {
      return jsonError(request, 403, writeError);
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(realPath);
    } catch {
      return jsonError(request, 404, "Not found");
    }

    if (stat.isSymbolicLink()) {
      return jsonError(request, 403, "Symlink targets are not writable");
    }

    if (!stat.isFile()) {
      return jsonError(request, 400, "Not a file");
    }

    const body = await request.json() as { content?: string };
    if (typeof body.content !== "string") {
      return jsonError(request, 400, "content required");
    }

    const contentBytes = Buffer.byteLength(body.content, "utf-8");
    if (contentBytes > TEXT_WRITE_MAX_BYTES) {
      return jsonError(request, 413, `File too large (>${TEXT_WRITE_MAX_BYTES / 1024}KB)`);
    }

    await fs.promises.writeFile(realPath, body.content, "utf-8");
    const newStat = await fs.promises.lstat(realPath);

    return NextResponse.json({ success: true, size: newStat.size });
  } catch (error) {
    logApiError({ route: "/api/files/[...path]", method: "PUT", requestId, error });
    return jsonError(request, 500, errorMessage(error));
  }
}
