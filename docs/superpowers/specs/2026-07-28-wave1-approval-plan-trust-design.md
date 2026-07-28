# Wave 1: Approval / Plan / Trust / Extension UI Bridge — Design Spec

> **Status**: Approved for implementation planning  
> **Date**: 2026-07-28  
> **Scope**: Wave 1 only (Codex-alignment foundation)

## 1. Goal

Make Pi Agent Desktop trustworthy enough for daily agentic coding by adding:

1. **Agent modes**: Plan / Ask / Full (approval + workflow)
2. **Extension UI bridge**: so pi extensions can `confirm` / `select` / `input` / `editor` / `notify` via the web UI
3. **Project Trust dialog**: load project `.pi/*` resources only after explicit trust
4. **Plan → Execute**: read-only planning, then one-click execute under Ask

This is the highest-leverage Codex parity set. No OS sandbox, no MCP, no worktrees in this wave.

## 2. Product Decisions (locked)

| Decision | Choice |
|---|---|
| Ask intercept granularity | **Every** `bash` / `write` / `edit` requires confirm; `read` / `grep` / `find` / `ls` auto-allow |
| Persistence | **Global default** + **session override** (session override is in-memory for Wave 1) |
| Plan → Execute | Switch to **Ask**, restore prior tool preset, **auto-prompt** to execute the plan |
| Architecture | In-process `AgentSession` + custom `ExtensionUIContext` + inline approval extension (not RPC subprocess) |

## 3. Concepts

### 3.1 AgentMode vs Tool Preset

These are orthogonal:

| Dimension | Values | Meaning |
|---|---|---|
| **Tool preset** (existing) | `none` / `default` / `full` | Which tools exist |
| **AgentMode** (new) | `plan` / `ask` / `full` | Safety / workflow gate |

Effective tools:

| AgentMode | Effective tools |
|---|---|
| `plan` | Forced read-only: `["read", "grep", "find", "ls"]` (ignore preset; if preset is `none`, still only those four when mode is plan — Plan always enables the four read tools) |
| `ask` | Active tool names from current tool preset |
| `full` | Active tool names from current tool preset |

Ask policy (when AgentMode is `ask`):

- Tools in `ASK_CONFIRM_TOOLS = ["bash", "write", "edit"]` → `ctx.ui.confirm` before execution
- Other tools → pass through
- User cancels / denies → `{ block: true, reason: "Blocked by user (Ask mode)" }`

Full policy:

- No confirm intercept

Plan policy:

- No write tools available → ask intercept does not fire

### 3.2 Global defaults storage

New file: `~/.pi/agent/desktop-settings.json`

```json
{
  "defaultAgentMode": "ask",
  "defaultToolPreset": "default"
}
```

- Do **not** overload pi's `settings.json` for desktop-only UX.
- API: `GET/PUT /api/desktop-settings`
- New sessions and cold start load defaults; session can override mode/preset until remount.

### 3.3 Session override lifetime (Wave 1)

- Stored on `AgentSessionWrapper` and React state only
- Session remount / app restart → fall back to global defaults
- **Out of scope**: persisting mode into `.jsonl` custom entries

## 4. Architecture

### 4.1 High-level flow

```text
Browser
  │  POST commands / UI responses
  │  SSE events (agent + extension_ui_request + notify)
  ▼
Next.js API  ──►  AgentSessionWrapper
                      │
                      ├─ ExtensionUIContext (bridge)
                      │     pending Map<id, Deferred>
                      │     emit SSE ──► Modal ──► extension_ui_response ──► resolve
                      │
                      ├─ bindExtensions({ uiContext, mode: "rpc" })
                      │
                      ├─ inline extension: desktop-approval
                      │     tool_call → confirm if Ask
                      │
                      └─ createAgentSession(...) + setActiveToolsByName
```

### 4.2 Extension UI bridge

**File**: `lib/extension-ui-bridge.ts`

Implements `ExtensionUIContext` (dialog subset + minimal fire-and-forget):

| Method | Behavior |
|---|---|
| `confirm(title, message, opts?)` | SSE request; resolve boolean; timeout → `false` |
| `select(title, options, opts?)` | SSE request; resolve string \| undefined; timeout → `undefined` |
| `input(title, placeholder?, opts?)` | SSE request; resolve string \| undefined; timeout → `undefined` |
| `editor(title, prefill?, opts?)` | Same path as multi-line input; resolve string \| undefined |
| `notify(message, type?)` | SSE fire-and-forget (toast) |
| `setStatus` / `setWidget` / `setTitle` / working indicators / TUI-only | no-op stubs |

