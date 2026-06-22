# Todo List and Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build StoryForge's first-class task list and per-turn Plan Mode on the native runtime path.

**Architecture:** Persist tasks on sessions, expose task mutation as model-callable tools, stream task list updates as `AgentEvent` values, and render a consolidated task list in the desktop timeline. Plan Mode reuses the same task state with a restricted tool registry and a composer mode chip.

**Tech Stack:** TypeScript, pnpm, Vitest, Zod, Electron IPC, React 19, existing StoryForge runtime/tool abstractions.

**Implementation status:** Complete as of 2026-06-23. The shipped implementation keeps `@story-forge/tools` independent of `@story-forge/shared` by defining local structural task types that match the shared task shape.

---

## Scope and Existing Work

There are existing uncommitted changes in:

- `packages/agent-core/src/native-agent-runtime.test.ts`
- `packages/agent-core/src/runtime-context.ts`
- `packages/agent-core/src/storyforge-context-document.test.ts`
- `packages/agent-core/src/storyforge-context-document.ts`

Those changes add a `<runtime>` context block with current date/time. Preserve them and build on top of them. Do not revert them.

This plan implements V1A and V1B from the spec:

- V1A: task types, persistence, task tools, runtime task context, completion guard, task UI.
- V1B: `mode: "plan"`, `/plan` composer mode, `workspace.searchText`, and Plan Mode tool restriction.

## Files

- Create: `packages/shared/src/tasks.ts` for task types and ID creation.
- Modify: `packages/shared/src/events.ts` for `TaskListUpdatedEvent` and `unfinished-tasks`.
- Modify: `packages/shared/src/index.ts` to export task types.
- Leave `packages/tools/package.json` independent of `@story-forge/shared`; task tools use local structural task types.
- Create: `packages/tools/src/task-tools.ts` for `task.create`, `task.update`, and `task.list`.
- Create: `packages/tools/src/task-tools.test.ts`.
- Modify: `packages/tools/src/file-tools.ts` to add `workspace.searchText`.
- Modify: `packages/tools/src/workspace-sandbox.ts` if a helper is needed for walking/searching safely.
- Modify: `packages/tools/src/file-tools.test.ts` for search behavior.
- Modify: `packages/tools/src/command-tool.ts` for read-only Plan Mode command policy.
- Modify: `packages/tools/src/command-tool.test.ts`.
- Modify: `packages/tools/src/index.ts` to export task tools.
- Modify: `apps/desktop/src/main/session-repository.ts` for task schema and task methods.
- Modify: `apps/desktop/src/main/session-repository.test.ts`.
- Modify: `packages/agent-core/src/agent-runtime.ts` for turn mode and tasks.
- Modify: `packages/agent-core/src/runtime-context.ts` for mode/task prompt context while preserving the existing runtime time block.
- Modify: `packages/agent-core/src/storyforge-context-document.ts` only if task context needs a structured document field; prefer keeping tasks inside `<runtime>` or `<main>` to avoid a larger XML change.
- Modify: `packages/agent-core/src/agent-loop.ts` for `onBeforeFinish`.
- Modify: `packages/agent-core/src/agent-loop.test.ts`.
- Modify: `packages/agent-core/src/native-agent-runtime.ts` for task loaded events and guard integration.
- Modify: `packages/agent-core/src/native-agent-runtime.test.ts`.
- Modify: `apps/desktop/src/main/agent-coordinator.ts` for turn mode, task tools, and Plan Mode registry.
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`.
- Modify: `apps/desktop/src/main/ipc-handlers.ts` and `apps/desktop/src/main/ipc-handlers.test.ts` for validated turn mode.
- Modify: `apps/desktop/src/shared/story-forge-api.ts` for task/session/turn API types.
- Modify: `apps/desktop/src/preload/index.ts` only if the start forwarder needs explicit typing changes.
- Modify: `apps/desktop/src/renderer/timeline.ts` and `apps/desktop/src/renderer/timeline.test.ts` for task list items.
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx` for task rendering.
- Modify: `apps/desktop/src/renderer/components/run-context-panel.tsx` for task summary.
- Modify: `apps/desktop/src/renderer/components/agent-workspace.tsx` for `/plan` mode chip.
- Modify: `apps/desktop/src/renderer/App.tsx` and `apps/desktop/src/renderer/App.test.tsx` for mode state and event handling.
- Modify: `docs/superpowers/plans/2026-06-23-todo-plan-mode.md` as tasks complete.

