import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-session-commands.ts", import.meta.url), "utf8");

test("handleSend reuses an assigned session id even while the render is still new", () => {
  const block = source.slice(
    source.indexOf("const handleSend"),
    source.indexOf("const handleAgentModeChange")
  );
  assert.match(block, /resolveSessionCommandTarget\(\{\s*sessionId: sessionIdRef\.current,/);
  assert.match(block, /sendAgentCommand\(commandTarget\.sessionId,/);
});

test("handleSend acquires a synchronous dispatch gate before starting a request", () => {
  const block = source.slice(
    source.indexOf("const handleSend"),
    source.indexOf("const handleAgentModeChange")
  );
  const gateIdx = block.indexOf("tryStartPromptDispatch(promptDispatchStateRef.current)");
  const requestIdx = block.indexOf('ensureTrustThenFetch(');
  assert.ok(gateIdx >= 0, "expected prompt dispatch gate");
  assert.ok(requestIdx > gateIdx, "gate must be acquired before the new-session request");
  assert.match(block, /finishPromptDispatch\(promptDispatchStateRef\.current\)/);
});

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

test("handleAgentModeChange updates an assigned session despite stale new-session state", () => {
  const block = source.slice(
    source.indexOf("const handleAgentModeChange"),
    source.indexOf("const handleExecutePlan")
  );
  assert.match(block, /const sid = sessionIdRef\.current;\s*if \(!sid\) return;/);
  assert.doesNotMatch(block, /if \([^)]*isNew/);
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

test("handleAbort separates abort failure from transcript reload failure", () => {
  // Regression: if the abort POST succeeds but the transcript reload GET
  // throws (network blip), the reload failure must NOT be treated as an abort
  // failure — restoring agentRunning after a successful abort would leave the
  // UI stuck running forever (agent_end will never arrive).
  const block = source.slice(
    source.indexOf("const handleAbort"),
    source.indexOf("const handleFork")
  );

  const abortIdx = block.indexOf('await sendAgentCommand(sid, { type: "abort" })');
  const loadIdx = block.indexOf("await loadSession(sid)");
  const restoreIdx = block.indexOf("setAgentRunning(true)");

  assert.ok(abortIdx >= 0, "abort POST expected");
  assert.ok(loadIdx >= 0, "transcript reload expected");
  assert.ok(restoreIdx >= 0, "running restore expected");

  // The restore (in the abort catch) must appear BEFORE the reload, so the
  // reload is never wrapped by the abort failure path…
  assert.ok(restoreIdx < loadIdx, "abort-catch restore must precede the reload");
  // …and nothing after the reload may restore agentRunning.
  assert.ok(
    !block.slice(loadIdx).includes("setAgentRunning(true)"),
    "a reload throw must never restore agentRunning"
  );
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

// A slash command that is listed in the menu but has no case in the dispatch
// switch falls through and is sent to the model as a plain user message.
// /statusline was exactly that bug: it reached the LLM instead of the
// status line. Pin every registered command to a handler.
test("every builtin slash command has a dispatch handler", () => {
  const slashSource = readFileSync(
    new URL("../../lib/slash-commands.ts", import.meta.url),
    "utf8"
  );
  const registered = [...slashSource.matchAll(/id: "([^"]+)", label: "\/[^"]+"/g)].map(
    (m) => m[1]
  );
  const handled = [...source.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);

  assert.ok(registered.length >= 4, "expected the builtin slash commands to be listed");
  for (const id of registered) {
    assert.ok(
      handled.includes(id),
      `/${id} appears in the slash menu but has no case in the dispatch switch, ` +
        `so it would be sent to the model as a plain message`
    );
  }
});

test("the /statusline command fetches the status line route and reports it upward", () => {
  const block = source.slice(
    source.indexOf('case "statusline"'),
    source.indexOf("if (handled) return;")
  );
  assert.ok(block.length > 0, "expected a /statusline branch");
  assert.match(block, /fetch\(`\/api\/statusline\?cwd=/);
  assert.match(block, /onStatusline\?\.\(d\)/);
  // Both exit paths must mark the command as handled: the empty-cwd path and
  // the fetch path. If either is missing, the command falls through and is
  // sent to the model as a plain user message.
  const handledCount = (block.match(/handled = true;/g) ?? []).length;
  assert.equal(
    handledCount,
    2,
    "both the empty-cwd path and the fetch path must set handled = true"
  );
});
