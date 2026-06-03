import test from "node:test";
import assert from "node:assert/strict";
import { pickApiKeys } from "./env-filter.ts";

test("pickApiKeys keeps allowlisted keys", () => {
  const env = {
    PATH: "/usr/bin",
    NODE_ENV: "production",
    ANTHROPIC_API_KEY: "anthropic",
    OPENAI_API_KEY: "openai",
    SECRET_TOKEN: "secret",
  };

  assert.deepEqual(pickApiKeys(env), {
    PATH: "/usr/bin",
    NODE_ENV: "production",
    ANTHROPIC_API_KEY: "anthropic",
    OPENAI_API_KEY: "openai",
  });
});

test("pickApiKeys keeps Windows Path key", () => {
  const env = {
    Path: "C:/Windows/System32",
    SECRET_TOKEN: "secret",
  };

  assert.deepEqual(pickApiKeys(env), {
    Path: "C:/Windows/System32",
  });
});

test("pickApiKeys keeps PI-prefixed keys", () => {
  const env = {
    PI_API_BASE_URL: "http://localhost:1234",
    PI_PROFILE: "dev",
    SECRET_TOKEN: "secret",
  };

  assert.deepEqual(pickApiKeys(env), {
    PI_API_BASE_URL: "http://localhost:1234",
    PI_PROFILE: "dev",
  });
});

test("pickApiKeys filters disallowed keys", () => {
  const env = {
    ELECTRON_RUN_AS_NODE: "1",
    npm_config_registry: "https://registry.npmjs.org/",
    VSCODE_GIT_IPC_HANDLE: "pipe",
    SECRET_TOKEN: "secret",
  };

  assert.deepEqual(pickApiKeys(env), {});
});

test("pickApiKeys returns empty object for empty env", () => {
  assert.deepEqual(pickApiKeys({}), {});
});
