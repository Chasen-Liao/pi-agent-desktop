import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8");

// P2: the setMessages updater must stay pure. React StrictMode double-invokes
// updaters during render, and a nested setCanExecutePlan inside the updater is
// both a side effect in a pure function and a nested setState during render.
test("streaming append uses a pure setMessages updater (no nested setState)", () => {
  assert.match(source, /setMessages\(\(prev\) => \[\.\.\.prev,/);
  // No block-bodied messages updater may remain in the file:
  assert.doesNotMatch(source, /setMessages\(\(prev\) => \{/);
});

test("plan-mode setCanExecutePlan runs outside the messages updater", () => {
  // The plan check sits in its own block after the pure setMessages call.
  const planBlock = source.slice(source.indexOf('setEntryIds('));
  assert.match(planBlock, /if \(agentModeRef\.current === "plan"\) \{/);
  assert.match(planBlock, /if \(text\.trim\(\)\) setCanExecutePlan\(true\);/);
});

// P2: streaming appends update messages AND entryIds so the two arrays stay
// parallel (MessageList keys/fork/navigate rely on entryIds[idx] being the
// session entry id; new slots are undefined until the next reload fills them).
test("streaming append keeps entryIds parallel with messages", () => {
  assert.match(source, /setEntryIds\(\(prev\) => \[\.\.\.prev,/);
});

test("canonical prompt events replace pending bubbles and reserve one entry id", () => {
  const block = source.slice(
    source.indexOf("if (reconciledPromptId"),
    source.indexOf("if (result.agentRunning")
  );
  assert.match(block, /result\.appendMessages = undefined;/);
  assert.match(block, /reconcileOrAppendPendingUserMessage\(prev, canonical, clientMessageId\)/);
  assert.match(block, /setEntryIds\(\(prev\) => \[\.\.\.prev, undefined/);
});

test("transcript reload invalidates optimistic delivery refs before replacing messages", () => {
  const block = source.slice(
    source.indexOf("const loadSession = useCallback"),
    source.indexOf("const promptTrust")
  );
  const loadIdx = block.indexOf("loadSessionFromApi");
  assert.ok(loadIdx >= 0, "expected transcript load");
  const promptsIdx = block.indexOf("pendingPromptsRef.current = []");
  const steersIdx = block.indexOf("pendingSteersRef.current = []");
  assert.ok(promptsIdx >= 0 && promptsIdx < loadIdx);
  assert.ok(steersIdx >= 0 && steersIdx < loadIdx);
});
