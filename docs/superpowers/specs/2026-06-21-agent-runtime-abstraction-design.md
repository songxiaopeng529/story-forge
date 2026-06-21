# Agent Runtime Abstraction Design

## Goal

Refactor StoryForge so `AgentRuntime` becomes the real product-level runtime boundary.
The runtime abstraction should let StoryForge keep its own desktop experience, session model,
permission system, Skills, MCP, automations, developer-mode inspection, and event protocol while
allowing different agent execution engines underneath.

The target architecture must support:

- `NativeAgentRuntime`, backed by StoryForge's own `AgentLoop`.
- Future `CodexAgentRuntime`, backed by a Codex-style external agent SDK.
- Future `PaAgentRuntime`, backed by a PA Agent SDK.
- Additional runtimes that implement the same StoryForge runtime contract.

The important shift is that polymorphism belongs at the `AgentRuntime` layer, not the `AgentLoop`
layer. `AgentLoop` is the native runtime's internal loop engine; external SDK runtimes use their
own loop engines and adapt them to StoryForge's runtime contract.

## Current Problem

The original design introduced `AgentRuntime` and `NativeAgentRuntime`, but the production path
currently bypasses them.

Current production path:

```text
AgentCoordinator
  -> creates provider
  -> creates workspace sandbox
  -> creates StoryForge tools
  -> resolves Skills
  -> builds system messages
  -> calls AgentLoop.run()
  -> persists checkpoints
  -> emits AgentEvent values
```

Current dead path:

```text
AgentRuntime
  -> NativeAgentRuntime
```

This means `AgentCoordinator` has become the de facto runtime. It owns desktop coordination,
runtime context assembly, tool creation, Skills injection, automation proposal wiring, checkpoint
conversion, and event forwarding. That makes future external SDK integration harder because any new
SDK would have to duplicate desktop-specific orchestration or bypass existing product capabilities.

## Core Concepts

### AgentRuntime

`AgentRuntime` is the stable StoryForge runtime interface consumed by desktop hosts,
automations, tests, and future runtime selectors.

It should expose a turn-level API:

```ts
export interface AgentRuntime {
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentEvent>;
}
```

The exact implementation can be native or backed by an external SDK. Consumers should not need to
know which loop engine is used.

### NativeAgentRuntime

`NativeAgentRuntime` is StoryForge's built-in runtime implementation.

It should:

- Build a StoryForge `RuntimeContext`.
- Create the native tool registry.
- Call StoryForge's `AgentLoop`.
- Persist checkpoints through runtime services.
- Convert loop callbacks into `AgentEvent` values.

`NativeAgentRuntime` owns the native execution path, but it should not become a single large file
containing every concern. It should coordinate focused collaborators such as a context assembler,
tool factory, prompt builder, and checkpoint mapper.

### AgentLoop

`AgentLoop` is not the base class for all runtimes.

It is the internal loop engine used by `NativeAgentRuntime`. It owns the native while loop:

```text
while true:
  trim context
  call model
  emit deltas
  append assistant message
  execute tool calls
  append tool results
  checkpoint
  stop when complete or limited
```

Future external SDK runtimes do not override or subclass `AgentLoop`. They implement
`AgentRuntime` and call their own SDK loop.

### External Runtime Adapters

Future runtimes such as `CodexAgentRuntime` and `PaAgentRuntime` should look like adapters:

```text
StoryForge RuntimeContext
  -> SDK-specific input
  -> SDK-specific loop/events
  -> StoryForge AgentEvent stream
  -> StoryForge checkpoint/session model
```

These adapters may not use StoryForge `AgentLoop` at all. Their job is to preserve StoryForge's
product contract while delegating execution to the external SDK.

## Runtime Context Assembly

Context assembly is a StoryForge product capability and should be shared by all runtimes.

StoryForge decides what context should exist. Runtime implementations decide how to execute with it.

Shared context assembly should cover:

- Base StoryForge system prompt.
- Workspace identity and path.
- Provider and model identity.
- Session history.
- Enabled Skills registry.
- Active Skill instructions for the current turn.
- MCP server configuration and available tools.
- Automation proposal instructions.
- Command execution mode.
- Response mode.
- Developer mode / model request inspection state.
- Future memory or repo-index context.