Request event (SSE):

```ts
{
  type: "extension_ui_request";
  id: string; // uuid
  method: "confirm" | "select" | "input" | "editor";
  title: string;
  message?: string;       // confirm
  options?: string[];     // select
  placeholder?: string;   // input
  prefill?: string;       // editor
  timeout?: number;       // ms, optional
}
```

Notify event:

```ts
{
  type: "extension_ui_notify";
  message: string;
  notifyType: "info" | "warning" | "error";
}
```

Response command (`POST /api/agent/[id]`):

```ts
{
  type: "extension_ui_response";
  id: string;
  confirmed?: boolean;  // confirm
  value?: string;       // select | input | editor
  cancelled?: boolean;
}
```

Rules:

- Matching `id` required
- Unknown / already-resolved id → 404/400 with clear error
- Wrapper `destroy()` rejects all pending as cancelled
- Only one modal visible at a time on the client; server may queue multiple pending (FIFO display on client)

### 4.3 Wiring in `startRpcSession`

After `createAgentSession(...)`:

1. Construct `ExtensionUiBridge` bound to this wrapper's event listeners
2. `await inner.bindExtensions({ uiContext: bridge, mode: "rpc" })`
3. If `toolNames` provided, still apply `setActiveToolsByName` as today
4. Apply initial AgentMode (from desktop defaults or caller option) → tools + approval policy

**Inline approval extension** via `DefaultResourceLoader({ extensionFactories: [desktopApprovalFactory] })` **or** factories passed when constructing the loader. Prefer a dedicated factory function in `lib/approval-policy.ts` so tests don't need the full loader.

Policy reference is mutable on the wrapper:

```ts
wrapper.agentMode: "plan" | "ask" | "full"
wrapper.toolPreset: "none" | "default" | "full"
wrapper.toolPresetBeforePlan?: ... // for restore on execute
```

Approval factory reads `getAgentMode()` from a shared ref set by the wrapper.

### 4.4 Project Trust

Trust must run **before** project resources are loaded. Pi's `DefaultResourceLoader` + `SettingsManager` honor trust store; desktop currently starts sessions without UI for `ask`.

**Desktop flow** (HTTP handshake, not agent SSE — session may not exist yet):

1. Client intends to create/open a session for `cwd`
2. Server checks `needsProjectTrust(cwd)`:
   - no trust-requiring resources → proceed
   - trust store has decision → proceed with that trust
   - default is always/never → proceed accordingly
   - default is ask and no decision → **do not** create session; return:

```ts
// HTTP 409
{
  needsTrust: true,
  cwd: string,
  options: Array<{ id: string; label: string }>
}
```

3. Client shows `ProjectTrustDialog`
4. `POST /api/trust` body `{ cwd, optionId }` writes trust store (reuse pi trust manager APIs when exported; otherwise thin wrapper over `~/.pi/agent/trust.json` compatible with pi)
5. Client retries session create/open

**Endpoints**:

- Trust check can be embedded in `POST /api/agent/new` and any path that calls `startRpcSession` for a new cwd
- `POST /api/trust` — persist decision
- Optional `GET /api/trust?cwd=` — debug/status (nice-to-have; not required if 409 payload is enough)

Labels/options: use pi's `getProjectTrustOptions` when available so wording matches CLI (`Trust this folder`, parent, session-only, deny).

### 4.5 Plan mode UX

**AgentModeSelector** in chat input toolbar: `Plan | Ask | Full`

When user selects **Plan**:

1. Remember `toolPresetBeforePlan` if not already in plan
2. `setActiveToolsByName(PLAN_TOOLS)`
3. Set mode `plan`
4. Clear any pending "execute plan" eligibility until next successful plan turn

When agent finishes a turn while mode is `plan` and last assistant message has non-empty text:

- Set `canExecutePlan = true` (client-side)

**ExecutePlanBar** ("执行此计划"):

1. `set_agent_mode` → `ask`
2. Restore `toolPresetBeforePlan` via `set_tools`
3. Auto `prompt` with fixed message:

```
请按你刚才的计划开始执行。需要写入文件或运行命令前会请求我确认。
```

4. Clear `canExecutePlan`

**Eligibility rule (Wave 1)**: at least one completed `agent_end` in Plan mode with non-empty last assistant text. No markdown parsing.

### 4.6 Frontend components

| Component | Role |
|---|---|
| `components/AgentModeSelector.tsx` | Plan / Ask / Full control |
| `components/ExtensionUiDialog.tsx` | Modal for confirm/select/input/editor |
| `components/ProjectTrustDialog.tsx` | Trust options on 409 |
| `components/ExecutePlanBar.tsx` | Execute plan CTA |
| Notify toast | Minimal; can reuse existing patterns or a tiny toast state in AppShell/ChatWindow |

