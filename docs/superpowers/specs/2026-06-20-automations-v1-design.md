# Automations V1 Design

## Goal

Add a first version of StoryForge Automations: users can define scheduled tasks that create a new chat session at the scheduled time and automatically send a configured prompt to the agent.

V1 focuses on local desktop scheduling while the app is running. It should feel useful quickly, fit the current StoryForge session architecture, and leave clean extension points for V2 features such as thread heartbeat, worktree isolation, run inbox, and a general `askUser` capability.

## Product Direction

StoryForge should support two creation paths:

1. **Automations page**: users manually create and manage scheduled tasks.
2. **Agent proposal from chat**: when the user asks for a recurring task in a normal chat, the model proposes an automation draft and the user confirms before anything is saved.

The important product rule is that the model may propose an automation, but it must not silently create one. Scheduled work is unattended execution, so the user confirms the schedule, workspace, prompt, and model before activation.

## Reference Patterns

Codex separates automation into standalone project automations and thread automations. Standalone automations start fresh runs on a schedule and can run in a local checkout or worktree. Thread automations are heartbeat-style follow-ups attached to the same conversation. Codex also recommends testing automation prompts manually and paying attention to sandbox/permission settings because unattended runs carry extra risk.

Claude Code has a similar shape across surfaces: scheduled tasks can create new sessions, `/loop` handles repeated work in the current session, and GitHub Actions or other external schedulers can run headless jobs.

StoryForge V1 adopts the standalone scheduled-session shape. V2 can add heartbeat and worktree behavior.

## User Experience

### Navigation

The primary navigation gains a new page:

- `Coding Agent`
- `Models`
- `MCP & Skills`
- `Automations`
- `Settings`

### Automations Page

The Automations page shows:

- List of automation definitions.
- Status: active or paused.
- Workspace.
- Schedule summary.
- Next run time.
- Last run result.
- Actions: create, edit, pause/resume, run now, delete.

The page should feel operational and compact, closer to a dashboard table than a marketing page.

### Create Automation Flow

The first version can be a single form instead of a multi-step wizard.

Fields:

- Name.
- Workspace.
- Provider and model.
- Schedule text, such as `每天上午 9 点`.
- Cron expression.
- Timezone.
- Prompt.
- Enabled state.

The schedule UI should support two paths:

- User enters natural language, then clicks `Generate schedule`.
- User directly edits the cron expression.

The generated schedule should be previewed before save:

- Human summary.
- Cron expression.
- Timezone.
- Next 3 run times.

Users can save only when the schedule can be parsed and a workspace is selected.

The default timezone should come from the user's local environment, using the browser or main-process equivalent of `Intl.DateTimeFormat().resolvedOptions().timeZone`. Users can override it before saving.

### Chat Proposal Flow

When a user says something like:

```text
每天早上帮我检查一下这个项目有没有依赖风险。
```

The model can call a new tool named `automation.proposeCreate`. The tool creates a pending automation proposal for the current turn and emits an event to the renderer.

The proposal card appears in the chat timeline near the assistant/tool activity. It shows:

- Proposed name.
- Workspace.
- Schedule summary.
- Cron.
- Timezone.
- Prompt.
- Provider/model.
- Next run time.
- Actions: `Create automation` and `Cancel`.

If the user confirms, the renderer calls the Automations IPC API to save the task. If the user cancels, nothing is persisted.

The assistant can still explain what it proposed, but the confirmation card is the source of truth for creation.

The proposal card should remain visible after the active turn completes until the user creates, cancels, switches sessions, or reloads the app. V1 does not persist unconfirmed proposals across app restarts.

## Naming

Use the page label `Automations`.

Use the V1 task type label `Scheduled Chat`.

Use these status labels:

- `Active`
- `Paused`
- `Running`
- `Completed`
- `Failed`
- `Skipped`

The user-facing copy can remain English for consistency with the current app, while schedule text and prompt contents may be Chinese or any user language.