Proposed shape:

```ts
export type AgentRuntimeTurnInput = {
  sessionId: SessionId;
  turnId: TurnId;
  prompt: string;
  signal?: AbortSignal;
};

export type RuntimeContext = {
  session: {
    id: SessionId;
    workspaceId: string;
    providerId: ProviderId;
    model: string;
  };
  workspace: {
    id: string;
    path: string;
  };
  messages: ChatMessage[];
  systemBlocks: RuntimeSystemBlock[];
  tools: RuntimeToolDefinition[];
  skills: RuntimeSkillContext;
  mcp: RuntimeMcpContext;
  settings: {
    responseMode: ResponseMode;
    developerMode: boolean;
    commandExecutionMode: CommandExecutionMode;
  };
};
```

`RuntimeContextAssembler` should be shared by all runtime implementations:

```text
NativeAgentRuntime
  -> RuntimeContextAssembler
  -> StoryForge AgentLoop

CodexAgentRuntime
  -> RuntimeContextAssembler
  -> Codex SDK adapter

PaAgentRuntime
  -> RuntimeContextAssembler
  -> PA Agent SDK adapter
```

This keeps Skills, MCP, automations, permissions, and developer-mode model inspection from drifting
across runtime implementations.

## Proposed Architecture

```text
Desktop Host
  AgentCoordinator
    - validates prompt
    - creates turn id
    - reserves active session
    - appends user message
    - marks session running
    - wires stop and permission responses
    - consumes AgentRuntime events

Agent Runtime Boundary
  AgentRuntime interface
    - NativeAgentRuntime
    - CodexAgentRuntime
    - PaAgentRuntime

Shared Runtime Services
  RuntimeContextAssembler
  RuntimePromptBuilder
  RuntimeToolFactory
  RuntimeCheckpointMapper
  RuntimeSecretRedactor

Native Runtime Internals
  NativeAgentRuntime
    -> RuntimeContextAssembler
    -> RuntimeToolFactory
    -> AgentLoop

External Runtime Internals
  CodexAgentRuntime
    -> RuntimeContextAssembler
    -> map context to Codex SDK input
    -> consume Codex SDK events
    -> emit StoryForge AgentEvent values
```

## Responsibility Split

### AgentCoordinator

After refactor, `AgentCoordinator` should be a desktop host, not the runtime implementation.

It keeps responsibility for:

- Prompt validation.
- Session reservation and active turn tracking.
- Turn id creation.
- Appending the user message before execution.
- Marking session status.
- Stop handling through `AbortController`.
- Permission request response bridging.
- Emitting runtime events to the renderer.
- Waiting for running turns.

It should no longer own:

- System prompt construction.
- Skills system message construction.
- Tool registry construction.
- Automation proposal tool wiring.
- Model provider invocation.
- Agent loop execution.
- Chat message to persisted message conversion.
- Runtime checkpoint semantics.

### AgentRuntime

Every runtime implementation should own one turn of execution from StoryForge's point of view.

It owns:

- Runtime context assembly.
- Tool and SDK adapter preparation.
- Calling the underlying loop engine.
- Mapping underlying events to `AgentEvent`.
- Calling checkpoint services.
- Returning terminal status through events.

### RuntimeContextAssembler

The assembler owns product context.

It should:

- Load the session and workspace.
- Resolve provider metadata needed by the runtime.
- Load settings.
- Resolve enabled Skills.
- Detect active Skill invocation.
- Load MCP configuration and tool metadata.
- Build ordered system blocks.
- Combine system blocks with persisted session messages.

It should not:

- Execute model calls.
- Execute tools.
- Emit UI events directly.
- Persist loop checkpoints by itself.

### RuntimeToolFactory

The tool factory owns StoryForge tool creation.

It should create tools for:

- Workspace file operations.
- Workspace command execution.
- Automation proposal drafting.
- Ask-user or permission-style tools when added.
- MCP tools when execution is enabled.

It should receive a runtime permission bridge instead of directly depending on renderer code.

### AgentLoop

`AgentLoop` keeps native loop mechanics:

- Model request loop.
- Tool call execution order.
- Streaming and smooth playback.
- Repeated tool call detection.
- Consecutive tool failure detection.
- Step and duration limits.
- Context trimming for native model providers.
- Native checkpoint callback.

