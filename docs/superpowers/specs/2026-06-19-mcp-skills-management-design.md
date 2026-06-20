# MCP And Skills Management Design

## Goal

Add a left-navigation page named `MCP & Skills` that lets users manage local Skills and MCP server configuration from the desktop app.

The first implementation intentionally splits the maturity level:

- Skills are fully callable in real agent turns.
- MCP servers support JSON configuration, validation, test connection, and tool listing.
- MCP tools are not injected into `AgentLoop` yet.

This gives users an immediately useful Skills workflow while keeping MCP execution behind an explicit testing boundary until the permission and tool-call semantics are designed.

## User Experience

The primary navigation gains a new item:

- `Coding Agent`
- `Models`
- `MCP & Skills`
- `Settings`

The new page has two tabs:

- `Skills`
- `MCP Servers`

### Skills Tab

The Skills tab shows:

- Installed skill list.
- Skill name.
- Description.
- Enabled/disabled state.
- Invocation name, such as `/code-review`.
- Install date or updated date.
- Actions: upload zip, enable/disable, delete.

The upload flow:

1. User clicks `Upload skill`.
2. StoryForge opens a zip file picker.
3. The main process validates and extracts the zip.
4. The app finds exactly one skill root containing `SKILL.md`, or accepts a zip whose root itself contains `SKILL.md`.
5. The app parses the skill manifest and installs it into StoryForge's local app data.
6. The new skill appears in the list enabled by default.

Callable behavior:

- Users invoke a skill by starting a prompt with `/skill-name`.
- Arguments are the rest of the prompt after the skill name.
- Enabled skills are also listed in each model request so the model does not deny that installed skills exist.
- If a prompt explicitly mentions exactly one enabled skill by name or invocation, the app injects that skill for the turn.
- Disabled skills cannot be invoked.
- Unknown slash commands produce a clear user-facing error instead of silently sending a confusing prompt to the model.
- There is no broad intent-based automatic matching in v1; the non-slash path only reacts to explicit skill names.

Example prompt:

```text
/code-review focus on regressions in the current diff
```

Developer mode should make the skill injection visible in the model request drawer.

### MCP Servers Tab

The MCP tab shows:

- JSON editor for the full MCP configuration.
- Save and validate controls.
- Server list derived from `mcpServers`.
- Per-server test connection action.
- Per-server test status.
- Tool list returned by the server during the latest successful test.

Supported input shape follows the common `mcpServers` convention used by coding agents:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      }
    },
    "docs": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

The page can save valid configuration even if no server is currently connected. `Test connection` is explicit and runs on demand.

## Existing Context

StoryForge already has early package boundaries:

- `@story-forge/skills` parses a `SKILL.md` manifest.
- `@story-forge/mcp` exposes a disabled MCP client implementation.
- `AgentCoordinator` is the right place to assemble system messages before each `AgentLoop` run.
- Developer mode now shows exact model request messages, which is useful for verifying Skill injection.

The design builds on those boundaries instead of putting extension logic directly into renderer components.

## Skill Model

Add a durable installed skill record:

```ts
type SkillView = {
  id: string;
  name: string;
  description: string;
  invocationName: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
};
```

Internal stored records also include:

```ts
type InstalledSkillRecord = SkillView & {
  rootDir: string;
  entrypointPath: string;
  body: string;
  contentHash: string;
};
```

Rules:

- `id` is a stable sanitized directory name plus a short content hash when needed for uniqueness.
- `invocationName` is `/` plus the sanitized skill name.
- Skill names are limited to lowercase letters, numbers, and dashes after normalization.
- Uploading a skill with the same normalized name replaces the existing skill after successful validation.
- Only enabled skills are invocable.

The existing `SkillManifest` parser should be expanded but kept conservative. Required fields for StoryForge v1:

- `name`
- `description`
- markdown body

Optional frontmatter fields may be preserved for future display but are not executed in v1.

Ignored in v1:

- `allowed-tools`
- `disallowed-tools`
- `hooks`
- dynamic shell injection syntax
- model override fields
- subagent fields

Ignoring these fields is deliberate. Installing a skill should not silently grant tool permissions or execute code.

## Skill Storage

Store installed skills under app user data:

```text
<userData>/skills/
  skills.json
  <skill-id>/
    SKILL.md
    ...
```

`skills.json` is the index used for list views and enabled state. The skill folder keeps the original uploaded supporting files for future use, but v1 only reads `SKILL.md`.

