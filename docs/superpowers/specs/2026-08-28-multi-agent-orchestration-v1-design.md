# Multi-Agent Orchestration V1 Design

## Document Status

- **Status:** Implemented on `codex/multi-agent-development-plan`; pending review
- **Date:** 2026-08-28
- **Repository baseline:** `origin/main` at
  `245d4169029009b248603e6bec3e611598b59a7f`
- **Implementation plan:**
  [`../plans/2026-08-28-multi-agent-orchestration-v1.md`](../plans/2026-08-28-multi-agent-orchestration-v1.md)

This document describes the first production-shaped multi-agent capability for
StoryForge. It is intentionally limited to a root supervisor delegating bounded,
read-only work to isolated PI workers. It does not describe a peer-to-peer agent
team or parallel code-writing system.

## Goal

Allow the active StoryForge agent to delegate up to four independent research or
review tasks to isolated child agents, execute at most two children concurrently
for a turn, and synthesize their structured results in the root conversation.

The feature must preserve StoryForge's existing product boundaries:

- The root agent remains the only author in the user-facing conversation.
- StoryForge, rather than PI or the model, owns scheduling, persistence,
  cancellation, tool policy, resource cleanup, event identity, and UI state.
- Every child has a fresh context and a separate PI transcript.
- Children cannot mutate the workspace or external state.
- A failed child does not discard successful sibling results.
- Reloading the app preserves the run tree and completed results without claiming
  that an interrupted child resumed.

## Success Criteria

V1 is complete when all of the following are true:

1. The root PI session can call one synchronous `agent_delegate` tool with one to
   four tasks.
2. StoryForge runs eligible child tasks with a per-turn concurrency of two and a
   global child capacity of four.
3. Each child uses its own `SessionManager` and JSONL transcript and never opens
   the root or a sibling transcript.
4. Child tool discovery exposes only `read`, `grep`, `find`, `ls`,
   `current_time`, enabled read-only web tools, and internal `agent_report`.
5. Child executions, results, usage, and terminal state are persisted before
   corresponding terminal events are emitted.
6. Stopping the root turn cancels queued and running descendants and releases all
   PI subscriptions, timers, and tool resources.
7. The renderer shows a nested run tree in the workspace context panel while the
   main conversation shows only the root stream and one delegate summary card.
8. After application restart, completed children remain visible and any
   `queued` or `running` execution is shown as `interrupted`; V1 does not resume
   it automatically.

## Current StoryForge Baseline

The baseline is a PI-backed single-agent runtime:

- `StoryForgeAgentHarness` owns active turns, PI session creation, PI event
  mapping, permissions, human input, Extension UI, MCP lifetime, todo syncing,
  and final Session status.
- `reservedSessions` allows different StoryForge Sessions to run concurrently
  but rejects two active turns in the same Session.
