# Automations V2 Thread Timers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thread timers that wake the current StoryForge session on a schedule and preserve the session context.

**Architecture:** Extend the existing V1 automation model with `thread_chat`, optional `sessionId`, and kind-aware proposal payloads. Keep V1 scheduled-chat behavior intact, while the scheduler branches `thread_chat` runs through `AgentCoordinator.start({ sessionId, prompt })`. Add a chat timer button and modal dialog for current-session timers, plus scope-aware proposal cards and Automations-page labels.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, `@story-forge/shared`, `@story-forge/tools`, `@story-forge/desktop`, existing `cron-parser` schedule helpers.

---

### Task 1: Shared Types And IPC Shape

**Files:**
- Modify: `packages/shared/src/extensions.ts`
- Modify: `packages/shared/src/events.test.ts`
- Modify: `apps/desktop/src/shared/story-forge-api.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`

- [ ] Update `AutomationKind` to `"scheduled_chat" | "thread_chat"` and add optional `sessionId` to `AutomationView`, `CreateAutomationInput`, `UpdateAutomationInput`, and `AutomationProposalView`.
- [ ] Update event tests so automation views and proposal fixtures include `kind: "scheduled_chat"`.
- [ ] Extend IPC Zod schemas with optional `kind` and `sessionId`; keep both fields optional for backward compatibility.
- [ ] Add an IPC validation test that creates a `thread_chat` automation with a session id:

```ts
await expect(fixture.invoke(IPC_CHANNELS.automationsCreate, {
  name: "Thread timer",
  kind: "thread_chat",
  status: "active",
  workspaceId: "workspace-1",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  sessionId: "sf_session_existing",
  schedule: {
    sourceText: "every hour",
    cron: "0 * * * *",
    timezone: "UTC",
    summary: "Every hour",
  },
  prompt: "Check the current session.",
})).resolves.toMatchObject({
  kind: "thread_chat",
  sessionId: "sf_session_existing",
});
```

- [ ] Run `corepack pnpm --filter @story-forge/shared test` and the IPC test; expect the new thread timer shape to fail before implementation and pass after implementation.

### Task 2: Repository And Service Validation

**Files:**
- Modify: `apps/desktop/src/main/automation-repository.ts`
- Modify: `apps/desktop/src/main/automation-service.ts`
- Modify: `apps/desktop/src/main/automation-service.test.ts`

- [ ] Add failing service tests:

```ts
it("creates a thread timer bound to an existing session id", async () => {
  const service = await createService();

  await expect(service.create({
    name: "Thread timer",
    kind: "thread_chat",
    status: "active",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    sessionId: "sf_session_existing",
    schedule: {
      sourceText: "hourly",
      cron: "0 * * * *",
      timezone: "UTC",
      summary: "",
    },
    prompt: "Check this session.",
  })).resolves.toMatchObject({
    kind: "thread_chat",
    sessionId: "sf_session_existing",
    nextRunAt: "2026-06-20T01:00:00.000Z",
  });
});

it("rejects thread timers without a session id", async () => {
  const service = await createService();

  await expect(service.create({
    name: "Broken thread timer",
    kind: "thread_chat",
    status: "active",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    schedule: {
      sourceText: "hourly",
      cron: "0 * * * *",
      timezone: "UTC",
      summary: "",
    },
    prompt: "Check this session.",
  })).rejects.toThrow("Thread timers require a session id.");
});
```

- [ ] Implement `normalizeAutomationKind(input.kind)` with default `"scheduled_chat"`.
- [ ] Enforce `thread_chat` requires `sessionId` in service create/update paths before repository writes.
- [ ] Extend repository Zod schemas to persist `sessionId` and both automation kinds.
- [ ] Run `corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/main/automation-service.test.ts`.

### Task 3: Scheduler Same-Session Runs

**Files:**
- Modify: `apps/desktop/src/main/automation-scheduler.ts`
- Modify: `apps/desktop/src/main/automation-scheduler.test.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.ts`

- [ ] Add failing scheduler tests:

```ts
it("runs thread timers in the existing session", async () => {
  const fixture = await createFixture();
  const automation = await fixture.service.create({
    name: "Thread timer",
    kind: "thread_chat",
    status: "active",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    sessionId: "sf_session_existing",
    schedule: {
      sourceText: "hourly",
      cron: "0 * * * *",
      timezone: "UTC",
      summary: "",
    },
    prompt: "Check this session.",
  });
  fixture.now = new Date("2026-06-20T01:00:00.000Z");

  await fixture.scheduler.runDue();

  expect(fixture.start).toHaveBeenCalledWith({
    sessionId: "sf_session_existing",
    prompt: "Check this session.",
  });
  await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
    expect.objectContaining({
      status: "completed",
      sessionId: "sf_session_existing",
    }),
  ]);
});

it("skips thread timers when the target session is already running", async () => {
  const fixture = await createFixture();
  fixture.start.mockRejectedValueOnce(new Error("Session already has an active turn: sf_session_existing"));
  const automation = await fixture.service.create({
    name: "Thread timer",
    kind: "thread_chat",
    status: "active",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    sessionId: "sf_session_existing",
    schedule: {
      sourceText: "hourly",
      cron: "0 * * * *",
      timezone: "UTC",
      summary: "",
    },
    prompt: "Check this session.",
  });
  fixture.now = new Date("2026-06-20T01:00:00.000Z");

  await fixture.scheduler.runDue();

  await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
    expect.objectContaining({
      status: "skipped",
      error: "session-already-running",
    }),
  ]);
});
```