## Scope

### V1

V1 includes:

- `Automations` navigation page.
- Local persisted automation definitions.
- Natural-language schedule draft generation.
- Cron expression validation.
- Timezone support.
- Next run preview.
- Scheduled run loop while the desktop app is open.
- New chat session per scheduled run.
- Automatic prompt submission.
- Run history for each automation.
- Pause/resume/delete.
- Manual `Run now`.
- Agent tool for proposing an automation from chat.
- User confirmation before saving model-proposed automations.

### V2

V2 should include:

- Thread heartbeat: scheduled follow-ups into the same session.
- Worktree isolation for Git workspaces.
- Automation inbox or triage view.
- Richer run history and archived run detail.
- Conflict policy for overlapping runs: queue, skip, or cancel.
- General `askUser` tool and AgentLoop pause/resume behavior.
- More advanced prompt testing before activation.
- Per-automation command execution mode overrides.

### Out Of Scope

V1 and V2 do not include:

- Cloud execution.
- Running while the app is closed.
- OS-level launch agents.
- Multi-device sync.
- Remote workers.
- Webhook-triggered automations.

## Data Model

Add shared view types:

```ts
type AutomationStatus = "active" | "paused";
type AutomationRunStatus = "scheduled" | "running" | "completed" | "failed" | "skipped";
type AutomationKind = "scheduled_chat";

type AutomationView = {
  schemaVersion: 1;
  id: string;
  kind: AutomationKind;
  name: string;
  status: AutomationStatus;
  workspaceId: string;
  providerId: ProviderId;
  model: string;
  schedule: {
    sourceText: string;
    cron: string;
    timezone: string;
    summary: string;
  };
  prompt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastRunStatus?: AutomationRunStatus;
};

type AutomationRunView = {
  schemaVersion: 1;
  id: string;
  automationId: string;
  sessionId?: SessionId;
  status: AutomationRunStatus;
  scheduledFor: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};
```

Internal records can match these shapes closely. The run record stores a `sessionId` once a session is created.

## Storage

Store automations under app user data:

```text
<userData>/automations/
  automations.json
  runs/
    <automation-id>.json
```

`automations.json` stores definitions. Each `runs/<automation-id>.json` stores recent run history for that automation.

V1 should cap retained runs per automation, for example the latest 50 runs, to avoid unbounded local files.

## Schedule Model

V1 stores cron plus timezone.

Timezones use IANA identifiers, such as `Asia/Shanghai` or `America/Los_Angeles`.

Use a standard cron parser library in the main process instead of hand-rolling date math. The implementation should support five-field cron expressions:

```text
minute hour day-of-month month day-of-week
```

Seconds are not supported in V1.

Schedule validation returns:

```ts
type ScheduleValidationResult =
  | {
      ok: true;
      cron: string;
      timezone: string;
      summary: string;
      nextRuns: string[];
    }
  | { ok: false; error: string };
```

`nextRuns` should be ISO strings. The renderer can format them for display.

## Natural Language To Cron

V1 needs a deterministic API boundary even if the first implementation uses the configured model.

Add an `AutomationScheduleInterpreter` in the main process:

```ts
type InterpretScheduleInput = {
  scheduleText: string;
  timezone: string;
  now: string;
};

type InterpretScheduleOutput = {
  cron: string;
  timezone: string;
  summary: string;
};
```

The interpreter can use the provider/model selected in the Automations form, falling back to the current default provider/model when the form has not chosen one yet. It should use a narrow prompt and a JSON-only response contract. The result must still pass cron validation before the UI accepts it.

If the model is unavailable or returns invalid output, the UI shows a validation error and lets the user type cron manually.

The interpreter should not create automations. It only proposes a schedule.

## Backend Components

### AutomationRepository

Responsibilities:

- Read/write automation definitions.
- Create/update/delete automation records.
- Store run records.
- Return list views sorted by next run time or updated time.
- Recover running runs as failed or skipped after app restart.

