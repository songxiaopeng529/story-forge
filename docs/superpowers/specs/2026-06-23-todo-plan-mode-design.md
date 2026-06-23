# Todo List and Plan Mode Design

## Goal

Add first-class task planning to StoryForge before building true multi-agent orchestration.

The first version should let the native coding agent break complex user requests into a structured task list, keep that list visible to the user, update task status as work progresses, and avoid declaring completion while known work remains unfinished. Plan Mode should give users a safe review step for complex work: the agent may gather context and produce a plan, but it must not edit files until the user approves execution.

This is the Phase 1 foundation for a later multi-agent system. V1 stays single-agent, but the task model should be strong enough to become the future multi-agent scheduling surface.

## Background

StoryForge already has a capable native runtime:

- `AgentCoordinator` starts turns, reserves running sessions, wires permissions, and consumes runtime events.
- `NativeAgentRuntime` builds runtime context, creates tools, calls `AgentLoop`, persists checkpoints, and emits `AgentEvent` values.
- `AgentLoop` supports multi-step model and tool execution with stop reasons, checkpoints, repeated-tool-call detection, and consecutive-failure detection.
- The renderer already displays a chronological timeline of user messages, assistant messages, tool calls, tool results, automation proposals, and runtime status.

The missing layer is a durable task state. Today a model can write a checklist in assistant text, but the runtime cannot validate it, the UI cannot reliably track it, and future multi-agent orchestration cannot consume it.

Current mainstream coding agents point to two useful patterns:

- Codex exposes explicit Plan Mode and streams plan updates as structured turn state. Public Codex docs describe `/plan` as a way to gather context, ask clarifying questions, and propose an execution plan before implementation starts.
- Claude Code exposes structured task tracking through task tools. Its documented lifecycle is `pending -> in_progress -> completed`, with task tracking used for complex multi-step work, explicit user task lists, and non-trivial operations that benefit from progress visibility.

StoryForge should use the same underlying idea, adapted to its current runtime architecture: structured task tools, structured events, persisted session state, and a Plan Mode permission boundary.

## Non-Goals

V1 does not implement real multi-agent execution.

V1 does not create background worker threads, subagent contexts, task assignment, dependency scheduling, or cross-agent result merging.

V1 does not require a global goal system, although the task model should not block one later.

V1 does not parse todos out of free-form assistant Markdown. The source of truth is structured runtime state.

V1 does not introduce a separate planning model. It uses the session's selected provider and model.

## Product Behavior

### Automatic Task Tracking

For complex requests, the agent should create and maintain a task list. The system prompt should instruct the model to use task tools when:

- The user asks for a complex implementation, investigation, migration, refactor, or debugging task.
- The request naturally has three or more distinct steps.
- The user provides a list of requirements or asks for a todo list, checklist, plan, or progress tracking.
- The task spans multiple files, tools, or validation stages.

The model should keep exactly one task `in_progress` at a time unless it is explicitly tracking independent concurrent work. Since V1 is single-agent and tool execution is serial, one active task is the normal case.

The model should mark a task `completed` only after its work and relevant verification for that task are done. If it cannot finish a task due to missing user input, denied permissions, failing external services, or another real blocker, it should mark the task `blocked` and explain why.

### Plan Mode

Plan Mode is a per-turn mode. Users can enter it with:

- A `/plan` slash command in the composer.
- A future Plan toggle or command palette action.

In Plan Mode, the agent may:

- Read workspace files.
- List directories.
- Search project files through a safe search tool or read-only command.
- Use web search and fetch tools when web access is enabled.
- Ask clarifying questions.
- Create and update planning tasks.
- Emit a proposed plan for user review.

In Plan Mode, the agent must not:

- Write files.
- Replace text.
- Run commands classified as modifying, destructive, elevated, or high-risk.
- Claim implementation work has started.

The Plan Mode output should include a concise implementation plan and the task list it created. After the user approves, the next normal turn executes the plan using the existing runtime loop.

### Execution After Approval

The first version can keep approval simple:

1. User invokes `/plan <request>`.
2. Agent gathers context and writes a task list plus plan.
3. UI shows the task list and a clear prompt for the user to approve or revise.
4. User sends a follow-up such as "execute this plan" or clicks a future "Start implementation" button.
5. StoryForge starts a normal turn using the same session and persisted task list.

The implementation turn should see the existing task list in runtime context and continue updating it. It should not need to recreate the list unless the user changes scope.

## Task Model

Add a persisted task list to each session.

```ts
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export type SessionTask = {
  id: `sf_task_${string}`;
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
```

Field rules:

- `title` is the short stable label displayed in the UI.
- `description` gives implementation detail when needed.
- `activeForm` is optional text shown while the task is `in_progress`, such as "Inspecting runtime event flow".
- `blockedReason` is required when status becomes `blocked`.
- Timestamps are ISO strings in the session JSON, matching existing session message timestamps.
- Task IDs are generated by StoryForge, not by the model.

The session schema remains `schemaVersion: 1` for V1 if the new field is optional and defaults to an empty list when missing. If the migration becomes more invasive later, a dedicated schema version bump can be introduced then.

## Tool Surface

Add task tools in `packages/tools`, registered by `AgentCoordinator` through the native runtime tool factory.

The tools should validate inputs by hand, following the existing tool convention. They should update a task store supplied by the desktop runtime, emit task events, and return a snapshot or changed task.

### `task.create`

Create one new task.

Input:

```ts
{
  title: string;
  description?: string;
  activeForm?: string;
}
```

Output:

```ts
{
  task: SessionTask;
  tasks: SessionTask[];
}
```

### `task.update`

Patch one existing task.

Input:

```ts
{
  taskId: string;
  title?: string;
  description?: string;
  activeForm?: string;
  status?: "pending" | "in_progress" | "completed" | "blocked";
  blockedReason?: string;
}
```

Rules:

- `taskId` must identify an existing task in the current session.
- `blockedReason` is required when setting `status: "blocked"`.
- `blockedReason` should be cleared automatically when status changes away from `blocked`.
- If setting a task to `in_progress`, the store should move any other `in_progress` task back to `pending` unless the tool later gains an explicit `allowMultipleInProgress` option.

Output:

```ts
{
  task: SessionTask;
  tasks: SessionTask[];
}
```

### `task.list`

Return the current task list.

Input:

```ts
{}
```

Output:

```ts
{
  tasks: SessionTask[];
}
```

### Why Not One `todo.write` Tool

A single tool that rewrites the full list is easy to implement but easy for the model to misuse. Incremental `create/update/list` tools give StoryForge stable task IDs, clearer event history, better validation, and a cleaner path to future multi-agent assignment.

## Runtime Integration

### Runtime Context

`RuntimeContext` should include the current session tasks:

```ts
tasks: SessionTask[];
mode: "normal" | "plan";
```

The structured system prompt should include task guidance inside the main runtime rules:

- Use `task.create` and `task.update` for complex multi-step tasks.
- Keep task status current before and after meaningful work.
- Do not mark a task complete until the work and relevant validation are done.
- If blocked, mark the task `blocked` and explain the blocker.
- Before finalizing, make sure all known tasks are `completed` or `blocked`.

The prompt should include a compact task snapshot when tasks already exist. This lets follow-up turns continue the same list without forcing the model to call `task.list` immediately.

### Completion Guard

Add an optional completion guard to `AgentLoop`.

Current behavior ends the loop when the model returns no tool calls. With tasks, that is too trusting. V1 should add a callback such as:

```ts
onBeforeFinish?: (messages: ChatMessage[]) => Promise<
  | { action: "finish" }
  | { action: "continue"; message: ChatMessage }
>;
```

When the model tries to finish, `NativeAgentRuntime` checks the persisted task list:

- If all tasks are `completed` or `blocked`, finish normally.
- If no tasks exist, finish normally.
- If any task is `pending` or `in_progress`, append an internal user-style reminder and continue the loop.

The reminder should be direct and bounded:

```text
Known tasks remain pending or in progress. Continue working on them, or mark tasks blocked with a concrete reason if you cannot proceed.
```

