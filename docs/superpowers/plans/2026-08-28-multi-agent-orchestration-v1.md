# Multi-Agent Orchestration V1 Implementation Plan

> Execute this plan task-by-task. Each task starts with a failing test or contract
> check, implements only the behavior required by that task, and finishes with the
> listed verification before moving on.

**Goal:** Add a production-shaped, read-only multi-agent MVP in which the root
StoryForge agent synchronously delegates one to four independent exploration or
review tasks to isolated PI child sessions, then synthesizes their structured
results.

**Architecture:** StoryForge remains the multi-agent control plane. A real
`AgentCoordinator` owns the Turn execution tree, durable run snapshots, admission,
budgets, event sequencing, and cancellation. Root and child execution use PI as a
single-agent kernel, but every child has a separate `SessionManager`, transcript,
resource policy, and read-only tool set.

**Tech Stack:** TypeScript ESM, Node `>=22.19.0`, PI coding agent 0.82.1, Zod,
Electron IPC, React 19, Tailwind, Vitest, pnpm 10.11.0, Turborepo.

**Repository baseline:** `origin/main` at
`245d4169029009b248603e6bec3e611598b59a7f`.

**Design reference:**
[`../specs/2026-08-28-multi-agent-orchestration-v1-design.md`](../specs/2026-08-28-multi-agent-orchestration-v1-design.md)

## Scope Guardrails

- Root remains the only user-facing speaker and the only workspace writer.
- `agent_delegate` is synchronous and available by default to root sessions.
- Child roles are only `explorer` and `reviewer`; they inherit the root turn's
  resolved provider/model.
- Child tools are only `read`, `grep`, `find`, `ls`, `current_time`, optional
  enabled read-only web tools, and internal `agent_report`.
- Child does not load Shell, write/edit, MCP, todo, automation, ask-user,
  Extension UI, Soul, user/project extensions, Skills, or prompt templates.
- V1 has no async handles, recursive delegation, retry, writer/worktree mode,
  peer team, custom Agent profiles, or automatic restart resume.
- `SessionTask` remains root-owned and is not reused as a concurrent worker
  ledger.

## Target File Structure

Exact exports may be co-located where the existing package convention requires,
but the implementation should converge on this structure:

```text
packages/shared/src/
  agent-runs.ts
  events.ts

packages/agent/src/
  persistence/agent-run-repository.ts
  persistence/storyforge-home.ts
  pi/create-storyforge-session.ts
  pi/pi-session-adapter.ts
  pi/storyforge-tool-adapter.ts
  runtime/agent-coordinator.ts
  runtime/agent-definitions.ts
  runtime/pi-agent-worker.ts
  runtime/run-admission-controller.ts
  runtime/storyforge-agent-harness.ts

packages/extensions/src/subagents/
  agent-delegate-tool.ts
  agent-report-tool.ts
  index.ts

apps/desktop/src/
  shared/story-forge-api.ts
  preload/index.ts
  main/ipc-handlers.ts
  main/main.ts
  renderer/hooks/use-app-controller.ts
  renderer/components/agent-run-tree.tsx
  renderer/components/run-context-panel.tsx
  renderer/components/conversation-timeline.tsx
  renderer/utils/timeline.ts
```

Tests stay in the existing `src/__test__` or renderer component test directories.

---

## Task 1: Runtime Baseline and Terminal Correctness

**Purpose:** Align the supported Node version with the installed PI package and
make the existing single-agent terminal/outcome path trustworthy before child
execution depends on it.

**Files:**

- Modify: `package.json`
- Create: `packages/agent/src/runtime/turn-outcome.ts`
- Modify: `packages/agent/src/runtime/storyforge-agent-harness.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/__test__/storyforge-agent-harness.test.ts`
- Modify: `apps/desktop/src/main/automation-scheduler.ts`
- Modify: `apps/desktop/src/main/__test__/automation-scheduler.test.ts`

- [ ] **Step 1: Verify and update the Node baseline**

Run:

```bash
node -v
corepack pnpm --version
```

Expected before implementation: Node may be older than PI 0.82.1's declared
`>=22.19.0` engine even though the root package currently accepts `>=22.12.0`.

Change the root `engines.node` to `>=22.19.0`. Use a Node 22 release at or above
22.19 for all remaining commands. Do not change pnpm or replace Corepack.

- [ ] **Step 2: Add failing terminal-order and outcome tests**

In `storyforge-agent-harness.test.ts`, add tests that use injected PI sessions and
a deferred/fake Session repository to prove:

1. `runtime.completed` is not emitted until the terminal Session status write has
   resolved.
2. An execution error produces a persisted error/stopped state before the
   terminal event.
3. `waitForTurn(turnId)` returns a durable `TurnOutcome` instead of `void`.
4. A stopped turn returns `status: "stopped"` and `stopReason: "user-stopped"`.

Define the target contract in `turn-outcome.ts`:

```ts
export type TurnOutcome = {
  status: "completed" | "stopped" | "error";
  stopReason: AgentStopReason;
  steps: number;
  error?: string;
};
```

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/storyforge-agent-harness.test.ts
```

Expected: **FAIL** because terminal events currently precede `markStatus()` and
`waitForTurn()` returns `void`.

- [ ] **Step 3: Add a failing Automation outcome test**

Extend `automation-scheduler.test.ts` so a coordinator returning an error
`TurnOutcome` marks the Automation run failed rather than completed.

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- src/main/__test__/automation-scheduler.test.ts
```

Expected: **FAIL** because the scheduler currently treats any resolved
`waitForTurn()` as success.

- [ ] **Step 4: Implement durable terminal ordering**

Change `turnPromises` to store `Promise<TurnOutcome>` and make `executeTurn()`
return the outcome it persists. On both success and failure:

1. Compute the final outcome.
2. Persist Session status.
3. Emit the terminal runtime event.
4. Resolve the Turn promise with the same outcome.

If terminal persistence fails, do not emit a successful completion. Preserve the
original error as `cause` where possible and return/emit an unrecoverable error.

Update `AutomationScheduler` to branch on `TurnOutcome.status` and persist the
corresponding Automation result.

- [ ] **Step 5: Verify Task 1**

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/storyforge-agent-harness.test.ts
corepack pnpm --filter @story-forge/desktop test -- src/main/__test__/automation-scheduler.test.ts
corepack pnpm --filter @story-forge/agent typecheck
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: **PASS**. Existing interactive and Automation success behavior remains
unchanged except for correct persistence ordering and explicit outcomes.

---

## Task 2: Shared Contracts, Run Persistence, and Session Linkage

**Purpose:** Introduce stable execution identity and a durable per-Turn ledger
without putting child attempts into `SessionTask` or exposing internal paths over
IPC.

**Files:**

- Create: `packages/shared/src/agent-runs.ts`
- Create: `packages/shared/src/__test__/agent-runs.test.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/__test__/events.test.ts`
- Create: `packages/agent/src/persistence/agent-run-repository.ts`
- Create: `packages/agent/src/__test__/agent-run-repository.test.ts`
- Modify: `packages/agent/src/persistence/storyforge-home.ts`
- Modify: `packages/agent/src/__test__/storyforge-home.test.ts`
- Modify: `packages/agent/src/persistence/session-repository.ts`
- Modify: `packages/agent/src/__test__/session-repository.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add failing shared-contract tests**

Write tests for:

- `AgentExecutionId` and `AgentEventId` creation via `createId()`.
- The roles/statuses and public views fixed in the design.
- `DelegateResult.results` preserving input order.
- Every `AgentEvent` variant carrying `eventId`, `sequence`, `occurredAt`,
  `agentExecutionId`, and optional `parentAgentExecutionId`.
- Existing root terminal guards still recognizing only root
  `runtime.completed`/`runtime.error` events.

Run:

```bash
corepack pnpm --filter @story-forge/shared test -- src/__test__/agent-runs.test.ts src/__test__/events.test.ts
```

Expected: **FAIL** because the types/helpers and common event envelope do not yet
exist.

- [ ] **Step 2: Implement shared types and event envelope**

Add the exact public semantics from the design:

- `AgentExecutionId`, `AgentEventId`, `AgentRole`, `AgentExecutionStatus`.
- Usage, evidence, report, execution, run, delegate input, and delegate result
  types.
- `AgentEventEnvelope` and child lifecycle events.

Refactor event payloads as intersections with the common envelope. Replace the
root-start-only `createdAt` timestamp with `occurredAt`; update tests and callers
rather than adding a compatibility shim.

Build shared before testing dependents:

```bash
corepack pnpm --filter @story-forge/shared build
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/shared typecheck
```

Expected: **PASS**.

- [ ] **Step 3: Add failing path and repository tests**

Using `tmpdir()` and per-test directories, specify:

1. `resolveStoryForgePaths()` returns `agentRunsDir` and
   `agentTranscriptsDir` under `<root>/sessions/`.
2. A run snapshot is created at
   `agent-runs/<sessionId>/<turnId>.json` and validates through Zod.
3. Concurrent updates for one Turn are serialized without lost child results.
4. Updating one execution cannot overwrite a completed sibling.
5. Recovery maps only `queued`/`running` to `interrupted` and preserves completed
   results and usage.
6. Corrupt JSON is quarantined.
7. `toView()` strips `transcriptFile` and any absolute internal paths.
8. Repository initialization rebuilds `TurnId -> snapshot path` lookup after a
   simulated restart and rejects duplicate Turn IDs.
9. Session metadata retains optional `lastTurnId` after terminal and recovery.
10. Deleting a Session removes its run snapshots and referenced child
    transcripts.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/agent-run-repository.test.ts src/__test__/storyforge-home.test.ts src/__test__/session-repository.test.ts
```

