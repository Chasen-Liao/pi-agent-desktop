import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  buildContextMenuTemplate,
  decideWindowCloseAction,
  isCloseAction,
  readCloseActionFromDisk,
  resolveAgentDir,
  resolveCopyLinkLabel,
} from "./window-options.ts";

test("isCloseAction accepts only tray and quit", () => {
  assert.equal(isCloseAction("tray"), true);
  assert.equal(isCloseAction("quit"), true);
  assert.equal(isCloseAction("minimize"), false);
  assert.equal(isCloseAction(null), false);
});

test("resolveAgentDir normalizes quotes, file URLs, and tilde prefixes", () => {
  const fakeHome = join(tmpdir(), "pi-fake-home");

  assert.equal(
    resolveAgentDir(undefined, fakeHome, {}),
    join(fakeHome, ".pi", "agent"),
  );
  assert.equal(
    resolveAgentDir('  "~/custom-agent"  ', fakeHome, {}),
    join(fakeHome, "custom-agent"),
  );
  assert.equal(
    resolveAgentDir("'~'", fakeHome, {}),
    fakeHome,
  );
  assert.equal(
    resolveAgentDir(undefined, fakeHome, { PI_CODING_AGENT_DIR: "~/env-agent" }),
    join(fakeHome, "env-agent"),
  );
  assert.equal(
    resolveAgentDir(undefined, fakeHome, { PI_CODING_AGENT_DIR: "~\\win-agent" }),
    join(fakeHome, "win-agent"),
  );

  const fileTarget = join(fakeHome, "url-agent");
  const fileUrl = pathToFileURL(fileTarget).href;
  assert.equal(
    resolveAgentDir(undefined, fakeHome, { PI_CODING_AGENT_DIR: `"${fileUrl}"` }),
    fileTarget,
  );
});

test("readCloseActionFromDisk defaults to tray and reads persisted closeAction", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-window-options-"));
  const prevEnv = process.env.PI_CODING_AGENT_DIR;
  try {
    assert.equal(readCloseActionFromDisk(dir), "tray");

    writeFileSync(join(dir, "desktop-settings.json"), JSON.stringify({ closeAction: "quit" }));
    assert.equal(readCloseActionFromDisk(dir), "quit");

    process.env.PI_CODING_AGENT_DIR = `"${pathToFileURL(dir).href}"`;
    assert.equal(readCloseActionFromDisk(), "quit");

    writeFileSync(join(dir, "desktop-settings.json"), JSON.stringify({ closeAction: "invalid" }));
    assert.equal(readCloseActionFromDisk(dir), "tray");

    writeFileSync(join(dir, "desktop-settings.json"), "{broken json");
    assert.equal(readCloseActionFromDisk(dir), "tray");
  } finally {
    if (prevEnv === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = prevEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decideWindowCloseAction respects isQuitting and closeAction", () => {
  assert.equal(
    decideWindowCloseAction({ isQuitting: true, closeAction: "tray" }),
    "allow-close",
  );
  assert.equal(
    decideWindowCloseAction({ isQuitting: true, closeAction: "quit" }),
    "allow-close",
  );
  assert.equal(
    decideWindowCloseAction({ isQuitting: false, closeAction: "tray" }),
    "hide-to-tray",
  );
  assert.equal(
    decideWindowCloseAction({ isQuitting: false, closeAction: "quit" }),
    "quit-app",
  );
});

test("buildContextMenuTemplate builds Cut/Copy/Paste/SelectAll items with editFlags", () => {
  const copied: string[] = [];
  const items = buildContextMenuTemplate(
    {
      isEditable: false,
      selectionText: "hello",
      editFlags: {
        canCut: false,
        canCopy: true,
        canPaste: false,
        canSelectAll: true,
      },
    },
    { locale: "en-US", onCopyLink: (url) => copied.push(url) },
  );

  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => ({ role: item.role, enabled: item.enabled })),
    [
      { role: "cut", enabled: false },
      { role: "copy", enabled: true },
      { role: "paste", enabled: false },
      { role: "selectAll", enabled: true },
    ],
  );
  assert.equal(copied.length, 0);
});

test("buildContextMenuTemplate appends localized Copy Link Address when linkURL is present", () => {
  const copied: string[] = [];
  const items = buildContextMenuTemplate(
    {
      linkURL: "https://example.com/docs",
      editFlags: {
        canCut: false,
        canCopy: false,
        canPaste: false,
        canSelectAll: true,
      },
    },
    { locale: "zh-CN", onCopyLink: (url) => copied.push(url) },
  );

  assert.equal(items.length, 6);
  assert.equal(items[4].type, "separator");
  assert.equal(items[5].id, "copy-link-address");
  assert.equal(items[5].label, "复制链接地址");
  assert.equal(resolveCopyLinkLabel("en-US"), "Copy Link Address");

  items[5].click?.({} as never, undefined, {} as never);
  assert.deepEqual(copied, ["https://example.com/docs"]);
});
