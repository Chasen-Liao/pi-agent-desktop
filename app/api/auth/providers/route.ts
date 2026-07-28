import { createPiRuntime, listOAuthProviders } from "@/lib/pi-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const { runtime } = await createPiRuntime();
  const providers = listOAuthProviders(runtime);

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = providers
    .filter((p) => !EXCLUDED.has(p.id))
    .map((p) => {
      const status = runtime.getProviderAuthStatus(p.id);
      return {
        id: p.id,
        name: DISPLAY_NAMES[p.id] ?? p.name,
        usesCallbackServer: p.usesCallbackServer,
        loggedIn: status.configured,
      };
    });

  return Response.json({ providers: result });
}