Expected: **FAIL** because the run repository, paths, and `lastTurnId` do not yet
exist.

- [ ] **Step 4: Implement `AgentRunRepository`**

Use Zod schemas, `readJsonOrQuarantine()`, and `writeJsonAtomic()`. Keep a
per-`TurnId` update-tail Map following the Session repository pattern. Implement:

```ts
createRun(input): Promise<AgentRunRecord>;
getRun(turnId): Promise<AgentRunRecord | undefined>;
addExecutions(turnId, executions): Promise<AgentRunRecord>;
updateExecution(turnId, executionId, updater): Promise<AgentRunRecord>;
recoverInterruptedRuns(): Promise<void>;
deleteSessionRuns(sessionId): Promise<void>;
toView(record): AgentRunView;
```

Store internal transcript references in records but never views. Terminal
execution statuses are immutable; a late update must be ignored or rejected.
Since snapshots are grouped by Session but IPC lookup uses only `TurnId`, scan the
run directory on initialization/recovery to build an in-memory Turn index. Update
the index on create/delete and fail deterministically on duplicate IDs.

- [ ] **Step 5: Add `lastTurnId` and cleanup ownership**

Add optional `lastTurnId` to Session metadata and desktop view mapping without
changing existing Session IDs or root transcripts:

- Start: set `currentTurnId` and `lastTurnId`.
- Terminal: clear `currentTurnId`, retain `lastTurnId`.
- Restart recovery: retain `lastTurnId`.

Define a narrow `SessionAgentRunStore` port in the agent package, inject it into
`SessionRepository`, and call `deleteSessionRuns(sessionId)` from
`SessionRepository.delete()` before deleting the root PI transcript and metadata.
`AgentRunRepository` implements this port and removes transcripts referenced by
its internal records. Do not make `packages/shared` depend on fs/Node.

- [ ] **Step 6: Verify Task 2**

Run:

```bash
corepack pnpm --filter @story-forge/shared build
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/shared typecheck
corepack pnpm --filter @story-forge/agent test -- src/__test__/agent-run-repository.test.ts src/__test__/storyforge-home.test.ts src/__test__/session-repository.test.ts
corepack pnpm --filter @story-forge/agent typecheck
```

Expected: **PASS**, including existing schema-v2 Session fixtures without
`lastTurnId`.

---

## Task 3: Isolated PI Child Worker and Read-Only Resource Policy

**Purpose:** Make one PI session a reusable worker while preserving the root's
current capabilities and proving that child capabilities are strictly attenuated.

**Files:**

- Modify: `packages/agent/src/pi/create-storyforge-session.ts`
- Modify: `packages/agent/src/__test__/create-storyforge-session.test.ts`
- Modify: `packages/agent/src/pi/pi-session-adapter.ts`
- Modify: `packages/agent/src/__test__/pi-session-adapter.test.ts`
- Create: `packages/agent/src/pi/storyforge-tool-adapter.ts`
- Create: `packages/agent/src/runtime/agent-definitions.ts`
- Create: `packages/agent/src/runtime/pi-agent-worker.ts`
- Create: `packages/agent/src/__test__/pi-agent-worker.test.ts`
- Modify: `packages/extensions/src/workspace/guard.ts`
- Create: `packages/extensions/src/__test__/workspace-guard.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add failing root/child resource-policy tests**

Extend `create-storyforge-session.test.ts` to assert:

- Omitting policy options preserves the full current root built-ins and current
  discovered-resource behavior.
- Child policy selects exactly `read/grep/find/ls` plus explicitly registered
  inline tools.
- Child policy passes `noExtensions`, `noSkills`, `noPromptTemplates`, and
  `noThemes`, keeps project context files enabled, and does not load PI todo.
- Inline factories still bind under the isolated policy.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/create-storyforge-session.test.ts
```