Zip extraction safety:

- Reject path traversal entries.
- Reject absolute paths.
- Reject symlinks.
- Enforce maximum file count.
- Enforce maximum total uncompressed size.
- Require `SKILL.md`.
- Reject empty skill body.

## Skill Invocation Flow

`AgentCoordinator.start()` parses the user prompt before appending the user message.

Every request includes a concise enabled-skill registry system message. The registry contains each invocation, name, and short description. It does not include full skill bodies.

If the trimmed prompt starts with `/`:

1. Extract command name up to whitespace.
2. Look up an enabled installed skill by invocation name.
3. If no match exists, reject the turn with a clear error.
4. If a match exists, keep the original user message and attach an active skill to the turn execution.

If the prompt does not start with `/`, `AgentCoordinator` checks whether it explicitly mentions exactly one enabled skill name or invocation. When exactly one skill is mentioned, the coordinator attaches that active skill to the turn. Ambiguous or implicit intent does not auto-select a skill.

The model request gets additional system content before the user conversation history:

```text
Available StoryForge skills:
- /code-review (Code Review): Review code

Active StoryForge skill: code-review

Invocation: /code-review
Arguments: focus on regressions in the current diff

Follow this skill for the current turn. The skill instructions apply in addition to StoryForge's normal coding-agent rules. If the skill conflicts with higher-priority system instructions, follow the higher-priority instructions.
If this skill describes CLI commands or command-line workflows, use StoryForge's workspace.runCommand / workspace_runCommand tool to execute those commands. Do not claim the capability is unavailable only because there is no dedicated tool named after the skill.

<contents of SKILL.md body>
```

Ordering:

1. Base StoryForge system prompt.
2. Available skills registry system prompt, if any enabled skills exist.
3. Active skill system prompt, if any.
4. Existing persisted conversation converted to chat messages.
5. Current user prompt as persisted by the coordinator.

This ordering keeps the base agent constraints first while making the active skill clearly visible to the model.

Developer mode should show both system messages, making it easy to confirm whether a skill entered the request.

## MCP Configuration Model

Add a durable MCP configuration shape:

```ts
type McpConfigView = {
  schemaVersion: 1;
  rawJson: string;
  servers: McpServerView[];
};

type McpServerView = {
  name: string;
  transport: "stdio" | "http" | "sse" | "ws";
  enabled: boolean;
  status: "untested" | "success" | "failed";
  lastTestedAt?: string;
  lastError?: string;
  tools: McpToolView[];
};

type McpToolView = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
```

The persisted config is the user-authored JSON plus cached test results. The renderer should not need to parse transport details itself except for display.

Supported server entries in v1:

- stdio-style entries with `command`, optional `args`, `env`, `cwd`, and `timeout`.
- HTTP-style entries with `type: "http"` or `type: "streamable-http"` and `url`.
- SSE-style entries with `type: "sse"` and `url`.
- WebSocket entries may validate structurally but can return `unsupported in v1` during test if the MCP SDK path is not ready.

## MCP Storage

Store MCP data under app user data:

```text
<userData>/mcp.json
```

The saved file includes:

- user-authored `rawJson`
- normalized server summaries
- cached test results

Secrets:

- Users may place literal values in JSON, but the UI should recommend environment variable references such as `$GITHUB_TOKEN`.
- Test connection expands environment variables at runtime.
- The app should not echo env values in errors.

## MCP Test Connection Flow

`Test connection` is explicit and per server.

Flow:

1. Validate saved JSON.
2. Resolve the selected server entry.
3. Start or connect to the MCP server.
4. Call `listTools()`.
5. Cache returned tool descriptors and status.
6. Stop the temporary connection and child process.

Safety:

- Use a timeout.
- Kill stdio child processes after the test.
- Redact environment values from errors.
- Do not start MCP servers automatically at app startup.
- Do not expose MCP tools to `AgentLoop` in v1.

The main process owns MCP testing because it can spawn processes and access Node APIs. The renderer only invokes IPC and renders results.

## Main Process Services

Add two services:

```ts
class SkillService {
  list(): Promise<SkillView[]>;
  importZip(): Promise<SkillView>;
  setEnabled(skillId: string, enabled: boolean): Promise<SkillView>;
  remove(skillId: string): Promise<void>;
  resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined>;
}

class McpConfigService {
  get(): Promise<McpConfigView>;
  saveRawJson(rawJson: string): Promise<McpConfigView>;
  testServer(name: string): Promise<McpServerView>;
}
```