- A StoryForge Session stores one `piSessionId` and one `piSessionFile`.
- `createStoryForgeAgentSession()` always enables PI's full built-in tool set:
  `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
- Every root turn currently loads enabled Skills, all enabled MCP servers, the PI
  todo extension, current-time/web/automation/human-input tools, and optional
  Soul context and update tooling.
- `AgentEvent` values carry `sessionId` and `turnId`, but no execution identity,
  parent identity, or global event sequence.
- Renderer runtime state is keyed primarily by Session ID and represents one
  `TurnRuntime` in the right panel.
- `SessionTask` intentionally models a user-visible plan, including a current
  single-`in_progress` invariant. It is not safe as a concurrent worker ledger.

The existing `packages/extensions/src/subagents` module contains only placeholder
types. The previously merged branch named `codex/subagent-integration` did not
add delegation, child sessions, scheduling, persistence, events, IPC, or UI.

The newest baseline also contains persistent StoryForge Soul support. Soul remains
a root-only personalization facility in V1. Children receive neither the Soul
document nor `soul_propose_update`.

## Resolved Product Decisions

| Question | V1 decision |
|---|---|
| User-facing speaker | Root agent only |
| Orchestration pattern | Supervisor with synchronous batch fan-out/fan-in |
| Activation | `agent_delegate` is available by default in every root turn |
| Child roles | Built-in `explorer` and `reviewer` |
| Model | Inherit the exact provider/model selected for the root turn |
| Context | Fresh child context plus explicit task and project context files |
| Child mutations | Prohibited |
| Shell | Not available |
| MCP | Not loaded |
| Skills/extensions | User/project Skills and extensions are not loaded |
| Soul | Not read or updated by children |
| Transcript | Independent persisted PI JSONL per child execution |
| Failure aggregation | `Promise.allSettled` semantics with partial results |
| Restart | Persist and mark unfinished work interrupted; no resume |
| UI | Root timeline summary plus right-panel execution tree |
| Retry | No automatic retry; a future retry creates a new execution ID |

## Non-Goals

V1 does not include:

- Asynchronous `spawn`, `status`, `wait`, `followup`, or `cancel-child` tools.
- Recursive delegation or a delegation depth greater than one.
- Peer messaging, mailboxes, shared chat history, leader election, or self-claiming
  tasks.
- Child writes, Shell commands, test execution, worktrees, branches, merges, or
  file leases.
- User-authored or repository-authored Agent Markdown profiles.
- Child MCP, todo, automation, ask-user, Extension UI, permission requests,
  custom Skills, custom prompt templates, or StoryForge Soul.
- Provider-native multi-agent APIs as the product-level state model.
- Process, container, VM, or operating-system isolation. V1 workers run in the
  Electron main process with isolated PI sessions.
- Durable checkpoint resume or automatic retry after application restart.
- Replacing `SessionTask` with a worker queue or adding task DAG/lease semantics.
- A complete historical replay of every child token. The durable surface is the
  run snapshot, structured report, usage, and PI transcript.

## Terminology and Identity

### Session

The existing user-visible StoryForge conversation. It retains one authoritative
root PI transcript.

### Turn / Agent Run

One user request and all root/child work caused by it. `TurnId` remains the
product-level run identifier so existing Session and automation behavior does not
gain a second competing run ID.

### Agent Execution

One concrete attempt by one root or child agent. An execution has exactly one PI
session, one role, one parent (except root), one status, and one usage record.
Manual retry is outside V1, but the schema includes `attempt`; a later retry must
create a new `AgentExecutionId` and preserve the failed attempt.

### IDs

IDs use `createId()` from `@story-forge/shared`:

```ts
export type AgentExecutionId = `sf_agent_execution_${string}`;
export type AgentEventId = `sf_agent_event_${string}`;
```

The root execution is created before `runtime.started`. Child execution IDs are
created by StoryForge while validating `agent_delegate`; the model cannot choose
or reuse them.

## Target Architecture

```text
Electron renderer
  ├─ root conversation timeline
  └─ AgentRun tree / snapshot hydration
             │ IPC + sequenced AgentEvent values
Electron main
  └─ AgentCoordinator
       ├─ root-turn lifecycle and Session reservation
       ├─ AgentRunRepository
       ├─ RunAdmissionController
       ├─ cancellation tree and budgets
       ├─ root StoryForge/PI worker
       └─ child PiAgentWorker (0..4)
            ├─ independent SessionManager + JSONL
            ├─ isolated resource policy
            ├─ read-only workspace guard
            └─ structured agent_report
```

PI remains the execution kernel for each individual agent. StoryForge owns the
multi-agent control plane. No second agent framework is introduced.

## Shared Contracts

The final implementation may split these types across files, but their public
semantics are fixed by this design.

### Roles and Status

```ts
export type AgentRole = "root" | "explorer" | "reviewer";

export type AgentExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
```

`interrupted` is only produced by recovery. A normal abort is `cancelled`.

### Usage

```ts
export type AgentExecutionUsage = {
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};
```

PI-reported usage is authoritative. Missing fields are stored as zero rather than
omitted so aggregation is deterministic. V1 records token and cost usage but does
not impose a hard token or currency limit; hard enforcement covers concurrency,
turns, tool calls, wall time, depth, and result size.

### Delegation Input

The model-visible tool input is intentionally smaller than the internal worker
configuration:

```ts
export type DelegateTaskInput = {
  role: "explorer" | "reviewer";
  objective: string;
  scope?: string[];
  constraints?: string[];
  expectedOutput?: string;
};

export type AgentDelegateInput = {
  tasks: DelegateTaskInput[]; // min 1, max 4
};
```

The model cannot provide a provider, model, cwd, tool list, timeout, concurrency,
depth, transcript path, or permission mode. `scope` contains workspace-relative
hints; it is validated and normalized but never changes the worker cwd.

### Structured Report and Tool Result

```ts
export type AgentEvidence = {
  path?: string;
  line?: number;
  detail: string;
};

