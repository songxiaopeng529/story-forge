# Automations V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build Automations V1: users can create scheduled chats from a new Automations page or confirm an automation proposal produced by the agent, and StoryForge runs those automations locally while the desktop app is open.

**Architecture:** Add shared automation view/event types and Electron IPC APIs. Implement main-process automation storage, cron validation/preview, a local timer scheduler, and an automation runner that creates sessions and starts normal agent turns. Add an `automation.proposeCreate` tool to emit proposal events, then render Automations management UI and chat proposal cards in the renderer.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, `@story-forge/shared`, `@story-forge/tools`, `@story-forge/desktop`, and the `cron-parser` package in the desktop app.

---

### Task 1: Shared Types And API Surface

**Files:**
- Modify: `packages/shared/src/extensions.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/events.test.ts`
- Modify: `apps/desktop/src/shared/story-forge-api.ts`

- [x] Add `AutomationView`, `AutomationRunView`, `AutomationProposalView`, `ScheduleValidationResult`, `CreateAutomationInput`, and `UpdateAutomationInput` shared types.
- [x] Add `AutomationProposalEvent` to `AgentEvent`.
- [x] Extend `StoryForgeApi` with `automations.list`, `automations.getRuns`, `automations.validateSchedule`, `automations.interpretSchedule`, `automations.create`, `automations.update`, `automations.delete`, and `automations.runNow`.
- [x] Update shared event tests with an `automation.proposal` fixture and automation type compile checks.
- [x] Run `corepack pnpm --filter @story-forge/shared test`.

### Task 2: Cron Validation, Repository, And IPC

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/main/automation-schedule.ts`
- Create: `apps/desktop/src/main/automation-repository.ts`
- Create: `apps/desktop/src/main/automation-service.ts`
- Create: `apps/desktop/src/main/automation-service.test.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [x] Add `cron-parser` dependency to `@story-forge/desktop`.
- [x] Implement `validateSchedule()` with five-field cron, IANA timezone validation, human summary, and next 3 ISO runs.
- [x] Implement a conservative `interpretSchedule()` that recognizes common Chinese/English daily/hourly/weekly phrases locally and falls back to validation errors for unsupported text. Keep the API boundary ready for model-backed interpretation later.
- [x] Implement `AutomationRepository` under `<userData>/automations`.
- [x] Implement `AutomationService` for list/create/update/delete/getRuns/run record storage.
- [x] Register automations IPC handlers with Zod payload validation.
- [x] Expose the preload `automations` API.
- [x] Add tests for cron validation, repository CRUD, run history cap, and IPC validation.
- [x] Run targeted desktop main tests.

### Task 3: Scheduler, Runner, And Agent Proposal Tool

**Files:**
- Create: `apps/desktop/src/main/automation-scheduler.ts`
- Create: `packages/tools/src/automation-proposal-tool.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/tools/src/automation-proposal-tool.test.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [x] Add `createAutomationProposalTool()` that validates input, emits an `automation.proposal` event, and does not persist automations.
- [x] Inject the proposal tool into normal agent turns and add system prompt guidance for scheduled-task requests.
- [x] Add `AgentCoordinator.startAutomationRun()` or an equivalent automation-facing start path that creates a session and starts a turn with a configured prompt.
- [x] Implement `AutomationScheduler` with active timers, no missed-run backfill, overlap skip behavior, `runNow`, and reschedule after changes.
- [x] Wire scheduler startup in `main.ts`.
- [x] Add tests for proposal events, runner session creation, scheduler due run, and overlap skip.
- [x] Run tools and coordinator/scheduler tests.

### Task 4: Renderer Automations Page

**Files:**
- Modify: `apps/desktop/src/renderer/components/primary-navigation.tsx`
- Create: `apps/desktop/src/renderer/components/automations-page.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [x] Add `Automations` nav item.
- [x] Implement Automations page with list, compact editor, schedule validation/generation, next-run preview, pause/resume/delete, and run-now.
- [x] Load providers/workspaces from existing App state into the page.
- [x] Add renderer tests for navigation, create form, schedule validation, save, pause/resume, delete, and run now.
- [x] Run renderer tests.

### Task 5: Chat Proposal Card

**Files:**
- Modify: `apps/desktop/src/renderer/timeline.ts`
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/timeline.test.ts`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [x] Store automation proposal events in renderer memory keyed by session.
- [x] Add `automation-proposal` timeline items that outlive active turn activities.
- [x] Render a proposal card with Create automation and Cancel actions.
- [x] Confirming calls `automations.create`; cancel dismisses locally.
- [x] Add tests for proposal rendering, creation, and dismissal.
- [x] Run renderer timeline and App tests.

### Task 6: Final Verification And Commit

**Files:**
- All changed files.

- [x] Run `corepack pnpm --filter @story-forge/shared test`.
- [x] Run `corepack pnpm --filter @story-forge/tools test`.
- [x] Run `corepack pnpm --filter @story-forge/desktop test`.
- [x] Run `corepack pnpm typecheck`.
- [x] Review `git diff --check` and `git status --short`.
- [x] Commit with `feat: add automations v1`.