## Task 1: Shared Task Types and Events

**Files:**
- Create: `packages/shared/src/tasks.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add task types**

Create `packages/shared/src/tasks.ts`:

```ts
import type { TurnId } from "./events";

export type TaskId = `sf_task_${string}`;
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TurnMode = "normal" | "plan";

export type SessionTask = {
  id: TaskId;
  title: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  createdTurnId?: TurnId;
  updatedTurnId?: TurnId;
};

export function createTaskId(): TaskId {
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `sf_task_${entropy}`;
}
```

- [ ] **Step 2: Add event and stop reason**

Modify `packages/shared/src/events.ts`:

```ts
import type { CommandExecutionMode, MessageDeliveryMode, ResponseMode } from "./settings";
import type { AutomationProposalView } from "./extensions";
import type { SessionTask, TaskId } from "./tasks";
```

Add `"unfinished-tasks"` to `AgentStopReason`.

Add:

```ts
export type TaskListUpdatedEvent = {
  type: "task.list.updated";
  sessionId: SessionId;
  turnId: TurnId;
  tasks: SessionTask[];
  changedTaskId?: TaskId;
  reason: "created" | "updated" | "loaded" | "guard";
};
```

Add `TaskListUpdatedEvent` to the `AgentEvent` union.

- [ ] **Step 3: Export tasks**

Modify `packages/shared/src/index.ts`:

```ts
export * from "./events";
export * from "./extensions";
export * from "./settings";
export * from "./tasks";
```

- [ ] **Step 4: Verify shared typecheck**

Run: `corepack pnpm --filter @story-forge/shared typecheck`

Expected: pass.

## Task 2: Session Task Persistence

**Files:**
- Modify: `apps/desktop/src/main/session-repository.ts`
- Modify: `apps/desktop/src/main/session-repository.test.ts`
- Modify: `apps/desktop/src/shared/story-forge-api.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests in `apps/desktop/src/main/session-repository.test.ts`:

```ts
it("defaults missing tasks to an empty list", async () => {
  const repository = new SessionRepository({ rootDir });
  const session = await repository.create({
    workspaceId: "workspace-1",
    providerId: "openai",
    model: "gpt-test",
  });

  await expect(repository.listTasks(session.id)).resolves.toEqual([]);
});

it("creates and updates tasks on the session", async () => {
  const repository = new SessionRepository({ rootDir });
  const session = await repository.create({
    workspaceId: "workspace-1",
    providerId: "openai",
    model: "gpt-test",
  });

  const afterCreate = await repository.createTask(session.id, {
    title: "Inspect runtime",
    description: "Read the runtime files.",
    activeForm: "Inspecting runtime files",
    turnId: "sf_turn_test",
  });
  const task = afterCreate.tasks[0];

  expect(task).toMatchObject({
    title: "Inspect runtime",
    description: "Read the runtime files.",
    activeForm: "Inspecting runtime files",
    status: "pending",
    createdTurnId: "sf_turn_test",
    updatedTurnId: "sf_turn_test",
  });

  const afterUpdate = await repository.updateTask(session.id, {
    taskId: task.id,
    status: "blocked",
    blockedReason: "Need approval",
    turnId: "sf_turn_test_2",
  });

  expect(afterUpdate.tasks[0]).toMatchObject({
    status: "blocked",
    blockedReason: "Need approval",
    updatedTurnId: "sf_turn_test_2",
  });
});

it("keeps only one task in progress", async () => {
  const repository = new SessionRepository({ rootDir });
  const session = await repository.create({
    workspaceId: "workspace-1",
    providerId: "openai",
    model: "gpt-test",
  });

  const first = (await repository.createTask(session.id, { title: "First" })).tasks[0];
  const second = (await repository.createTask(session.id, { title: "Second" })).tasks[1];

  await repository.updateTask(session.id, { taskId: first.id, status: "in_progress" });
  const updated = await repository.updateTask(session.id, { taskId: second.id, status: "in_progress" });

  expect(updated.tasks.map((task) => [task.title, task.status])).toEqual([
    ["First", "pending"],
    ["Second", "in_progress"],
  ]);
});
```

