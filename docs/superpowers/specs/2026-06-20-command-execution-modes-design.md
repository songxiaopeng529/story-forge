# Command Execution Modes Design

## Goal

Add a Settings-level command execution mode that lets users choose how much StoryForge should ask before running workspace commands. The feature should make command restrictions understandable, reduce surprising hard failures like `Command is not allowed: which agent-browser`, and preserve a clear safety path for users who want stricter control.

## Naming

Use user-facing names that feel distinctive without hiding the behavior:

| Internal value | Display name | Summary |
| --- | --- | --- |
| `sentinel` | 哨兵模式 | Safety-first. Safe commands run automatically; risky or unknown commands ask first. |
| `cruise` | 巡航模式 | Flow-first. Most commands run automatically; destructive commands ask first. |
| `unleashed` | 无缰模式 | Full-speed. Commands run without confirmation. |

The Settings UI should show both the name and a plain-language subtitle. The names provide personality; the subtitle provides precision.

Recommended default: `sentinel`.

## User Experience

Settings gains a `Command execution` section with three selectable options:

- **哨兵模式**: `安全优先。安全命令会直接执行，危险或未知命令会先询问你。`
- **巡航模式**: `快速推进。大多数命令会直接执行，破坏性操作会先询问你。`
- **无缰模式**: `完全放开。命令不会再弹出确认，请只在你信任当前 Agent 时使用。`

When a command needs confirmation, the user sees a modal or docked prompt containing:

- Command line, including executable and arguments.
- Working directory.
- Risk reason, such as `This may delete files` or `This command is outside the safe allowlist`.
- Actions: `Allow once` and `Deny`.

If the user denies, the tool call should fail with a clear message that the command was denied by the user. The conversation timeline should show that failure as a normal tool result.

If the user selects 无缰模式, the Settings page should display a persistent caution state near that option. A one-time confirmation when enabling the option is acceptable, but once enabled the mode itself should not prompt for every command.

## Existing Context

Relevant files:

- `apps/desktop/src/main/app-settings-store.ts` stores app-level settings such as `responseMode` and `developerMode`.
- `apps/desktop/src/renderer/components/settings-page.tsx` renders the Settings screen.
- `apps/desktop/src/main/agent-coordinator.ts` creates `workspace.runCommand` through `createWorkspaceCommandTool()`.
- `packages/tools/src/command-tool.ts` currently hard-rejects commands that are not in a safe allowlist.
- `packages/tools/src/command-tool.test.ts` covers the current allowlist behavior.
- `packages/tools/src/workspace-sandbox.ts` validates workspace paths and command argument paths.
- `packages/shared/src/events.ts` already contains a `permission.request` event shape, but there is no complete request/response flow for command confirmation yet.

Current behavior is safe but opaque. For example, `which agent-browser` is rejected because `which` is not allowlisted, even though it is a read-only discovery command. The user sees a tool failure instead of a chance to approve the command.

## Policy Model

Introduce a command policy layer that classifies each requested command before execution:

```ts
type CommandExecutionMode = "sentinel" | "cruise" | "unleashed";

type CommandPolicyDecision =
  | { action: "allow"; reason: string; risk: "safe" | "low" }
  | { action: "confirm"; reason: string; risk: "unknown" | "destructive" | "elevated" }
  | { action: "deny"; reason: string; risk: "invalid" };
```

The policy should be deterministic and testable without invoking a real process.

## Mode Behavior

### 哨兵模式

Safe commands run automatically. Risky or unknown commands ask for confirmation.

Automatically allowed examples:

- Package scripts that match existing safe script rules: `dev`, `start`, `test`, `build`, `typecheck`, `check`, `lint`, `format`.
- Existing safe direct tools: `tsc`, `vitest`, `jest`, `eslint`, `prettier`, `pytest`.
- Existing safe language commands: `go test`, `go build`, `cargo test`, `cargo build`, `vite dev`, `vite build`.
- Read-only Git commands already allowed today: `git status`, `git diff`, `git log`, `git show`, `git grep`, `git ls-files`, `git rev-parse`.
- Read-only discovery commands that can run without a shell, such as `which` and `pwd`.

Confirmation examples:

- Unknown executables such as `agent-browser`.
- Shell execution such as `sh -c ...` or `bash -lc ...`.
- Package installation or publishing commands.
- File mutation commands not otherwise classified as safe.
- Destructive commands.

Denied examples:

- Empty executable names.
- Executables containing path separators when the runtime cannot safely reason about them.
- Commands whose configured working directory is outside the workspace.
- Arguments rejected by the workspace sandbox in this mode.

### 巡航模式

Most commands run automatically. Only destructive or highly elevated commands ask for confirmation.

Automatically allowed examples:

- Everything allowed in 哨兵模式.
- Unknown executables such as `agent-browser`.
- Read-only inspection commands such as `which agent-browser`.
- Non-destructive shell commands.
- Package install commands, because users in this mode are choosing faster agent progress.

Confirmation examples:

- `rm`, `rmdir`, `unlink`, and recursive deletion.
- `mv` or `cp` patterns that overwrite existing paths when detectable.
- `git reset --hard`, `git clean`, `git checkout -- <path>`, `git restore <path>`, `git branch -D`.
- `npm uninstall`, `pnpm remove`, `yarn remove`, `bun remove`.
- `chmod`, `chown`, and commands that alter permissions or ownership.
- Commands that write outside the workspace when the sandbox can detect it.

