import { resolveSessionPath, getHeaderAsync } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", {
        status: 404,
        headers: { "x-request-id": requestId },
      });
    }
    const header = await getHeaderAsync(filePath);
    const cwd = header?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      logApiError({ route: "/api/agent/[id]/events", method: "GET", requestId, error, params: { id } });
      return new Response(`Failed to start agent: ${errorMessage(error)}`, {
        status: 500,
        headers: { "x-request-id": requestId },
      });
    }
  }

  // Shared cleanup state — lifted out of ReadableStream so both `start`
  // (via abort signal) and `cancel` (via consumer-side cancellation) can
  // invoke the SAME idempotent cleanup. Without this, a silently-dropped
  // client (proxy timeout, network blip) that never fires `abort` would
  // leave the heartbeat interval running, the listener attached to the
  // wrapper, and the stream object pinned in memory forever.
  let controllerRef: ReadableStreamController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        /* already unsubscribed */
      }
    }
    if (controllerRef) {
      try {
        // On the `cancel` path the controller is already disposed by the
        // runtime; on the `abort` path it is still writable. try/catch
        // covers both cases.
        controllerRef.close();
      } catch {
        /* already closed */
      }
    }
    req.signal?.removeEventListener("abort", cleanup);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s).
      // keepAlive() is called only after a successful enqueue so that when the client
      // silently disappears, the idle timer eventually fires and destroys the wrapper.
      heartbeat = setInterval(() => {
        // desiredSize === null means the stream is closed/errored. Detect it
        // explicitly so we clean up even when the abort signal never fires
        // (e.g. reverse-proxy that drops the connection without sending FIN).
        if (controller.desiredSize === null) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
          session.keepAlive();
        } catch {
          // controller already closed; clean up so the idle timer can
          // eventually destroy the wrapper (no orphan).
          cleanup();
        }
      }, 30_000);

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
    cancel() {
      // Consumer cancelled the stream (reader.cancel(), page close, etc.).
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