- [ ] Extend `AutomationCoordinator` in the scheduler with `start(input: { sessionId; prompt })`.
- [ ] Branch `runAutomation`: `scheduled_chat` uses `startAutomationRun`; `thread_chat` uses `start`.
- [ ] Store the existing session id on `thread_chat` runs.
- [ ] Catch `"Session already has an active turn"` and mark run `skipped` with `session-already-running`.
- [ ] Run `corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/main/automation-scheduler.test.ts`.

### Task 4: Agent Proposal Tool Supports Thread Timers

**Files:**
- Modify: `packages/tools/src/automation-proposal-tool.ts`
- Modify: `packages/tools/src/automation-proposal-tool.test.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`

- [ ] Add a failing tool test where `kind: "thread_chat"` survives draft parsing and validation.
- [ ] Add a failing coordinator test where a model tool call with `kind: "thread_chat"` emits an `automation.proposal` with `kind: "thread_chat"` and `sessionId` equal to the active session id.
- [ ] Update tool parameter schema to accept optional `kind` and `sessionId`.
- [ ] Default proposal kind to `"scheduled_chat"` when omitted.
- [ ] In `AgentCoordinator`, include `sessionId` only for thread proposals and update system prompt guidance:

```text
If the user asks to schedule work in this chat/session/current conversation, propose kind "thread_chat".
If the user asks for recurring work without current-session scope, propose kind "scheduled_chat".
```

- [ ] Run `corepack pnpm --filter @story-forge/tools test` and `corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/main/agent-coordinator.test.ts`.

### Task 5: Renderer Session Timer Dialog And Proposal Card

**Files:**
- Create: `apps/desktop/src/renderer/components/session-timer-dialog.tsx`
- Modify: `apps/desktop/src/renderer/components/agent-workspace.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] Add failing renderer tests:

```ts
it("creates a thread timer from the chat header", async () => {
  const fixture = installApi();
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Schedule in this session" }));
  fireEvent.change(await screen.findByLabelText("Timer name"), {
    target: { value: "Build monitor" },
  });
  fireEvent.change(screen.getByLabelText("Schedule description"), {
    target: { value: "every hour" },
  });
  fireEvent.change(screen.getByLabelText("Timer prompt"), {
    target: { value: "Check build status." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate schedule" }));
  await screen.findByDisplayValue("0 9 * * *");
  fireEvent.click(screen.getByRole("button", { name: "Create timer" }));

  await waitFor(() => expect(fixture.createAutomation).toHaveBeenCalledWith(expect.objectContaining({
    kind: "thread_chat",
    sessionId: "sf_session_existing",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
  })));
});

it("creates a thread timer from a proposal card", async () => {
  const fixture = installApi();
  render(<App />);
  await screen.findByText("Previous question");

  await act(async () => {
    fixture.emit({
      type: "automation.proposal",
      sessionId: "sf_session_existing",
      turnId: "sf_turn_active",
      proposalId: "automation-proposal-thread",
      proposal: {
        kind: "thread_chat",
        sessionId: "sf_session_existing",
        name: "Build monitor",
        scheduleText: "every hour",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "Every hour",
        nextRuns: ["2026-06-20T01:00:00.000Z"],
        prompt: "Check build status.",
        workspaceId: "workspace-1",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
      },
    });
  });

  fireEvent.click(await screen.findByRole("button", { name: "Create timer Build monitor" }));
  await waitFor(() => expect(fixture.createAutomation).toHaveBeenCalledWith(expect.objectContaining({
    kind: "thread_chat",
    sessionId: "sf_session_existing",
  })));
});
```

- [ ] Implement `SessionTimerDialog` with the same schedule generation and validation calls as V1, creating `kind: "thread_chat"` with the current session id.
- [ ] Add a clock button to `AgentWorkspace` with aria-label `Schedule in this session`.
- [ ] In `App`, load automations into state, refresh after create/update/delete, and compute active timer count for the selected session.
- [ ] Update proposal confirmation to pass `kind` and `sessionId` through to `automations.create`.
- [ ] Update proposal card labels: `Thread timer proposal` and `Create timer` for `thread_chat`; existing labels remain for scheduled chat.
- [ ] Run `corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/renderer/App.test.tsx`.

### Task 6: Automations Page Scope Labels

**Files:**
- Modify: `apps/desktop/src/renderer/components/automations-page.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] Preserve the existing local empty-schedule guard in `automations-page.tsx`:

```ts
const trimmedScheduleText = scheduleText.trim();
if (!trimmedScheduleText) {
  props.onError("Please enter a schedule description first");
  return;
}
```

- [ ] Add a failing renderer test that a `thread_chat` automation row shows `Thread Timer` and a scheduled chat row shows `Scheduled Chat`.
- [ ] Pass sessions into `AutomationsPage` so it can display the bound session title when available.
- [ ] Render a scope badge in `AutomationRow`:

```tsx
{props.automation.kind === "thread_chat" ? "Thread Timer" : "Scheduled Chat"}
```

- [ ] For thread timers, render the matching session title or the session id if the session is not loaded.
- [ ] Run `corepack pnpm --filter @story-forge/desktop test -- --run apps/desktop/src/renderer/App.test.tsx`.

### Task 7: Final Verification And Commit

**Files:**
- All changed files.

- [ ] Run `corepack pnpm --filter @story-forge/shared test`.
- [ ] Run `corepack pnpm --filter @story-forge/tools test`.
- [ ] Run `corepack pnpm --filter @story-forge/desktop test`.
- [ ] Run `corepack pnpm typecheck`.
- [ ] Run `git diff --check`.
- [ ] Review `git status --short` and confirm only Automations V2 changes plus the preserved empty-schedule guard are staged.
- [ ] Commit with `feat: add thread timers for automations v2`.
