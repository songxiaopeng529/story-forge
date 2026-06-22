# Agent Runtime Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route production agent turns through `AgentRuntime`, with `NativeAgentRuntime` using StoryForge `AgentLoop` internally and `AgentCoordinator` reduced to a desktop host.

**Architecture:** Shared runtime types and context assembly live in `@story-forge/agent-core`; desktop storage and UI-facing bridges remain injected services from `apps/desktop/src/main`. `NativeAgentRuntime` assembles context, creates tools, calls `AgentLoop`, maps checkpoints, and emits `AgentEvent` values; future SDK runtimes can implement `AgentRuntime` without using `AgentLoop`.

**Tech Stack:** TypeScript, Vitest, pnpm/turbo, existing `@story-forge/agent-core`, `@story-forge/desktop`, `@story-forge/tools`, `@story-forge/shared`, and `@story-forge/model-gateway` packages.

---

## File Structure

- Modify: `packages/agent-core/src/agent-runtime.ts`
  - Replace the old `runTurn(userInput: string)` contract with `AgentRuntimeTurnInput`, `RuntimeContext`, service interfaces, and `AgentRuntime.runTurn(input)`.
- Create: `packages/agent-core/src/runtime-context.ts`
  - Build ordered system blocks, resolve enabled/active Skills, assemble persisted messages, and expose helper message conversion utilities.
- Modify: `packages/agent-core/src/native-agent-runtime.ts`
  - Replace the old single-chat runtime with an implementation that calls `AgentLoop`.
- Modify: `packages/agent-core/src/native-agent-runtime.test.ts`
  - Test the new runtime contract, checkpointing, developer-mode model inspection, and the fact that native runtime uses `AgentLoop` behavior.
- Modify: `packages/agent-core/src/index.ts`
  - Export new runtime context types.
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
  - Inject or construct an `AgentRuntime`; keep active turn, session reservation, permission bridge, and final status handling.
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`
  - Add tests proving `AgentCoordinator` can run through a fake runtime without `AgentLoop`, and update existing behavior tests to pass through the native runtime.

## Task 1: Runtime Contract And Context Assembler

**Files:**
- Modify: `packages/agent-core/src/agent-runtime.ts`
- Create: `packages/agent-core/src/runtime-context.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/native-agent-runtime.test.ts`

- [ ] **Step 1: Write failing runtime contract tests**

Add tests that instantiate `NativeAgentRuntime` with injected session/workspace/settings/skill services and call:

```ts
runtime.runTurn({
  sessionId: "sf_session_test",
  turnId: "sf_turn_test",
  prompt: "/code-review check regressions",
});
```

Assert that the provider sees system messages containing:

```text
You are StoryForge
Available StoryForge skills
Active StoryForge skill: Code Review
workspace.runCommand / workspace_runCommand
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/native-agent-runtime.test.ts
```

Expected: FAIL because `NativeAgentRuntime.runTurn` still accepts a string and no runtime context assembler exists.

- [ ] **Step 3: Implement the runtime types**

In `packages/agent-core/src/agent-runtime.ts`, define:

```ts
export type AgentRuntimeTurnInput = {
  sessionId: SessionId;
  turnId: TurnId;
  prompt: string;
  signal?: AbortSignal;
};

export interface AgentRuntime {
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentEvent>;
}
```

Also add service interfaces for sessions, workspaces, settings, Skills, providers, permissions, and checkpoint writing. Keep these interfaces dependency-injected so `agent-core` does not import desktop repositories.

- [ ] **Step 4: Implement `RuntimeContextAssembler`**

Create `packages/agent-core/src/runtime-context.ts` with:

```ts
export class RuntimeContextAssembler {
  async build(input: AgentRuntimeTurnInput): Promise<RuntimeContext> {
    // load session/workspace/settings/skills
    // resolve active skill
    // build system messages
    // append persisted messages
  }
}
```

Move the current skill registry and active-skill system message text out of `AgentCoordinator` into this assembler.

- [ ] **Step 5: Verify agent-core tests pass**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/native-agent-runtime.test.ts
```

Expected: PASS for new context assembly tests.

## Task 2: NativeAgentRuntime Uses AgentLoop

**Files:**
- Modify: `packages/agent-core/src/native-agent-runtime.ts`
- Modify: `packages/agent-core/src/native-agent-runtime.test.ts`

- [ ] **Step 1: Write failing native runtime loop tests**

