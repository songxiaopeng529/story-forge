# Agent Timeline Ordering Design

## Goal

Make the chat workspace render agent turns as a chronological process timeline: the user message appears in order, each reasoning or tool step appears where it happened, and the final assistant answer appears after the relevant work.

The first implementation focuses on ordering and clarity. It should not redesign the whole chat surface or change the runtime protocol unless the existing event shape is insufficient.

## Problem

The current renderer has two timeline issues:

1. `buildTimeline()` aggregates all `message.delta` events for the active turn and inserts the assistant stream before iterating over tool events. This makes new model output appear before tool calls even when it happened after them.
2. `tool.call` and `tool.result` render as separate items. A single tool invocation can appear as both `Running workspace.runCommand` and `Failed workspace.runCommand`, producing duplicate process cards instead of one updating step.

Persisted assistant messages also mix final answer, reasoning, and requested tool calls inside one assistant bubble. That makes old turns feel like one large message rather than a readable agent loop.

## Desired User Experience

Each turn should read from top to bottom in the same order the agent acted:

```text
User
  "你好！你拥有哪些工具能力呢？"

Reasoning
  Collapsed by default.

Tool step
  workspace.runCommand
  Status: failed
  Input/output visible when expanded.

Tool step
  workspace.readFile
  Status: completed
  Input/output visible when expanded.

Assistant
  Final answer text.
```

New turns appear at the bottom of the conversation. While a turn is active, new steps are appended to the bottom as they arrive. A tool step changes status from running to completed or failed instead of leaving multiple cards for the same `callId`.

The UI should remain compact enough for long tool-heavy turns. Reasoning and tool details are expandable. The step label should always be visible without opening the card.

## Non-Goals

- No new backend AgentEvent types in the first pass.
- No persisted schema migration unless the existing message shape cannot support the timeline.
- No full chat visual redesign.
- No automatic grouping by files, commands, or tool categories.
- No replay UI for older intermediate streaming deltas, because persisted sessions currently store final messages and tool results, not every live delta.

## Existing Context

Relevant files:

- `apps/desktop/src/renderer/timeline.ts` builds timeline items from persisted session messages and live `AgentEvent`s.
- `apps/desktop/src/renderer/components/conversation-timeline.tsx` renders those items.
- `apps/desktop/src/renderer/components/agent-workspace.tsx` owns the scroll container and calls `buildTimeline()`.
- `apps/desktop/src/renderer/App.tsx` records live `AgentEvent`s per session and clears them when a new prompt starts.
- `apps/desktop/src/main/session-repository.ts` persists user, assistant, and tool messages.
- `packages/shared/src/events.ts` defines `message.delta`, `tool.call`, `tool.result`, and terminal runtime events.

The current data model is enough for a first version:

- Active turns can be rendered from live events.
- Completed turns can be rendered from persisted messages.
- Persisted tool messages already carry `name`, `toolCallId`, `ok`, and `content`.
- Persisted assistant messages already carry `content`, optional `reasoningContent`, and optional `toolCalls`.

## Timeline Model

Replace the renderer timeline item model with explicit process-oriented items:

```ts
type TimelineItem =
  | { type: "user-message"; id: string; content: string }
  | { type: "assistant-message"; id: string; content: string; streaming?: boolean; delivery?: MessageDeliveryMode }
  | { type: "reasoning"; id: string; content: string }
  | {
      type: "tool-step";
      id: string;
      callId: string;
      name: string;
      status: "running" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
    }
  | { type: "notice"; id: string; message: string }
  | { type: "error"; id: string; message: string };
```

The exact TypeScript can stay close to this shape. The important behavior is that the timeline distinguishes user text, assistant text, reasoning, and tool steps.

## Persisted Message Mapping

Persisted history should be expanded into a readable sequence:

- `user` becomes `user-message`.
- `tool` becomes one `tool-step` with `completed` or `failed` based on `ok`.
- `assistant.reasoningContent` becomes a `reasoning` item before the assistant answer.
- `assistant.toolCalls` become running `tool-step` placeholders only when there is no matching persisted tool result yet.
- `assistant.content` becomes `assistant-message` only when the content is non-empty.

