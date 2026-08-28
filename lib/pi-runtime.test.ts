import test from "node:test";
import assert from "node:assert/strict";
import { setProviderApiKey, removeProviderApiKey } from "./pi-runtime.ts";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Regression test for issue #21: API keys must be persisted via the SDK
// login flow (auth.json). runtime.setRuntimeApiKey only writes an in-memory
// override that is lost when the per-request runtime instance is discarded,
// so providers configured from the UI never showed up as configured.
test("setProviderApiKey persists via runtime.login(api_key), not the in-memory override", async () => {
  const calls: unknown[][] = [];
  const runtime = {
    login: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ type: "api_key", key: "k" });
    },
    setRuntimeApiKey: () => {
      throw new Error("setRuntimeApiKey must not be used (memory-only)");
    },
  } as unknown as ModelRuntime;

  await setProviderApiKey(runtime, "deepseek", "  sk-test-123  ");

  assert.equal(calls.length, 1);
  const [providerId, type, interaction] = calls[0] as [string, string, { prompt: (p: { type: string }) => Promise<string>; notify: () => void }];
  assert.equal(providerId, "deepseek");
  assert.equal(type, "api_key");
  assert.equal(await interaction.prompt({ type: "secret" }), "sk-test-123");
  assert.equal(typeof interaction.notify, "function");
});

test("setProviderApiKey rejects select-prompt flows that cannot be answered headlessly", async () => {
  const runtime = {
    login: (_p: string, _t: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) =>
      interaction.prompt({ type: "select" }).then(() => ({ type: "api_key" })),
  } as unknown as ModelRuntime;

  await assert.rejects(() => setProviderApiKey(runtime, "weird-provider", "sk-test"), /interactive login/);
});

test("removeProviderApiKey deletes the stored credential via runtime.logout", async () => {
  const calls: unknown[][] = [];
  const runtime = {
    logout: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    },
    removeRuntimeApiKey: () => {
      throw new Error("removeRuntimeApiKey must not be used (memory-only)");
    },
  } as unknown as ModelRuntime;

  await removeProviderApiKey(runtime, "deepseek");
  assert.deepEqual(calls, [["deepseek"]]);
});