Add tests that prove:

- Native runtime emits `runtime.started`, `message.delta`, and `runtime.completed`.
- Native runtime persists assistant/tool/tool-result checkpoints through the injected checkpoint writer.
- Native runtime emits `model.request` when developer mode is enabled.
- Native runtime handles workspace tool calls through the injected tool factory.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/native-agent-runtime.test.ts
```

Expected: FAIL because the old runtime performs only one provider chat and does not call `AgentLoop`.

- [ ] **Step 3: Rewrite `NativeAgentRuntime`**

Implement `NativeAgentRuntime` so it:

```ts
async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentEvent> {
  const context = await this.contextAssembler.build(input);
  const provider = this.providerFactory.createProvider(context.provider.config, context.provider.apiKey);
  const tools = this.toolFactory.create(context);
  const events: AgentEvent[] = [];
  const result = await new AgentLoop({ provider, tools }).run({
    sessionId: input.sessionId,
    turnId: input.turnId,
    responseMode: context.settings.responseMode,
    inspectModelRequests: context.inspectModelRequests,
    signal: input.signal,
    messages: context.messages,
    onEvent: (event) => events.push(this.redactor.redact(event, context.secrets)),
    onCheckpoint: (messages) => this.checkpointWriter.write(input.sessionId, messages, context),
  });
  for (const event of events) yield event;
}
```

If implementation needs live yielding instead of buffering, use an async queue. Preserve event order.

- [ ] **Step 4: Verify native runtime tests pass**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/native-agent-runtime.test.ts
```

Expected: PASS.

## Task 3: AgentCoordinator Becomes Desktop Host

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`

- [ ] **Step 1: Write failing coordinator fake-runtime test**

Add a test that constructs `AgentCoordinator` with a fake runtime:

```ts
const runtime: AgentRuntime = {
  async *runTurn(input) {
    yield { type: "runtime.started", sessionId: input.sessionId, turnId: input.turnId, createdAt: now };
    yield { type: "message.delta", sessionId: input.sessionId, turnId: input.turnId, content: "Fake runtime" };
    yield { type: "runtime.completed", sessionId: input.sessionId, turnId: input.turnId, stopReason: "completed" };
  },
};
```

Assert that `AgentCoordinator` forwards events, marks the session `completed`, and does not require a `providerFactory`.

- [ ] **Step 2: Run the failing coordinator test**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- src/main/agent-coordinator.test.ts
```

Expected: FAIL because `AgentCoordinator` still constructs `AgentLoop` directly.

- [ ] **Step 3: Refactor coordinator options**

Update `AgentCoordinatorOptions` to accept either:

```ts
runtime?: AgentRuntime;
runtimeFactory?: AgentRuntimeFactory;
```

For production, construct `NativeAgentRuntime` from existing desktop stores and bridges. For tests, allow injecting a fake runtime.

- [ ] **Step 4: Move prompt/system/tool/checkpoint logic out of coordinator**

Remove from `AgentCoordinator`:

- `createAvailableSkillsSystemMessage`
- `createSkillSystemMessage`
- direct `ToolRegistry` construction
- direct `AgentLoop` construction
- `toChatMessage`
- `toPersistedMessages`

Keep:

- active turn map
- pending permissions map
- user message append
- status updates
- stop/wait behavior

- [ ] **Step 5: Verify coordinator tests pass**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- src/main/agent-coordinator.test.ts
```

Expected: PASS.

## Task 4: Regression Suite And Typecheck

**Files:**
- Modify as needed based on compiler feedback.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test
corepack pnpm --filter @story-forge/desktop test
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
corepack pnpm test
```

Expected: PASS across all packages.

- [ ] **Step 3: Run typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for architecture boundaries**

Run:

```bash
git diff --stat
rg -n "new AgentLoop|createAvailableSkillsSystemMessage|createSkillSystemMessage" apps/desktop/src/main/agent-coordinator.ts packages/agent-core/src
```

Expected:

- `new AgentLoop` appears only in native runtime code.
- Skill system message builders do not remain in `AgentCoordinator`.
- No production desktop code bypasses `AgentRuntime`.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add packages/agent-core apps/desktop docs/superpowers/plans/2026-06-21-agent-runtime-abstraction.md
git commit -m "refactor: route agent turns through runtime abstraction"
```

Expected: commit succeeds with tests passing before commit.