Expected: **FAIL** because `createStoryForgeAgentSession()` currently always adds
the full PI built-in list and has no isolated resource policy.

- [ ] **Step 2: Make PI session creation policy-driven**

Add explicit inputs such as:

```ts
builtInToolNames?: readonly PiBuiltInToolName[];
resourcePolicy?: "root" | "isolated-child";
```

Root defaults must remain byte-for-byte equivalent in capability. For
`isolated-child`, configure `DefaultResourceLoader` with discovery disabled while
retaining project context files and the supplied inline factories. Do not use an
empty `agentDir` as a security assumption; tests must inspect the final loaded
tools/resources.

Extract `toPiToolDefinition()` from the Harness into
`pi/storyforge-tool-adapter.ts` so root and child adapt StoryForge tools through
one implementation.

- [ ] **Step 3: Add failing child-transcript tests**

Extend `pi-session-adapter.test.ts` to create two child execution sessions for the
same Turn and assert:

- Both use the requested workspace cwd.
- Their JSONL paths are distinct.
- Both paths are under
  `sessions/agent-transcripts/<workspaceId>/<turnId>/`.
- Neither equals or opens the root Session's `piSessionFile`.
- Execution IDs determine PI session IDs; paths are sanitized.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/pi-session-adapter.test.ts
```

Expected: **FAIL** because the adapter currently creates only root Session
transcripts under `sessionTranscriptsDir`.

- [ ] **Step 4: Implement child SessionManager creation**

Add a method that returns both the new `SessionManager` and its file reference:

```ts
createAgentExecutionSession(input: {
  workspaceId: string;
  turnId: TurnId;
  executionId: AgentExecutionId;
}): Promise<{ sessionManager: SessionManager; transcriptFile: string }>;
```

Use `SessionManager.create(workspace.path, executionDir, { id: executionId })`.
Never derive child state by opening or forking the active root manager.

- [ ] **Step 5: Add failing worker and path-boundary tests**

Create tests with injected PI sessions, clocks, and tool factories that assert:

- `explorer` and `reviewer` prompts include only their TaskEnvelope and project
  context, not root messages or Soul text.
- Child model is the exact resolved root-turn model.
- Available tools contain the strict allowlist and exclude
  `write/edit/bash/todo/automation/ask_user/soul_propose_update/agent_delegate`
  and all MCP/Skill tools.
- PI turn/tool counters and timeout abort the child at the configured limit.
- Cleanup always unsubscribes, clears the timer, disposes PI, and settles once.
- Lexical `..` and a symlink resolving outside the workspace are blocked for
  child read/search calls.

Run:

```bash
corepack pnpm --filter @story-forge/extensions test -- src/__test__/workspace-guard.test.ts
corepack pnpm --filter @story-forge/agent test -- src/__test__/pi-agent-worker.test.ts
```

Expected: **FAIL** until canonical path checking and the worker exist.

- [ ] **Step 6: Implement definitions and `PiAgentWorker`**

Create immutable built-in definitions for `explorer` and `reviewer`. Implement a
worker that receives the execution/task/model/workspace/signal and injected
read-only StoryForge tools, creates the isolated PI session, subscribes with the
execution identity, enforces 8 turns/40 tools/300 seconds, captures usage/report,
and returns one terminal worker result.

Harden the workspace guard using canonical paths for existing read targets. Keep
the existing root lexical guard behavior compatible while closing symlink escape.

- [ ] **Step 7: Verify Task 3**

Run:

```bash
corepack pnpm --filter @story-forge/extensions test -- src/__test__/workspace-guard.test.ts
corepack pnpm --filter @story-forge/extensions typecheck
corepack pnpm --filter @story-forge/agent test -- src/__test__/create-storyforge-session.test.ts src/__test__/pi-session-adapter.test.ts src/__test__/pi-agent-worker.test.ts
corepack pnpm --filter @story-forge/agent typecheck
```

Expected: **PASS**. Add a negative assertion for every forbidden child tool; do
not rely on an indirect count-only assertion.

---

## Task 4: AgentCoordinator, Admission, Sequencing, and Cancellation Tree

**Purpose:** Replace the current `AgentCoordinator` alias with a real orchestration
boundary that owns root/child identity and lifecycle while keeping the root PI
behavior behind the existing Harness.

**Files:**

- Create: `packages/agent/src/runtime/agent-coordinator.ts`
- Create: `packages/agent/src/runtime/run-admission-controller.ts`
- Create: `packages/agent/src/__test__/agent-coordinator.test.ts`
- Create: `packages/agent/src/__test__/run-admission-controller.test.ts`
- Modify: `packages/agent/src/runtime/storyforge-agent-harness.ts`
- Modify: `packages/agent/src/__test__/storyforge-agent-harness.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/__test__/desktop-entry.test.ts`

- [ ] **Step 1: Add failing admission tests**

Specify a deterministic admission controller with an injected clock/notification
primitive:

- At most two children for one Turn run concurrently.
- At most four children run globally.
- Observed root/automation sessions reduce child capacity beneath the target of
  four, but root/automation starts are never queued or rejected by this new
  controller.
- Waiting children start FIFO by creation order when capacity is released.
- Aborting while queued resolves without starting a PI session.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/run-admission-controller.test.ts
```

