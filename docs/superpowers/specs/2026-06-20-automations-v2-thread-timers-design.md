# Automations V2 Thread Timers Design

## Goal

Add V2 Automations support for timers that wake up inside the current chat session. Unlike V1 scheduled chats, a V2 thread timer must preserve the session context by appending a new user prompt to the same session and continuing the normal Agent loop there.

This makes StoryForge useful for monitor-style work such as:

```text
Every 10 minutes in this conversation, check whether the build is finished.
```

## Product Direction

V2 should support two creation paths:

1. **Session timer button**: a discoverable clock button in the current chat surface opens a compact form for creating a timer bound to this session.
2. **Natural-language proposal**: when the user asks for scheduled work in the current conversation, the agent can propose a thread timer and the user confirms it from a chat card.

Slash commands are useful for power users, but they should not be the primary V2 entry. They can be added later as a shortcut on top of the same proposal and creation APIs.

## Reference Patterns

Codex distinguishes between standalone automations and thread automations. Standalone automations create fresh runs; thread automations wake up the same thread and preserve conversation state. StoryForge V2 follows this model.

Claude Code has a similar split: scheduled tasks and routines are durable task definitions, while `/loop` is a current-session repeated-work pattern. StoryForge V2 should feel closer to a durable, user-visible current-session timer than a hidden slash-only loop.

## User Experience

### Chat Timer Button

The active chat header or input footer gets a small clock button.

- Tooltip: `Schedule in this session`.
- Visible only when a session is selected.
- If the current session has active timers, show a small count indicator.
- Clicking opens a compact dialog or drawer.

The first implementation can use a modal dialog instead of a full side drawer. It should not change the main chat layout.

### Create Thread Timer Dialog

Fields:

- Name.
- Schedule description, such as `每 10 分钟` or `every weekday at 9`.
- Cron expression.
- Timezone.
- Prompt.
- Enabled state, default active.

The dialog reuses the V1 schedule generation and validation flow:

- `Generate schedule` converts schedule text to cron.
- `Validate` previews the next runs.
- Save creates an automation bound to the current session.

The dialog should make the scope explicit with copy such as:

```text
Runs in this session and keeps this conversation's context.
```

### Natural-Language Proposal

The user can ask inside chat:

```text
每 10 分钟在当前会话里检查一下测试有没有跑完。
```

The model should call an automation proposal tool with `kind: "thread_chat"`. The chat proposal card should show:

- Proposed name.
- Scope: `Runs in this session`.
- Session title.
- Schedule summary.
- Cron.
- Timezone.
- Prompt.
- Provider/model inherited from the session.
- Actions: `Create timer` and `Cancel`.

The model must not silently persist a timer. The user confirms from the card.

### Automations Page

The existing Automations page should list both V1 and V2 automations.

Add a type/scope label:

- `Scheduled Chat`: creates a new session on every run.
- `Thread Timer`: appends a prompt to an existing session.

For thread timers, show the bound session title when available.

## Scope

### V2 Includes

- New automation kind `thread_chat`.
- Persisted `sessionId` for thread timers.
- Chat button entry for creating a timer in the selected session.
- Natural-language proposal support for thread timers.
- Scheduler support that wakes the same session by calling the existing turn start path.
- `Run now` support for thread timers.
- Automations page display and management for both kinds.
- Skip overlapping runs when the target session is already running.
- Tests for storage, scheduler behavior, IPC, agent proposal, and renderer flows.

### V2 Does Not Include

- Running while the desktop app is closed.
- Cloud execution.
- OS-level launch agents.
- Queueing missed runs.
- Slash command creation.
- Worktree isolation.
- Cross-session timer moves.
- Persisting unconfirmed proposal cards across restart.

## Data Model

Extend the shared automation kind:

```ts
type AutomationKind = "scheduled_chat" | "thread_chat";
```

Extend `AutomationView`:

```ts
type AutomationView = {
  schemaVersion: 1;
  id: string;
  kind: AutomationKind;
  name: string;
  status: AutomationStatus;
  workspaceId: string;
  providerId: ProviderId;
  model: string;
  sessionId?: SessionId;
  schedule: AutomationScheduleView;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastRunStatus?: AutomationRunStatus;
};
```

Rules:

- `scheduled_chat` must not require `sessionId`.
- `thread_chat` must require `sessionId`.
- The `workspaceId`, `providerId`, and `model` remain denormalized for list display and for resilience if the session cannot be loaded immediately.

Extend creation and proposal inputs with:

```ts
kind?: AutomationKind;
sessionId?: SessionId;
```

Default `kind` to `scheduled_chat` for backward compatibility.

## Storage And Migration

The V1 JSON storage path stays the same:

```text
<userData>/automations/
  automations.json
  runs/
    <automation-id>.json
```

Existing records without `sessionId` remain valid. Existing records with `kind: "scheduled_chat"` continue to run exactly as before.

Repository validation should enforce that new `thread_chat` records include a valid session id.

## Scheduler Behavior

The scheduler branches by automation kind:

- `scheduled_chat`: keep V1 behavior and create a fresh session with `AgentCoordinator.startAutomationRun`.
- `thread_chat`: call `AgentCoordinator.start({ sessionId, prompt })` directly.

Run lifecycle:

1. Append a `running` automation run.
2. Start the turn.
3. Store the target `sessionId` on the run.
4. Wait for the turn to finish.
5. Mark the run `completed` or `failed`.
6. Recompute `nextRunAt`.

Overlap policy:

- If the same automation is already running, mark the new run `skipped`.
- If the target session already has an active turn, mark the run `skipped` with `session-already-running`.
- Do not queue in V2.

Missing session policy:

- If the session no longer exists, mark the run `failed` with `session-not-found`.
- The automation stays active in V2 so the user can repair or delete it from the page.

## Agent Integration

Update `automation.proposeCreate` so proposals include a kind:

```ts
kind: "scheduled_chat" | "thread_chat";
sessionId?: SessionId;
```

System prompt guidance:

- If the user asks to schedule work "in this chat", "in this session", "在当前会话", or similar wording, propose `thread_chat`.
- If the user asks for recurring work without specifying current-session context, prefer `scheduled_chat`.
- Always require user confirmation.

The proposal event should carry enough information for the renderer to create the correct automation without asking the model again.

## IPC And Preload API

The existing `automations.create`, `automations.update`, `automations.runNow`, and proposal creation flow should support the new fields.

No new top-level IPC namespace is required.

Add one convenience API only if the renderer needs it:

```ts
automations.listBySession(sessionId): Promise<AutomationView[]>
```

This can also be implemented by filtering `automations.list()` in the renderer for V2 to keep scope small.

## Renderer Flow

### App State

The renderer should be able to answer:

- Which timers are bound to the selected session?
- How many are active?

For V2, a full global subscription is not required. Loading the automation list on page open and after creation/update is enough. The chat surface can also fetch `automations.list()` when the session changes.

### Agent Workspace

Add a clock button beside the existing header actions.

- Disabled if no selected session.
- Shows active count for the session.
- Opens `SessionTimerDialog`.

### Proposal Card

Reuse the existing automation proposal card with scope-specific copy:

- `Automation proposal` for scheduled chat.
- `Thread timer proposal` for current-session timer.

The confirm button label should be:

- `Create automation` for scheduled chat.
- `Create timer` for thread timer.

## Error Handling

- Empty schedule text: show inline error before calling interpretation.
- Invalid cron/timezone: reuse V1 validation errors.
- Missing session on create: show `A thread timer needs an active session`.
- Session running at scheduled time: create a skipped run instead of throwing to the UI.
- Deleted session at scheduled time: failed run, automation remains visible.

## Testing

Main process tests:

- Repository accepts `thread_chat` with session id.
- Repository rejects or service rejects `thread_chat` without session id.
- Scheduler starts the same session for `thread_chat`.
- Scheduler skips when the session already has an active turn.
- `runNow` works for both automation kinds.
- Agent proposal emits `thread_chat` when model calls the tool with that kind.

Renderer tests:

- Chat header shows the session timer button.
- Dialog creates a `thread_chat` automation with current session id.
- Active timer count appears for selected session.
- Proposal card confirms a `thread_chat` timer.
- Automations page renders type/scope labels for both kinds.

Verification:

- `corepack pnpm --filter @story-forge/shared test`
- `corepack pnpm --filter @story-forge/tools test`
- `corepack pnpm --filter @story-forge/desktop test`
- `corepack pnpm typecheck`
