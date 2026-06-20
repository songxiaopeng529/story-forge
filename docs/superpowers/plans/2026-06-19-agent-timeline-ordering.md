# Agent Timeline Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render StoryForge agent turns as a chronological timeline where reasoning, tool steps, and assistant responses appear in the order they happen.

**Architecture:** Keep the change renderer-first. Refactor `buildTimeline()` into an explicit process-item mapper, update `ConversationTimeline` to render those item types, and add scroll-to-bottom behavior in `AgentWorkspace`. Runtime events, IPC, model calls, and persisted session schemas stay unchanged.

**Tech Stack:** TypeScript, React 19, Electron Vite, Vitest, Testing Library.

---

## File Structure

- Modify `apps/desktop/src/renderer/timeline.ts`: redefine timeline item types, map persisted messages into process items, and process active turn events in chronological order.
- Create `apps/desktop/src/renderer/timeline.test.ts`: focused unit tests for timeline ordering, tool-step merging, persisted assistant splitting, and empty-message skipping.
- Modify `apps/desktop/src/renderer/components/conversation-timeline.tsx`: render `user-message`, `assistant-message`, `reasoning`, `tool-step`, `notice`, and `error` items.
- Modify `apps/desktop/src/renderer/components/agent-workspace.tsx`: add auto-scroll-to-bottom when timeline content changes.
- Modify `apps/desktop/src/renderer/App.test.tsx`: update expectations for merged tool steps and chronological assistant text.

## Task 1: Timeline Unit Tests

**Files:**
- Create: `apps/desktop/src/renderer/timeline.test.ts`
- Modify: `apps/desktop/src/renderer/timeline.ts`

- [ ] **Step 1: Write failing tests for active event ordering**

Create `apps/desktop/src/renderer/timeline.test.ts` with tests that call `buildTimeline()` directly:

```ts
// @vitest-environment node

import type { AgentEvent } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../shared/story-forge-api";
import { buildTimeline } from "./timeline";

const session = {
  id: "sf_session_test",
  workspaceId: "workspace",
  title: "Timeline",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  status: "running",
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
  messages: [{ id: "m1", role: "user", content: "Inspect", createdAt: "2026-06-19T00:00:00.000Z" }],
} satisfies SessionView;

describe("buildTimeline", () => {
  it("keeps active tool steps before later assistant deltas", () => {
    const activities: AgentEvent[] = [
      {
        type: "tool.call",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        callId: "call_cmd",
        name: "workspace.runCommand",
        input: { command: "pnpm test" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        callId: "call_cmd",
        name: "workspace.runCommand",
        ok: false,
        output: "failed",
      },
      {
        type: "message.delta",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        content: "I found the failing command.",
        delivery: "live",
      },
    ];

    expect(buildTimeline({
      session,
      activities,
      activeTurnId: "sf_turn_active",
    }).map((item) => item.type)).toEqual([
      "user-message",
      "tool-step",
      "assistant-message",
    ]);
  });
});
```

- [ ] **Step 2: Write failing tests for tool result merging**

Extend `timeline.test.ts`:

```ts
it("merges tool call and result into one active tool step", () => {
  const items = buildTimeline({
    session,
    activeTurnId: "sf_turn_active",
    activities: [
      {
        type: "tool.call",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        callId: "call_read",
        name: "workspace.readFile",
        input: { path: "README.md" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        callId: "call_read",
        name: "workspace.readFile",
        ok: true,
        output: "README",
      },
    ],
  });

  const toolSteps = items.filter((item) => item.type === "tool-step");
  expect(toolSteps).toHaveLength(1);
  expect(toolSteps[0]).toMatchObject({
    callId: "call_read",
    name: "workspace.readFile",
    status: "completed",
    input: { path: "README.md" },
    output: "README",
  });
});
```

- [ ] **Step 3: Write failing tests for persisted assistant splitting**

Extend `timeline.test.ts`:

```ts
it("splits persisted assistant reasoning, tool requests, tool results, and final answer", () => {
  const completedSession: SessionView = {
    ...session,
    status: "completed",
    messages: [
      session.messages[0],
      {
        id: "assistant-tools",
        role: "assistant",
        content: "",
        reasoningContent: "I should inspect the file.",
        toolCalls: [{
          id: "call_read",
          name: "workspace.readFile",
          input: { path: "README.md" },
        }],
        createdAt: "2026-06-19T00:00:01.000Z",
      },
      {
        id: "tool-read",
        role: "tool",
        content: "README",
        name: "workspace.readFile",
        toolCallId: "call_read",
        ok: true,
        createdAt: "2026-06-19T00:00:02.000Z",
      },
      {
        id: "assistant-final",
        role: "assistant",
        content: "Done.",
        createdAt: "2026-06-19T00:00:03.000Z",
      },
    ],
  };

  const items = buildTimeline({
    session: completedSession,
    activities: [],
    activeTurnId: undefined,
  });

  expect(items.map((item) => item.type)).toEqual([
    "user-message",
    "reasoning",
    "tool-step",
    "assistant-message",
  ]);
  expect(items.filter((item) => item.type === "tool-step")).toHaveLength(1);
});
```

