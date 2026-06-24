# Context Compaction Design

## Goal

Keep long StoryForge sessions usable by compacting conversation history instead of only trimming it. When a session approaches its context window, the runtime should distill the accumulated history into a structured Chinese summary and continue from that summary, so the agent retains long-term memory (original intent, decisions, file changes, open tasks) without exceeding the model context window.

Two trigger paths are in scope:

- **Automatic compaction** when the provider-reported context usage reaches a high threshold.
- **Manual compaction** through a `/compact` slash command.

This builds directly on the context-usage tracking added in the previous milestone (the `context.usage` event with provider-accurate and estimated token counts).

## Background

StoryForge already has the runtime pieces this feature depends on:

- `AgentLoop` (`packages/agent-core/src/agent-loop.ts`) runs the model/tool loop, trims history with `trimMessagesToContext` before each request, and now emits `context.usage` events (`source: "provider"` from API usage, `source: "estimate"` from local heuristics). It also exposes `onBeforeFinish` and `onCheckpoint` callbacks.
- `NativeAgentRuntime` (`packages/agent-core/src/native-agent-runtime.ts`) builds runtime context, creates the provider and tools, runs `AgentLoop`, and persists history through `onCheckpoint` -> `toRuntimePersistedMessages` -> `replaceMessages`.
- `RuntimeContextAssembler` (`packages/agent-core/src/runtime-context.ts`) rebuilds the system prompt every turn and converts persisted messages to chat messages with `toChatMessage`.
- `SessionRepository` (`apps/desktop/src/main/session-repository.ts`) persists sessions as Zod-validated JSON. Persisted messages have exactly three roles: `user`, `assistant`, `tool`. It already exposes `replaceMessages` and per-session serialized writes through an update queue, plus `listTasks`.
- `AgentCoordinator` (`apps/desktop/src/main/agent-coordinator.ts`) starts turns, resolves slash/skill invocations through `resolveSkillInvocation` + `parseSlashInvocation`, and forwards `AgentEvent` values to the renderer.
- The renderer composer (`apps/desktop/src/renderer/components/agent-workspace.tsx`) already implements a slash command menu with built-in commands (`/plan`, `/timer`, `/models`, ...), and `timeline.ts` already has a `notice` timeline item type.

### What the current trimming does and does not do

`trimMessagesToContext` keeps the system messages plus as many whole recent conversation rounds as fit in `contextWindowTokens * 0.8`. This is **lossy by deletion**: older rounds are dropped and gone. Compaction is **lossy by distillation**: older rounds are replaced by a model-written summary that preserves their essential content. The two are complementary. Compaction reduces how often trimming has to drop rounds, and trimming stays as the final safety net if a single retained round is still too large.

### How mainstream agents do it

- **Claude Code (auto-compact)**: monitors token usage and, when the conversation nears the limit, sends the full history to the model with a dedicated summarization prompt. It replaces the history with the summary plus the most recent messages and continues. It also exposes `/compact` (manual, optionally with focus instructions) and `/clear` (drop context without summarizing).
- **Codex**: similar auto-summarization / context compaction when usage gets high, folding history into a summary so the turn can continue, with both automatic and manual paths.

The shared pattern is: **trigger by usage threshold or explicit command -> summarize history with a meta prompt -> replace old history with summary + recent tail**. StoryForge adopts the same pattern, adapted to its native runtime and its existing task system.

## Non-Goals

- No separate summarization model. Compaction uses the session's selected provider and model, matching the Plan Mode precedent.
- No `/clear` command in this version. Only summarizing compaction (auto + `/compact`) is in scope.
- No `/compact <focus>` argument parsing in this version. `/compact` runs an unparameterized compaction. The summary prompt is fixed (structured Chinese summary). Focus arguments can be added later.
- No retention of a pre-compaction transcript snapshot. Compaction overwrites session history in place (the same overwrite model `replaceMessages` already uses). A separate snapshot store is out of scope.
- No streaming of the summarization request to the UI. The summary is produced with a single non-streamed model call.
- No change to `trimMessagesToContext`. It stays as the final safety net.