export type AgentReport = {
  summary: string;
  findings: string[];
  evidence: AgentEvidence[];
  filesInspected: string[];
  unresolved: string[];
};

export type DelegateTaskResult = {
  executionId: AgentExecutionId;
  role: "explorer" | "reviewer";
  status: Exclude<AgentExecutionStatus, "queued" | "running" | "interrupted">;
  report?: AgentReport;
  error?: string;
  usage: AgentExecutionUsage;
  truncated: boolean;
};

export type DelegateResult = {
  status: "completed" | "partial" | "failed" | "cancelled";
  results: DelegateTaskResult[]; // same order as input tasks
};
```

Child `agent_report` validates this structure and stores the latest valid report.
The child prompt requires exactly one final report call. If no valid report was
captured, the worker creates a fallback report whose `summary` is the last
assistant text and whose remaining arrays are empty.

The serialized report stored in the run snapshot and returned to the root is
capped at 16 KiB of UTF-8. StoryForge truncates fields deterministically and sets
`truncated: true`; the independent PI transcript remains available for debugging.

### Agent Execution and Run Views

```ts
export type AgentExecutionView = {
  id: AgentExecutionId;
  parentExecutionId?: AgentExecutionId;
  role: AgentRole;
  objective: string;
  status: AgentExecutionStatus;
  attempt: number;
  providerId: string;
  model: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  usage: AgentExecutionUsage;
  report?: AgentReport;
  error?: string;
  truncated?: boolean;
};

export type AgentRunView = {
  schemaVersion: 1;
  sessionId: SessionId;
  turnId: TurnId;
  rootExecutionId: AgentExecutionId;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  executions: AgentExecutionView[];
};
```

Internal records may include `transcriptFile` and cleanup metadata. The IPC view
must be explicitly mapped and must never expose absolute transcript paths.

## Event Model

Every `AgentEvent` receives a common envelope:

```ts
export type AgentEventEnvelope = {
  eventId: AgentEventId;
  sequence: number;
  occurredAt: string;
  sessionId: SessionId;
  turnId: TurnId;
  agentExecutionId: AgentExecutionId;
  parentAgentExecutionId?: AgentExecutionId;
};
```

`sequence` is monotonic across the entire Turn, not per child. A coordinator-owned
sequencer decorates root and child events before they reach IPC. Existing event
payloads remain recognizable, but `runtime.started` uses `occurredAt` instead of
its current one-off `createdAt` field.

New lifecycle events are:

```ts
type AgentExecutionQueuedEvent = AgentEventEnvelope & {
  type: "agent.execution.queued";
  role: "explorer" | "reviewer";
  objective: string;
};

type AgentExecutionStartedEvent = AgentEventEnvelope & {
  type: "agent.execution.started";
};

type AgentExecutionCompletedEvent = AgentEventEnvelope & {
  type: "agent.execution.completed";
  usage: AgentExecutionUsage;
  report: AgentReport;
  truncated: boolean;
};

type AgentExecutionFailedEvent = AgentEventEnvelope & {
  type: "agent.execution.failed";
  usage: AgentExecutionUsage;
  error: string;
};