Expected: **FAIL** because no admission layer exists.

- [ ] **Step 2: Add failing coordinator lifecycle tests**

Using fake root and child workers, assert:

1. `start()` creates/persists a root execution before `runtime.started`.
2. Every emitted event has one execution ID and a strictly increasing Turn-wide
   sequence, including interleaved child events.
3. Child queued/start/terminal state is persisted before its corresponding event.
4. Root stop cancels queued and running descendants and awaits cleanup.
5. A late child event cannot mutate a terminal execution.
6. Different StoryForge Sessions can still run concurrently; one Session still
   has one root Turn.
7. Child executions receive the root turn's resolved provider/model snapshot even
   if the global default changes during the Turn.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/agent-coordinator.test.ts
```

Expected: **FAIL** because `AgentCoordinator` is currently only a re-exported
alias of `StoryForgeAgentHarness`.

- [ ] **Step 3: Implement the real coordinator boundary**

Move product-level orchestration into `AgentCoordinator`:

- Active Turn/Session reservation.
- Root `AgentExecutionId`, Turn sequencer, and run snapshot creation.
- Root/automation activity observation for admission.
- Child controller registry and cancellation tree.
- Root `start`, `stop`, `waitForTurn`, compact, permission, Extension UI, and
  human-input surface consumed by desktop main.
- Delegation callback supplied to the root Harness/tool factory.

Keep root PI-specific prompt/tool/event mapping in `StoryForgeAgentHarness` and
child PI-specific execution in `PiAgentWorker`. Remove the alias export from
`packages/agent/src/index.ts`; export the actual class and options.

Do not make the coordinator a second model loop. It schedules workers and maps
durable state; PI continues to own each agent's LLM/tool loop.

- [ ] **Step 4: Implement event sequencing and terminal immutability**

Give each active Turn one sequencer. Decorate all root/child events centrally.
Sequence allocation is in memory during the live Turn; lifecycle writes persist
the latest sequence. Since V1 never resumes interrupted execution, recovery does
not emit new events into an old sequence.

Persist lifecycle state before emitting terminal events. Ignore events from a
disposed worker or terminal execution.

- [ ] **Step 5: Wire main-process construction and recovery**

In `main.ts`:

1. Construct `AgentRunRepository` from StoryForge paths.
2. Recover interrupted Session and Agent run state before opening a window.
3. Construct `RunAdmissionController`, root Harness/worker factory, and real
   `AgentCoordinator`.
4. Preserve existing Automation, permission, Skills, MCP, Web, Soul, and provider
   injections for root turns.

- [ ] **Step 6: Verify Task 4**

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/run-admission-controller.test.ts src/__test__/agent-coordinator.test.ts src/__test__/storyforge-agent-harness.test.ts
corepack pnpm --filter @story-forge/agent typecheck
corepack pnpm --filter @story-forge/desktop test -- src/main/__test__/desktop-entry.test.ts
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: **PASS** with the existing desktop coordinator call surface preserved.

---

## Task 5: Synchronous `agent_delegate` and Structured `agent_report`

**Purpose:** Expose the bounded supervisor workflow to the root model without
exposing model-controlled policy fields or child failures as all-or-nothing tool
errors.

**Files:**

- Replace: `packages/extensions/src/subagents/index.ts`
- Create: `packages/extensions/src/subagents/agent-delegate-tool.ts`
- Create: `packages/extensions/src/subagents/agent-report-tool.ts`
- Create: `packages/extensions/src/__test__/agent-delegate-tool.test.ts`
- Create: `packages/extensions/src/__test__/agent-report-tool.test.ts`
- Modify: `packages/extensions/src/index.ts`
- Modify: `packages/agent/src/runtime/storyforge-agent-harness.ts`
- Modify: `packages/agent/src/pi/create-storyforge-session.ts`
- Modify: `packages/agent/src/__test__/create-storyforge-session.test.ts`
- Modify: `packages/agent/src/__test__/agent-coordinator.test.ts`

- [ ] **Step 1: Add failing tool-contract tests**

For `agent_delegate`, prove:

- `tasks` accepts one to four entries and rejects zero/five.
- Role is only `explorer` or `reviewer`.
- Objective is required and non-blank.
- `scope`, `constraints`, and `expectedOutput` accept only bounded strings.
- Provider, model, cwd, tools, permissions, budget, depth, and transcript path are
  absent from the JSON schema and ignored/rejected if smuggled into a task.
- The tool delegates once through an injected callback and returns its structured
  result.

For `agent_report`, prove valid normalization, path/line validation, deterministic
16 KiB truncation, and rejection of malformed evidence.

Run:

```bash
corepack pnpm --filter @story-forge/extensions test -- src/__test__/agent-delegate-tool.test.ts src/__test__/agent-report-tool.test.ts
```

Expected: **FAIL** because only placeholder subagent types exist.

- [ ] **Step 2: Implement tool factories**

Follow the repository `ToolDefinition` convention: raw JSON Schema, manual input
validation with shared record/string helpers, injected callback, and AbortSignal
propagation.

`agent_report` stores the latest valid report in an execution-local collector and
returns an acknowledgement. It is never registered on root.

`agent_delegate` is registered only on root. It never accepts a working directory
or tool/model policy from model input.

- [ ] **Step 3: Add failing fan-out/fan-in tests**

Extend coordinator tests with deferred fake workers to assert:

- Four tasks start in two waves of two.
- Out-of-order completion produces input-order results.
- One completed + one failed returns `partial` and does not throw.
- All failed returns `failed`; all cancelled returns `cancelled`.
- Missing reports fall back to last assistant text.
- Reports are capped before both persistence and root tool return.
- No child can call `agent_delegate`; delegation depth remains one.
- No automatic worker retry occurs.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/agent-coordinator.test.ts
```