- [ ] **Step 4: Run test to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- timeline.test.ts
```

Expected: FAIL because `TimelineItem` still uses `message`, `pending`, `assistant-stream`, and duplicated `tool-activity` items.

## Task 2: Timeline Builder Implementation

**Files:**
- Modify: `apps/desktop/src/renderer/timeline.ts`
- Test: `apps/desktop/src/renderer/timeline.test.ts`

- [ ] **Step 1: Replace `TimelineItem` type and `buildTimeline()`**

Implement:

```ts
export type TimelineItem =
  | { type: "user-message"; id: string; content: string }
  | {
      type: "assistant-message";
      id: string;
      content: string;
      streaming?: boolean;
      delivery?: MessageDeliveryMode;
    }
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

Implementation requirements:

- Build persisted items first through `buildPersistedItems(session.messages)`.
- Skip persisted assistant content when `content.trim()` is empty.
- Build a set of persisted `toolCallId`s before rendering assistant tool-call placeholders.
- Only process active events when `activeTurnId` is defined.
- Process active events in array order.
- Maintain a `Map<callId, index>` for active tool steps and update the existing item on result.
- Maintain a current active assistant stream item and append new deltas to it until a non-delta event appears.

- [ ] **Step 2: Run focused test**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- timeline.test.ts
```

Expected: PASS.

## Task 3: Conversation Timeline Rendering

**Files:**
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx`
- Test: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Update renderer for new item types**

Replace old type branches with:

- `user-message`: right-aligned dark bubble.
- `assistant-message`: left-aligned white bubble, using `useTypewriterText()` when `streaming` and `delivery === "smooth"`.
- `reasoning`: collapsible bordered block labeled `Reasoning`.
- `tool-step`: collapsible bordered block with label `Running`, `Completed`, or `Failed`.
- `notice`: blue notice block.
- `error`: red notice block.

Add a helper:

```ts
function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
```

- [ ] **Step 2: Run renderer tests to expose changed expectations**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: Existing tests that expect both `Running` and `Completed` for the same call fail.

## Task 4: Auto Scroll And Renderer Tests

**Files:**
- Modify: `apps/desktop/src/renderer/components/agent-workspace.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Add auto-scroll**

In `AgentWorkspace`, add:

```ts
const messageScrollRef = useRef<HTMLDivElement | null>(null);
const timelineFingerprint = timelineItems.map((item) => {
  if (item.type === "assistant-message") {
    return `${item.id}:${item.content.length}:${item.streaming ? "streaming" : "static"}`;
  }
  if (item.type === "tool-step") {
    return `${item.id}:${item.status}`;
  }
  return item.id;
}).join("|");

useEffect(() => {
  const element = messageScrollRef.current;
  if (!element) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}, [timelineFingerprint]);
```

Attach `ref={messageScrollRef}` to the `agent-message-scroll` div.

- [ ] **Step 2: Update App tests**

Update expectations:

- In `shows pending status, live deltas, and inline tool progress while a turn runs`, expect `Completed workspace.readFile` and assert `Running workspace.readFile` is not present after the result.
- Add a test where `tool.call`, `tool.result`, then `message.delta` are emitted and assert the rendered DOM order has `Failed workspace.runCommand` before `I found the failure`.
- Keep the existing fixed-shell scroll test and assert `agent-message-scroll` is still the scroll container.

- [ ] **Step 3: Run App tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: PASS.

## Task 5: Verification And Commit

**Files:**
- Modify: implementation files from previous tasks.

- [ ] **Step 1: Run full desktop tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test
```

Expected: PASS.

- [ ] **Step 2: Run root typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add apps/desktop/src/renderer/timeline.ts apps/desktop/src/renderer/timeline.test.ts apps/desktop/src/renderer/components/conversation-timeline.tsx apps/desktop/src/renderer/components/agent-workspace.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "fix: render agent steps chronologically"
```

Expected: Commit succeeds.

## Self-Review

- Spec coverage: timeline model, persisted mapping, active mapping, deduplication, rendering, scroll, and tests are all covered by tasks.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: task code uses the same `TimelineItem` names and status values throughout.