Denied examples:

- Malformed commands that cannot be executed.
- Commands whose working directory is outside the workspace.

### 无缰模式

Commands run without confirmation.

The mode bypasses the command allowlist and destructive confirmation policy. It still keeps technical controls that protect app stability:

- Command schema validation.
- Working directory resolution.
- Timeout handling.
- Output size limits.
- Cancellation handling.
- Tool result logging.

This mode should not claim to be safe. The UI copy should make clear that StoryForge will execute what the Agent asks it to execute.

## Destructive Command Heuristics

The first version should use straightforward executable and argument matching. It does not need a full shell parser.

Treat the following as destructive in 哨兵模式 and 巡航模式:

- Deletion: `rm`, `rmdir`, `unlink`, `trash`.
- Git destructive operations: `reset --hard`, `clean`, `checkout --`, `restore`, `branch -D`.
- Dependency removal: `npm uninstall`, `pnpm remove`, `yarn remove`, `bun remove`.
- Permission or ownership mutation: `chmod`, `chown`.
- File overwrite signals: `>` or `>>` only when shell execution is used and visible as an argument.

When the classifier is unsure:

- 哨兵模式 returns `confirm`.
- 巡航模式 returns `allow`, unless a destructive pattern is detected.
- 无缰模式 returns `allow`.

## Settings Model

Extend app settings:

```ts
type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
};
```

Defaults:

```ts
{
  responseMode: "auto",
  developerMode: false,
  commandExecutionMode: "sentinel"
}
```

Settings saves should remain partial so changing command execution mode does not rewrite unrelated preferences incorrectly.

## Backend Flow

`AgentCoordinator` should pass the selected command execution mode into `createWorkspaceCommandTool()`.

`workspace.runCommand` should follow this flow:

1. Normalize executable, arguments, and working directory.
2. Ask the command policy for a decision.
3. If `allow`, execute the command.
4. If `deny`, return a failed tool result with the policy reason.
5. If `confirm`, emit a permission request and wait for the user's response.
6. If approved, execute the command.
7. If denied, return a failed tool result with a denial message.

The policy layer should live in `packages/tools` so it can be unit tested near the command tool.

## Permission Request Flow

The shared event model already has `permission.request`. Extend the request payload so the renderer can show command details, then complete the flow with an IPC response path:

```ts
type CommandPermissionRequest = {
  type: "permission.request";
  sessionId: SessionId;
  turnId: TurnId;
  requestId: string;
  reason: string;
  command: {
    program: string;
    args: string[];
    cwd: string;
  };
  mode: CommandExecutionMode;
  risk: CommandPolicyDecision["risk"];
};
```

```ts
type PermissionResponse = {
  requestId: string;
  approved: boolean;
};
```

The main process owns a pending permission map keyed by `requestId`. The renderer receives a permission request, shows the confirmation UI, then sends the response back through IPC.

Permission requests should time out if the renderer disappears or no answer arrives. A timed-out request should fail closed in 哨兵模式 and 巡航模式.

## Renderer Flow

The renderer needs two pieces:

- Settings UI for the three command modes.
- A permission confirmation component that can appear over the active workspace.

The confirmation component should be intentionally simple for v1:

- Title: `Allow command?`
- Body: command, cwd, reason.
- Buttons: `Deny` and `Allow once`.

If multiple permission requests arrive at once, queue them and show one at a time. The agent loop normally runs tools sequentially, but the queue keeps the UI robust.

## Error Handling

- Invalid settings values should fall back to `sentinel`.
- Permission IPC failures should deny the command and produce a clear tool error.
- If the command policy throws, the command should be denied with a generic policy failure message.
- If 无缰模式 is active, process execution failures are still reported normally as failed tool results.

## Testing

Add focused unit tests:

- App settings defaults include `commandExecutionMode: "sentinel"`.
- App settings persist and validate each command execution mode.
- Policy allows `which agent-browser` in 哨兵模式.
- Policy confirms unknown executables in 哨兵模式.
- Policy allows unknown executables in 巡航模式.
- Policy confirms destructive commands in 巡航模式.
- Policy allows destructive commands in 无缰模式.
- Command tool returns a denial result when policy denies.
- Command tool emits and waits for permission when policy confirms.
- Command tool executes after an approval response.
- Command tool fails after a denial response.
- Settings page renders all three options and saves selection.
- Permission prompt shows command, cwd, reason, and sends approve or deny.

Run:

```bash
corepack pnpm --filter @story-forge/desktop test
corepack pnpm --filter @story-forge/tools test
corepack pnpm typecheck
```

## Non-Goals

- No persistent per-command allow rules in v1.
- No project-level command policy overrides in v1.
- No full shell parser in v1.
- No automatic detection of every possible destructive shell expression.
- No remote policy sync.
- No provider-specific behavior. This policy applies to tool execution, not model selection.

## Open Decisions Resolved

- User-facing names: 哨兵模式, 巡航模式, 无缰模式.
- Default mode: 哨兵模式.
- 巡航模式 confirms destructive operations, not only literal deletion commands.
- 无缰模式 bypasses confirmation but keeps technical process controls.
- `which agent-browser` should no longer fail under the default policy.
