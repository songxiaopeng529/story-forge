# Command Execution Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 哨兵模式, 巡航模式, and 无缰模式 for `workspace.runCommand`, including Settings persistence, command policy decisions, permission confirmation, and renderer controls.

**Architecture:** Add `CommandExecutionMode` to shared settings and persist it through the existing app settings store. Move command safety classification into a testable `packages/tools` policy module, then let the main process provide a permission callback to `workspace.runCommand`. Renderer receives `permission.request` events through the existing turn event stream, displays one confirmation prompt at a time, and answers through a new IPC channel.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, existing `@story-forge/shared`, `@story-forge/tools`, and `@story-forge/desktop` packages.

---

### Task 1: Shared Settings And Events

**Files:**
- Modify: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/events.test.ts`
- Modify: `apps/desktop/src/shared/story-forge-api.ts`

- [ ] **Step 1: Add command execution mode types**

Add this type to `packages/shared/src/settings.ts`:

```ts
export type CommandExecutionMode = "sentinel" | "cruise" | "unleashed";
```

Extend `AppSettingsView`:

```ts
export type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
};
```

- [ ] **Step 2: Extend permission request events**

In `packages/shared/src/events.ts`, import `CommandExecutionMode` and extend `PermissionRequestEvent`:

```ts
export type PermissionRequestEvent = {
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
  risk: "unknown" | "destructive" | "elevated";
};
```

- [ ] **Step 3: Extend renderer API types**

In `apps/desktop/src/shared/story-forge-api.ts`, import `CommandExecutionMode`, extend `settings.save()`, and add:

```ts
permissions: {
  respond(input: { requestId: string; approved: boolean }): Promise<void>;
};
```

- [ ] **Step 4: Update shared tests**

Update `packages/shared/src/events.test.ts` so the sample app settings include `commandExecutionMode: "sentinel"` and the permission event includes command/mode/risk fields.

- [ ] **Step 5: Run shared tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test
```

Expected: shared tests pass.

### Task 2: Settings Persistence And IPC

**Files:**
- Modify: `apps/desktop/src/main/app-settings-store.ts`
- Modify: `apps/desktop/src/main/app-settings-store.test.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Persist command execution mode**

Add a Zod enum in `app-settings-store.ts`:

```ts
const commandExecutionModeSchema = z.enum(["sentinel", "cruise", "unleashed"]);
```

Default settings must return:

```ts
{
  schemaVersion: 1,
  responseMode: "auto",
  developerMode: false,
  commandExecutionMode: "sentinel",
}
```

`SaveAppSettingsInput` should include:

```ts
commandExecutionMode?: CommandExecutionMode | undefined;
```

- [ ] **Step 2: Validate command execution mode over IPC**

In `ipc-handlers.ts`, add the same enum and include:

```ts
commandExecutionMode: commandExecutionModeSchema.optional(),
```

Register the new permission response channel with payload:

```ts
z.object({ requestId: z.string().min(1), approved: z.boolean() })
```

and forward it to `options.coordinator.respondToPermission()`.

- [ ] **Step 3: Wire main coordinator options**

In `main.ts`, pass:

```ts
getCommandExecutionMode: async () => (await settingsStore.get()).commandExecutionMode,
```

to `AgentCoordinator`.

- [ ] **Step 4: Expose preload API**

In `preload/index.ts`, add:

```ts
permissions: {
  respond: (input) => ipcRenderer.invoke(IPC_CHANNELS.permissionRespond, input),
},
```

- [ ] **Step 5: Update settings and IPC tests**

Update expected settings objects in `app-settings-store.test.ts` and `ipc-handlers.test.ts`. Add assertions that saving `{ commandExecutionMode: "cruise" }` succeeds and `{ commandExecutionMode: "chaos" }` is rejected.

- [ ] **Step 6: Run desktop main tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/main/app-settings-store.test.ts apps/desktop/src/main/ipc-handlers.test.ts
```

Expected: targeted desktop main tests pass.

### Task 3: Command Policy And Tool Execution

**Files:**
- Create: `packages/tools/src/command-policy.ts`
- Modify: `packages/tools/src/command-tool.ts`
- Modify: `packages/tools/src/command-tool.test.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Create policy module**

Create `command-policy.ts` with exported types:

```ts
export type CommandPolicyDecision =
  | { action: "allow"; reason: string; risk: "safe" | "low" }
  | { action: "confirm"; reason: string; risk: "unknown" | "destructive" | "elevated" }
  | { action: "deny"; reason: string; risk: "invalid" };