This avoids empty assistant bubbles when a model response only requested tools.

Persisted tool results should be associated with preceding assistant tool calls by `toolCallId`. If a persisted tool message exists for a call, the timeline should render the tool result item and avoid rendering the assistant's tool-call placeholder as a duplicate.

## Active Turn Mapping

Active turn events should be processed in event order. The renderer should not pre-collect all message deltas and place them before tools.

Rules:

- `message.delta` appends to the current active assistant stream segment.
- If a tool event arrives after text has streamed, the current assistant stream segment stays where it is and a later text delta starts a new assistant stream segment after the tool step.
- `tool.call` creates a `tool-step` with `running` status.
- `tool.result` updates the matching `tool-step` by `callId` to `completed` or `failed`. If no matching call exists, create a result-only `tool-step` at the result event position.
- `response.fallback` becomes a notice at the point it was emitted.
- `runtime.error` becomes an error item at the point it was emitted.

This preserves the runtime order while still letting each tool card behave like a single evolving step.

## Deduplication

Live activities should not duplicate persisted messages after the turn completes.

Implementation rule:

- When `activeTurnId` is present, render live activities for that turn.
- When the turn completes and `activeTurnId` is cleared, stop rendering those live activities.
- The refreshed persisted session becomes the source of truth for completed content.

This matches the existing `App.tsx` pattern where the session is refreshed on `runtime.completed` or `runtime.error`.

## Scrolling

The conversation pane should scroll to the latest item when:

- The user sends a prompt.
- A new timeline item is appended.
- A streaming assistant item receives more content.
- A tool step status changes.

The first version may always scroll to bottom while an active turn is running. A later refinement can pause auto-scroll when the user manually scrolls upward.

## Rendering

`ConversationTimeline` should render each item with a dedicated component:

- User messages stay right-aligned.
- Assistant messages stay left-aligned.
- Reasoning uses a compact collapsible block.
- Tool steps use a compact collapsible block with visible name and status.
- Failed tool steps should have a red-tinted status marker.
- Running tool steps should have a neutral or blue status marker.
- Completed tool steps should have a green or neutral status marker.

Tool detail cards should show JSON input and output when expanded. For string output, preserve line breaks. Long output should scroll inside the detail area rather than stretching the whole page too aggressively.

## Error Handling

Malformed or incomplete event sequences should still render something useful:

- A `tool.result` without a prior `tool.call` renders as a result-only tool step.
- Empty assistant content is skipped.
- Empty reasoning content is skipped.
- Unknown output shapes are displayed with `JSON.stringify`.
- Runtime errors render as red notice blocks in chronological order.

## Testing

Add focused unit tests around `buildTimeline()`:

- Active events preserve chronological order when tool calls happen before assistant deltas.
- `tool.call` plus `tool.result` for the same `callId` renders as one `tool-step`.
- A result without a call still renders a result-only `tool-step`.
- Persisted assistant messages split reasoning, tool-call placeholders, and final content.
- Persisted assistant tool-call placeholders are suppressed when a matching persisted tool result exists.
- Empty assistant content does not render an empty bubble.

Update renderer tests:

- Active tool progress shows one step changing to completed or failed, not separate Running and Completed cards.
- Sending a new prompt places the optimistic user message at the bottom.
- A turn with tool failure followed by assistant text shows tool failure before assistant text.
- The scroll container keeps the app shell fixed and remains the only conversation scroll surface.

Run:

```bash
corepack pnpm --filter @story-forge/desktop test
corepack pnpm typecheck
```

## Implementation Notes

This change should stay renderer-first. The current runtime event stream already carries enough information for a correct active timeline. Backend changes should be considered only if tests reveal that persisted history cannot reconstruct a useful completed timeline.

Keep the first pass intentionally small:

1. Refactor `buildTimeline()` and its tests.
2. Update `ConversationTimeline` rendering for the new item model.
3. Add auto-scroll in `AgentWorkspace`.
4. Update affected renderer tests.

This sequence gives a visible UX improvement without changing model calls, tool execution, session persistence, or IPC contracts.
