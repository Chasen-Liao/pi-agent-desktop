import { validateProviderName } from "@/lib/auth-policy";
import {
  createPiRuntime,
  isOAuthProvider,
  loginProvider,
  type AuthInteraction,
} from "@/lib/pi-runtime";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const providerError = validateProviderName(provider);
  if (providerError) {
    return Response.json({ error: providerError }, { status: 400 });
  }
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const providerError = validateProviderName(provider);
  if (providerError) {
    return new Response(JSON.stringify({ error: providerError }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // AbortController propagates client disconnect into ModelRuntime.login()
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  // Ref so the ReadableStream cancel() can invoke the cleanup defined inside start().
  let cleanupRef: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const { runtime } = await createPiRuntime();
      if (!isOAuthProvider(runtime, provider)) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        controller.close();
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        const token = `${provider}-${Date.now()}-${crypto.randomUUID()}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch((err) => { console.error("Login pending request finalization failed:", err); });
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise.
      // Idempotent — safe to call from abort.signal, finally block, and stream cancel().
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };
      cleanupRef = cleanup;

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      const interaction: AuthInteraction = {
        signal: abort.signal,
        notify: (event: AuthEvent) => {
          if (event.type === "auth_url") {
            const request = getManualInputRequest();
            send(controller, {
              type: "auth",
              url: event.url,
              instructions: event.instructions ?? null,
              token: request.token,
            });
            return;
          }
          if (event.type === "device_code") {
            send(controller, {
              type: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              intervalSeconds: event.intervalSeconds ?? null,
              expiresInSeconds: event.expiresInSeconds ?? null,
            });
            return;
          }
          if (event.type === "progress") {
            send(controller, { type: "progress", message: event.message });
            return;
          }
          if (event.type === "info") {
            send(controller, { type: "progress", message: event.message });
          }
        },
        prompt: async (prompt: AuthPrompt) => {
          if (prompt.type === "select") {
            const request = createClientInputRequest();
            send(controller, {
              type: "select_request",
              message: prompt.message,
              options: prompt.options,
              token: request.token,
            });
            const value = await request.promise;
            return value || "";
          }
          // text / secret / manual_code
          const request = getManualInputRequest();
          send(controller, {
            type: "prompt_request",
            message: prompt.message,
            placeholder: "placeholder" in prompt ? (prompt.placeholder ?? null) : null,
            token: request.token,
          });
          return request.promise;
        },
      };

      try {
        await loginProvider(runtime, provider, "oauth", interaction);
        send(controller, { type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send(controller, { type: "error", message: msg });
        } else {
          send(controller, { type: "cancelled" });
        }
      } finally {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
      cleanupRef?.();
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
