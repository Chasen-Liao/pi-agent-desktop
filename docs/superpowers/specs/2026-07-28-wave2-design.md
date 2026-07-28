# Wave 2: MCP / Session Branching & Export / Extensions Management — Design Spec

> **Status**: Approved for implementation planning  
> **Date**: 2026-07-28  
> **Scope**: Wave 2 (MCP, Session Branching & Export, Extensions Management)

---

## 1. Goal & Core Pillars

Wave 2 expands **Pi Agent Desktop** from a Codex-aligned execution baseline (Wave 1: Plan/Ask/Full modes, Trust, Extension UI Bridge) into a fully extensible, branching-aware personal AI workspace.

### Core Pillars

1. **MCP (Model Context Protocol) Server Discovery, Status, and Config UI**
   - Discover installed and configured MCP servers across global (`~/.pi/agent/mcp.json`) and project (`<cwd>/.pi/mcp.json`) configurations.
   - Live status monitoring (connected, error, disabled, tool counts).
   - Config UI to add, edit, toggle, remove, and test MCP servers without manual JSON editing.

2. **Session Branching, Cloning, and Session Metadata Persistence**
   - **Branching**: Ability to split context from any point/message entry in the session tree into a new session branch or set active leaf.
   - **Cloning & Forking**: One-click duplication of current session state within the same project or fork to a target directory.
   - **AgentMode Persistence**: Store `AgentMode` (`plan`, `ask`, `full`) inside `.jsonl` custom entries (`type: "custom"`, `customType: "desktop_agent_mode"`). Reloading a session restores its historical mode.

3. **Session Export (HTML / Markdown)**
   - Export any active session or archived `.jsonl` file into clean, standalone **HTML** (with syntax highlighting and formatted tool calls) or **Markdown**.
   - One-click trigger from Chat toolbar and SessionSidebar context menu with download payload.

4. **Extensions & MCP Management UI**
   - Unified Management UI (`ExtensionsConfigModal.tsx`) for extensions, skills, and MCP servers.
   - View loaded extensions, error diagnostics, active skill paths, toggle states, and add new extensions/skills.

---

## 2. Product Decisions (Locked)

| Dimension | Decision / Policy |
|---|---|
| **MCP Storage Format** | standard `mcp.json` at `~/.pi/agent/mcp.json` (global) and `<cwd>/.pi/mcp.json` (project) |
| **AgentMode Persistence** | Append custom entry `desktop_agent_mode` to session `.jsonl` on mode change; parse last mode entry on load |
| **Branching Behavior** | Extract session branch path from root to `targetEntryId`, create a new `.jsonl` session file with `parentSession` reference |
| **Export Formats** | **HTML** via `@earendil-works/pi-coding-agent`'s `exportSessionToHtml` / `exportFromFile`, **Markdown** via pure custom renderer |
| **UI Integration** | Modals for MCP/Extensions and Export; Branching integrated into `BranchNavigator` and message context menu |

---

## 3. Architecture & Concepts

### 3.1 MCP Server Architecture & Config Schema

MCP servers run as stdio sub-processes or remote SSE endpoints managed by the agent runtime. Desktop reads and updates configuration files:

#### Configuration File Path & Schema (`mcp.json`)
- Global: `~/.pi/agent/mcp.json`
- Project: `<cwd>/.pi/mcp.json`

```ts
export type McpTransportType = "stdio" | "sse";

export interface McpServerConfig {
  id: string; // unique key in mcpServers dictionary
  name?: string;
  transport?: McpTransportType; // default "stdio"
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // for SSE transport
  disabled?: boolean;
}

export interface McpConfigFile {
  mcpServers: Record<string, Omit<McpServerConfig, "id">>;
}

export interface McpServerStatus extends McpServerConfig {
  scope: "global" | "project";
  status: "connected" | "disconnected" | "error" | "disabled";
  toolsCount?: number;
  errorMessage?: string;
}
```

### 3.2 AgentMode `.jsonl` Metadata Persistence

To ensure AgentMode selection survives session reload and app restart:

1. When `set_agent_mode` command is received by `AgentSessionWrapper`, it calls `this.inner.sessionManager.appendCustomEntry("desktop_agent_mode", { mode })`.
2. When loading a session via `SessionManager` or parsing `.jsonl` entries in `session-reader.ts`, `findLastAgentMode(entries)` scans entries from end to start for `customType === "desktop_agent_mode"`.
3. If found, `startRpcSession` initializes `AgentSessionWrapper` with that mode instead of the global default.

