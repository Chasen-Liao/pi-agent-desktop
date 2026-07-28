import { createPiRuntime, isOAuthProvider, logoutProvider } from "@/lib/pi-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { runtime } = await createPiRuntime();
  if (!isOAuthProvider(runtime, provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await logoutProvider(runtime, provider);
  return Response.json({ ok: true });
}
