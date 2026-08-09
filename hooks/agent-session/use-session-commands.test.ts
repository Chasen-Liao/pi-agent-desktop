import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-session-commands.ts", import.meta.url), "utf8");

// P2: handleAgentModeChange optimistically flips agentMode; a failed server
// call must roll the UI mode back so it never diverges from the server.
test("handleAgentModeChange rolls the optimistic mode back on failure", () => {
  const block = source.slice(
    source.indexOf("const handleAgentModeChange"),
    source.indexOf("const handleExecutePlan")
  );
  assert.match(block, /const prevMode = agentMode;/);
  const catchIdx = block.indexOf("} catch (e) {");
  assert.ok(catchIdx >= 0, "expected a catch handler");
  const rollbackIdx = block.indexOf("setAgentMode(prevMode)");
  assert.ok(rollbackIdx > catchIdx, "mode rollback must run inside the catch handler");
});

// P2: handleAbort optimistically stops the agent so agentRunning isn't stuck
// true when the agent_end SSE event is lost; a failed abort must restore the
// running state and reconnect the SSE stream.
test("handleAbort optimistically stops the agent and restores on failure", () => {
  const block = source.slice(
    source.indexOf("const handleAbort"),
    source.indexOf("const handleFork")
  );
  assert.match(block, /setAgentRunning\(false\);/);
  assert.match(block, /await sendAgentCommand\(sid, \{ type: "abort" \}\)/);
  assert.match(block, /await loadSession\(sid\);/);
  const catchIdx = block.indexOf("} catch (e) {");
  assert.ok(catchIdx >= 0, "expected a catch handler");
  const restoreIdx = block.indexOf("setAgentRunning(true)");
  assert.ok(restoreIdx > catchIdx, "agentRunning restore must run inside the catch handler");
  assert.match(block, /connectEvents\(sid\);/);
});

// P2: while a message is streaming the transcript may be longer than
// entryIds (SSE events carry no entry id until reload) — fork must never send
// an empty entryId to the server.
test("handleFork guards against an empty entryId", () => {
  const block = source.slice(
    source.indexOf("const handleFork"),
    source.indexOf("const navigateToLeaf")
  );
  assert.match(block, /if \(!sid \|\| !entryId\) return;/);
});