```json
{"id":"e1a2b3","parentId":"c4d5e6","timestamp":1785200000000,"type":"custom","customType":"desktop_agent_mode","data":{"mode":"plan"}}
```

### 3.3 Session Branching & Cloning Data Flow

```text
User selects message entry node (targetEntryId)
  │
  ├─► Branch Action: POST /api/sessions/[id]/branch { targetEntryId, name? }
  │     └─ SessionManager.createBranchedSession(targetEntryId)
  │     └─ Writes new session .jsonl with header.parentSession = sourceSessionId
  │     └─ Returns { newSessionId, newSessionFile }
  │
  └─► Clone Action: POST /api/sessions/[id]/clone { targetCwd? }
        └─ SessionManager.forkFrom(sourceFile, targetCwd)
        └─ Returns { newSessionId, newSessionFile }
```

### 3.4 Export Engine Data Flow

```text
GET /api/sessions/[id]/export?format=html|markdown
  │
  ├─► format=html:
  │     └─ exportFromFile(sessionFile) or exportSessionToHtml(sessionManager)
  │     └─ Returns Content-Type: text/html with header filename attachment
  │
  └─► format=markdown:
        └─ parseSessionEntries(sessionFile)
        └─ formatEntriesToMarkdown(entries)
        └─ Returns Content-Type: text/markdown with header filename attachment
```

---

## 4. API Endpoints Specification

### 4.1 MCP Management API

#### `GET /api/mcp`
- Purpose: Retrieve merged list of MCP servers (global + project) with status.
- Query params: `cwd?: string`
- Response:
  ```json
  {
    "servers": [
      {
        "id": "github",
        "scope": "global",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "disabled": false,
        "status": "connected",
        "toolsCount": 12
      }
    ]
  }
  ```

#### `POST /api/mcp`
- Purpose: Add or update an MCP server configuration.
- Body:
  ```ts
  {
    scope: "global" | "project";
    cwd?: string;
    server: McpServerConfig;
  }
  ```
- Response: `{ success: true, server: McpServerStatus }`

#### `DELETE /api/mcp`
- Purpose: Remove an MCP server configuration.
- Body: `{ id: string, scope: "global" | "project", cwd?: string }`
- Response: `{ success: true }`

#### `POST /api/mcp/toggle`
- Purpose: Enable or disable an MCP server.
- Body: `{ id: string, scope: "global" | "project", disabled: boolean, cwd?: string }`
- Response: `{ success: true }`

#### `POST /api/mcp/test`
- Purpose: Test connection to an MCP server config.
- Body: `{ command?: string, args?: string[], env?: Record<string, string>, url?: string }`
- Response: `{ success: boolean, message?: string, toolsCount?: number }`

---

### 4.2 Session Branching & Cloning API

#### `POST /api/sessions/[id]/branch`
- Purpose: Create a new branched session starting at a specific entry node.
- Body: `{ targetEntryId: string, name?: string }`
- Response:
  ```json
  {
    "success": true,
    "sessionId": "s-new-branch-id",
    "sessionFile": "/path/to/session.jsonl"
  }
  ```

#### `POST /api/sessions/[id]/clone`
- Purpose: Fork / clone session to current or target cwd.
- Body: `{ targetCwd?: string, name?: string }`
- Response:
  ```json
  {
    "success": true,
    "sessionId": "s-cloned-id",
    "sessionFile": "/path/to/session.jsonl"
  }
  ```

---

### 4.3 Session Export API

#### `GET /api/sessions/[id]/export`
- Purpose: Export session as downloadable HTML or Markdown.
- Query params: `format=html|markdown`, `theme?: string`, `download?: boolean`
- Response:
  - Header: `Content-Type: text/html; charset=utf-8` or `text/markdown; charset=utf-8`
  - Header: `Content-Disposition: attachment; filename="session-<id>.<ext>"` (when `download=true`)
  - Body: raw file content.

---

### 4.4 Extensions Management API

