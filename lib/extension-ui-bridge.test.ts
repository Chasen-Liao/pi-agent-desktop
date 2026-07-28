import test from "node:test";
import assert from "node:assert/strict";
import {
  ExtensionUiBridge,
  type ExtensionUiNotifyEvent,
  type ExtensionUiRequestEvent,
} from "./extension-ui-bridge.ts";

test("confirm resolves true/false from respond", async () => {
  const events: ExtensionUiRequestEvent[] = [];
  const bridge = new ExtensionUiBridge((e) => {
    if (e.type === "extension_ui_request") events.push(e);
  });
  const p = bridge.confirm("Allow?", "rm -rf /");
  assert.equal(events.length, 1);
  assert.equal(events[0].method, "confirm");
  const err = bridge.respond({ id: events[0].id, confirmed: true });
  assert.equal(err, null);
  assert.equal(await p, true);

  const p2 = bridge.confirm("Allow?", "again");
  const id2 = events[1].id;
  bridge.respond({ id: id2, confirmed: false });
  assert.equal(await p2, false);
});

test("cancel resolves false for confirm and undefined for select", async () => {
  const events: ExtensionUiRequestEvent[] = [];
  const bridge = new ExtensionUiBridge((e) => {
    if (e.type === "extension_ui_request") events.push(e);
  });
  const c = bridge.confirm("t", "m");
  bridge.respond({ id: events[0].id, cancelled: true });
  assert.equal(await c, false);

  const s = bridge.select("pick", ["a", "b"]);
  bridge.respond({ id: events[1].id, cancelled: true });
  assert.equal(await s, undefined);
});

test("select resolves value", async () => {
  const events: ExtensionUiRequestEvent[] = [];
  const bridge = new ExtensionUiBridge((e) => {
    if (e.type === "extension_ui_request") events.push(e);
  });
  const p = bridge.select("pick", ["Trust", "Deny"]);
  bridge.respond({ id: events[0].id, value: "Trust" });
  assert.equal(await p, "Trust");
});

test("unknown id returns error", () => {
  const bridge = new ExtensionUiBridge(() => {});
  assert.match(bridge.respond({ id: "nope", confirmed: true })!, /Unknown/);
});

test("timeout auto-resolves confirm to false", async () => {
  const events: ExtensionUiRequestEvent[] = [];
  const bridge = new ExtensionUiBridge((e) => {
    if (e.type === "extension_ui_request") events.push(e);
  });
  const p = bridge.confirm("t", "m", { timeout: 20 });
  assert.equal(await p, false);
  assert.equal(bridge.pendingCount, 0);
});

test("destroy cancels pending", async () => {
  const bridge = new ExtensionUiBridge(() => {});
  const p = bridge.input("name");
  assert.equal(bridge.pendingCount, 1);
  bridge.destroy();
  assert.equal(await p, undefined);
  assert.equal(bridge.pendingCount, 0);
});

test("notify emits fire-and-forget event", () => {
  const notes: ExtensionUiNotifyEvent[] = [];
  const bridge = new ExtensionUiBridge((e) => {
    if (e.type === "extension_ui_notify") notes.push(e);
  });
  bridge.notify("hello", "warning");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].message, "hello");
  assert.equal(notes[0].notifyType, "warning");
});