Hook changes:

- `agent-event-apply.ts`: handle `extension_ui_request`, `extension_ui_notify`
- `useAgentSession` / `use-session-commands`: `setAgentMode`, trust retry, execute plan
- `ChatInput` / `ChatWindow`: wire selectors and dialogs

### 4.7 Agent commands

Extend whitelist in `lib/agent-commands.ts`:

```ts
"set_agent_mode",
"extension_ui_response",
```

`get_state` / peek snapshot adds:

```ts
{
  agentMode: "plan" | "ask" | "full",
  // optional: pendingUiRequestCount
}
```

`set_agent_mode` body: `{ type: "set_agent_mode", mode: "plan" | "ask" | "full" }`

### 4.8 New API routes

| Route | Methods | Purpose |
|---|---|---|
| `app/api/desktop-settings/route.ts` | GET, PUT | Read/write `desktop-settings.json` |
| `app/api/trust/route.ts` | POST | Persist project trust decision |

Modify existing session-start routes to return 409 `needsTrust` when appropriate instead of silently denying project resources.

## 5. Error handling

| Case | Behavior |
|---|---|
| UI response for unknown id | 400 `{ error: "Unknown or expired UI request" }` |
| Session destroyed with pending UI | Resolve cancelled; extension treats as deny/cancel |
| Trust denied | Session may still start with project resources skipped (pi semantics); UI should show a short notice that project skills/extensions were not loaded |
| Confirm timeout | Treat as deny (`false`) |
| Select/input/editor timeout | Treat as cancel (`undefined`) |
| User closes modal | Send `cancelled: true` |

## 6. Security notes

- Extension UI bridge does **not** sandbox the agent; it is a human gate.
- Trust dialog only gates **loading** project resources; it does not restrict model tool power after trust.
- Ask mode is the primary runtime gate for writes/shell.
- File API `allowed-roots` unchanged.
- Origin checks on agent POST remain; new routes follow same auth-policy patterns as siblings.

## 7. Testing plan (TDD)

| Area | Tests |
|---|---|
| `lib/extension-ui-bridge.test.ts` | confirm resolve true/false; cancel; timeout; select value; destroy cancels pending |
| `lib/approval-policy.test.ts` | plan tools list; ask needs confirm for bash/write/edit only; full never; block payload shape |
| `lib/project-trust-desktop.test.ts` | no resources → no prompt; remembered trust; needs options payload shape |
| `lib/desktop-settings.test.ts` | default merge; PUT validation |
| `lib/agent-commands` | new types accepted |
| `hooks/agent-session/agent-event-apply.test.ts` | extension_ui_request / notify side effects |

Prefer pure unit tests with node:test (project standard). Avoid Electron e2e in Wave 1.

## 8. Out of scope (explicit)

- OS-level sandbox / network policy UI
- Danger-command regex allowlist
- MCP
- Worktree / multi-agent parallel
- Extensions management page
- Persisting AgentMode into session jsonl
- HTML export, clone, full slash-command parity (later waves)
- Changing default pi CLI trust file format incompatibly

## 9. Implementation order (for plan skill)

1. Pure libs: desktop-settings, approval-policy, extension-ui-bridge, project-trust-desktop (+ tests)
2. rpc-manager + agent-commands wiring (+ state fields)
3. API routes: desktop-settings, trust; session create 409
4. SSE + event-apply + frontend dialogs
5. AgentModeSelector + ExecutePlanBar + ChatInput integration
6. Manual smoke checklist + typecheck/tests

## 10. Success criteria

- [ ] New session defaults to **Ask**; write/bash/edit prompts a modal; deny blocks the tool
- [ ] **Full** runs write/bash/edit without modal
- [ ] **Plan** cannot write/run (tools limited); after a plan reply, **执行此计划** switches to Ask and auto-prompts
- [ ] Untrusted project with `.pi/skills` (or other trust-requiring resources) shows Trust dialog before resources load
- [ ] A minimal extension using `ctx.ui.confirm` works through the web UI
- [ ] Unit tests for bridge, policy, trust, settings pass; `npx tsc --noEmit` clean for touched code

## 11. Spec self-review

- No TBD placeholders remaining for Wave 1 behavior
- AgentMode vs tool preset interaction specified
- Trust uses HTTP 409 handshake (avoids pre-SSE UI deadlock)
- Session mode persistence deferred explicitly
- Scope limited to four Wave 1 pillars