#### `GET /api/extensions`
- Purpose: List all installed and configured extensions, skills, and diagnostics.
- Query params: `cwd?: string`
- Response:
  ```json
  {
    "extensions": [
      {
        "id": "my-extension",
        "name": "My Custom Extension",
        "source": "package",
        "scope": "global",
        "enabled": true
      }
    ],
    "skills": [
      {
        "name": "find-skills",
        "description": "Find skills",
        "scope": "project"
      }
    ],
    "diagnostics": []
  }
  ```

#### `POST /api/extensions`
- Purpose: Add, enable, or disable an extension/skill.
- Body: `{ action: "toggle" | "add" | "remove", type: "extension" | "skill", nameOrPath: string, scope: "global" | "project", cwd?: string, enabled?: boolean }`
- Response: `{ success: true }`

---

## 5. UI Component Hierarchy

```text
AppShell
  ├── TopBar / Header
  │     ├── ModeSelector (Plan / Ask / Full)
  │     ├── ExtensionsButton ──► ExtensionsConfigModal
  │     │                            ├── Tab: MCP Servers (McpServerList, McpServerForm)
  │     │                            ├── Tab: Extensions
  │     │                            └── Tab: Skills
  │     └── ExportButton ────────► SessionExportModal
  │
  ├── SessionSidebar
  │     └── SessionTree
  │           └── ContextMenu ──► Branch, Clone, Export, Rename, Delete
  │
  └── ChatWindow
        ├── BranchNavigator (Enhanced with Branch & Clone buttons)
        └── MessageList
              └── MessageView
                    └── NodeBranchButton ──► Branch from this message
```

### Component Breakdown

| Component | Responsibility |
|---|---|
| `components/McpConfigModal.tsx` | Dialog for viewing, adding, editing, toggling, testing MCP servers |
| `components/SessionExportModal.tsx` | Dialog for selecting export format (HTML/MD), previewing, and downloading |
| `components/ExtensionsConfigModal.tsx` | Tabbed modal for managing extensions, skills, and MCP servers |
| `components/BranchCloneModal.tsx` | Confirmation dialog for branching from entry or forking session |

---

## 6. Testing Plan (TDD)

| Test Module | Coverage & Scenarios |
|---|---|
| `lib/mcp-config.test.ts` | Parsing `mcp.json`, merging global & project configs, validating server payloads, toggle disabled flag |
| `lib/session-export.test.ts` | Converting session entries to Markdown format (user, assistant, tool calls, tool results); HTML export invocation |
| `lib/agent-mode-persistence.test.ts` | Appending `desktop_agent_mode` entry; reading last mode from entries array; initializing wrapper with stored mode |
| `lib/session-branch-clone.test.ts` | `createBranchedSession` payload validation; `forkFrom` cross-cwd resolution |
| `lib/extensions-config.test.ts` | Merging global and project settings for extensions and skills |
| `app/api/mcp/route.test.ts` | API integration test for GET, POST, DELETE `/api/mcp` |

---

## 7. Out of Scope (Explicit)

- OS-level sandbox / process isolation for MCP servers (MCP stdio runs as sub-processes, handled by pi runtime).
- Full AST diff editor in browser.
- Git worktree management for multi-agent parallel executions (Wave 3).

---

## 8. Implementation Steps & Milestones

1. **Step 1: Pure Logic & Data Models**
   - Create `lib/mcp-config.ts`, `lib/session-export.ts`, `lib/session-branch-clone.ts`, `lib/agent-mode-persistence.ts`, `lib/extensions-config.ts` + corresponding `.test.ts` files.

2. **Step 2: Session Manager & RPC Manager Wiring**
   - Wire `desktop_agent_mode` custom entry into `AgentSessionWrapper.applyAgentMode` and session load path.

3. **Step 3: API Routes Implementation**
   - Add `/api/mcp`, `/api/mcp/toggle`, `/api/mcp/test`, `/api/sessions/[id]/branch`, `/api/sessions/[id]/clone`, `/api/sessions/[id]/export`, `/api/extensions`.

4. **Step 4: UI Components & Toolbar Integration**
   - Add `McpConfigModal`, `SessionExportModal`, `ExtensionsConfigModal`, `BranchCloneModal`, update `BranchNavigator`.

5. **Step 5: Verification & Quality Gate**
   - Run `npm test` and `npx tsc --noEmit` to ensure 100% green tests and zero type errors.
