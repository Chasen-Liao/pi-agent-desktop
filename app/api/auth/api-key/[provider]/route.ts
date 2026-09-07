import { NextResponse } from "next/server";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import { validateProviderName } from "@/lib/auth-policy";
import {
  createPiRuntime,
  removeProviderApiKey,
  setProviderApiKey,
} from "@/lib/pi-runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(req: Request, { params }: Params) {
  const { provider } = await params;
  const providerError = validateProviderName(provider);
  if (providerError) {
    return jsonError(req, 400, providerError);
  }
  const { runtime, registry } = await createPiRuntime();
  const status = runtime.getProviderAuthStatus(provider);
  const displayName = registry.getProviderDisplayName(provider);
  const models = registry.getAll().filter((m) => m.provider === provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  const requestId = getRequestId(req);
  const providerError = validateProviderName(provider);
  if (providerError) {
    return jsonError(req, 400, providerError);
  }
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return jsonError(req, 400, "apiKey is required");
    }
    const { runtime } = await createPiRuntime();
    await setProviderApiKey(runtime, provider, apiKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError({ route: "/api/auth/api-key/[provider]", method: "POST", requestId, error, params: { provider } });
    return jsonError(req, 500, errorMessage(error));
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  const { provider } = await params;
  const requestId = getRequestId(req);
  const providerError = validateProviderName(provider);
  if (providerError) {
    return jsonError(req, 400, providerError);
  }
  try {
    const { runtime } = await createPiRuntime();
    await removeProviderApiKey(runtime, provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError({ route: "/api/auth/api-key/[provider]", method: "DELETE", requestId, error, params: { provider } });
    return jsonError(req, 500, errorMessage(error));
  }
}
