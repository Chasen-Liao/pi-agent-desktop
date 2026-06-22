import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
import { validateProviderName } from "@/lib/auth-policy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(req: Request, { params }: Params) {
  const { provider } = await params;
  const requestId = getRequestId(req);
  const providerError = validateProviderName(provider);
  if (providerError) {
    return NextResponse.json({ error: providerError }, { status: 400, headers: { "x-request-id": requestId } });
  }
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const status = registry.getProviderAuthStatus(provider);
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
    return NextResponse.json({ error: providerError }, { status: 400, headers: { "x-request-id": requestId } });
  }
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400, headers: { "x-request-id": requestId } });
    }
    const authStorage = AuthStorage.create();
    authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError({ route: "/api/auth/api-key/[provider]", method: "POST", requestId, error, params: { provider } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  const { provider } = await params;
  const requestId = getRequestId(req);
  const providerError = validateProviderName(provider);
  if (providerError) {
    return NextResponse.json({ error: providerError }, { status: 400, headers: { "x-request-id": requestId } });
  }
  try {
    const authStorage = AuthStorage.create();
    authStorage.remove(provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError({ route: "/api/auth/api-key/[provider]", method: "DELETE", requestId, error, params: { provider } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