type AgentExecutionCancelledEvent = AgentEventEnvelope & {
  type: "agent.execution.cancelled";
};
```

Child PI message/tool events reuse existing `message.delta`, `tool.call`,
`tool.result`, `context.usage`, and related event types with the child envelope.
The renderer does not append those events to the root conversation.

There is no recovery-time `agent.execution.interrupted` broadcast because no
window exists during startup. Hydration reads `interrupted` from the snapshot.

For any terminal transition, StoryForge follows this order:

1. Update the in-memory execution.
2. Atomically persist the run snapshot.
3. Persist the root Session status when the root is terminal.
4. Emit the sequenced terminal event.

A persistence failure is an infrastructure error. StoryForge must not emit a
successful terminal event for state it failed to persist.

## Persistence

`resolveStoryForgePaths()` gains:

```ts
agentRunsDir: join(rootDir, "sessions", "agent-runs");
agentTranscriptsDir: join(rootDir, "sessions", "agent-transcripts");
```

### Run Snapshot

Each Turn has one atomic JSON snapshot:

```text
<storyforge-home>/sessions/agent-runs/<sessionId>/<turnId>.json
```

`AgentRunRepository` validates snapshots with Zod, uses `writeJsonAtomic`, and
serializes read-modify-write operations per `TurnId`. The snapshot contains the
internal execution records, current sequence, reports, usage, and timestamps.

The repository provides, at minimum:

- `createRun(...)`
- `getRun(turnId)`
- `updateExecution(turnId, executionId, updater)`
- `addExecutions(turnId, executions)`
- `recoverInterruptedRuns()`
- `deleteSessionRuns(sessionId)`
- `toView(record)`

Because the public lookup is `getRun(turnId)` while files are grouped by Session,
the repository builds an in-memory `TurnId -> snapshot path` index by scanning
`agentRunsDir` during initialization/recovery. `createRun()` and
`deleteSessionRuns()` update the index. A duplicate Turn ID is treated as corrupt
state and surfaced rather than resolved by arbitrary directory order.

`recoverInterruptedRuns()` changes every `queued` or `running` execution to
`interrupted`, sets `endedAt`, and preserves completed siblings and reports.

### Child PI Transcripts

Each child receives a dedicated PI session directory:

```text
<storyforge-home>/sessions/agent-transcripts/<workspaceId>/<turnId>/
```

The worker calls `SessionManager.create(workspacePath, directory, {
id: executionId })`. The resulting JSONL filename is stored only in the internal
execution record. No two active workers open the same file.

The internal run record includes `workspaceId` and each execution's
`transcriptFile`; neither field is exposed merely because it exists on disk.

`SessionRepository` receives a narrow `SessionAgentRunStore` dependency whose
`deleteSessionRuns(sessionId)` method is called by `SessionRepository.delete()`.
Deleting a StoryForge Session therefore deletes its run snapshots and every child
transcript referenced by those snapshots before deleting the existing root
transcript and metadata.

### Linking Sessions to the Latest Run

Session metadata gains optional `lastTurnId`. Starting a turn sets both
`currentTurnId` and `lastTurnId`; terminal status clears only `currentTurnId`.
Recovery also retains `lastTurnId`. Existing schema-v2 files without the optional
field remain valid.

This allows the renderer to call `agentRuns.get(session.lastTurnId)` after reload
without turning child executions into sidebar Sessions.

## PI Worker Isolation

### Root Worker

Root behavior remains functionally unchanged: full StoryForge tool policy,
configured Skills/MCP, todo, human input, automation, Soul policy, and existing
permission flow continue to apply. Root additionally receives `agent_delegate`
and delegation guidance in its system prompt.

### Child Worker

`createStoryForgeAgentSession()` becomes policy-driven instead of unconditionally
adding every PI built-in tool. Root uses the current defaults; child passes an
explicit built-in list.

For child resource loading, `DefaultResourceLoader` is configured with:

```ts
{
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: false,
  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  extensionFactories: [runtimeEnvironment, childEventBridge, agentReportBridge],
}
```

PI inline extension factories remain available even when discovered extensions
are disabled. Project context files such as `AGENTS.md` remain loaded. Child does
not receive the root transcript, root Soul append prompt, image attachments,
configured Skills, project/user extensions, todo extension, or MCP tools.

Child built-ins are exactly:

```text
read, grep, find, ls
```

Child StoryForge tools are:

```text
current_time, agent_report
```

If root web access is enabled, the same SSRF-guarded `web_search` and `web_fetch`
tools are added. No other tool is permitted.

The existing workspace guard is bound to child read/search calls. Before V1 ships,
the guard must reject lexical traversal and symlink-based escape for existing
read targets. `scope` values are normalized as workspace-relative paths and are
prompt constraints, never alternate working directories.

### Child Prompt

The child system prompt includes:

- Its built-in role definition.
- The normalized `DelegateTaskInput`.
- The workspace root and explicit read-only rule.
- A prohibition on delegation, user interaction, mutations, and invented tool
  success.
- A requirement to cite repository-relative paths and line numbers when useful.
- A requirement to finish with `agent_report`.

Role intent:

- `explorer`: gather evidence, map relevant files and behavior, and compress
  findings for the root.
- `reviewer`: critically verify a stated design or implementation target and
  report correctness, security, concurrency, and test gaps.

## Scheduling and Budgets

The constants for V1 are not user-configurable:

| Limit | Value |
|---|---:|
| Tasks per `agent_delegate` call | 4 |
| Concurrent children per Turn | 2 |
| Global active children | 4 |
| Delegation depth | 1 |
| Turns per child | 8 |
| Tool calls per child | 40 |
| Wall time per child | 300 seconds |
| Stored/returned report | 16 KiB UTF-8 |
| Automatic retries | 0 |

`RunAdmissionController` observes active root/automation PI sessions but does not
block or queue those existing product paths. A child may start only when:

- its Turn has fewer than two active children;
- global active children are below four; and
- observed root + automation + child activity leaves capacity under the global
  PI target of four.

Root and automation runs have priority. If a new root starts while children are
already running, existing children are not killed, but no new child is admitted
until capacity is available.

Turn and tool-call limits are counted from PI events. Wall time uses a child
AbortController and an unref'd timer. Hitting any limit aborts that child, records
a failed execution with a stable reason, and allows siblings to finish.

## Delegation Flow

1. Root calls `agent_delegate({ tasks })`.
2. The tool validates task count, roles, strings, and workspace-relative scope.
3. Coordinator creates all child execution records as `queued`, persists once,
   then emits queued events in input order.
4. Admission starts up to two children for the Turn.
5. Each start changes one record to `running`, persists it, then emits started.
6. Each child runs a fresh PI session and reports progress with attributed events.
7. Completion/failure/cancellation is persisted before its terminal child event.
8. Queued siblings are admitted until all input tasks settle or root is aborted.
9. Results are ordered like the input, aggregated into `DelegateResult`, and
   returned as the root tool result.
10. Root evaluates the results, performs any root-only mutations, and writes the
    final user-facing response.

`agent_delegate` never throws merely because one child failed. It throws only for
invalid input, a coordinator/persistence failure, or root-turn abort. Aggregate
status is:

- `completed`: every child completed;
- `partial`: at least one completed and at least one failed/cancelled;
- `cancelled`: every child was cancelled;
- `failed`: no child completed and the group was not wholly cancelled.

The root system prompt tells the model to delegate only when tasks are genuinely
independent, such as cross-package discovery or an independent review. It should
not delegate simple questions, one-file changes, strongly sequential work, or a
single slow external operation.

## Cancellation and Cleanup

An active Turn owns one root AbortController and a set of child controllers.

`turns.stop(turnId)`:

1. Aborts the root controller.
2. Marks queued children cancelled without starting them.
3. Aborts every running child.
4. Calls PI `abort()` and waits for worker settlement.
5. Unsubscribes PI events, clears timers, disposes sessions, and closes any root
   MCP session.
6. Persists child cancellation and final root/Session status before emitting the
   root terminal event.

Cleanup is idempotent. A late PI event after terminal state is ignored by execution
ID and cannot reopen or overwrite a terminal record.

## IPC and Renderer

### IPC

The shared desktop contract gains:

```ts
IPC_CHANNELS.agentRunsGet = "story-forge:agent-runs:get";