Expected: **FAIL** until the delegate callback and aggregation are connected.

- [ ] **Step 4: Wire delegation into root tools and prompt**

Register `agent_delegate` in the root StoryForge tool list for interactive and
Automation root turns. Add concise system-prompt heuristics:

- Delegate independent cross-package discovery or independent review.
- Do not delegate simple questions, one-file edits, strongly sequential tasks, or
  one slow external operation.
- Treat child results as evidence to verify and synthesize, not user-facing
  answers.

Do not add a settings flag; the tool is available by default.

- [ ] **Step 5: Verify Task 5**

Run:

```bash
corepack pnpm --filter @story-forge/extensions test -- src/__test__/agent-delegate-tool.test.ts src/__test__/agent-report-tool.test.ts
corepack pnpm --filter @story-forge/extensions typecheck
corepack pnpm --filter @story-forge/agent test -- src/__test__/create-storyforge-session.test.ts src/__test__/agent-coordinator.test.ts
corepack pnpm --filter @story-forge/agent typecheck
```

Expected: **PASS** with the delegate tool absent from every child tool snapshot.

---

## Task 6: IPC Snapshot Hydration and Renderer Run Tree

**Purpose:** Make child work observable without mixing child text into the root
conversation or allowing child terminal events to clear root interaction state.

**Files:**

- Modify: `apps/desktop/src/shared/story-forge-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/__test__/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-app-controller.ts`
- Create: `apps/desktop/src/renderer/components/agent-run-tree.tsx`
- Create: `apps/desktop/src/renderer/components/__test__/agent-run-tree.test.tsx`
- Modify: `apps/desktop/src/renderer/components/run-context-panel.tsx`
- Modify: `apps/desktop/src/renderer/components/__test__/run-context-panel.test.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx`
- Modify: `apps/desktop/src/renderer/components/__test__/conversation-timeline.test.tsx`
- Modify: `apps/desktop/src/renderer/utils/timeline.ts`
- Modify: `apps/desktop/src/renderer/__test__/timeline.test.ts`
- Modify: `apps/desktop/src/renderer/__test__/App.test.tsx`

- [ ] **Step 1: Add failing IPC contract tests**

Add:

```ts
IPC_CHANNELS.agentRunsGet = "story-forge:agent-runs:get";

StoryForgeApi.agentRuns.get(
  turnId: TurnId,
): Promise<AgentRunView | undefined>;
```

Test that:

- Preload forwards exactly the Turn ID.
- Main rejects malformed IDs through the existing `handle()` Zod path.
- Main maps an internal record to `AgentRunView` and does not expose transcript
  paths.
- `SessionView` includes optional `lastTurnId`.

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- src/main/__test__/ipc-handlers.test.ts
```

Expected: **FAIL** because the channel and API surface do not exist.

- [ ] **Step 2: Implement all four IPC layers**

Update shared contract, preload, main handler, and main construction together.
Keep preload as a thin forwarder and validate the payload in main. Do not create a
second child event channel; sequenced events continue through `turns.onEvent`.

- [ ] **Step 3: Add failing renderer-state tests**

Extend App/controller tests with sequenced interleaved root and child events:

- State contains `agentRuns: Record<TurnId, AgentRunView>` and
  `agentActivities: Record<AgentExecutionId, AgentEvent[]>`.
- Root events (no parent execution) feed the existing Session timeline.
- Child message/tool events update only child activity.
- Child terminal events do not remove `activeTurns`, root permissions, Extension
  UI, or human-input requests.
- Selecting/reloading a Session with `lastTurnId` hydrates `agentRuns.get()`.
- Root terminal performs a final snapshot refresh.

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- src/renderer/__test__/App.test.tsx src/renderer/__test__/timeline.test.ts
```

Expected: **FAIL** because renderer state is currently Session-only.

- [ ] **Step 4: Implement normalized run/activity state**

Route every event by `agentExecutionId`. Keep existing `activities` as the root
conversation stream or derive it from root execution activity; do not duplicate
child events into it. Apply lifecycle events locally for responsiveness and
reconcile from `agentRuns.get()` after terminal state.

Sequence handling must ignore duplicate or older events for one Turn. Do not use
wall-clock arrival order to overwrite a newer snapshot.

- [ ] **Step 5: Add failing UI component tests**

Specify:

- Root row plus indented children in creation order.
- Queued/running/completed/failed/cancelled/interrupted visuals.
- Role, compact objective, elapsed time, tool count, usage, report, error, and
  truncation indicator.
- Collapsible child details.
- A specialized `agent_delegate` timeline card showing aggregate status and task
  counts.
- Raw child assistant text never appears in the root conversation.

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- src/renderer/components/__test__/agent-run-tree.test.tsx src/renderer/components/__test__/run-context-panel.test.tsx src/renderer/components/__test__/conversation-timeline.test.tsx
```

Expected: **FAIL** until the tree and specialized card are implemented.

- [ ] **Step 6: Implement the run tree and delegate card**

Add `AgentRunTree` to the existing Run area of `RunContextPanel`. Preserve current
repository/change/model/inspector cards. Use current StoryForge visual tokens and
accessible buttons/labels; do not redesign the whole workspace panel.

In the main timeline, special-case only the structured `agent_delegate` result.
Other tool cards remain unchanged. Evidence paths are displayed as
workspace-relative text; V1 does not add a file-opening IPC.

- [ ] **Step 7: Verify Task 6**

Run:

```bash
corepack pnpm --filter @story-forge/shared build
corepack pnpm --filter @story-forge/desktop test -- src/main/__test__/ipc-handlers.test.ts src/renderer/__test__/App.test.tsx src/renderer/__test__/timeline.test.ts src/renderer/components/__test__/agent-run-tree.test.tsx src/renderer/components/__test__/run-context-panel.test.tsx src/renderer/components/__test__/conversation-timeline.test.tsx
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: **PASS**, including existing Session, permission, Soul, and timeline
tests.

---

## Task 7: Security, Recovery, Integration, and Final Verification

**Purpose:** Prove the complete feature under cancellation, partial failure,
restart, and adversarial tool requests without contacting real services.

**Files:**

- Create: `packages/agent/src/__test__/multi-agent-integration.test.ts`
- Modify: `packages/agent/src/__test__/agent-run-repository.test.ts`
- Modify: `packages/agent/src/__test__/agent-coordinator.test.ts`
- Modify: `packages/extensions/src/__test__/workspace-guard.test.ts`
- Modify: `apps/desktop/src/main/__test__/desktop-entry.test.ts`
- Modify: `apps/desktop/src/renderer/__test__/App.test.tsx`
- Modify only as failures require: production files introduced in Tasks 1–6

