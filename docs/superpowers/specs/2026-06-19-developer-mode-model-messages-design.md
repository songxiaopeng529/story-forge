# Developer Mode Model Messages Design

## Goal

Add a developer mode that lets users inspect the exact message payloads StoryForge sends to the model during a turn. The first version is intentionally simple: it exposes model requests for the current renderer session only, shows them in a right-side docked drawer inside the chat workspace, and avoids persisting debug payloads to local session files.

## User Experience

Developer mode is controlled from Settings with a new `Developer mode` toggle. It is off by default.

When developer mode is off:

- The chat UI does not show the model-message inspector button.
- The main process does not emit model request debug events.
- Renderer memory does not collect model request payloads.

When developer mode is on:

- The chat header shows a small inspector button on the right side.
- Clicking the button opens a docked drawer on the right side of the current chat workspace.
- On desktop widths, the drawer pushes the conversation area narrower.
- On narrower widths, the drawer switches to overlay behavior so the chat does not collapse into an unusable width.
- The drawer lists model requests for the selected session, grouped as `Model Request #1`, `Model Request #2`, and so on.
- Each request displays the ordered messages that were actually sent to the provider after context trimming.
- Each message shows its role first, then its content. Assistant tool calls and tool response metadata are shown as formatted JSON.
- The drawer includes a `Copy JSON` action for the selected request.

The drawer is deliberately rough for the first version. Readability and correctness matter more than polish.

## Data Scope

Model request payloads are not persisted to session storage in v1. They live only in renderer memory and are lost on reload.

This avoids storing sensitive debug data such as:

- System prompts.
- Tool outputs.
- File contents read from the workspace.
- Conversation history after trimming.

Developer mode is a visibility feature, not a logging feature. Persistent debug history can be reconsidered later with explicit redaction and retention controls.

## Settings Model

Extend the app settings view:

```ts
type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
  developerMode: boolean;
};
```

Defaults:

- `responseMode: "auto"`
- `developerMode: false`

The settings store accepts partial saves so the Settings page can update developer mode without rewriting unrelated fields incorrectly.

## Runtime Event

Add a shared runtime event:

```ts
type ModelRequestEvent = {
  type: "model.request";
  sessionId: SessionId;
  turnId: TurnId;
  requestId: string;
  providerId: string;
  model: string;
  responseMode: ResponseMode;
  messages: InspectableModelMessage[];
  tools: InspectableModelTool[];
};
```

`InspectableModelMessage` is a plain JSON type in `@story-forge/shared`. It mirrors the parts of `ChatMessage` that are useful to inspect without making `@story-forge/shared` depend on `@story-forge/model-gateway`:

```ts
type InspectableModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      reasoningContent?: string;
      toolCalls?: Array<{ id: string; name: string; input: unknown }>;
    }
  | { role: "tool"; content: string; name: string; toolCallId: string };
```

Tools are also summarized as plain JSON:

```ts
type InspectableModelTool = {
  name: string;
  description: string;
  parameters: unknown;
};
```

The event is emitted immediately before the provider request is made, after context trimming and tool schema generation. That timing makes the payload match what the model actually sees.

## Backend Flow

The settings store gains `developerMode`.

`AgentCoordinator` reads both response settings for a turn:

- `responseMode` controls live/smooth/auto behavior.
- `developerMode` controls whether model request debug events should be emitted.

`AgentLoop` is extended with optional debug metadata:

- Whether model request inspection is enabled.
- Provider id.
- Model name.

Before each call to `chat()` or `streamChat()`, the loop builds the final request object, emits `model.request` when enabled, and then sends the request to the provider. Multi-step tool turns produce multiple model request events.

The debug event uses the existing `onEvent` path. If that path treats event failures as fatal, the model request follows the existing behavior; v1 does not introduce a separate error policy for debug events.

## Renderer Flow

`App` keeps model request debug state in memory:

```ts
Record<SessionId, ModelRequestEvent[]>
```

When a `model.request` event arrives, the renderer appends it to the matching session's debug state. When a new prompt starts for a session, the renderer clears that session's previous model request debug state so the drawer reflects the current turn and any later events.

`AgentWorkspace` receives:

- `developerMode`
- model request events for the selected session
- drawer open state and callbacks

The workspace header renders the inspector button only when developer mode is enabled. The workspace body becomes a two-column layout when the drawer is open: conversation on the left, inspector drawer on the right.

## Inspector Drawer

The drawer is a new renderer component named `ModelRequestDrawer`.

It shows:

- Empty state: `No model requests captured yet.`
- Request list with request id/order, provider/model, and message count.
- Message cards grouped under the selected request.
- Role labels with simple visual distinction.
- Tool schema count and collapsible JSON summary.
- `Copy JSON` for the selected request.

The first request is selected by default when requests exist.

## Testing

Shared tests:

- Settings defaults include `developerMode: false`.
- `model.request` is a valid non-terminal `AgentEvent`.

Main process tests:

- Settings store persists developer mode.
- Settings IPC validates developer mode saves.
- Agent coordinator passes developer mode into the loop.

Agent core tests:

- When inspection is enabled, a model request event is emitted before `chat()`.
- In live mode, a model request event is emitted before `streamChat()`.
- Multi-step tool turns emit one model request event per provider request.
- When inspection is disabled, no model request event is emitted.

Renderer tests:

- Settings page loads and saves developer mode.
- Inspector button appears only when developer mode is on.
- Clicking the button opens a right drawer that shows captured model messages.
- Starting a new prompt clears previous captured requests for that session.
- `Copy JSON` writes the selected request payload to clipboard.

## Non-Goals

- Persisting model request history.
- Redacting arbitrary message content.
- Token counting.
- Prompt diffing.
- Search/filter in the inspector.
- Editing or replaying model requests.
- MCP or Skills management. Developer mode is useful groundwork for those later features, but this change does not add MCP/Skills configuration.

## Open Decisions Resolved

- Layout: right-side docked drawer that pushes the chat area on desktop.
- Storage: renderer memory only in v1.
- Trigger: Settings-level developer mode toggle.
- Capture point: immediately before the provider request, after trimming and tool schema construction.