StoryForgeApi.agentRuns.get(
  turnId: TurnId,
): Promise<AgentRunView | undefined>;
```

The preload remains a thin `ipcRenderer.invoke` forwarder. The main handler uses
the existing `handle()` helper and a `TurnId` Zod schema. It returns an explicit
view mapping, not the internal record.

No new child-control IPC is added. Live updates continue over
`story-forge:turns:event`.

### Renderer State

Renderer state gains normalized maps:

```ts
agentRuns: Record<TurnId, AgentRunView>;
agentActivities: Record<AgentExecutionId, AgentEvent[]>;
```

Events without `parentAgentExecutionId` are root events and continue to feed the
Session conversation timeline. Child events update only their execution activity
and run tree. A child `runtime` or tool event must never clear root active-turn,
permission, Extension UI, or human-input state.

When a Session is selected, the renderer loads `agentRuns.get(lastTurnId)` when
`lastTurnId` exists. Live terminal events update the local view, followed by a
snapshot refresh to reconcile durable state.

### UI

The existing Run card in `RunContextPanel` gains an Agent tree:

- Root row at the top.
- Indented child rows in creation order.
- Role, compact objective, status, elapsed time, tool count, and usage.
- Expanded terminal row shows summary, findings/evidence links, unresolved items,
  truncation, and error text.

The root timeline continues to show normal root messages and tools. The
`agent_delegate` tool call/result receives a specialized summary card containing
task counts and aggregate status. Raw child messages and reasoning are not copied
into the main chat.

## Error and Recovery Semantics

| Failure | Required behavior |
|---|---|
| Invalid delegate input | Reject before creating executions |
| Run snapshot cannot be created | Start no child; fail root tool |
| Child PI creation fails | Mark only that child failed; continue siblings |
| Child timeout/limit | Abort and mark failed with stable reason |
| Child report invalid/missing | Use fallback last-text report |
| One or more children fail | Return partial/failed aggregate without throwing |
| Root is stopped | Cancel queued/running children and propagate abort |
| Snapshot terminal write fails | Do not emit a successful terminal event |
| App exits mid-run | Startup recovery marks unfinished nodes interrupted |
| Snapshot corrupt | Quarantine file and surface an unavailable/error view |
| Late event after terminal | Ignore; terminal status is immutable |

No child can ask the user for help in V1. If its task lacks required context, it
reports the gap in `unresolved`.

## Observability

The run snapshot and UI expose per-execution:

- Role/model/provider.
- Created/started/ended timestamps.
- Status and stable failure reason.
- Turns, tool calls, token/cache usage, and reported cost.
- Structured report and truncation.

Logs include `sessionId`, `turnId`, and `agentExecutionId`; they must not print
credentials, full Soul contents, or absolute transcript paths in renderer events.

## Testing Strategy

### Shared Contracts

- ID creation and status/type guards.
- Event envelope presence and terminal-event classification.
- Delegate task/result shape and stable input ordering.

### Persistence

- Atomic create/update/read of run snapshots.
- Per-Turn serialization under concurrent child completion.
- `queued`/`running` recovery to `interrupted` while preserving completed nodes.
- Corrupt snapshot quarantine.
- Internal transcript path omitted from `AgentRunView`.
- Session `lastTurnId` behavior and Session deletion cleanup.

### PI Isolation

- Root retains its current tool/resource set.
- Child exposes only the approved tools.
- Child has no write/edit/bash/todo/automation/ask-user/MCP/Soul/Skills.
- Every child receives a unique session file outside the root transcript.
- Workspace traversal and symlink escape are rejected.

### Scheduling

- Maximum four tasks and two concurrently running children per Turn.
- Maximum four children globally with root/automation activity reducing available
  child capacity.
- Input-order results despite out-of-order completion.
- Turn/tool/time/result limits.
- Partial results, no automatic retry, and deterministic aggregate status.
- Root cancellation reaches queued and running descendants and cleans resources.

### IPC and Renderer

- Zod validation for `agentRuns.get`.
- Preload forwarding and explicit DTO mapping.
- Snapshot hydration from `lastTurnId`.
- Child events do not enter the root timeline or terminate root UI state.
- Delegate summary and nested execution tree render all terminal states.

All PI sessions, clocks, timers, and fetches are injected or mocked in tests. Tests
must not contact real model providers, web providers, or MCP servers.

## Rollout

The tool is registered by default after the implementation lands; there is no
feature flag in V1. Safety comes from strict role/tool policy and bounded execution,
not a runtime toggle.

Before merging, evaluate representative tasks in three groups:

1. Simple/single-file work where Root should avoid delegation.
2. Independent exploration/review where delegation should improve coverage.
3. Adversarial requests attempting to grant Child write, Shell, MCP, alternate
   cwd, nested delegation, or user-interaction capability.

If Root over-delegates simple tasks, adjust system-prompt heuristics before
changing the product contract.

## Future Phases

Later designs may add, in order:

1. Async background handles and user-driven retry/follow-up.
2. Task dependency, assignment, revision, and lease semantics.
3. Writer agents isolated in git worktrees with explicit diff review and merge.
4. Trusted user/project Agent profiles and read-only MCP capability metadata.
5. Bounded nested delegation, best-of-N, or peer-team experiments.
6. Provider-native multi-agent execution as an implementation optimization behind
   the same StoryForge run contracts.

None of these future items changes the V1 rule that StoryForge owns durable run,
permission, workspace, and UI state.

## Acceptance Checklist

- [ ] Root is the only user-facing speaker and default workspace writer.
- [ ] `agent_delegate` supports one to four ordered tasks and partial results.
- [ ] Every Child has a unique PI `SessionManager` and transcript.
- [ ] Child has the exact approved read-only tool/resource set.
- [ ] Run state and terminal ordering survive reload without false completion.
- [ ] Concurrency, depth, turn, tool, time, result, and retry limits are enforced.
- [ ] Root cancellation settles and disposes every descendant.
- [ ] Event attribution prevents child output from corrupting root UI state.
- [ ] Right-panel tree and main-timeline summary hydrate from durable state.
- [ ] No obsolete pre-PI runtime architecture from earlier design documents is
  introduced.
