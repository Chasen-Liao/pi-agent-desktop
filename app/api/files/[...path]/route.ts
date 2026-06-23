import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
import { getAllowedRoots, isPathAllowed, isWindowsAbsolutePath, normalizeSlashes } from "@/lib/allowed-roots";
import { validateWritablePath } from "@/lib/path-policy";

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

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git",
]);

const IGNORED_SUFFIXES = [".pyc"];

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
const TEXT_WRITE_MAX_BYTES = 512 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

function getExt(filePath: string): string {
  const ext = path.basename(filePath).toLowerCase().split(".").pop() ?? "";
  return ext;
}

function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  // Special full-name matches
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

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

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  end = Math.min(end, stat.size - 1);
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
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: { "x-request-id": requestId } });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(realPath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }

    if (stat.isSymbolicLink()) {
      return NextResponse.json({ error: "Symlinks are not accessible" }, { status: 403, headers: { "x-request-id": requestId } });
    }

    if (type === "read") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400, headers: { "x-request-id": requestId } });
      }
      const imageMime = getImageMime(realPath);
      if (imageMime) {
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
          return NextResponse.json({ error: "Image too large (>10MB)" }, { status: 413, headers: { "x-request-id": requestId } });
        }
        return streamFile(realPath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(realPath);
      if (audioMime) {
        return streamFile(realPath, stat, audioMime, request.headers.get("range"));
      }
      if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "File too large for preview (>256KB)" }, { status: 413, headers: { "x-request-id": requestId } });
      }
      const content = await fs.promises.readFile(realPath, "utf-8");
      const language = getLanguage(realPath);
      return NextResponse.json({ content, language, size: stat.size });
    }

    if (type === "watch") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400, headers: { "x-request-id": requestId } });
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
      return NextResponse.json({ error: "Not a directory" }, { status: 400, headers: { "x-request-id": requestId } });
    }

    const names = await fs.promises.readdir(realPath);
    const entryPromises = names
      .filter((name) => !IGNORED_NAMES.has(name) && !IGNORED_SUFFIXES.some((s) => name.endsWith(s)))
      .map(async (name) => {
        const full = path.join(realPath, name);
        try {
          const s = await fs.promises.stat(full);
          return {
            name,
            isDir: s.isDirectory(),
            size: s.isFile() ? s.size : 0,
            modified: s.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      });
    const entries = (await Promise.all(entryPromises))
      .filter(Boolean)
      .sort((a, b) => {
        // Dirs first, then files, both alphabetically
        if (a!.isDir !== b!.isDir) return a!.isDir ? -1 : 1;
        return a!.name.localeCompare(b!.name);
      });

    return NextResponse.json({ entries, path: realPath });
  } catch (error) {
    logApiError({ route: "/api/files/[...path]", method: "GET", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
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
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: { "x-request-id": requestId } });
    }

    // Reject writes to version-control metadata, node_modules internals, and
    // .env files even when the path is inside an allowed root. Prevents a
    // compromised agent from planting a postinstall hook or overwriting
    // .git/config to establish persistence. (GET intentionally not restricted.)
    const writeError = validateWritablePath(realPath);
    if (writeError) {
      return NextResponse.json({ error: writeError }, { status: 403, headers: { "x-request-id": requestId } });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(realPath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }

    if (stat.isSymbolicLink()) {
      return NextResponse.json({ error: "Symlink targets are not writable" }, { status: 403, headers: { "x-request-id": requestId } });
    }

    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400, headers: { "x-request-id": requestId } });
    }

    const body = await request.json() as { content?: string };
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content required" }, { status: 400, headers: { "x-request-id": requestId } });
    }

    const contentBytes = Buffer.byteLength(body.content, "utf-8");
    if (contentBytes > TEXT_WRITE_MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (>${TEXT_WRITE_MAX_BYTES / 1024}KB)` },
        { status: 413, headers: { "x-request-id": requestId } }
      );
    }

    await fs.promises.writeFile(realPath, body.content, "utf-8");
    const newStat = await fs.promises.lstat(realPath);

    return NextResponse.json({ success: true, size: newStat.size });
  } catch (error) {
    logApiError({ route: "/api/files/[...path]", method: "PUT", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
