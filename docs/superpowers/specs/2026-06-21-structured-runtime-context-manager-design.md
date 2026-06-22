# Structured Runtime Context Manager Design

## Goal

Build StoryForge's context manager into a first-class runtime module that assembles a
structured, inspectable context document for every agent turn.

The target model is:

```xml
<storyforge-context>
  <main>...</main>
  <skills>...</skills>
  <mcp>...</mcp>
  <project-info>...</project-info>
  <soul>...</soul>
</storyforge-context>
```

This XML document becomes the primary `system` message. Conversation history remains separate
role-preserving messages:

```ts
[
  { role: "system", content: "<storyforge-context>...</storyforge-context>" },
  ...conversationMessages
]
```

StoryForge should not serialize historical user, assistant, or tool messages into the system
prompt for real model calls. A `<messages>` XML view can exist in developer mode as a debugging
preview, but the provider payload must preserve native message roles and tool-call structure.

## Current State

`RuntimeContextAssembler` currently builds context in `packages/agent-core/src/runtime-context.ts`.
It already provides:

- Base StoryForge system prompt.
- Enabled Skills list.
- Active Skill body injection when a user explicitly invokes or implicitly mentions a Skill.
- Persisted session history converted into model `ChatMessage` values.
- Runtime settings such as response mode, developer mode, and command execution mode.

It does not yet provide:

- A structured XML system prompt.
- Project instruction discovery from `AGENTS.md`.
- MCP server and MCP tool context in the runtime prompt.
- MCP tools registered into the runtime `ToolRegistry`.
- Long-term memory context.
- A clean context-source model that developer mode can inspect.

## Design Principles

### One Structured System Document

StoryForge should emit one primary XML system document rather than several loosely ordered system
messages. This makes the payload easier to inspect, test, diff, and evolve.

Each section has a clear meaning:

- `<main>`: StoryForge's durable built-in identity, policy, permissions, automation guidance, and
  runtime behavior.
- `<skills>`: enabled Skills catalog plus the active Skill body for this turn, if any.
- `<mcp>`: enabled MCP servers, server instructions, and available MCP tool summaries.
- `<project-info>`: project-level guidance discovered from the workspace, starting with
  `AGENTS.md`.
- `<soul>`: long-term memory, user preferences, project lessons, and durable experience. This is a
  reserved module in V1 and becomes populated when memory exists.

### XML Is For Structure, Not Protocol Flattening

XML is used to structure system context. It should not flatten conversation history into the
system prompt. Role-aware messages must stay as provider messages because:

- `user`, `assistant`, and `tool` roles carry meaning.
- Tool-call IDs and tool results need protocol-level structure.
- Model request inspection should show the true provider payload.
- Future runtimes may need to map messages into SDK-native conversation formats.

### Context Sources Are Explicit

Every block should know where it came from, whether it was truncated, and how it should be
interpreted. The context manager should produce both:

1. A serialized XML system document for the model.
2. Structured metadata for developer-mode inspection and tests.

### MCP Is Both Prompt Context And Tools

MCP cannot be treated as only prompt text. The model needs a concise description of MCP servers
and tools in `<mcp>`, but the runtime must also expose enabled MCP tools as callable tool
definitions. Otherwise the assistant can describe MCP capabilities but cannot actually invoke
them.

## Context Precedence

The XML section order should stay close to the product mental model:

```xml
<main/>
<skills/>
<mcp/>
<project-info/>
<soul/>
```

Precedence is stated explicitly inside `<main>` so the visible order does not create ambiguity.

Recommended precedence:

1. Higher-priority platform/system/developer instructions outside StoryForge.
2. `<main>` StoryForge built-in runtime rules.
3. `<project-info>` project instructions.
4. Active `<skills>` instructions for this turn.
5. `<mcp>` server instructions and tool usage notes.
6. `<soul>` long-term memory.
7. Conversation messages.

When two lower-priority blocks conflict, the more specific project or active-turn instruction wins
unless it conflicts with `<main>` or external system instructions. `<soul>` is contextual memory,
not an enforcement layer.

## XML Shape

The serialized system message should use a stable root:

```xml
<storyforge-context version="1">
  <main>
    <![CDATA[
    You are StoryForge...
    ]]>
  </main>

  <skills count="2" active="/code-review">
    <available>
      <skill invocation="/code-review" name="Code Review">
        <![CDATA[Review changes for regressions.]]>
      </skill>
    </available>
    <active-skill invocation="/code-review" name="Code Review">
      <arguments><![CDATA[focus on auth]]></arguments>
      <instructions><![CDATA[...full SKILL.md body...]]></instructions>
    </active-skill>
  </skills>

  <mcp server-count="1" tool-count="2">
    <server name="github" transport="stdio" status="available">
      <instructions><![CDATA[...server instructions...]]></instructions>
      <tool name="list_issues">
        <![CDATA[List issues in a repository.]]>
      </tool>
    </server>
  </mcp>

  <project-info source-count="1">
    <source path="/workspace/AGENTS.md" scope="project" truncated="false">
      <![CDATA[...AGENTS.md content...]]>
    </source>
  </project-info>

  <soul source-count="0" status="empty">
    <![CDATA[No long-term memory has been recorded yet.]]>
  </soul>
</storyforge-context>
```

Use CDATA or an XML escaping helper for markdown bodies so project instructions and Skill bodies
can contain code blocks, angle brackets, and shell snippets without corrupting the XML.

## Runtime Data Model

Introduce a structured context bundle owned by `RuntimeContextAssembler` or a successor
`RuntimeContextManager`.

Proposed shape:

```ts
type RuntimeContextBundle = {
  turnId: TurnId;
  session: RuntimeSession;
  workspace: RuntimeWorkspace;
  settings: RuntimeSettings;
  document: StoryForgeContextDocument;
  systemMessage: ChatMessage;
  conversationMessages: ChatMessage[];
  messages: ChatMessage[];
  sources: RuntimeContextSource[];
  availableSkills: SkillView[];
  activeSkillInvocation?: RuntimeSkillInvocation;
  mcp: RuntimeMcpContext;
  soul: RuntimeSoulContext;
};
```

`messages` is derived from:

```ts
[
  systemMessage,
  ...conversationMessages,
]
```

`sources` is used by developer mode and tests. It should include source kind, title, path or
server name, byte count, truncation state, and warnings.

## Context Sections

### Main

`<main>` replaces `createBaseSystemMessage`. It should include:

- StoryForge identity.
- Workspace path.
- Instruction precedence.
- Edit-before-inspect discipline.
- Workspace-relative path guidance.
- Command execution and permission mode guidance.
- Automation proposal rules.
- Safety and honesty rules.
- A short explanation that XML sections are context blocks with explicit precedence.

This block is owned by StoryForge and should be tested as a stable prompt asset.

### Skills

`<skills>` replaces the separate available-skills and active-skill system messages.

It should include:

- Enabled Skills list.
- Invocation name.
- Human-readable name.
- Single-line description.
- Active Skill instructions when a Skill is explicitly invoked or uniquely inferred.
- Active Skill arguments.

The current progressive-disclosure behavior should remain:

- Always list enabled Skills in a compact catalog.
- Only include full `SKILL.md` body for the active Skill.
- Keep implicit invocation based on Skill description/name.
- Keep explicit slash invocation validation.

Budgeting:

- The available Skills catalog should be capped.
- Descriptions should be shortened before dropping Skills.
- Active Skill body may have its own cap and should warn when truncated.

### MCP

`<mcp>` should represent enabled MCP servers and tools.

It should include:

- Server name.
- Transport.
- Enabled/available status.
- Server instructions from initialization, when available.
- Tool name, description, and a compact input-schema summary.
- Warnings for failed, disabled, or untested servers.

Runtime behavior:

- Enabled MCP tools must be converted into StoryForge tool definitions.
- MCP tool calls must execute through an MCP client layer.
- MCP tool results should enter conversation history as normal tool results.
- MCP tool errors should be visible in the timeline.
- MCP tool approval policy should later integrate with command execution modes or a dedicated MCP
  permission mode.

The first implementation can support stdio MCP servers because the current configuration and test
path already emphasize local command-based servers. HTTP/SSE/WS should remain in the data model but
can be enabled incrementally.

### Project Info

`<project-info>` should load project instructions from the workspace.

V1 discovery:

- Start at the workspace root.
- Include `AGENTS.override.md` if present; otherwise include `AGENTS.md`.
- Skip empty files.
- Apply a byte cap, defaulting to 32 KiB unless we add a setting.
- Report truncation in context metadata and developer mode.

Future discovery:

- Walk from workspace root toward a focused working directory when StoryForge supports
  subdirectory-scoped sessions.
- Support fallback filenames if settings add them.
- Support imports only after explicit design, because imports can read additional files and need
  loop detection, path safety, and predictable limits.

Project instructions are guidance, not hard enforcement. For hard enforcement, future hooks or
permission policies are a separate module.

### Soul

`<soul>` is the long-term memory module.

V1 behavior:

- Include the section even when empty.
- Mark it as `status="empty"` or `status="unavailable"`.
- Do not invent memory content.

Future behavior:

- Load user preferences.
- Load project lessons and repeated mistakes.
- Load durable architectural decisions.
- Load compact summaries of prior work.
- Track provenance and timestamps.
- Keep a strict budget so memory does not crowd out project instructions or active task context.

Precedence:

- `<soul>` cannot override `<main>`.
- `<soul>` should not override project facts in `<project-info>`.
- If memory conflicts with current repository state, the agent should inspect the repository and
  prefer observed facts.

## Developer Mode And Observability

Developer mode should show both:

1. The true provider message payload.
2. A structured context breakdown.

The existing model request inspector already shows messages. It should eventually add a
Context tab or section that lists:

- XML system message preview.
- Source blocks by section.
- Token or byte estimate per block.
- Truncation warnings.
- Enabled Skills.
- Active Skill.
- Enabled MCP servers and tools.
- Project instruction files loaded.
- Soul status.

This is important because users explicitly want to understand what is sent to the model.

## Error Handling

Context assembly should be resilient but honest.

- Missing `AGENTS.md`: omit sources and include an empty `<project-info>` status.
- Invalid or unreadable `AGENTS.md`: continue without it and add a warning.
- MCP server startup failure: include a warning in `<mcp>` and do not register tools for that
  server.
- MCP tool listing failure: include the server as failed/unavailable.
- Skill resolver failure: fail explicit slash invocation, but avoid failing unrelated prompts
  unless the failure prevents safe context assembly.
- Soul provider failure: continue with `<soul status="unavailable">` and warning metadata.

Warnings should be available to developer mode. User-visible errors should be reserved for failures
that block the turn or make explicit user intent impossible.

## Testing Strategy

Unit tests should cover:

- XML serialization and escaping.
- Section ordering.
- Explicit precedence text in `<main>`.
- Enabled Skills catalog.
- Active Skill body injection.
- Disabled Skill exclusion.
- `AGENTS.md` discovery and truncation.
- Empty project-info behavior.
- Empty soul behavior.
- MCP server and tool summaries.
- Failed MCP server warnings.
- `messages` preserving role-aware conversation history outside XML.

Integration tests should cover:

- A turn request includes one XML system message plus persisted conversation messages.
- Developer-mode inspector can show the XML system message.
- Runtime tool registry includes native workspace tools plus enabled MCP tools.
- MCP tool call results checkpoint like native tool results.

Regression tests should ensure:

- Existing Skill invocation behavior keeps working.
- Existing automation proposal instructions remain present in `<main>`.
- Existing command execution mode behavior keeps working.
- Existing model request inspection continues to show real provider messages.

## Phased Implementation

### Phase 1: Structured XML System Context

- Add `StoryForgeContextDocument`.
- Add XML serializer.
- Move base prompt, Skills catalog, active Skill, empty MCP summary, project-info, and empty soul
  into the XML system message.
- Add `AGENTS.md` discovery from workspace root.
- Keep conversation messages separate.
- Update tests around `RuntimeContextAssembler`.

### Phase 2: MCP Runtime Integration

- Add an MCP runtime client interface in the runtime boundary.
- Load enabled MCP server tool descriptors.
- Render MCP tools in `<mcp>`.
- Register MCP tools into the native `ToolRegistry`.
- Execute MCP tool calls and persist results.
- Surface MCP warnings in developer mode.

### Phase 3: Long-Term Memory Provider

- Add `RuntimeSoulProvider`.
- Start with manually stored user/project memory.
- Add provenance, timestamps, caps, and conflict handling.
- Render memory into `<soul>`.
- Add UI/inspector affordances later.

## Non-Goals

- Do not implement general memory writing in this spec.
- Do not flatten conversation history into XML for real provider calls.
- Do not implement path-scoped project rules yet.
- Do not implement arbitrary import expansion from `AGENTS.md` yet.
- Do not migrate external SDK runtimes in this spec.
- Do not redesign the existing chat timeline or slash command UI.

## V1 Decisions

- Load `AGENTS.override.md` when present; otherwise load `AGENTS.md`.
- Do not load `CLAUDE.md` automatically in V1.
- Keep `<soul>` present but empty until a real memory provider exists.
- Keep historical conversation messages outside the XML system document for real provider calls.
- Treat MCP tool permissions as part of Phase 2 MCP runtime integration, not Phase 1 XML
  serialization.

## Deferred Decisions

- Whether StoryForge should support `CLAUDE.md` as a compatibility input.
- Whether project instruction discovery should support import expansion.
- Whether path-scoped project guidance should exist.
- Whether MCP should reuse command execution modes or get a dedicated permission setting.
- What token or byte budget `<soul>` should receive once long-term memory is implemented.