- [ ] **Step 2: Run repository tests to verify red**

Run: `corepack pnpm --filter @story-forge/desktop test -- src/main/session-repository.test.ts`

Expected: fail because task methods do not exist.

- [ ] **Step 3: Implement task schema and methods**

In `apps/desktop/src/main/session-repository.ts`, import task types and ID creation from shared. Add a `sessionTaskSchema`, add `tasks: z.array(sessionTaskSchema).default([])` to `sessionSchema`, and export task input types:

```ts
export type CreateTaskInput = {
  title: string;
  description?: string;
  activeForm?: string;
  turnId?: TurnId;
};

export type UpdateTaskInput = {
  taskId: TaskId;
  title?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedReason?: string;
  turnId?: TurnId;
};
```

Add methods:

```ts
async listTasks(sessionId: SessionId): Promise<SessionTask[]> {
  const session = await this.get(sessionId);
  return session.tasks ?? [];
}

async createTask(sessionId: SessionId, input: CreateTaskInput): Promise<SessionRecord> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Task title must not be empty");
  }
  return this.update(sessionId, (session) => {
    const now = new Date().toISOString();
    const task: SessionTask = {
      id: createTaskId(),
      title,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.activeForm?.trim() ? { activeForm: input.activeForm.trim() } : {}),
      ...(input.turnId ? { createdTurnId: input.turnId, updatedTurnId: input.turnId } : {}),
    };
    return { ...session, tasks: [...(session.tasks ?? []), task] };
  });
}

async updateTask(sessionId: SessionId, input: UpdateTaskInput): Promise<SessionRecord> {
  return this.update(sessionId, (session) => {
    const tasks = session.tasks ?? [];
    const index = tasks.findIndex((task) => task.id === input.taskId);
    if (index < 0) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    if (input.status === "blocked" && !input.blockedReason?.trim()) {
      throw new Error("Blocked tasks require a blockedReason");
    }
    const now = new Date().toISOString();
    const nextTasks = tasks.map((task, taskIndex) => {
      if (input.status === "in_progress" && taskIndex !== index && task.status === "in_progress") {
        return { ...task, status: "pending" as const, updatedAt: now, ...(input.turnId ? { updatedTurnId: input.turnId } : {}) };
      }
      if (taskIndex !== index) {
        return task;
      }
      const status = input.status ?? task.status;
      return {
        ...task,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? input.description.trim() ? { description: input.description.trim() } : { description: undefined } : {}),
        ...(input.activeForm !== undefined ? input.activeForm.trim() ? { activeForm: input.activeForm.trim() } : { activeForm: undefined } : {}),
        ...(input.status ? { status } : {}),
        ...(status === "blocked" ? { blockedReason: input.blockedReason?.trim() ?? task.blockedReason } : { blockedReason: undefined }),
        updatedAt: now,
        ...(input.turnId ? { updatedTurnId: input.turnId } : {}),
      };
    });
    return { ...session, tasks: nextTasks };
  });
}
```

Adjust exact optional property handling if TypeScript requires explicit object construction rather than `undefined` properties.

