import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildContextMenuTemplate,
  decideWindowCloseAction,
  isCloseAction,
  readCloseActionFromDisk,
  resolveCopyLinkLabel,
} from "./window-options.ts";

test("isCloseAction accepts only tray and quit", () => {
  assert.equal(isCloseAction("tray"), true);
  assert.equal(isCloseAction("quit"), true);
  assert.equal(isCloseAction("minimize"), false);
  assert.equal(isCloseAction(null), false);
});

test("readCloseActionFromDisk defaults to tray and reads persisted closeAction", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-window-options-"));
  try {
    assert.equal(readCloseActionFromDisk(dir), "tray");

    writeFileSync(join(dir, "desktop-settings.json"), JSON.stringify({ closeAction: "quit" }));
    assert.equal(readCloseActionFromDisk(dir), "quit");

    writeFileSync(join(dir, "desktop-settings.json"), JSON.stringify({ closeAction: "invalid" }));
    assert.equal(readCloseActionFromDisk(dir), "tray");

    writeFileSync(join(dir, "desktop-settings.json"), "{broken json");
    assert.equal(readCloseActionFromDisk(dir), "tray");
  } finally {
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
