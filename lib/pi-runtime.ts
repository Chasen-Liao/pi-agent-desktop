/**
 * Thin server-side adapter over Pi 0.82 ModelRuntime.
 * Auth/model routes should use this module instead of the removed AuthStorage public API.
 */
import {
  ModelRegistry,
  ModelRuntime,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import { join } from "path";

export type { AuthInteraction, AuthType };

export interface CreatePiRuntimeOptions {
  /** Override models.json path (used by models-config test). */
  modelsPath?: string | null;
  /** Allow network catalog refresh during create. Default false for API routes. */
  allowModelNetwork?: boolean;
  authPath?: string;
}

/**
 * Create a fresh ModelRuntime + ModelRegistry pair.
 * Prefer a new instance per mutation-heavy request so auth.json writes are not stale.
 */
export async function createPiRuntime(options: CreatePiRuntimeOptions = {}): Promise<{
  runtime: ModelRuntime;
  registry: ModelRegistry;
}> {
  const agentDir = getAgentDir();
  const runtime = await ModelRuntime.create({
    authPath: options.authPath ?? join(agentDir, "auth.json"),
    modelsPath: options.modelsPath === undefined ? join(agentDir, "models.json") : options.modelsPath,
    allowModelNetwork: options.allowModelNetwork ?? false,
  });
  const registry = new ModelRegistry(runtime);
  await registry.refresh();
  return { runtime, registry };
}

/** Providers that expose OAuth login (for the OAuth panel). */
export function listOAuthProviders(runtime: ModelRuntime): Array<{
  id: string;
  name: string;
  usesCallbackServer: boolean;
}> {
  return runtime
    .getProviders()
    .filter((p) => p.auth.oauth != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      // Extension legacy flag; native OAuth providers no longer advertise it.
      usesCallbackServer: false,
    }));
}

export function isOAuthProvider(runtime: ModelRuntime, providerId: string): boolean {
  const provider = runtime.getProvider(providerId);
  return provider?.auth.oauth != null;
}

export async function loginProvider(
  runtime: ModelRuntime,
  providerId: string,
  type: AuthType,
  interaction: AuthInteraction
): Promise<void> {
  await runtime.login(providerId, type, interaction);
}

export async function logoutProvider(runtime: ModelRuntime, providerId: string): Promise<void> {
  await runtime.logout(providerId);
}

/**
 * Persistently store an API key for a provider via the SDK login flow
 * (writes auth.json). `runtime.setRuntimeApiKey` is intentionally NOT used:
 * it only writes an in-memory override that is lost when the per-request
 * runtime instance is discarded.
 */
export async function setProviderApiKey(
  runtime: ModelRuntime,
  providerId: string,
  apiKey: string
): Promise<void> {
  await runtime.login(providerId, "api_key", {
    notify: () => {},
    prompt: async (prompt) => {
      // Providers with interactive multi-step logins (e.g. select-prompt
      // flows) can't be answered headlessly with a single key.
      if (prompt.type === "select") {
        throw new Error(`Provider "${providerId}" requires an interactive login and cannot be configured with an API key here.`);
      }
      return apiKey.trim();
    },
  });
}

export async function removeProviderApiKey(
  runtime: ModelRuntime,
  providerId: string
): Promise<void> {
  // logout() deletes the stored credential from auth.json.
  await runtime.logout(providerId);
}