### AutomationScheduler

Responsibilities:

- Load active automations on app startup.
- Compute next run times.
- Maintain timers.
- Trigger due automations.
- Reschedule after every run.
- Refresh when automations are created, edited, paused, resumed, or deleted.

Scheduler rule:

- If an automation is already running when the next occurrence arrives, V1 records a `skipped` run with reason `previous-run-still-active`.
- If StoryForge is closed, the machine is asleep, or the timer cannot fire, V1 does not backfill missed runs on startup. On startup it computes the next future occurrence and records no synthetic runs for missed times.

### AutomationRunner

Responsibilities:

1. Create a new session using the automation's workspace, provider, and model.
2. Start the agent turn with the automation prompt.
3. Mark run as running with `sessionId`.
4. Wait for the turn to finish.
5. Mark run completed or failed.

The runner should reuse:

- `SessionRepository.create()`
- `AgentCoordinator.start()`
- `AgentCoordinator.waitForTurn()`

This keeps V1 aligned with normal user-initiated chats.

### AutomationProposalTool

Add a tool available to normal agent turns:

```ts
{
  name: "automation.proposeCreate",
  description: "Propose a scheduled automation for the user to review and confirm. This does not create the automation.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      scheduleText: { type: "string" },
      cron: { type: "string" },
      timezone: { type: "string" },
      prompt: { type: "string" }
    },
    required: ["name", "scheduleText", "cron", "timezone", "prompt"]
  }
}
```

The tool receives the current session/workspace/provider/model from `AgentCoordinator`, validates the schedule, emits a proposal event, and returns a short success result to the model.

It must not persist the automation.

## Runtime Events

Add shared event types:

```ts
type AutomationProposalEvent = {
  type: "automation.proposal";
  sessionId: SessionId;
  turnId: TurnId;
  proposalId: string;
  proposal: {
    name: string;
    workspaceId: string;
    providerId: ProviderId;
    model: string;
    scheduleText: string;
    cron: string;
    timezone: string;
    summary: string;
    nextRuns: string[];
    prompt: string;
  };
};
```

The renderer stores proposals in memory like model request debug payloads. V1 does not need to persist unconfirmed proposals.

Proposal state should be keyed by `sessionId` and `proposalId`, not by active turn state, so the card does not disappear when `runtime.completed` clears live turn activities.

## IPC API

Add automations IPC channels:

```ts
automations: {
  list(): Promise<AutomationView[]>;
  getRuns(automationId: string): Promise<AutomationRunView[]>;
  validateSchedule(input: { cron: string; timezone: string }): Promise<ScheduleValidationResult>;
  interpretSchedule(input: { scheduleText: string; timezone: string }): Promise<ScheduleValidationResult>;
  create(input: CreateAutomationInput): Promise<AutomationView>;
  update(input: UpdateAutomationInput): Promise<AutomationView>;
  delete(automationId: string): Promise<void>;
  runNow(automationId: string): Promise<AutomationRunView>;
}
```

`CreateAutomationInput` requires name, workspaceId, providerId, model, schedule, prompt, and status.

`UpdateAutomationInput` requires `automationId` and allows partial edits.

All IPC payloads must be validated with Zod in the main process.

## Renderer Flow

### Automations Page

Components:

- `AutomationsPage`
- `AutomationList`
- `AutomationEditor`
- `AutomationRunHistory`

The page owns loading, save, error, and selected automation state. It uses the existing API pattern from Models and MCP & Skills.

### Proposal Card

Add a timeline item for automation proposals:

```ts
type TimelineItem =
  | ...
  | { type: "automation-proposal"; id: string; proposal: AutomationProposalView };
```

The card actions:

- `Create automation`: calls `automations.create()`.
- `Cancel`: dismisses the proposal locally.

If create succeeds, the card changes to a created state or shows a success notice.

## Agent Prompting

The model should know that it can propose automations but cannot create them directly.

Add the tool schema and include guidance in the system prompt:

```text
If the user asks for a recurring or scheduled task, use automation.proposeCreate to draft an automation for user confirmation. Do not claim the automation has been created until the user confirms the proposal.
```

The tool should be available in normal turns, including turns with active skills.

## Security And Permissions

Automations are unattended agent runs. V1 should keep behavior conservative:

- Automations use the global command execution mode.
- If the mode requires confirmation during a background automation, the run waits for the same permission UI.
- If no user responds before the permission timeout, the command is denied and the run fails normally.
- The Automations page should warn that automations run only while StoryForge is open and the machine is awake.
- Created automations start as active only after explicit user confirmation.

V1 should not force `无缰模式` or bypass command permission behavior.

## Error Handling

- Invalid cron: show validation error, do not save.
- Missing workspace: block save with an error.
- Missing provider/model: block save with an error.
- App restart during run: mark the run failed or skipped with reason `application-restarted`.
- Automation deleted while running: let the active run finish, then do not reschedule.
- Workspace removed: pause the automation or mark runs failed with `workspace-not-found`.
- Provider API key missing: run fails with the same provider resolution error as a normal turn.
- Overlapping due time: record skipped run with `previous-run-still-active`.

## Testing

Main process tests:

- Repository defaults to empty automation list.
- Create/update/delete automation definitions.
- Validate cron and timezone.
- Interpret schedule returns validated cron or a clear error.
- Scheduler computes next run and triggers due automation.
- Scheduler skips overlapping runs.
- Runner creates a session and starts an agent turn.
- App restart recovery marks running runs failed or skipped.
- Proposal tool emits `automation.proposal` and does not persist.

Renderer tests:

- Navigation shows `Automations`.
- Automations page lists tasks.
- Create form validates schedule and saves.
- Pause/resume/delete actions call IPC.
- Run now creates a run row.
- Chat proposal card renders from `automation.proposal`.
- Confirming a proposal saves an automation.
- Canceling a proposal dismisses it without saving.

Integration-style tests:

- A due automation creates a new session with the configured prompt.
- A scheduled run appears in session sidebar after completion.

Run:

```bash
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/desktop test
corepack pnpm typecheck
```

## V2 Design Hooks

V1 should keep these extension points explicit:

- `kind: "scheduled_chat"` can later add `thread_heartbeat`.
- `executionTarget` can later distinguish `new_session`, `existing_session`, and `worktree`.
- `runHistory` can later feed an inbox or triage page.
- `AutomationRunner` can later run in isolated worktrees.
- The proposal card path can later reuse a general `askUser` framework.

## References

- Codex Automations: `https://developers.openai.com/codex/app/automations`
- Codex non-interactive automation patterns: `https://developers.openai.com/codex/noninteractive`
- Claude Code scheduled tasks: `https://code.claude.com/docs/en/scheduled-tasks`
- Claude Code desktop scheduled tasks: `https://code.claude.com/docs/en/desktop-scheduled-tasks`
- Claude Code GitHub Actions: `https://code.claude.com/docs/en/github-actions`

## AskUser Positioning

A general `askUser` tool is valuable but should not block Automations V1.

`askUser` requires AgentLoop pause/resume semantics:

1. Model calls `askUser`.
2. Renderer asks the user.
3. Turn enters `waiting_for_user`.
4. User answers.
5. AgentLoop resumes with the answer as a tool result.

Automations V1 only needs a narrower confirmation flow, so it should implement `automation.proposeCreate` first. The broader `askUser` tool belongs in V2 or a dedicated V1.5 spec.

## Open Decisions Resolved

- V1 runs only while the desktop app is open.
- V1 creates a new session for each scheduled run.
- V1 supports both Automations page creation and chat-based proposals.
- The model can propose but not directly create automations.
- Natural-language schedule conversion is useful but must be validated before save.
- V2 will cover heartbeat, worktree isolation, inbox, and general `askUser`.
- V3 cloud/background execution is out of scope.