- [ ] **Step 4: Add tasks to SessionView**

In `apps/desktop/src/shared/story-forge-api.ts`, import `SessionTask` and add:

```ts
tasks: SessionTask[];
```

to `SessionView`.

- [ ] **Step 5: Verify repository tests pass**

Run: `corepack pnpm --filter @story-forge/desktop test -- src/main/session-repository.test.ts`

Expected: pass.

## Task 3: Task Tools

**Files:**
- Modify: `packages/tools/package.json`
- Create: `packages/tools/src/task-tools.ts`
- Create: `packages/tools/src/task-tools.test.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Write failing task tool tests**

Create tests covering create, update, list, validation, blocked reason, and single `in_progress`.

- [ ] **Step 2: Run tests to verify red**

Run: `corepack pnpm --filter @story-forge/tools test -- src/task-tools.test.ts`

Expected: fail because `task-tools.ts` does not exist.

- [ ] **Step 3: Implement task tools**

Add `@story-forge/shared` to `packages/tools/package.json` dependencies.

Create `packages/tools/src/task-tools.ts` with:

```ts
import type { SessionTask, TaskId, TaskStatus, TurnId } from "@story-forge/shared";
import type { ToolDefinition } from "./tool-registry";

export type TaskToolStore = {
  listTasks(): Promise<SessionTask[]> | SessionTask[];
  createTask(input: { title: string; description?: string; activeForm?: string; turnId?: TurnId }): Promise<SessionTask[]> | SessionTask[];
  updateTask(input: {
    taskId: TaskId;
    title?: string;
    description?: string;
    activeForm?: string;
    status?: TaskStatus;
    blockedReason?: string;
    turnId?: TurnId;
  }): Promise<SessionTask[]> | SessionTask[];
};