`AgentCoordinator` depends on `SkillService` through a narrow interface for invocation lookup. It does not depend on renderer state.

## IPC And Preload API

Extend `StoryForgeApi`:

```ts
skills: {
  list(): Promise<SkillView[]>;
  importZip(): Promise<SkillView>;
  setEnabled(input: { skillId: string; enabled: boolean }): Promise<SkillView>;
  remove(skillId: string): Promise<void>;
};

mcp: {
  get(): Promise<McpConfigView>;
  save(input: { rawJson: string }): Promise<McpConfigView>;
  testServer(name: string): Promise<McpServerView>;
};
```

The first version uses a main-process file picker for `importZip()`. This matches the existing workspace-open pattern and avoids passing large binary blobs over IPC.

## Renderer Design

Add `McpSkillsPage`.

Top-level layout:

- Page header: `MCP & Skills`.
- Tabs: `Skills`, `MCP Servers`.
- Shared error display pattern matching Settings and Models.

Skills tab:

- Upload button.
- List table or compact cards.
- Enable switch.
- Invocation name.
- Delete action.
- Empty state encouraging upload of a zip containing `SKILL.md`.

MCP tab:

- JSON textarea or editor-like textarea.
- Validate/save button.
- Server summary list generated from saved config.
- Test button per server.
- Tool list shown after successful test.
- Error panel for invalid JSON or failed test.

Keep the UI utilitarian and dense. This is a configuration surface, not a marketing page.

## Error Handling

Skills:

- Invalid zip: explain that the archive must contain `SKILL.md`.
- Invalid manifest: show the missing field.
- Duplicate skill name: replacement is allowed only after the new upload validates.
- Unknown slash invocation: reject the turn with `Skill not found: /name`.
- Disabled slash invocation: reject the turn with `Skill is disabled: /name`.

MCP:

- Invalid JSON: keep the editor contents and show parse error.
- Invalid shape: show the first schema error.
- Test timeout: mark server failed with timeout message.
- Spawn failure: mark server failed with command error.
- Tool listing failure: mark server failed with redacted error.

## Testing

Shared/API tests:

- New view types compile through `StoryForgeApi`.

Skills package tests:

- Parse required skill metadata.
- Normalize skill names.
- Reject missing frontmatter and empty body.

Main process tests:

- Skill zip import validates `SKILL.md`.
- Skill enable/disable persists.
- Skill delete removes index entry.
- Skill invocation lookup returns enabled skills only.
- Agent coordinator injects active skill system message on slash invocation.
- Unknown and disabled slash skill prompts fail clearly.
- MCP config save rejects invalid JSON and invalid shapes.
- MCP config save lists normalized servers.
- MCP test connection stores tools on success and errors on failure.

Renderer tests:

- Navigation shows `MCP & Skills`.
- Skills tab lists installed skills.
- Upload invokes API and refreshes list.
- Enable switch calls API.
- MCP tab saves JSON.
- MCP tab shows validation errors.
- MCP server test displays returned tools.

Integration verification:

- `@story-forge/skills` tests.
- `@story-forge/mcp` tests.
- `@story-forge/agent-core` tests.
- `@story-forge/desktop` tests.
- Desktop and root typechecks.

## Non-Goals

- Automatic skill selection based on user intent.
- Skill autocomplete in the prompt box.
- Executing shell snippets embedded in skill markdown.
- Honoring skill `allowed-tools`, hooks, subagent, or model override frontmatter.
- Injecting all available full skill bodies into every model request.
- Injecting MCP tools into `AgentLoop`.
- Persistently running MCP servers in the background.
- OAuth flows for remote MCP servers.
- Team-shared project MCP config.
- Marketplace discovery.

## Design Rationale

Skills should become real model context before MCP tools become real executable tools. Skills are text-first, easy to inspect in developer mode, and naturally fit the current `AgentCoordinator` message assembly path. Explicit slash invocation avoids surprising prompt changes and gives users a clear mental model.

MCP servers can run arbitrary local commands or connect to external services. The first version should therefore make configuration and discovery visible without silently widening the agent's action surface. Testing connections and listing tools gives users confidence while leaving tool-call permission design for a future, explicit MCP execution design.

This staged approach matches patterns in current coding agents: MCP configuration commonly uses a `mcpServers` JSON object, while Skills are directory-based `SKILL.md` packages loaded into context only when relevant or explicitly invoked.