It should not know about desktop session repositories, app settings stores, or renderer IPC.

## Runtime Selection

The first refactor can hard-code `NativeAgentRuntime` as the only runtime. The interface should
leave room for future runtime selection:

```ts
export type AgentRuntimeKind = "native" | "codex" | "pa";
```

Future selection can live in settings or workspace configuration:

```text
Settings
  Agent runtime: Native / Codex / PA
```

The runtime selector should create the selected runtime behind the `AgentRuntime` interface.

V1 of this refactor should not implement Codex or PA runtimes. It should create a clean seam so
those adapters can be added later without changing desktop UI or automation code.

## Native Runtime Flow

```text
AgentCoordinator.start()
  -> append user message
  -> mark session running
  -> runtime.runTurn({ sessionId, turnId, prompt, signal })
       -> RuntimeContextAssembler.build()
       -> RuntimeToolFactory.create()
       -> providerFactory.createProvider()
       -> AgentLoop.run()
            -> emit runtime.started
            -> emit model.request if developer mode is enabled
            -> emit message.delta
            -> emit tool.call / tool.result
            -> checkpoint messages
            -> emit runtime.completed or runtime.error
  -> AgentCoordinator forwards events to renderer
  -> AgentCoordinator marks final session status
```

The user message is still appended before runtime execution so the UI immediately reflects the
prompt and session title derivation remains stable.

## Future Codex Runtime Flow

```text
AgentCoordinator.start()
  -> append user message
  -> mark session running
  -> codexRuntime.runTurn({ sessionId, turnId, prompt, signal })
       -> RuntimeContextAssembler.build()
       -> map RuntimeContext to Codex SDK input
       -> register StoryForge tools / MCP tools with Codex SDK
       -> run Codex SDK loop
       -> map Codex content stream to message.delta
       -> map Codex tool call events to tool.call / tool.result
       -> map Codex permission requests to permission.request
       -> checkpoint mapped StoryForge messages
       -> emit runtime.completed or runtime.error
```

Codex runtime does not subclass or rewrite StoryForge `AgentLoop`. It bypasses it and adapts Codex
SDK behavior to StoryForge's runtime protocol.

## Event Protocol

`AgentEvent` remains the stable protocol between runtimes and the desktop host.

All runtimes should emit compatible events:

- `runtime.started`
- `model.request`
- `message.delta`
- `tool.call`
- `tool.result`
- `permission.request`
- `automation.proposal`
- `response.fallback` when relevant
- `runtime.completed`
- `runtime.error`

Runtime-specific events should not leak into renderer code directly. If an external SDK exposes
events that StoryForge cannot represent, add a StoryForge event intentionally rather than passing
through SDK-native shapes.

## Checkpointing And Persistence

The runtime should not write raw SDK state into session messages.

Each runtime should map its execution state into StoryForge's persisted message model:

- user messages
- assistant messages
- tool calls
- tool results
- reasoning content when available

Native runtime can keep using the existing `AgentLoop` checkpoint callback after moving the mapping
out of `AgentCoordinator`.

External runtimes must provide equivalent checkpoint mapping. If an SDK has richer internal state,
that state can be stored separately later, but the chat UI should continue to read StoryForge
messages.

## Skills And MCP

Skills and MCP are part of StoryForge context, not native-loop-only features.

Rules:

- Enabled Skills registry is assembled once by shared context assembly.
- Active Skill instruction is inserted by shared context assembly.
- MCP configuration and tool metadata are assembled by shared context assembly.
- Runtime adapters decide how to expose the resulting instructions and tools to their loop engine.

Native runtime:

```text
RuntimeContext.systemBlocks -> ChatMessage[] system messages
RuntimeContext.tools -> ToolRegistry
```

External runtime:

```text
RuntimeContext.systemBlocks -> SDK instructions
RuntimeContext.tools -> SDK tool registrations
RuntimeContext.mcp -> SDK MCP config or StoryForge-hosted MCP tool wrappers
```

## Error Handling And Permissions

Permission handling should stay in StoryForge.

Runtime implementations can request permission through a shared bridge:

```ts
export type RuntimePermissionBridge = {
  requestCommandPermission(input: RuntimeCommandPermissionRequest): Promise<boolean>;
};
```

The desktop host owns the UI response path. Runtimes should not know about renderer components.

Errors should be redacted before being emitted to UI. Secret redaction should move into a shared
runtime service so it applies to native and future external runtimes.

## Migration Plan

The implementation should be incremental.

1. Expand `AgentRuntime` input types.
2. Add characterization tests around current `AgentCoordinator` behavior.
3. Add runtime service interfaces in `@story-forge/agent-core`.
4. Extract context assembly from `AgentCoordinator`.
5. Extract tool creation from `AgentCoordinator`.
6. Rewrite `NativeAgentRuntime` to call `RuntimeContextAssembler`, `RuntimeToolFactory`, and
   `AgentLoop`.
7. Change `AgentCoordinator` to depend on `AgentRuntime`.
8. Move checkpoint mapping from `AgentCoordinator` into runtime services.
9. Remove or update obsolete tests for the old `runTurn(userInput: string)` runtime.
10. Add a small fake external runtime test double to prove the desktop host can run through the
    `AgentRuntime` interface without `AgentLoop`.

## Testing Strategy

Add tests at four levels.

### Agent Core

- `AgentRuntime` type-level behavior through fake implementations.
- `RuntimeContextAssembler` system block ordering.
- `RuntimeContextAssembler` skill injection behavior.
- `NativeAgentRuntime` calls `AgentLoop` and emits expected events.
- Native checkpoint mapping preserves assistant messages, tool calls, and tool results.

### Desktop Main

- `AgentCoordinator` starts a turn through an injected runtime.
- `AgentCoordinator` forwards runtime events.
- `AgentCoordinator` handles terminal events and marks session status.
- Permission response bridging still resolves pending runtime permission requests.

### Regression Tests

- Existing Skills injection remains visible in developer-mode model requests.
- Automation proposal tool still emits proposal events.
- Command execution mode still controls command permission behavior.
- Session timer automations still wake the same session.

### Adapter Readiness

- A fake SDK runtime implements `AgentRuntime` without using `AgentLoop`.
- The fake runtime emits `message.delta` and `runtime.completed`.
- Desktop host and session persistence work without knowing the runtime is fake.

## Non-Goals

This spec does not implement:

- A real Codex runtime.
- A real PA Agent runtime.
- Runtime selection UI.
- Cloud execution.
- Cross-device session sync.
- Persisting external SDK private state.
- A new chat UI.
- A new model provider abstraction.

The goal is to restore the runtime boundary and make future SDK adapters natural.

## Implementation Decisions

Use these decisions for the first implementation plan:

- Define runtime interfaces and shared types in `@story-forge/agent-core`.
- Keep durable desktop storage implementations in `apps/desktop/src/main`, injected through service
  interfaces. This avoids making `agent-core` depend on Electron or desktop repositories.
- Put `RuntimeContextAssembler` in `@story-forge/agent-core` as orchestration logic that receives
  injected services for session, workspace, settings, Skills, MCP, and provider metadata.
- Resolve active Skill invocation inside `RuntimeContextAssembler` so all runtimes receive the same
  active-skill context.
- Resolve provider connection details inside each runtime. The assembler can expose provider id,
  model, and workspace/session metadata, while each runtime decides how to create or delegate its
  execution client.
- Keep final session status ownership in `AgentCoordinator`. Runtimes emit terminal events;
  the desktop host interprets terminal events and marks session lifecycle state. This preserves the
  host boundary for desktop session management.

## Acceptance Criteria

The refactor is successful when:

- Production turns go through `AgentRuntime`.
- `NativeAgentRuntime` is used by the desktop app.
- `AgentCoordinator` no longer constructs system prompts, tool registries, or `AgentLoop` directly.
- `AgentLoop` remains native-runtime internals and is not required by fake external runtimes.
- Skills, MCP-ready context, automations, command permissions, response mode, and developer-mode
  inspection still behave as before.
- Tests prove a runtime implementation can run without using StoryForge `AgentLoop`.
- The architecture clearly supports adding `CodexAgentRuntime` later as a new adapter rather than
  as a rewrite of `AgentLoop`.