export function createTaskTools(store: TaskToolStore): ToolDefinition[] {
  return [
    {
      name: "task.create",
      description: "Create a task in the current StoryForge task list.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          activeForm: { type: "string" },
        },
        required: ["title"],
      },
      execute: async (input) => {
        const tasks = await store.createTask(readCreateInput(input));
        return { task: tasks.at(-1), tasks };
      },
    },
    {
      name: "task.update",
      description: "Update status or details for an existing StoryForge task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          activeForm: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] },
          blockedReason: { type: "string" },
        },
        required: ["taskId"],
      },
      execute: async (input) => {
        const patch = readUpdateInput(input);
        const tasks = await store.updateTask(patch);
        const task = tasks.find((candidate) => candidate.id === patch.taskId);
        return { task, tasks };
      },
    },
    {
      name: "task.list",
      description: "Return the current StoryForge task list.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ tasks: await store.listTasks() }),
    },
  ];
}
```

Add helpers that reject empty titles, invalid statuses, and blocked status without `blockedReason`.

- [ ] **Step 4: Export task tools**

Add to `packages/tools/src/index.ts`:

```ts
export * from "./task-tools";
```

- [ ] **Step 5: Verify tools tests pass**

Run: `corepack pnpm --filter @story-forge/tools test -- src/task-tools.test.ts`

Expected: pass.

## Task 4: Workspace Search and Read-Only Commands

**Files:**
- Modify: `packages/tools/src/file-tools.ts`
- Modify: `packages/tools/src/file-tools.test.ts`
- Modify: `packages/tools/src/command-tool.ts`
- Modify: `packages/tools/src/command-tool.test.ts`

- [ ] **Step 1: Write failing `workspace.searchText` tests**

Add tests that create files under a temp workspace and assert:

- It finds bounded line/snippet matches.
- It respects a workspace-relative `path`.
- It ignores binary-like files.
- It rejects empty query.

- [ ] **Step 2: Run file tests to verify red**

Run: `corepack pnpm --filter @story-forge/tools test -- src/file-tools.test.ts`

Expected: fail because `workspace.searchText` is missing.

- [ ] **Step 3: Implement `workspace.searchText`**

Add a read-only tool to `createWorkspaceFileTools`. Use `fs/promises` to recursively walk from `sandbox.resolveDirectory(path ?? ".")`, skip directories such as `.git` and `node_modules`, skip files that contain NUL bytes in the first chunk, and return:

```ts
{
  query: string;
  matches: Array<{ path: string; line: number; snippet: string }>;
  truncated: boolean;
}
```

Clamp `maxResults` to a small default such as 20 and max such as 100.

- [ ] **Step 4: Write failing read-only command tests**

Add tests that `createWorkspaceCommandTool(..., { readOnly: true })` denies commands that would otherwise ask for confirmation and allows existing safe read-only commands.

- [ ] **Step 5: Implement read-only command option**

Add `readOnly?: boolean` to `WorkspaceCommandToolOptions`. When true, deny any `classifyCommand` result other than `allow`. Keep the existing normal behavior unchanged.

- [ ] **Step 6: Verify tools package**

Run: `corepack pnpm --filter @story-forge/tools test`

Expected: pass.

## Task 5: Runtime Task Context and Completion Guard

**Files:**
- Modify: `packages/agent-core/src/agent-runtime.ts`
- Modify: `packages/agent-core/src/runtime-context.ts`
- Modify: `packages/agent-core/src/agent-loop.ts`
- Modify: `packages/agent-core/src/agent-loop.test.ts`
- Modify: `packages/agent-core/src/native-agent-runtime.ts`
- Modify: `packages/agent-core/src/native-agent-runtime.test.ts`

- [ ] **Step 1: Write failing `AgentLoop` guard tests**

Add tests that:

- Finish normally when `onBeforeFinish` returns `finish`.
- Append a guard message and continue when it returns `continue`.
- Stop with `unfinished-tasks` when the guard returns `finish` with that stop reason.

- [ ] **Step 2: Run loop tests to verify red**

Run: `corepack pnpm --filter @story-forge/agent-core test -- src/agent-loop.test.ts`

Expected: fail because `onBeforeFinish` does not exist.

- [ ] **Step 3: Implement guard callback**

Add an `onBeforeFinish` callback to `AgentLoopRunInput`. In the no-tool-call branch, call it before checkpointing and finishing. If it returns `continue`, push the provided message, checkpoint, and continue the while loop. If it returns `finish`, finish with the provided stop reason or `completed`.

- [ ] **Step 4: Extend runtime context**

Add `mode: TurnMode` and `tasks: SessionTask[]` to `AgentRuntimeTurnInput`, `RuntimeSession`, and `RuntimeContext` as needed. Default missing mode to `"normal"`.

Update `RuntimeContextAssembler` to include task guidance and compact task snapshots in the existing structured system prompt. Preserve the already-present `<runtime>` current-time block.

- [ ] **Step 5: Add native runtime task events and guard**

Update `NativeAgentRuntime` so:

- It emits `task.list.updated` with `reason: "loaded"` at turn start when existing tasks are present.
- It calls `sessionStore.listTasks` in `onBeforeFinish`.
- It appends at most two guard reminder messages.
- It returns `unfinished-tasks` after the guard limit.

- [ ] **Step 6: Verify agent-core tests**

Run: `corepack pnpm --filter @story-forge/agent-core test`

Expected: pass.

## Task 6: Desktop Runtime Wiring and IPC

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/shared/story-forge-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Write failing coordinator and IPC tests**

Add tests that:

- `turns.start` accepts `mode: "plan"` and rejects invalid mode.
- Normal mode registers `workspace.writeFile`.
- Plan Mode excludes `workspace.writeFile`, `workspace.replaceText`, and `automation.proposeCreate`.
- Plan Mode includes `workspace.searchText` and task tools.
- A task tool call emits `task.list.updated`.

- [ ] **Step 2: Run desktop main tests to verify red**

Run: `corepack pnpm --filter @story-forge/desktop test -- src/main/ipc-handlers.test.ts src/main/agent-coordinator.test.ts`

Expected: fail before implementation.

- [ ] **Step 3: Wire turn mode**

Add `mode?: TurnMode` to `StoryForgeApi.turns.start`, preload forwarding, IPC validation, `AgentCoordinator.start`, and `AgentRuntimeTurnInput`.

- [ ] **Step 4: Wire task tools**

In `AgentCoordinator.createRuntimeTools`, add `createTaskTools` with a store backed by `SessionRepository` task methods and event emission.

- [ ] **Step 5: Wire Plan Mode registry**

Build mode-aware tools:

- In normal mode, use existing file tools, command tool, web tools, automation proposal tool, task tools.
- In plan mode, filter file tools to read/list/search, use command tool with `readOnly: true`, include web tools, include task tools, and omit automation proposal.

- [ ] **Step 6: Verify desktop main tests**

Run: `corepack pnpm --filter @story-forge/desktop test -- src/main/ipc-handlers.test.ts src/main/agent-coordinator.test.ts`

Expected: pass.

## Task 7: Renderer Task UI and `/plan`

**Files:**
- Modify: `apps/desktop/src/renderer/timeline.ts`
- Modify: `apps/desktop/src/renderer/timeline.test.ts`
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx`
- Modify: `apps/desktop/src/renderer/components/run-context-panel.tsx`
- Modify: `apps/desktop/src/renderer/components/agent-workspace.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing timeline tests**

Add tests that persisted session tasks and live `task.list.updated` events produce one consolidated `task-list` item with completion counts and statuses.

- [ ] **Step 2: Implement timeline task item**

Add a `task-list` `TimelineItem` variant. Build it from `session.tasks` and latest live task event for the active turn.

- [ ] **Step 3: Render task list**

Add a compact task list component to `conversation-timeline.tsx` using existing card styles and lucide icons. Render status labels for pending, in progress, completed, and blocked.

- [ ] **Step 4: Add run context task summary**

Pass tasks into `RunContextPanel` and show total/completed/current/blocked summary.

- [ ] **Step 5: Add `/plan` composer mode**

In `AgentWorkspace`, add `/plan` to built-in slash commands. Selecting it sets a local composer mode chip and clears the slash command text. `App.sendPrompt` passes `mode: "plan"` and resets the composer mode to normal after sending.

- [ ] **Step 6: Verify renderer tests**

Run: `corepack pnpm --filter @story-forge/desktop test -- src/renderer/timeline.test.ts src/renderer/App.test.tsx`

Expected: pass.

## Task 8: Final Verification

**Files:**
- Modify: files changed by earlier tasks only.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared typecheck
corepack pnpm --filter @story-forge/tools test
corepack pnpm --filter @story-forge/agent-core test
corepack pnpm --filter @story-forge/desktop test
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

Run: `corepack pnpm typecheck`

Expected: pass.

- [ ] **Step 3: Review git status**

Run: `git status --short --branch`

Expected: shows intended implementation changes plus the pre-existing runtime context changes, now integrated.

- [ ] **Step 4: Commit implementation**

Stage only intended StoryForge Todo/Plan Mode implementation files and this plan:

```bash
git add packages/shared packages/tools packages/agent-core apps/desktop docs/superpowers/plans/2026-06-23-todo-plan-mode.md
git commit -m "feat: add todo plan mode"
```

## Self-Review

- Spec coverage: task model, task tools, persisted session tasks, events, completion guard, Plan Mode tool policy, `workspace.searchText`, IPC, composer mode, renderer task list, tests, and future multi-agent compatibility are covered.
- Placeholder scan: no TBD/TODO/fill-in placeholders are intentionally left for the implementer.
- Type consistency: the plan consistently uses `SessionTask`, `TaskId`, `TaskStatus`, `TurnMode`, `task.list.updated`, and `unfinished-tasks`.