## Product Behavior

### Automatic Compaction

During a running turn, before each model request, the loop checks the most recent provider-accurate context usage. When `usedTokens / budgetTokens >= 0.9` (using `source: "provider"` only), the loop performs one compaction before issuing the request:

1. Summarize the current in-memory history (everything except the system message) into a structured Chinese summary, plus the open task list.
2. Replace the history with: the summary message + the most recent one conversation round of original messages.
3. Persist the compacted history through the existing checkpoint path.
4. Emit a `context.compacted` event so the timeline can show a lightweight notice.
5. Continue the turn from the compacted history.

Estimated usage (`source: "estimate"`) never triggers automatic compaction. The estimate is only a display value; it is biased low for Chinese text and would cause false triggers.

Because the first request of a turn has no provider usage yet, automatic compaction effectively starts from the second request onward in a turn. Long histories carried over from previous turns are caught on the first request that returns provider usage. This is acceptable: a single over-budget request is still served by `trimMessagesToContext`, and compaction kicks in on the next iteration.

### Manual Compaction

`/compact` is a built-in slash command in the composer:

- Selecting `/compact` does not send a chat message. It calls a dedicated IPC method that compacts the selected session immediately.
- Manual compaction runs even when usage is low. The user is explicitly asking to shrink context.
- Manual compaction can run only when the session has no active turn. If a turn is running, the command is rejected with a clear error (the same way `start` rejects a session that already has an active turn).
- After compaction, the timeline shows the same `context.compacted` notice, and the next normal turn continues from the compacted history.

### Anti-Thrash Guard

Compaction itself consumes tokens (the summarization call) and produces a summary that occupies space. To avoid compacting repeatedly:

- Automatic compaction fires **at most once per turn**. After it runs, the loop does not auto-compact again for the remainder of that turn, even if usage is still high. If usage stays high, the loop relies on `trimMessagesToContext` for that turn and the next turn can compact again.
- If a compaction produces a result that is not meaningfully smaller (for example the retained tail alone already exceeds the budget), the loop logs/continues without looping. Correctness falls back to trimming.

### Visibility

A `context.compacted` event drives a lightweight timeline notice such as `已压缩上下文（约 X% -> Y%）`. Percentages are derived from token counts before and after compaction against the same budget. The notice reuses the existing `notice` timeline item type, so no new renderer item shape is required. The user also sees the run-context panel percentage drop naturally because the next `context.usage` reflects the smaller history.

## Data Model Changes

### Persisted summary message

Persisted history needs to mark which message is a compaction summary, so that reloading a session and rebuilding context treats it correctly and the UI can render it distinctly. Today persisted messages are strictly `user | assistant | tool` with no marker.

Add an optional discriminating field `kind` to the persisted `assistant` message variant:

```ts
// RuntimePersistedMessage assistant variant (packages/agent-core/src/agent-runtime.ts)
{
  id: string;
  role: "assistant";
  content: string;
  reasoningContent?: string | undefined;
  toolCalls?: ToolCall[] | undefined;
  error?: boolean | undefined;
  kind?: "summary" | undefined;   // new
  createdAt: string;
}
```

Rationale for `assistant` + `kind: "summary"` rather than a new role:

- The summary is model-authored content that the model should read as prior assistant context on the next request. Keeping it `assistant` means `toChatMessage` already maps it correctly to the model with no special case in the hot path.
- A new role would ripple through every provider message mapper (`openai-compatible`, `anthropic`), the Zod schema, the renderer message views, and the timeline. A `kind` marker is additive and backward compatible.
- The marker is optional and defaults to undefined, so existing sessions parse unchanged and `schemaVersion` stays `1`.

The same optional `kind` is added to:

- The Zod `persistedMessageSchema` assistant object in `session-repository.ts` (`kind: z.enum(["summary"]).optional()`).
- The desktop `PersistedMessageView` assistant variant in `apps/desktop/src/shared/story-forge-api.ts`, so the renderer can style summary messages.

### Compaction event

Add to `packages/shared/src/events.ts`:

```ts
export type ContextCompactedEvent = {
  type: "context.compacted";
  sessionId: SessionId;
  turnId: TurnId;
  trigger: "auto" | "manual";
  beforeTokens: number;
  afterTokens: number;
  budgetTokens: number;
  retainedRounds: number;
};
```

`ContextCompactedEvent` joins the `AgentEvent` union. `isTerminalAgentEvent` stays unchanged (compaction is not terminal). For manual compaction outside a turn, a synthetic `turnId` is generated for the event so the event shape stays uniform; the renderer treats `context.compacted` as a turn-independent notice.

## Compaction Engine

Introduce a small, pure, well-tested module in `packages/agent-core`, for example `context-compactor.ts`. It owns the summary prompt, the summarization call, and the history-rewrite math. Keeping it separate from `AgentLoop` keeps the loop readable and the logic unit-testable without running a full loop.

### Inputs and outputs

```ts
export type CompactionInput = {
  messages: ChatMessage[];          // current in-memory history incl. system
  openTasks: SessionTask[];         // pending + in_progress
  retainRounds: number;             // default 1
  summarize: (request: { messages: ChatMessage[] }) => Promise<string>;
};

export type CompactionResult = {
  messages: ChatMessage[];          // system + summary + retained tail
  summaryText: string;
  retainedRounds: number;
};
```

`summarize` is injected (the loop passes a thin wrapper over `provider.chat`), so the compactor never depends on a concrete provider and is trivially testable with a fake.

### Algorithm

1. Split off system messages (unchanged, rebuilt each turn anyway). Group the rest into conversation rounds using the same round-grouping rule as `trimMessagesToContext` (a round starts at a `user` message).
2. Reserve the most recent `retainRounds` rounds as the retained tail.
3. Build a summarization request: the system message(s) + all rounds **before** the retained tail + a final summarization instruction that includes the open task list.
4. Call `summarize` once to get `summaryText`.
5. Produce the new history: `system messages` + one assistant message `{ role: "assistant", content: summaryText }` (persisted with `kind: "summary"`) + the retained tail.
6. Return the new messages and metadata.

If there is nothing before the retained tail (history too short to compact), the compactor returns the input unchanged and reports `retainedRounds` equal to the number of rounds; callers treat this as a no-op.

### Summary prompt

A fixed Chinese structured prompt instructs the model to produce a compact summary with these sections:

- 目标与意图: the user's original goals and current intent.
- 关键决策: important decisions and the reasoning behind them.
- 改动文件: files created or modified and the nature of each change.
- 当前进度: what is done and what state the work is in.
- 未完成任务: the open task list, passed in explicitly from `openTasks` (title + status + blockedReason), so tasks survive compaction even if they were not mentioned recently.
- 注意事项: constraints, gotchas, failed approaches to avoid repeating.

The prompt explicitly tells the model this summary will replace the earlier conversation and must be self-contained for continuing the work. The open tasks are injected as data in the instruction, not left for the model to infer.

## Runtime Integration

### AgentLoop

Add optional compaction support to `AgentLoopOptions` and the run input, all optional so existing callers and tests are unaffected:

```ts
type AgentLoopOptions = {
  // ...existing
  compactor?: ContextCompactor;        // engine instance
};

type AgentLoopRunInput = {
  // ...existing
  contextCompaction?: {
    enabled: boolean;
    thresholdRatio: number;            // default 0.9
    retainRounds: number;              // default 1
    getOpenTasks: () => Promise<SessionTask[]>;
  };
};
```

In the loop, before building each request:

1. Read the last provider-accurate usage observed this turn (the loop already computes and emits usage; it should retain the latest `source: "provider"` value in a local variable).
2. If compaction is enabled, not yet used this turn, and `providerUsed / budget >= thresholdRatio`, run the compactor against the in-memory `messages`.
3. If the result is smaller, replace `messages` in place, mark `compactedThisTurn = true`, run the existing checkpoint to persist, and emit `context.compacted` with before/after token counts (computed with the loop's existing `estimateRequestTokens`/message estimator so the math is consistent with the usage display).
4. Proceed to build the (now smaller) request. `trimMessagesToContext` still runs afterward as the final guard.

The summarization call uses the same provider via a `summarize` wrapper that calls `provider.chat({ messages }, { signal })`. It honors the loop's abort signal. If summarization throws (provider error, abort), the loop catches it, skips compaction for this iteration, and continues with trimming. Compaction must never fail a turn.

### NativeAgentRuntime

The runtime wires the loop's compaction options:

- Construct a `ContextCompactor` and pass it to `AgentLoop`.
- Provide `contextCompaction` in the run input with `enabled: true`, `thresholdRatio: 0.9`, `retainRounds: 1`, and `getOpenTasks` reading `listTasks` filtered to `pending | in_progress`.
- The existing `onCheckpoint` already persists messages via `toRuntimePersistedMessages` + `replaceMessages`; compaction reuses it. See the persistence note below for the id-alignment fix.

### Manual compaction path

Manual compaction does not run inside a turn, so it needs a coordinator method that performs a single compaction against persisted history:

`AgentCoordinator.compactSession(sessionId)`:

1. Reject if the session has an active turn (reuse the `reservedSessions` check).
2. Load the session, resolve the provider and tasks.
3. Build chat messages from persisted history using the same assembler conversion (`toChatMessage`) plus the current system message, so the summarization sees the same shape as a turn would.
4. Run the `ContextCompactor` once with `retainRounds: 1` and open tasks.
5. Convert the result back to persisted messages and `replaceMessages`.
6. Emit `context.compacted` with `trigger: "manual"`.

This reuses the compaction engine and the persistence path; only the entry point differs from auto.

### Persistence: id alignment fix

`toRuntimePersistedMessages` currently reuses `id`/`createdAt` by **array index** against the previous persisted list. Compaction changes both the count and the order of messages (many old messages collapse into one summary), so index alignment would misassign ids. The fix:

- Change `toRuntimePersistedMessages` to align by a stable identity rather than positional index. Practical approach: match on `toolCallId` for tool messages and on a carried-over `id` for messages that already have one, generating fresh ids only for genuinely new messages (the summary).
- The compactor outputs the summary as a chat message without an id; the persistence layer assigns it a new id and `createdAt`, and tags it `kind: "summary"`.
- Retained tail messages keep their original persisted ids so the timeline does not flicker or duplicate.

This is the one non-additive change to existing code and is covered by dedicated tests (see Testing).

## IPC and Renderer

### IPC contract

Add a channel and method:

- `IPC_CHANNELS.turnsCompact = "story-forge:turns:compact"` (naming consistent with existing `turns:*` channels).
- `StoryForgeApi.turns.compact(sessionId): Promise<void>` in `story-forge-api.ts`.
- Preload forwarder in `apps/desktop/src/preload/index.ts` (thin `ipcRenderer.invoke`).
- Main handler in `apps/desktop/src/main/ipc-handlers.ts` validating `{ sessionId }` with Zod via the `handle()` helper, delegating to `AgentCoordinator.compactSession`.

### Composer

Add `/compact` to the built-in slash command list in `agent-workspace.tsx`:

- Title: `Compact context`.
- Description: `Summarize and shrink this conversation's context.`
- `kind: "builtin"`.
- `action`: clear the prompt text and call a new `onCompact` prop, which `App.tsx` wires to `window.storyForge.turns.compact(selectedSessionId)`.

The command does not insert text or start a turn. It triggers the IPC call directly, mirroring how `/models` and `/settings` open panels rather than sending messages.

### Timeline notice

`context.compacted` events are appended in `App.tsx`'s event subscription like other activities. `buildTimeline` adds a branch that turns a `context.compacted` activity into a `notice` item:

```text
已压缩上下文（约 92% -> 41%）
```

Because the `notice` item type already exists, no new timeline shape is needed. The notice is informational and non-blocking.

### Summary message rendering

Persisted assistant messages with `kind: "summary"` render with a subtle distinct treatment (for example a "上下文摘要" label or muted styling) so users understand why earlier messages collapsed. This is a small presentational change in the message renderer using the new `kind` field on `PersistedMessageView`.

## Error Handling

- Summarization provider error or abort during auto compaction: caught in the loop, compaction skipped for that iteration, turn continues with trimming. No user-visible error; optionally a debug log.
- Manual compaction provider error: surfaced to the renderer as a normal IPC rejection so the user can retry.
- Manual compaction while a turn is active: rejected with a clear message (`Session already has an active turn`).
- Compaction that cannot shrink (history too short, or retained tail alone over budget): treated as a no-op; no `context.compacted` event is emitted for a no-op manual call, and the loop simply proceeds.
- Persistence failure during the compaction checkpoint: same handling as existing checkpoint failures; the in-memory turn continues, and the error path mirrors current `onCheckpoint` behavior.

## Testing

### `packages/agent-core` (compactor)

- Groups rounds and retains exactly `retainRounds` recent rounds.
- Produces `system + summary(assistant) + retained tail`, with the summary carrying the injected open-task list.
- No-op when history is too short to compact.
- `summarize` is called once with the pre-tail history; abort/throw is propagated as a skip, not a crash (tested at the loop level).

### `packages/agent-core` (loop)

- No compaction when `contextCompaction` is absent (existing behavior unchanged).
- Auto compaction fires once when provider usage crosses the threshold, replaces messages, emits `context.compacted`, and persists via checkpoint.
- Auto compaction does not fire twice in one turn (anti-thrash).
- Estimated-only usage never triggers compaction.
- Summarization failure leaves the turn running and falls back to trimming.

### `packages/agent-core` (persistence alignment)

- `toRuntimePersistedMessages` keeps ids/timestamps for retained tail and tool messages after a compaction reshapes the list.
- A new summary message gets a fresh id and `kind: "summary"`.

### `apps/desktop/src/main`

- `turns.compact` IPC validates payload and rejects invalid input.
- `compactSession` rejects when a turn is active.
- `compactSession` rewrites persisted history and emits `context.compacted` with `trigger: "manual"`.
- Session JSON round-trips an assistant message with `kind: "summary"`; sessions without it still parse.

### `packages/shared`

- `context.compacted` is a valid `AgentEvent` and is non-terminal.

### Renderer

- `/compact` appears in the slash menu and calls `turns.compact`.
- A `context.compacted` activity renders a single `notice` timeline item with before/after percentages.
- A persisted `kind: "summary"` assistant message renders with the summary treatment.

## Rollout Plan

Two passes keep risk low.

### Pass A: Compaction engine + manual command

- Add `ContextCompactor` and its tests.
- Add the `kind: "summary"` field across runtime type, Zod schema, and `PersistedMessageView`.
- Fix `toRuntimePersistedMessages` id alignment.
- Add `context.compacted` event.
- Add `AgentCoordinator.compactSession`, the IPC channel/method, preload forwarder, and `/compact` composer command.
- Add the timeline notice and summary message rendering.

This delivers user-controllable compaction end to end without touching the hot loop trigger.

### Pass B: Automatic threshold compaction

- Retain latest provider usage in the loop, add the threshold check before each request, wire `contextCompaction` from `NativeAgentRuntime`, and add the anti-thrash guard.
- Add loop-level tests for auto trigger, single-fire, estimate-no-trigger, and failure fallback.

Splitting this way means the engine and persistence reshape are proven by the manual path before the automatic trigger drives it during live turns.

## Open Decisions Resolved

- Trigger threshold: provider-accurate usage `>= 90%`; estimate never triggers.
- Retention: summary + most recent 1 round of original messages.
- Open tasks are injected into the summary explicitly from `listTasks` (`pending | in_progress`).
- Visibility: emit `context.compacted`, render a lightweight `notice` in the timeline.
- Manual command: unparameterized `/compact`, immediate, blocked while a turn is active.
- No `/clear`, no focus argument, no pre-compaction snapshot in this version.
- Summary message is persisted as `assistant` with `kind: "summary"`, not a new role.
- Trimming (`trimMessagesToContext`) remains unchanged as the final safety net.