To prevent loops, the guard should only fire a small bounded number of times per turn, such as twice. After that, the runtime can finish with a warning event or stop reason if the model still refuses to reconcile task state.

### Stop Reasons

V1 can keep existing stop reasons. If the guard limit is reached, `unrecoverable-error` is too strong. Prefer adding a new stop reason:

```ts
"unfinished-tasks"
```

This status means the runtime stopped because the model attempted to finish while tasks still remained open after guard reminders.

## Plan Mode Tool Policy

The cleanest V1 implementation is to build a mode-aware tool registry.

Normal mode registers existing tools:

- Workspace file tools.
- Command tool.
- Web tools when enabled.
- Automation proposal tool.
- Task tools.

Plan Mode registers:

- `workspace.readFile`
- `workspace.listDirectory`
- `workspace.searchText`
- `workspace.runCommand` in a read-only policy variant for existing allowlisted safe commands.
- `web.search` and `web.fetch` when enabled.
- `task.create`
- `task.update`
- `task.list`

Plan Mode does not register:

- `workspace.writeFile`
- `workspace.replaceText`
- `automation.proposeCreate`

The read-only command variant should allow codebase inspection commands such as:

- `pwd`
- `which`
- `git status`
- `git diff`
- `git log`
- `git show`
- `git grep`
- `git ls-files`

Add `workspace.searchText` in this milestone rather than adding broad `rg` shell access to the command allowlist. `workspace.searchText` is the better product API because the agent should not need shell access just to search files.

`workspace.searchText` should accept a required query string and optional workspace-relative path:

```ts
{
  query: string;
  path?: string;
  maxResults?: number;
}
```

It should search text files under the workspace, return bounded file/line/snippet matches, honor `context.signal`, and avoid matching binary files or directories outside the workspace.

## Events

Add a task event to `packages/shared/src/events.ts`.

```ts
export type TaskListUpdatedEvent = {
  type: "task.list.updated";
  sessionId: SessionId;
  turnId: TurnId;
  tasks: SessionTask[];
  changedTaskId?: string;
  reason: "created" | "updated" | "loaded" | "guard";
};
```

The event stream remains the renderer's live source during a running turn. The session JSON remains the durable source when reloading a session.

`task.list.updated` should be emitted after every successful `task.create` and `task.update`. At `runtime.started`, emit `reason: "loaded"` when a session already has tasks, so the renderer can hydrate live state without waiting for the next task mutation.

## Persistence

Extend `SessionRepository` with focused task methods:

```ts
listTasks(sessionId: SessionId): Promise<SessionTask[]>;
createTask(sessionId: SessionId, input: CreateTaskInput): Promise<SessionRecord>;
updateTask(sessionId: SessionId, input: UpdateTaskInput): Promise<SessionRecord>;
```

Task updates should use the repository's existing per-session update queue so concurrent writes cannot corrupt the session file.

`recoverInterruptedSessions` should preserve tasks as-is. A session interrupted while a task is `in_progress` should still show that task as `in_progress`; the next turn can either continue it or mark it blocked.

## IPC and Renderer

### IPC Contract

`turns.start` gains:

```ts
mode?: "normal" | "plan";
```

The preload bridge remains a thin forwarder. The main IPC handler validates the mode with Zod and passes it into `AgentCoordinator.start`.

For V1, task reads can piggyback on `sessions.get` because tasks are part of `SessionView`. A separate `tasks.list` IPC method is not needed unless the UI later supports task editing outside sessions.

### Timeline

The conversation timeline should show a compact task list item when tasks exist.

Suggested layout:

- Title: `Plan` in Plan Mode or `Tasks` in normal mode.
- Progress: `2/5 completed`.
- Rows with status icon, title, and optional active form or blocked reason.
- Collapsible detail for longer descriptions.

Task updates should not appear as noisy individual tool cards by default. The existing tool timeline can still show `task.create` and `task.update` in developer-style details, but the main user-facing surface should be the consolidated task list.

### Run Context Panel

The right-side run context panel can show:

- `Tasks: 2/5`
- `Current: <activeForm or title>`
- `Blocked: N` when any tasks are blocked.

