import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, parse } from "path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import {
  applyTrustDecision,
  buildTrustOptions,
  evaluateProjectTrust,
} from "./project-trust-desktop.ts";
import { isTrustOptionId } from "./trust-types.ts";

test("buildTrustOptions includes trust/deny and session variants", () => {
  const opts = buildTrustOptions("D:\\proj");
  const ids = opts.map((o) => o.id);
  assert.ok(ids.includes("trust"));
  assert.ok(ids.includes("deny"));
  assert.ok(ids.includes("trust-session"));
  assert.ok(ids.includes("deny-session"));
});

test("no trust-requiring resources → proceed trusted", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-empty-"));
  try {
    const r = evaluateProjectTrust(dir, { agentDir: join(dir, "agent") });
    assert.equal(r.action, "proceed");
    if (r.action === "proceed") assert.equal(r.trusted, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project with .pi/skills and no decision → prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-skills-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const project = join(dir, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  try {
    const r = evaluateProjectTrust(project, { agentDir });
    assert.equal(r.action, "prompt");
    if (r.action === "prompt") {
      assert.equal(r.payload.needsTrust, true);
      assert.equal(r.payload.cwd, project);
      assert.ok(r.payload.options.length >= 2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persisted trust decision skips prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-saved-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const project = join(dir, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  try {
    applyTrustDecision(project, "trust", { agentDir });
    const r = evaluateProjectTrust(project, { agentDir });
    assert.equal(r.action, "proceed");
    if (r.action === "proceed") assert.equal(r.trusted, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session-only trust uses map without disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-session-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const project = join(dir, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  const sessionOnly = new Map<string, boolean>();
  try {
    applyTrustDecision(project, "trust-session", { agentDir, sessionOnlyTrust: sessionOnly });
    assert.equal(sessionOnly.get(project), true);
    const r = evaluateProjectTrust(project, { agentDir, sessionOnlyTrust: sessionOnly });
    assert.equal(r.action, "proceed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isTrustOptionId", () => {
  assert.equal(isTrustOptionId("trust"), true);
  assert.equal(isTrustOptionId("nope"), false);
});

test("trust-parent trusts the parent folder and everything under it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-parent-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const parent = join(dir, "parent");
  const project = join(parent, "proj");
  // Both levels carry trust-requiring resources, so the gate result really
  // reflects the stored decision rather than "nothing to trust here".
  mkdirSync(join(parent, ".pi", "skills"), { recursive: true });
  writeFileSync(join(parent, ".pi", "skills", "p.md"), "# skill\n");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  try {
    const r = applyTrustDecision(project, "trust-parent", { agentDir });
    assert.deepEqual(r, { trusted: true, persisted: true });

    const parentGate = evaluateProjectTrust(parent, { agentDir });
    assert.equal(parentGate.action, "proceed");
    if (parentGate.action === "proceed") assert.equal(parentGate.trusted, true);

    // The parent's decision is inherited by the child — that is the point of
    // "trust parent" — and by every other project under the same parent.
    const childGate = evaluateProjectTrust(project, { agentDir });
    assert.equal(childGate.action, "proceed");
    if (childGate.action === "proceed") assert.equal(childGate.trusted, true);

    const sibling = join(parent, "sibling");
    mkdirSync(join(sibling, ".pi", "skills"), { recursive: true });
    writeFileSync(join(sibling, ".pi", "skills", "s.md"), "# skill\n");
    const siblingGate = evaluateProjectTrust(sibling, { agentDir });
    assert.equal(siblingGate.action, "proceed");
    if (siblingGate.action === "proceed") assert.equal(siblingGate.trusted, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust-parent falls back to trusting the folder itself when there is no parent", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-noparent-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const root = parse(process.cwd()).root;
  try {
    const r = applyTrustDecision(root, "trust-parent", { agentDir });
    assert.deepEqual(r, { trusted: true, persisted: true });
    // The decision landed on the folder itself, not on a parent of it.
    const store = new ProjectTrustStore(agentDir);
    assert.equal(store.get(root), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deny persists a negative decision", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-deny-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const project = join(dir, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  try {
    const r = applyTrustDecision(project, "deny", { agentDir });
    assert.deepEqual(r, { trusted: false, persisted: true });

    const gate = evaluateProjectTrust(project, { agentDir });
    assert.equal(gate.action, "proceed");
    if (gate.action === "proceed") assert.equal(gate.trusted, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deny-session keeps a negative decision in memory only", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-denysession-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const project = join(dir, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  const sessionOnly = new Map<string, boolean>();
  try {
    const r = applyTrustDecision(project, "deny-session", { agentDir, sessionOnlyTrust: sessionOnly });
    assert.deepEqual(r, { trusted: false, persisted: false });
    assert.equal(sessionOnly.get(project), false);

    // Nothing was written to disk, so a fresh evaluation still asks.
    const gate = evaluateProjectTrust(project, { agentDir });
    assert.equal(gate.action, "prompt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown trust option is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-trust-unknown-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  try {
    assert.throws(
      () => applyTrustDecision(join(dir, "proj"), "bogus" as never, { agentDir }),
      /Unknown trust option/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