- [ ] **Step 1: Add end-to-end integration fixtures**

Create an injected fake PI factory that can:

- Emit interleaved root/child model and tool events.
- Block until released to test capacity.
- Return valid, missing, oversized, and malformed reports.
- Fail construction or model execution.
- Observe abort/dispose/unsubscribe calls.

Use temp StoryForge home/workspace directories. Do not invoke real PI providers,
Web APIs, MCP processes, Electron windows, or network access.

- [ ] **Step 2: Add the security matrix**

Test all forbidden Child capabilities individually:

```text
write
edit
bash
todo
automation.proposeCreate
ask_user
soul_propose_update
agent_delegate
configured MCP tool
enabled Skill/extension tool
```

Also test lexical traversal, absolute paths outside the workspace, and symlink
escape. The worker must reject/omit these capabilities even if a delegated task
asks for them explicitly.

- [ ] **Step 3: Add lifecycle and recovery scenarios**

Cover:

1. Two children run concurrently; a third remains queued.
2. Different Turns share the global four-child pool.
3. Root stop cancels queued/running children and disposes exactly once.
4. Timeout, turn limit, and tool limit fail only the affected child.
5. Partial sibling success reaches the root in input order.
6. Terminal snapshot is readable before the terminal event observer runs.
7. Process restart maps root/child queued/running state to interrupted, preserves
   completed siblings, and exposes it through `agentRuns.get()`.
8. Session deletion removes root and child artifacts.
9. Late/duplicate/out-of-order events cannot regress execution or UI state.

Run:

```bash
corepack pnpm --filter @story-forge/agent test -- src/__test__/multi-agent-integration.test.ts src/__test__/agent-coordinator.test.ts src/__test__/agent-run-repository.test.ts
corepack pnpm --filter @story-forge/extensions test -- src/__test__/workspace-guard.test.ts
```

Expected before final fixes: **FAIL** on any missing cleanup, recovery, or policy
edge. Fix production behavior, not the expectations.

- [ ] **Step 4: Run package verification in dependency order**

Because dependents consume `@story-forge/shared` through built `dist/`, run:

```bash
corepack pnpm --filter @story-forge/shared build
corepack pnpm --filter @story-forge/shared typecheck
corepack pnpm --filter @story-forge/shared test

corepack pnpm --filter @story-forge/extensions typecheck
corepack pnpm --filter @story-forge/extensions test

corepack pnpm --filter @story-forge/agent typecheck
corepack pnpm --filter @story-forge/agent test

corepack pnpm --filter @story-forge/desktop typecheck
corepack pnpm --filter @story-forge/desktop test
```

Expected: **PASS**.

- [ ] **Step 5: Run full monorepo verification**

Run from the repository root:

```bash
corepack pnpm typecheck
corepack pnpm test
git diff --check
git status --short
```

Expected:

- All typechecks and tests pass.
- No whitespace errors.
- Only intentional multi-agent files are modified.
- No generated credentials, transcripts, temporary StoryForge home data, or
  build artifacts are staged.

- [ ] **Step 6: Manual product acceptance**

With a test provider configured, verify:

1. A simple single-file question does not cause unnecessary delegation.
2. A cross-package exploration delegates two independent tasks, shows two running
   child rows, then one summary card and a synthesized root answer.
3. A reviewer task cites workspace-relative files and does not mutate them.
4. Stop cancels the entire execution tree and leaves no running status.
5. Restart during delegation shows interrupted children and completed sibling
   results without claiming resume.
6. Attempted prompts to grant Child Shell/write/MCP/Soul/delegation capability
   fail because those tools are absent.

## Final Acceptance Checklist

- [ ] Node baseline matches PI 0.82.1.
- [ ] Root terminal outcome is persisted before terminal event emission.
- [ ] `AgentRunRepository` is atomic, serialized per Turn, and recoverable.
- [ ] Session exposes `lastTurnId`; IPC views hide internal paths.
- [ ] Every execution has an independent PI session and attributed event stream.
- [ ] Child capability tests enumerate every allowed and forbidden tool/resource.
- [ ] Fixed V1 capacity and budget limits are enforced.
- [ ] Partial results and cancellation are deterministic.
- [ ] Renderer hydrates and renders the run tree without child/root stream mixing.
- [ ] Relevant package and full monorepo verification pass.
- [ ] No async team, writer, worktree, custom profile, MCP, or provider-native
  multi-agent behavior has leaked into V1.