This gives the user a quick sense of progress without scrolling the conversation.

### Composer

Add `/plan` to the slash command menu.

Selecting `/plan` should set a local `composerMode: "plan"` chip and remove the command text. The persisted user message should be the user's actual planning request, not the `/plan` implementation detail. Sending the message passes `mode: "plan"` through `turns.start`.

## Error Handling

Task tool errors should be ordinary tool failures:

- Missing task ID: `Task not found: <id>`.
- Empty title: `task.create requires a non-empty title`.
- Invalid status: `task.update requires a valid status`.
- Blocked without reason: `task.update requires blockedReason when status is blocked`.

If task persistence fails, the tool should fail and the model should see the error. The runtime should not silently pretend progress was recorded.

If Plan Mode blocks a write or modifying command, the tool should be unavailable or denied before execution. Prefer not registering write tools at all in Plan Mode; this produces a smaller, clearer tool surface for the model.

## Testing

### `packages/tools`

Add tests for task tool validation and behavior:

- `task.create` creates an ID, timestamps, and emits a full task snapshot.
- `task.update` changes status and clears blocked reason when unblocked.
- Setting one task `in_progress` resets the previous active task to `pending`.
- Invalid inputs throw useful errors.

### `apps/desktop/src/main`

Add repository and coordinator tests:

- Session files round-trip optional `tasks`.
- Missing `tasks` defaults to an empty list.
- `turns.start` accepts `mode: "plan"` and rejects invalid modes.
- Plan Mode tool registry excludes write tools.
- Task events emitted by tools reach the coordinator's event sink.

### `packages/agent-core`

Add loop/runtime tests:

- Existing behavior is unchanged when no tasks exist.
- Completion guard allows finish when all tasks are done.
- Completion guard appends a reminder and continues when open tasks remain.
- Guard limit stops with `unfinished-tasks`.
- Runtime context includes a compact task snapshot.

### Renderer

Add component and timeline tests:

- Persisted tasks render when a session loads.
- Live `task.list.updated` events update the visible task list.
- Completed, in-progress, pending, and blocked states have distinct labels.
- `/plan` creates a Plan Mode turn.

## Rollout Plan

V1 should land in two implementation passes.

### V1A: Task List Foundation

- Add shared task types and events.
- Persist tasks on sessions.
- Add task tools.
- Register task tools in normal mode.
- Render task lists in the timeline and run context.
- Add completion guard.

This gives StoryForge immediate todo list behavior for complex normal turns.

### V1B: Plan Mode

- Add `mode` to `turns.start`.
- Add `/plan` composer command.
- Add `workspace.searchText`.
- Build the Plan Mode tool registry.
- Add plan-specific system instructions.
- Show Plan Mode task/plan UI affordances.
- Add tests for read-only planning behavior.

Splitting this way reduces risk. The task list becomes useful on its own, and Plan Mode then becomes a controlled mode on top of the same task state.

## Future Multi-Agent Path

The future multi-agent system should reuse `SessionTask` rather than inventing a separate queue.

Likely extensions:

```ts
type SessionTask = {
  ...
  assigneeAgentId?: string;
  dependsOn?: string[];
  priority?: "low" | "normal" | "high";
  resultSummary?: string;
  evidence?: Array<{ kind: "file" | "command" | "url"; value: string }>;
};
```

Future agents can claim tasks by setting `assigneeAgentId` and `status: "in_progress"`. The main coordinator can wait for child agents, collect `resultSummary`, and mark parent tasks complete when all dependencies are done.

That future design is intentionally outside V1, but the V1 task model keeps the door open.

## Open Decisions Resolved for V1

- Use incremental `task.create/update/list`, not a full-list rewrite tool.
- Persist tasks on `SessionRecord`, not only in renderer state.
- Make Plan Mode per-turn, not a global app setting.
- Prefer not registering write tools in Plan Mode, rather than registering and denying them later.
- Add a completion guard so unfinished tasks are a runtime concern, not only a prompt convention.
- Keep V1 single-agent and serial, aligned with the current `AgentLoop` execution model.