```

Export `classifyCommand(input: { mode: CommandExecutionMode; program: string; args: string[] }): CommandPolicyDecision`.

- [ ] **Step 2: Port existing allowlist into policy**

Move the existing `SAFE_SCRIPT_NAMES`, `SAFE_GIT_COMMANDS`, `SAFE_DIRECT_PROGRAMS`, package manager validation, and unsafe argument checks into the policy module. Keep `validateCommand()` as a compatibility wrapper that throws unless the sentinel policy returns `allow`.

- [ ] **Step 3: Add mode behavior**

Implement:

```ts
if (mode === "unleashed") return { action: "allow", reason: "Unleashed mode allows command execution.", risk: "low" };
if (isDestructiveCommand(program, args)) return { action: "confirm", reason: "This command may modify or delete files.", risk: "destructive" };
if (isKnownSafeCommand(program, args)) return { action: "allow", reason: "Command matches the safe allowlist.", risk: "safe" };
if (mode === "cruise") return { action: "allow", reason: "Cruise mode allows non-destructive commands.", risk: "low" };
return { action: "confirm", reason: "Command is outside the safe allowlist.", risk: "unknown" };
```

- [ ] **Step 4: Add permission callback to command tool**

Change `createWorkspaceCommandTool()` to accept:

```ts
export type WorkspaceCommandToolOptions = {
  mode?: CommandExecutionMode;
  requestPermission?: (request: {
    reason: string;
    risk: "unknown" | "destructive" | "elevated";
    command: { program: string; args: string[]; cwd: string };
  }) => Promise<boolean>;
};
```

When the policy returns `confirm`, call `requestPermission`. If missing or denied, throw `Command denied: <reason>`.

- [ ] **Step 5: Keep workspace sandbox checks**

Resolve cwd before classification payload is shown, and keep `sandbox.assertCommandArgumentsInside()` for sentinel and cruise. In unleashed mode, still resolve cwd but skip argument-path rejection so explicit destructive commands can run.

- [ ] **Step 6: Update command tests**

Add tests for:

```ts
classifyCommand({ mode: "sentinel", program: "which", args: ["agent-browser"] }).action === "allow"
classifyCommand({ mode: "sentinel", program: "agent-browser", args: ["screenshot"] }).action === "confirm"
classifyCommand({ mode: "cruise", program: "agent-browser", args: ["screenshot"] }).action === "allow"
classifyCommand({ mode: "cruise", program: "rm", args: ["-rf", "dist"] }).action === "confirm"
classifyCommand({ mode: "unleashed", program: "rm", args: ["-rf", "dist"] }).action === "allow"
```

Add command tool tests for approval and denial.

- [ ] **Step 7: Run tools tests**

Run:

```bash
corepack pnpm --filter @story-forge/tools test
```

Expected: tools tests pass.

### Task 4: Permission Coordinator

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`

- [ ] **Step 1: Add coordinator options**

Extend `AgentCoordinatorOptions`:

```ts
getCommandExecutionMode?: () => Promise<CommandExecutionMode>;
```

Store a pending permission map:

```ts
private readonly pendingPermissions = new Map<string, (approved: boolean) => void>();
```

- [ ] **Step 2: Implement response method**

Add:

```ts
respondToPermission(input: { requestId: string; approved: boolean }): void {
  const resolve = this.pendingPermissions.get(input.requestId);
  if (!resolve) return;
  this.pendingPermissions.delete(input.requestId);
  resolve(input.approved);
}
```

- [ ] **Step 3: Emit permission requests from command tool callback**

Inside `executeTurn()`, read `commandExecutionMode`, pass it to `createWorkspaceCommandTool()`, and implement `requestPermission` by emitting `permission.request` with command details, then waiting for approval or a timeout.

- [ ] **Step 4: Test event emission and response**

Add an agent coordinator test with a provider that requests `workspace.runCommand` using a confirm-worthy command. Assert a `permission.request` event is emitted and the turn progresses after `respondToPermission({ approved: true })`.

- [ ] **Step 5: Run coordinator tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/main/agent-coordinator.test.ts
```

Expected: coordinator tests pass.

### Task 5: Renderer Settings And Permission Prompt

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/settings-page.tsx`
- Create: `apps/desktop/src/renderer/components/permission-request-prompt.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Track command execution mode in App**

Add `commandExecutionMode` state, persisted ref, and `saveCommandExecutionMode()` mirroring the existing response/developer mode save functions.

- [ ] **Step 2: Render settings choices**

Add a second radiogroup in Settings:

```ts
[
  { value: "sentinel", label: "哨兵模式", description: "安全优先。安全命令会直接执行，危险或未知命令会先询问你。" },
  { value: "cruise", label: "巡航模式", description: "快速推进。大多数命令会直接执行，破坏性操作会先询问你。" },
  { value: "unleashed", label: "无缰模式", description: "完全放开。命令不会再弹出确认，请只在你信任当前 Agent 时使用。" },
]
```

- [ ] **Step 3: Queue permission prompts**

In `App.tsx`, collect `permission.request` events into a queue, render one prompt above the current page, and answer via `window.storyForge.permissions.respond()`.

- [ ] **Step 4: Create prompt component**

`PermissionRequestPrompt` renders command, cwd, reason, `Deny`, and `Allow once`. It should be accessible as `role="dialog"` and should not cover the whole app in a way that makes the command unreadable.

- [ ] **Step 5: Update renderer tests**

Add tests that:

- Settings renders and saves 哨兵/巡航/无缰 choices.
- Permission prompt appears for a `permission.request` event.
- Clicking `Allow once` calls `permissions.respond({ requestId, approved: true })`.
- Clicking `Deny` calls `permissions.respond({ requestId, approved: false })`.

- [ ] **Step 6: Run renderer tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/renderer/App.test.tsx
```

Expected: renderer tests pass.

### Task 6: Final Verification

**Files:**
- No new source files beyond prior tasks.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/tools test
corepack pnpm --filter @story-forge/desktop test
```

Expected: all selected package tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: typecheck passes.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git status --short
git add packages/shared apps/desktop packages/tools docs/superpowers/plans/2026-06-20-command-execution-modes.md
git commit -m "feat: add command execution modes"
```

Expected: implementation commit is created on the current feature branch.
