# Response Mode and Progressive Agent Feedback Design

## Goal

Improve the chat experience so users receive immediate, trustworthy feedback after sending a prompt, while allowing them to choose a global response mode:

- `Auto`: prefer true model streaming when available, otherwise fall back to smooth playback.
- `Live`: use true model streaming and surface streaming failures clearly.
- `Smooth`: use non-streaming model calls, show waiting status, then play back the completed response progressively.

The first implementation should keep persistence stable: session history stores final messages, while transient UI states live in renderer memory.

## Current Message Types

StoryForge currently has three related message/event layers.

Model context messages, defined by `ChatMessage`:

- `system`: runtime instruction sent to the model, not persisted or shown in the session timeline.
- `user`: user task/query sent to the model.
- `assistant`: model response, with optional `reasoningContent` and `toolCalls`.
- `tool`: tool result replayed back to the model.

Persisted session messages, defined by `PersistedMessage`:

- `user`: user prompt stored in session history.
- `assistant`: final assistant response stored in session history.
- `tool`: final tool result stored in session history.

Runtime events, defined by `AgentEvent`:

- `runtime.started`
- `message.delta`
- `tool.call`
- `tool.result`
- `permission.request`
- `memory.write`
- `runtime.completed`
- `runtime.error`

Today, `message.delta` is emitted once with the complete assistant content because providers only expose `chat(): Promise<ChatResponse>`.

## UX Design

Add a global `Response mode` segmented control in Settings. If the dedicated Settings page remains minimal, the control can initially live in the existing navigation destination for Settings or in a small global settings panel.

Modes:

- `Auto`: default. Try live streaming for providers that support it. If streaming is unavailable or fails before producing content, fall back to smooth playback.
- `Live`: require live streaming where supported. If unsupported, show a clear inline state and keep the turn recoverable.
- `Smooth`: do not request streaming. Show waiting progress, then render the completed response with typewriter playback.

After the user sends a prompt:

1. Immediately render the user message optimistically.
2. Insert an assistant pending item with status text such as `Thinking...`.
3. If no model output has arrived after short intervals, update the status to more specific waiting copy, such as `Waiting for model response...` and then `Still waiting on provider/model...`.
4. Render tool events as timeline items as soon as `tool.call` and `tool.result` arrive.
5. Render assistant content progressively:
   - In `Live` or live-capable `Auto`, append true deltas as they arrive.
   - In `Smooth`, or fallback mode, play back the final response locally after it arrives.
6. On completion, replace transient timeline state with the persisted session snapshot.

Tool timeline items should show at least:

- queued/calling state from `tool.call`
- completed/failed state from `tool.result`
- expandable input/output details

## Settings Architecture

Add an application settings store separate from provider credentials:

```ts
type ResponseMode = "auto" | "live" | "smooth";

type AppSettings = {
  schemaVersion: 1;
  responseMode: ResponseMode;
};
```

Store it as `settings.json` under Electron `app.getPath("userData")`, using the existing atomic JSON helpers. This store is not encrypted because it contains no secret material.

Expose settings through IPC and preload:

- `settings.get(): Promise<AppSettingsView>`
- `settings.save(input: { responseMode: ResponseMode }): Promise<AppSettingsView>`

The renderer loads settings with providers, workspaces, and sessions during startup and keeps the selected mode in app state.

## Streaming Architecture

Extend the model gateway without breaking existing providers:

```ts
type ChatStreamEvent =
  | { type: "content.delta"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "tool.call"; toolCall: ToolCall }
  | { type: "done"; response: ChatResponse };

interface ModelProvider {
  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>;
  streamChat?(
    request: ChatRequest,
    options?: ChatOptions,
  ): AsyncIterable<ChatStreamEvent>;
}
```

`AgentLoop` chooses the path based on response mode and provider capability:

- `smooth`: always call `chat()`.
- `live`: call `streamChat()` if present; otherwise emit a recoverable runtime error.
- `auto`: call `streamChat()` if present; otherwise call `chat()`.

OpenAI-compatible providers should be the first streaming target because DeepSeek, OpenAI, OpenRouter, and Volcano share the same broad protocol shape. Anthropic can initially use smooth fallback and receive a dedicated streaming adapter later.

For OpenAI-compatible streaming, parse SSE chunks from `/chat/completions` with `stream: true`, accumulating final content, reasoning content, and tool calls into the final `ChatResponse`. Emit `message.delta` as content deltas arrive. Tool calls can be emitted when complete enough to execute safely; partial tool-call argument deltas should remain internal until valid JSON is available.

## Renderer Timeline

Introduce a renderer-only derived timeline model that merges persisted messages with active turn events:

- persisted `user`, `assistant`, `tool` messages
- pending assistant status item
- active assistant streaming item
- active tool call/result items
- runtime error/completion state

This avoids mutating persisted messages for animation and keeps the existing session repository focused on final state.

The existing Activity panel can either be folded into this timeline or remain as a developer detail panel. The user-facing path should show tool activity inline in the conversation area.

## Error Handling

- If streaming fails before any assistant content in `Auto`, retry once with `chat()` and show a small `Switched to smooth playback` notice.
- If streaming fails after partial content, stop the turn with a visible error rather than silently replacing text.
- If `Live` is selected for an unsupported provider, show an inline message that the provider does not support live streaming yet.
- Preserve existing secret redaction for runtime errors.
- Keep the Stop button wired through the same abort signal for streaming and non-streaming turns.

## Testing

Add tests at these layers:

- Settings store persists `responseMode` and defaults to `auto`.
- IPC validates settings input.
- Renderer loads and saves the global mode.
- Renderer shows pending status immediately after send.
- Renderer merges `message.delta`, `tool.call`, and `tool.result` into the visible timeline.
- Smooth mode typewriter playback does not persist intermediate text.
- Agent loop uses `streamChat()` in live/auto when available and falls back according to mode.
- OpenAI-compatible streaming parser accumulates content, reasoning, and complete tool calls.

## Non-Goals

- Persisting partial assistant text.
- Showing or storing system prompts in normal session history.
- Implementing Anthropic streaming in the first pass.
- Adding provider-specific response mode settings.
- Reworking provider credential storage.
