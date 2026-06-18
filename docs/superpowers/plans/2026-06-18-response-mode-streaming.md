# Response Mode Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global response mode setting, true streaming for OpenAI-compatible providers, smooth playback fallback, and a conversation timeline that shows model/tool progress immediately.

**Architecture:** Add a small Electron `settings.json` store and expose it through IPC/preload to the renderer. Extend the model gateway with optional `streamChat()`, teach `AgentLoop` to choose live or smooth delivery per response mode, and keep persisted sessions final-only while the renderer derives transient pending/streaming/tool timeline items from runtime events.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Vitest, pnpm, existing atomic JSON helpers, OpenAI-compatible SSE parsing with Web `ReadableStream`.

---

## Scope Notes

- Preserve existing uncommitted renderer work in the working tree. Do not revert changes in `apps/desktop/src/renderer/App.tsx`, `App.test.tsx`, `agent-workspace.tsx`, `models-page.tsx`, or `session-sidebar.tsx`.
- Anthropic streaming is outside this implementation. In this plan Anthropic remains smooth fallback.
- Do not persist partial assistant text. Persisted session files should still contain only final `user`, `assistant`, and `tool` messages.

## File Structure

- `packages/shared/src/settings.ts`: shared `ResponseMode`, `MessageDeliveryMode`, and settings view types.
- `packages/shared/src/events.ts`: adds delivery metadata to `message.delta` and adds a small fallback notice event.
- `packages/shared/src/index.ts`: exports the new settings types.
- `apps/desktop/src/main/app-settings-store.ts`: reads/writes `settings.json` under Electron user data.
- `apps/desktop/src/main/app-settings-store.test.ts`: tests defaults, persistence, and validation.
- `apps/desktop/src/shared/story-forge-api.ts`: adds settings IPC channels and renderer API shape.
- `apps/desktop/src/main/ipc-handlers.ts`: validates and registers settings handlers.
- `apps/desktop/src/main/ipc-handlers.test.ts`: covers settings IPC validation.
- `apps/desktop/src/preload/index.ts`: exposes `window.storyForge.settings`.
- `apps/desktop/src/main/main.ts`: creates `AppSettingsStore`, exposes settings IPC, and later passes response mode lookup to the coordinator.
- `apps/desktop/src/main/agent-coordinator.ts`: reads current response mode and passes it to `AgentLoop`.
- `apps/desktop/src/main/agent-coordinator.test.ts`: verifies response mode is forwarded.
- `packages/model-gateway/src/model-provider.ts`: adds stream event types and optional `streamChat()`.
- `packages/model-gateway/src/openai-compatible.ts`: implements SSE streaming for OpenAI-compatible providers.
- `packages/model-gateway/src/openai-compatible.test.ts`: tests stream request body, deltas, reasoning accumulation, and tool-call reconstruction.
- `packages/agent-core/src/agent-loop.ts`: selects smooth/live/auto transport, emits delivery-tagged deltas, and handles fallback.
- `packages/agent-core/src/agent-loop.test.ts`: tests smooth mode, live mode, auto fallback, and unsupported live mode.
- `apps/desktop/src/renderer/components/settings-page.tsx`: new global settings UI.
- `apps/desktop/src/renderer/components/conversation-timeline.tsx`: renders final and active timeline items.
- `apps/desktop/src/renderer/timeline.ts`: pure derivation helpers for timeline items.
- `apps/desktop/src/renderer/use-typewriter-text.ts`: small hook for smooth playback.
- `apps/desktop/src/renderer/App.tsx`: loads settings, supports Settings page, and passes timeline inputs.
- `apps/desktop/src/renderer/App.test.tsx`: covers settings UI, pending state, live deltas, tool timeline, and smooth playback.

---

### Task 1: Shared Settings and Runtime Event Types

**Files:**
- Create: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/events.test.ts`

- [ ] **Step 1: Write the failing shared type/event test**

Modify `packages/shared/src/events.test.ts`.

Add this import below the existing imports:

```ts
import type { ResponseMode } from "./settings";
```

Add this fixture after `messageDeltaEvent`:

```ts
const liveMessageDeltaEvent = {
  type: "message.delta",
  sessionId,
  turnId,
  content: "hello",
  delivery: "live",
} satisfies AgentEvent;

const responseFallbackEvent = {
  type: "response.fallback",
  sessionId,
  turnId,
  from: "live",
  to: "smooth",
  reason: "stream unavailable",
} satisfies AgentEvent;
```

Add both fixtures to `agentEventFixtures`:

```ts
  liveMessageDeltaEvent,
  responseFallbackEvent,
```

Add these tests:

```ts
describe("settings types", () => {
  it("accepts the three global response modes", () => {
    const modes: ResponseMode[] = ["auto", "live", "smooth"];

    expect(modes).toEqual(["auto", "live", "smooth"]);
  });
});

describe("AgentEvent", () => {
  it("allows delivery metadata and fallback notices without marking them terminal", () => {
    expect(liveMessageDeltaEvent.delivery).toBe("live");
    expect(responseFallbackEvent.to).toBe("smooth");
    expect(isTerminalAgentEvent(liveMessageDeltaEvent)).toBe(false);
    expect(isTerminalAgentEvent(responseFallbackEvent)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run:

```bash
corepack pnpm --filter @story-forge/shared test -- events.test.ts
```

Expected: FAIL because `./settings` does not exist and `response.fallback` is not part of `AgentEvent`.

- [ ] **Step 3: Add shared settings types**

Create `packages/shared/src/settings.ts`:

```ts
export type ResponseMode = "auto" | "live" | "smooth";

export type MessageDeliveryMode = "live" | "smooth";

export type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
};
```

- [ ] **Step 4: Extend runtime event types**

Modify `packages/shared/src/events.ts`:

```ts
import type { MessageDeliveryMode } from "./settings";
```

Update `MessageDeltaEvent`:

```ts
export type MessageDeltaEvent = {
  type: "message.delta";
  sessionId: SessionId;
  turnId: TurnId;
  content: string;
  delivery?: MessageDeliveryMode;
};
```

Add a new event type:

```ts
export type ResponseFallbackEvent = {
  type: "response.fallback";
  sessionId: SessionId;
  turnId: TurnId;
  from: "live";
  to: "smooth";
  reason: string;
};
```

Include it in `AgentEvent`:

```ts
export type AgentEvent =
  | RuntimeStartedEvent
  | RuntimeCompletedEvent
  | RuntimeErrorEvent
  | MessageDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | MemoryWriteEvent
  | ResponseFallbackEvent;
```

- [ ] **Step 5: Export settings types**

Modify `packages/shared/src/index.ts`:

```ts
export * from "./events";
export * from "./settings";
```

- [ ] **Step 6: Run the shared tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test -- events.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/shared/src/settings.ts packages/shared/src/events.ts packages/shared/src/index.ts packages/shared/src/events.test.ts
git commit -m "feat: add response mode event types"
```

---

### Task 2: Desktop Settings Store

**Files:**
- Create: `apps/desktop/src/main/app-settings-store.ts`
- Create: `apps/desktop/src/main/app-settings-store.test.ts`

- [ ] **Step 1: Write the failing settings store tests**

Create `apps/desktop/src/main/app-settings-store.test.ts`:

```ts
// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppSettingsStore } from "./app-settings-store";

describe("AppSettingsStore", () => {
  it("defaults response mode to auto", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.get()).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
    });
  });

  it("persists the selected response mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
    });
    await expect(new AppSettingsStore({ rootDir }).get()).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
    });
    await expect(readFile(join(rootDir, "settings.json"), "utf8")).resolves.toContain(
      "\"responseMode\": \"smooth\"",
    );
  });
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- app-settings-store.test.ts
```

Expected: FAIL because `app-settings-store.ts` does not exist.

- [ ] **Step 3: Implement the settings store**

Create `apps/desktop/src/main/app-settings-store.ts`:

```ts
import type { AppSettingsView, ResponseMode } from "@story-forge/shared";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

const responseModeSchema = z.enum(["auto", "live", "smooth"]);

const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  responseMode: responseModeSchema,
});

export type SaveAppSettingsInput = {
  responseMode: ResponseMode;
};

export class AppSettingsStore {
  private readonly settingsPath: string;

  constructor(options: { rootDir: string }) {
    this.settingsPath = join(options.rootDir, "settings.json");
  }

  get(): Promise<AppSettingsView> {
    return readJson(this.settingsPath, appSettingsSchema, createDefaultSettings());
  }

  async save(input: SaveAppSettingsInput): Promise<AppSettingsView> {
    const settings = appSettingsSchema.parse({
      schemaVersion: 1,
      responseMode: input.responseMode,
    });
    await writeJsonAtomic(this.settingsPath, settings);
    return settings;
  }
}

function createDefaultSettings(): AppSettingsView {
  return {
    schemaVersion: 1,
    responseMode: "auto",
  };
}
```

- [ ] **Step 4: Run the store test**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- app-settings-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/desktop/src/main/app-settings-store.ts apps/desktop/src/main/app-settings-store.test.ts
git commit -m "feat: persist app response settings"
```

---

### Task 3: Settings IPC, Preload API, and Main Wiring

**Files:**
- Modify: `apps/desktop/src/shared/story-forge-api.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Write failing IPC test coverage**

Modify `apps/desktop/src/main/ipc-handlers.test.ts`.

Add an import:

```ts
import type { AppSettingsStore } from "./app-settings-store";
```

Add this test inside `describe("registerIpcHandlers", ...)`:

```ts
  it("registers settings APIs and validates response mode input", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    await expect(fixture.invoke(IPC_CHANNELS.settingsGet)).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "smooth" }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "unsupported" }),
    ).rejects.toThrow();
  });
```

In `createFixture()`, add:

```ts
  const settings = {
    get: vi.fn(async () => ({ schemaVersion: 1 as const, responseMode: "auto" as const })),
    save: vi.fn(async (input) => ({ schemaVersion: 1 as const, ...input })),
  } as unknown as AppSettingsStore;
```

Add `settings` to `options`:

```ts
      settings,
```

- [ ] **Step 2: Run the IPC test to verify it fails**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- ipc-handlers.test.ts
```

Expected: FAIL because settings channels and handler options do not exist.

- [ ] **Step 3: Extend shared renderer API types**

Modify `apps/desktop/src/shared/story-forge-api.ts`.

Update imports:

```ts
import type { AppSettingsView, ResponseMode } from "@story-forge/shared";
```

Add channels:

```ts
  settingsGet: "story-forge:settings:get",
  settingsSave: "story-forge:settings:save",
```

Add to `StoryForgeApi`:

```ts
  settings: {
    get(): Promise<AppSettingsView>;
    save(input: { responseMode: ResponseMode }): Promise<AppSettingsView>;
  };
```

- [ ] **Step 4: Register settings handlers**

Modify `apps/desktop/src/main/ipc-handlers.ts`.

Add import:

```ts
import type { AppSettingsStore } from "./app-settings-store";
```

Add schema:

```ts
const responseModeSchema = z.enum(["auto", "live", "smooth"]);
```

Add `settings` to `IpcHandlerOptions`:

```ts
  settings: AppSettingsStore;
```

Register handlers near the top of `registerIpcHandlers`:

```ts
  handle(options.ipc, IPC_CHANNELS.settingsGet, z.undefined(), () =>
    options.settings.get()
  );
  handle(
    options.ipc,
    IPC_CHANNELS.settingsSave,
    z.object({ responseMode: responseModeSchema }),
    (input) => options.settings.save(input),
  );
```

- [ ] **Step 5: Expose settings from preload**

Modify `apps/desktop/src/preload/index.ts`:

```ts
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, input),
  },
```

Place it beside `providers`, `workspaces`, and `sessions`.

- [ ] **Step 6: Wire settings store into settings IPC in Electron main**

Modify `apps/desktop/src/main/main.ts`.

Add import:

```ts
import { AppSettingsStore } from "./app-settings-store";
```

Create the store after `rootDir`:

```ts
  const settingsStore = new AppSettingsStore({ rootDir });
```

Keep the existing coordinator construction unchanged in this task. The coordinator response mode callback is added in Task 7.

Pass the settings store into IPC registration:

```ts
    settings: settingsStore,
```

- [ ] **Step 7: Run the IPC test**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/desktop/src/shared/story-forge-api.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-handlers.test.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/main.ts
git commit -m "feat: expose global response settings"
```

---

### Task 4: Settings UI in Renderer

**Files:**
- Create: `apps/desktop/src/renderer/components/settings-page.tsx`
- Modify: `apps/desktop/src/renderer/components/primary-navigation.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing renderer settings tests**

Modify `apps/desktop/src/renderer/App.test.tsx`.

Add `AppSettingsView` to the type import:

```ts
  AppSettingsView,
```

Add this test inside `describe("App", ...)`:

```ts
  it("loads and saves the global response mode from Settings", async () => {
    const fixture = installApi({ settings: { schemaVersion: 1, responseMode: "auto" } });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Smooth" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      responseMode: "smooth",
    }));
    expect(screen.getByRole("button", { name: "Smooth" })).toHaveAttribute("aria-pressed", "true");
  });
```

Update `installApi` signature:

```ts
function installApi(options: { settings?: AppSettingsView } = {}) {
```

Add:

```ts
  const settings = options.settings ?? {
    schemaVersion: 1 as const,
    responseMode: "auto" as const,
  };
  const saveSettings = vi.fn(async (input) => ({ ...settings, ...input }));
```

Add the API group:

```ts
    settings: {
      get: vi.fn(async () => settings),
      save: saveSettings,
    },
```

Return `saveSettings` from the fixture.

- [ ] **Step 2: Run the renderer test to verify it fails**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: FAIL because Settings is not a clickable page and settings API is not loaded.

- [ ] **Step 3: Make Settings navigation real**

Modify `apps/desktop/src/renderer/components/primary-navigation.tsx`.

Update the page type:

```ts
export type Page = "agent" | "models" | "settings";
```

Replace the static Settings row with a button:

```tsx
        <div className="mt-6 border-t border-white/10 pt-4">
          <NavButton
            active={props.page === "settings"}
            icon={<Settings size={17} />}
            label="Settings"
            onClick={() => props.onChange("settings")}
          />
        </div>
```

- [ ] **Step 4: Create SettingsPage**

Create `apps/desktop/src/renderer/components/settings-page.tsx`:

```tsx
import type { ResponseMode } from "@story-forge/shared";

const responseModes: Array<{
  value: ResponseMode;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Use live streaming when available, otherwise smooth playback.",
  },
  {
    value: "live",
    label: "Live",
    description: "Prefer true model streaming and show unsupported-provider errors.",
  },
  {
    value: "smooth",
    label: "Smooth",
    description: "Show waiting status, then play back completed responses.",
  },
];

export function SettingsPage(props: {
  responseMode: ResponseMode;
  saving: boolean;
  error: string | undefined;
  onResponseModeChange: (responseMode: ResponseMode) => void;
}) {
  return (
    <section className="min-h-0 min-w-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Global preferences for StoryForge behavior.
        </p>

        <div className="mt-7 rounded-lg border border-forge-line bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Response mode</h3>
              <p className="mt-1 text-sm text-slate-500">
                Choose how model responses appear while an agent turn is running.
              </p>
            </div>
            {props.saving ? <span className="text-xs text-slate-500">Saving...</span> : null}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {responseModes.map((mode) => (
              <button
                aria-pressed={props.responseMode === mode.value}
                className={`rounded-md border px-3 py-3 text-left ${
                  props.responseMode === mode.value
                    ? "border-forge-ember bg-orange-50 text-forge-ember"
                    : "border-forge-line hover:bg-slate-50"
                }`}
                key={mode.value}
                onClick={() => props.onResponseModeChange(mode.value)}
                type="button"
              >
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="mt-1 block text-xs text-slate-500">{mode.description}</span>
              </button>
            ))}
          </div>

          {props.error ? (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {props.error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Load and save settings in App**

Modify `apps/desktop/src/renderer/App.tsx`.

Add imports:

```ts
import type { ResponseMode } from "@story-forge/shared";
import { SettingsPage } from "./components/settings-page";
```

Add state:

```ts
  const [responseMode, setResponseMode] = useState<ResponseMode>("auto");
  const [settingsSaving, setSettingsSaving] = useState(false);
```

Load settings in the initial `Promise.all`:

```ts
        const [nextSettings, nextProviders, nextWorkspaces, nextSessions] = await Promise.all([
          window.storyForge.settings.get(),
          window.storyForge.providers.list(),
          window.storyForge.workspaces.list(),
          window.storyForge.sessions.list(),
        ]);
```

Then set it:

```ts
        setResponseMode(nextSettings.responseMode);
```

Add a save handler:

```ts
  async function saveResponseMode(nextResponseMode: ResponseMode): Promise<void> {
    setResponseMode(nextResponseMode);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        responseMode: nextResponseMode,
      });
      setResponseMode(saved.responseMode);
    } catch (settingsError) {
      setError(formatError(settingsError));
    } finally {
      setSettingsSaving(false);
    }
  }
```

Render Settings:

```tsx
      {page === "settings" ? (
        <SettingsPage
          responseMode={responseMode}
          saving={settingsSaving}
          error={error}
          onResponseModeChange={(nextResponseMode) => void saveResponseMode(nextResponseMode)}
        />
      ) : page === "models" ? (
```

- [ ] **Step 6: Run the renderer test**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: PASS after Task 3 API wiring exists.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/desktop/src/renderer/components/settings-page.tsx apps/desktop/src/renderer/components/primary-navigation.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat: add global response mode settings"
```

---

### Task 5: Model Gateway Streaming API and OpenAI-Compatible Streaming

**Files:**
- Modify: `packages/model-gateway/src/model-provider.ts`
- Modify: `packages/model-gateway/src/openai-compatible.ts`
- Modify: `packages/model-gateway/src/openai-compatible.test.ts`

- [ ] **Step 1: Write failing streaming parser tests**

Append this helper and test to `packages/model-gateway/src/openai-compatible.test.ts`:

```ts
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

it("streams content deltas and returns the accumulated response", async () => {
  const fetch = vi.fn(async () => streamResponse([
    "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
    "data: {\"choices\":[{\"delta\":{\"content\":\"lo\",\"reasoning_content\":\"thinking\"}}]}\n\n",
    "data: [DONE]\n\n",
  ]));
  const provider = new OpenAICompatibleProvider({
    apiKey: "sf_test_key",
    baseUrl: "https://models.example.test/v1",
    model: "story-forge-small",
    fetch,
  });

  const events = [];
  for await (const event of provider.streamChat({
    messages: [{ role: "user", content: "Say hello" }],
  })) {
    events.push(event);
  }

  expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toMatchObject({
    stream: true,
  });
  expect(events).toEqual([
    { type: "content.delta", content: "Hel" },
    { type: "content.delta", content: "lo" },
    { type: "reasoning.delta", content: "thinking" },
    {
      type: "done",
      response: {
        content: "Hello",
        reasoningContent: "thinking",
        toolCalls: [],
      },
    },
  ]);
});
```

Add a second test for streamed tool calls:

```ts
it("reconstructs streamed tool calls from argument chunks", async () => {
  const fetch = vi.fn(async () => streamResponse([
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"workspace_readFile\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]}}]}\n\n",
    "data: [DONE]\n\n",
  ]));
  const provider = new OpenAICompatibleProvider({
    apiKey: "sf_test_key",
    baseUrl: "https://models.example.test/v1",
    model: "story-forge-small",
    fetch,
  });

  const events = [];
  for await (const event of provider.streamChat({
    messages: [{ role: "user", content: "Read" }],
    tools: [{
      name: "workspace.readFile",
      description: "Read a workspace file",
      parameters: { type: "object" },
    }],
  })) {
    events.push(event);
  }

  expect(events.at(-1)).toEqual({
    type: "done",
    response: {
      content: "",
      toolCalls: [{
        id: "call_1",
        name: "workspace.readFile",
        input: { path: "README.md" },
      }],
    },
  });
});
```

- [ ] **Step 2: Run the model-gateway streaming tests to verify they fail**

Run:

```bash
corepack pnpm --filter @story-forge/model-gateway test -- openai-compatible.test.ts
```

Expected: FAIL because `streamChat` does not exist.

- [ ] **Step 3: Add stream types to the provider interface**

Modify `packages/model-gateway/src/model-provider.ts`:

```ts
export type ChatStreamEvent =
  | { type: "content.delta"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "tool.call"; toolCall: ToolCall }
  | { type: "done"; response: ChatResponse };
```

Update `ModelProvider`:

```ts
  streamChat?(
    request: ChatRequest,
    options?: ChatOptions,
  ): AsyncIterable<ChatStreamEvent>;
```

- [ ] **Step 4: Implement `streamChat` request setup**

Modify `OpenAICompatibleProvider` in `packages/model-gateway/src/openai-compatible.ts`.

Update imports:

```ts
  ChatStreamEvent,
```

Set default capability to streaming:

```ts
      streaming: options.capabilities?.streaming ?? true,
```

Add `streamChat`:

```ts
  async *streamChat(
    request: ChatRequest,
    options: ChatOptions = {},
  ): AsyncIterable<ChatStreamEvent> {
    const toolNameMap = createToolNameMap(request.tools ?? []);
    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages.map((message) => toOpenAICompatibleMessage(message, toolNameMap)),
        ...(request.tools ? { tools: request.tools.map((tool) => toOpenAICompatibleTool(tool, toolNameMap)) } : {}),
        stream: true,
        ...this.extraBody,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      throw new Error(await createProviderError(response));
    }
    if (!response.body) {
      throw new Error("OpenAI-compatible provider returned an invalid stream: missing body");
    }

    yield* parseOpenAICompatibleStream(response.body, toolNameMap);
  }
```

- [ ] **Step 5: Add SSE parsing helpers**

Add these helpers to `packages/model-gateway/src/openai-compatible.ts`:

```ts
type OpenAICompatibleStreamDelta = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

type StreamingToolCallAccumulator = {
  id?: string;
  name?: string;
  argumentsText: string;
};

async function* parseOpenAICompatibleStream(
  body: ReadableStream<Uint8Array>,
  toolNameMap: Map<string, string>,
): AsyncIterable<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, StreamingToolCallAccumulator>();
  let buffer = "";
  let content = "";
  let reasoningContent = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice("data:".length).trim();
      if (!data || data === "[DONE]") {
        continue;
      }

      const payload = JSON.parse(data) as OpenAICompatibleStreamDelta;
      const delta = payload.choices?.[0]?.delta;
      if (!delta) {
        continue;
      }
      if (delta.content) {
        content += delta.content;
        yield { type: "content.delta", content: delta.content };
      }
      if (delta.reasoning_content) {
        reasoningContent += delta.reasoning_content;
        yield { type: "reasoning.delta", content: delta.reasoning_content };
      }
      for (const toolCallDelta of delta.tool_calls ?? []) {
        const index = toolCallDelta.index ?? 0;
        const current = toolCalls.get(index) ?? { argumentsText: "" };
        current.id = toolCallDelta.id ?? current.id;
        current.name = toolCallDelta.function?.name ?? current.name;
        current.argumentsText += toolCallDelta.function?.arguments ?? "";
        toolCalls.set(index, current);
      }
    }
  }

  const parsedToolCalls = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => parseStreamingToolCall(toolCall, toolNameMap));
  for (const toolCall of parsedToolCalls) {
    yield { type: "tool.call", toolCall };
  }
  yield {
    type: "done",
    response: {
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      toolCalls: parsedToolCalls,
    },
  };
}

function parseStreamingToolCall(
  toolCall: StreamingToolCallAccumulator,
  toolNameMap: Map<string, string>,
) {
  return parseToolCall(
    {
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.argumentsText,
      },
    },
    toolNameMap,
  );
}
```

- [ ] **Step 6: Update the existing capabilities test**

In `packages/model-gateway/src/openai-compatible.test.ts`, update the canonical capabilities expectation:

```ts
      streaming: true,
```

- [ ] **Step 7: Run model-gateway tests**

Run:

```bash
corepack pnpm --filter @story-forge/model-gateway test -- openai-compatible.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add packages/model-gateway/src/model-provider.ts packages/model-gateway/src/openai-compatible.ts packages/model-gateway/src/openai-compatible.test.ts
git commit -m "feat: stream openai-compatible responses"
```

---

### Task 6: Agent Loop Response Mode Selection and Fallback

**Files:**
- Modify: `packages/agent-core/src/agent-loop.ts`
- Modify: `packages/agent-core/src/agent-loop.test.ts`

- [ ] **Step 1: Write failing agent loop response mode tests**

Modify `packages/agent-core/src/agent-loop.test.ts`.

Add import:

```ts
import type { ChatStreamEvent } from "@story-forge/model-gateway";
```

Add this helper near `fakeProvider`:

```ts
function streamingProvider(events: ChatStreamEvent[]): ModelProvider {
  return {
    id: "streaming-fake",
    capabilities: {
      toolCalling: true,
      streaming: true,
      jsonSchema: false,
      contextWindowTokens: 1000,
    },
    chat: async () => {
      throw new Error("chat should not be called");
    },
    async *streamChat() {
      for (const event of events) {
        yield event;
      }
    },
  };
}
```

Add tests:

```ts
  it("uses streamChat in live mode and emits live deltas", async () => {
    const events = [];
    const result = await new AgentLoop({
      provider: streamingProvider([
        { type: "content.delta", content: "Hel" },
        { type: "content.delta", content: "lo" },
        { type: "done", response: { content: "Hello", toolCalls: [] } },
      ]),
      tools: new ToolRegistry(),
    }).run({
      sessionId,
      turnId,
      responseMode: "live",
      messages: [{ role: "user", content: "Say hello" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "Hel",
      delivery: "live",
    });
    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "lo",
      delivery: "live",
    });
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Hello" });
  });

  it("falls back from auto streaming to smooth chat before content arrives", async () => {
    const events = [];
    const provider: ModelProvider = {
      id: "fallback-fake",
      capabilities: {
        toolCalling: true,
        streaming: true,
        jsonSchema: false,
        contextWindowTokens: 1000,
      },
      chat: async () => ({ content: "Smooth answer", toolCalls: [] }),
      async *streamChat() {
        throw new Error("network stream failed");
      },
    };

    await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "auto",
      messages: [{ role: "user", content: "Recover" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toContainEqual({
      type: "response.fallback",
      sessionId,
      turnId,
      from: "live",
      to: "smooth",
      reason: "network stream failed",
    });
    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "Smooth answer",
      delivery: "smooth",
    });
  });

  it("reports unsupported live streaming as an unrecoverable live-mode error", async () => {
    const provider = fakeProvider(async () => ({ content: "unexpected", toolCalls: [] }));
    const events = [];

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "live",
      messages: [{ role: "user", content: "Live only" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(result.stopReason).toBe("unrecoverable-error");
    expect(events).toContainEqual(expect.objectContaining({
      type: "runtime.error",
      message: "Live streaming is not available for fake.",
    }));
  });
```

- [ ] **Step 2: Run agent-core tests to verify they fail**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- agent-loop.test.ts
```

Expected: FAIL because `responseMode` is not accepted and streaming is not used.

- [ ] **Step 3: Add responseMode to run input and imports**

Modify `packages/agent-core/src/agent-loop.ts`.

Update imports:

```ts
  ChatResponse,
  ChatStreamEvent,
```

Add:

```ts
import type { MessageDeliveryMode, ResponseMode } from "@story-forge/shared";
```

Update `AgentLoopRunInput`:

```ts
  responseMode?: ResponseMode;
```

- [ ] **Step 4: Add model response helper**

In `packages/agent-core/src/agent-loop.ts`, add this method inside `AgentLoop`:

```ts
  private async requestModelResponse(input: {
    request: {
      messages: ChatMessage[];
      tools: ReturnType<ToolRegistry["schemas"]>;
    };
    options: { signal: AbortSignal };
    responseMode: ResponseMode;
    sessionId: SessionId;
    turnId: TurnId;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
  }): Promise<ChatResponse> {
    if (input.responseMode === "smooth") {
      return this.requestSmoothResponse({ ...input, delivery: "smooth" });
    }
    if (!this.provider.streamChat) {
      if (input.responseMode === "live") {
        throw new Error(`Live streaming is not available for ${this.provider.id}.`);
      }
      return this.requestSmoothResponse({ ...input, delivery: "smooth" });
    }

    try {
      return await this.requestStreamingResponse(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (input.responseMode === "auto") {
        await emit(input, {
          type: "response.fallback",
          sessionId: input.sessionId,
          turnId: input.turnId,
          from: "live",
          to: "smooth",
          reason: message,
        });
        return this.requestSmoothResponse({ ...input, delivery: "smooth" });
      }
      throw error;
    }
  }

  private async requestSmoothResponse(input: {
    request: {
      messages: ChatMessage[];
      tools: ReturnType<ToolRegistry["schemas"]>;
    };
    options: { signal: AbortSignal };
    delivery: MessageDeliveryMode;
    sessionId: SessionId;
    turnId: TurnId;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
  }): Promise<ChatResponse> {
    const response = await this.provider.chat(input.request, input.options);
    if (response.content) {
      await emit(input, {
        type: "message.delta",
        sessionId: input.sessionId,
        turnId: input.turnId,
        content: response.content,
        delivery: input.delivery,
      });
    }
    return response;
  }

  private async requestStreamingResponse(input: {
    request: {
      messages: ChatMessage[];
      tools: ReturnType<ToolRegistry["schemas"]>;
    };
    options: { signal: AbortSignal };
    sessionId: SessionId;
    turnId: TurnId;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
  }): Promise<ChatResponse> {
    let response: ChatResponse | undefined;
    for await (const event of this.provider.streamChat?.(input.request, input.options) ?? []) {
      if (event.type === "content.delta") {
        await emit(input, {
          type: "message.delta",
          sessionId: input.sessionId,
          turnId: input.turnId,
          content: event.content,
          delivery: "live",
        });
      }
      if (event.type === "done") {
        response = event.response;
      }
    }
    if (!response) {
      throw new Error("Streaming response ended before a final response was received");
    }
    return response;
  }
```

- [ ] **Step 5: Use the helper in the main loop**

Replace the direct `this.provider.chat(...)` call in `run()` with:

```ts
        const response = await this.requestModelResponse({
          request: {
            messages: trimMessagesToContext(
              messages,
              Math.floor(this.provider.capabilities.contextWindowTokens * 0.8),
            ),
            tools: this.tools.schemas(),
          },
          options: { signal: abort.signal },
          responseMode: input.responseMode ?? "auto",
          sessionId: input.sessionId,
          turnId: input.turnId,
          onEvent: input.onEvent,
        });
```

Remove the old one-shot `message.delta` emit inside `if (response.toolCalls.length === 0)`, because the helper now emits deltas for both smooth and live modes.

- [ ] **Step 6: Ensure errors are emitted by the existing catch block**

In the `catch (error)` block, keep existing `runtime.error` behavior. The unsupported live-mode error should be emitted by the existing catch path.

- [ ] **Step 7: Run agent-core tests**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- agent-loop.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add packages/agent-core/src/agent-loop.ts packages/agent-core/src/agent-loop.test.ts
git commit -m "feat: route agent responses by response mode"
```

---

### Task 7: Desktop Coordinator Response Mode Wiring

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Write failing coordinator test**

Modify `apps/desktop/src/main/agent-coordinator.test.ts`.

Add this import below the existing imports:

```ts
import type { AgentEvent } from "@story-forge/shared";
```

Add a test that passes a streaming provider and verifies live delivery:

```ts
  it("passes the current response mode into the agent loop", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => ({
          id: "streaming-provider",
          capabilities: {
            toolCalling: true,
            streaming: true,
            jsonSchema: true,
            contextWindowTokens: 1000,
          },
          chat: async () => {
            throw new Error("chat should not be used");
          },
          async *streamChat() {
            yield { type: "content.delta" as const, content: "Hi" };
            yield {
              type: "done" as const,
              response: { content: "Hi", toolCalls: [] },
            };
          },
        }),
      },
      getResponseMode: async () => "live",
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "message.delta",
      content: "Hi",
      delivery: "live",
    }));
  });
```

Add this second test to verify the default remains `auto`:

```ts
  it("defaults response mode lookup to auto when not provided", async () => {
    const fixture = await createFixture();
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => ({
          id: "streaming-provider",
          capabilities: {
            toolCalling: true,
            streaming: true,
            jsonSchema: true,
            contextWindowTokens: 1000,
          },
          chat: async () => ({ content: "fallback", toolCalls: [] }),
          async *streamChat() {
            yield { type: "content.delta" as const, content: "Auto" };
            yield {
              type: "done" as const,
              response: { content: "Auto", toolCalls: [] },
            };
          },
        }),
      },
      emit: () => undefined,
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    await expect(fixture.sessionRepository.get(fixture.session.id)).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Auto" }),
      ]),
    });
  });
```

Do not change `createFixture()` for this task.

- [ ] **Step 2: Run coordinator tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- agent-coordinator.test.ts
```

Expected: FAIL because `AgentCoordinatorOptions` has no `getResponseMode`.

- [ ] **Step 3: Add response mode callback to coordinator options**

Modify `apps/desktop/src/main/agent-coordinator.ts`.

Import:

```ts
import type { ResponseMode } from "@story-forge/shared";
```

Add to `AgentCoordinatorOptions`:

```ts
  getResponseMode?: () => Promise<ResponseMode>;
```

Add a private field:

```ts
  private readonly getResponseMode: () => Promise<ResponseMode>;
```

Initialize it in the constructor:

```ts
    this.getResponseMode = options.getResponseMode ?? (async () => "auto");
```

- [ ] **Step 4: Pass response mode to AgentLoop**

In `executeTurn`, before `loop.run`, add:

```ts
      const responseMode = await this.getResponseMode();
```

Pass it to `loop.run`:

```ts
        responseMode,
```

- [ ] **Step 5: Pass the settings response mode lookup from Electron main**

Modify `apps/desktop/src/main/main.ts`.

Update the existing `new AgentCoordinator(...)` call:

```ts
  const coordinator = new AgentCoordinator({
    providerStore,
    sessionRepository,
    workspaceRepository,
    providerFactory: registry,
    getResponseMode: async () => (await settingsStore.get()).responseMode,
    emit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.turnEvent, event);
      }
    },
  });
```

- [ ] **Step 6: Run desktop coordinator and IPC tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- agent-coordinator.test.ts ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add apps/desktop/src/main/agent-coordinator.ts apps/desktop/src/main/agent-coordinator.test.ts apps/desktop/src/main/main.ts
git commit -m "feat: apply response mode to agent turns"
```

---

### Task 8: Renderer Timeline and Smooth Playback

**Files:**
- Create: `apps/desktop/src/renderer/timeline.ts`
- Create: `apps/desktop/src/renderer/use-typewriter-text.ts`
- Create: `apps/desktop/src/renderer/components/conversation-timeline.tsx`
- Modify: `apps/desktop/src/renderer/components/agent-workspace.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing renderer timeline tests**

Modify `apps/desktop/src/renderer/App.test.tsx`.

Add this test:

```ts
  it("shows pending status, live deltas, and inline tool progress while a turn runs", async () => {
    const fixture = installApi({ settings: { schemaVersion: 1, responseMode: "live" } });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "Inspect README" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Thinking...")).toBeInTheDocument();

    await act(async () => {
      fixture.emit({
        type: "message.delta",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        content: "Reading",
        delivery: "live",
      });
      fixture.emit({
        type: "tool.call",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        callId: "call_readme",
        name: "workspace.readFile",
        input: { path: "README.md" },
      });
      fixture.emit({
        type: "tool.result",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        callId: "call_readme",
        name: "workspace.readFile",
        ok: true,
        output: "README content",
      });
    });

    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("Running workspace.readFile")).toBeInTheDocument();
    expect(screen.getByText("Completed workspace.readFile")).toBeInTheDocument();
  });
```

Add a smooth playback test with fake timers:

```ts
  it("plays smooth deltas without exposing intermediate text as persisted messages", async () => {
    vi.useFakeTimers();
    const fixture = installApi({ settings: { schemaVersion: 1, responseMode: "smooth" } });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "Explain" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      fixture.emit({
        type: "message.delta",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        content: "Smooth answer",
        delivery: "smooth",
      });
    });

    expect(screen.queryByText("Smooth answer")).not.toBeInTheDocument();
    await act(async () => {
      vi.runAllTimers();
    });
    expect(screen.getByText("Smooth answer")).toBeInTheDocument();
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run renderer tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: FAIL because no timeline/pending/typewriter rendering exists.

- [ ] **Step 3: Create pure timeline derivation**

Create `apps/desktop/src/renderer/timeline.ts`:

```ts
import type { AgentEvent, TurnId } from "@story-forge/shared";
import type { PersistedMessageView, SessionView } from "../shared/story-forge-api";

export type TimelineItem =
  | { type: "message"; message: PersistedMessageView }
  | { type: "pending"; turnId: TurnId; label: string }
  | { type: "assistant-stream"; turnId: TurnId; content: string; delivery: "live" | "smooth" }
  | {
      type: "tool-activity";
      callId: string;
      name: string;
      status: "running" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
    }
  | { type: "notice"; message: string }
  | { type: "error"; message: string };

export function buildTimeline(input: {
  session: SessionView | undefined;
  activities: AgentEvent[];
  activeTurnId: TurnId | undefined;
}): TimelineItem[] {
  const items: TimelineItem[] = [
    ...(input.session?.messages ?? []).map((message) => ({
      type: "message" as const,
      message,
    })),
  ];
  if (!input.activeTurnId) {
    return items;
  }

  const deltas = input.activities.filter((event) => event.type === "message.delta");
  const content = deltas.map((event) => event.content).join("");
  if (content) {
    items.push({
      type: "assistant-stream",
      turnId: input.activeTurnId,
      content,
      delivery: deltas.at(-1)?.delivery ?? "smooth",
    });
  } else {
    items.push({ type: "pending", turnId: input.activeTurnId, label: "Thinking..." });
  }

  const tools = new Map<string, Extract<AgentEvent, { type: "tool.call" | "tool.result" }>>();
  for (const event of input.activities) {
    if (event.type === "tool.call" || event.type === "tool.result") {
      tools.set(event.callId, event);
    }
    if (event.type === "response.fallback") {
      items.push({ type: "notice", message: "Switched to smooth playback" });
    }
    if (event.type === "runtime.error") {
      items.push({ type: "error", message: event.message });
    }
  }

  for (const event of tools.values()) {
    if (event.type === "tool.call") {
      const result = input.activities.find(
        (candidate) => candidate.type === "tool.result" && candidate.callId === event.callId,
      );
      items.push({
        type: "tool-activity",
        callId: event.callId,
        name: event.name,
        status: result?.type === "tool.result" ? (result.ok ? "completed" : "failed") : "running",
        input: event.input,
        output: result?.type === "tool.result" ? result.output : undefined,
      });
    }
  }
  return items;
}
```

- [ ] **Step 4: Add typewriter hook**

Create `apps/desktop/src/renderer/use-typewriter-text.ts`:

```ts
import { useEffect, useState } from "react";

export function useTypewriterText(text: string, enabled: boolean, delayMs = 12): string {
  const [visible, setVisible] = useState(enabled ? "" : text);

  useEffect(() => {
    if (!enabled) {
      setVisible(text);
      return undefined;
    }
    setVisible("");
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(timer);
      }
    }, delayMs);
    return () => clearInterval(timer);
  }, [delayMs, enabled, text]);

  return visible;
}
```

- [ ] **Step 5: Create ConversationTimeline component**

Create `apps/desktop/src/renderer/components/conversation-timeline.tsx`:

```tsx
import type { PersistedMessageView } from "../../shared/story-forge-api";
import type { TimelineItem } from "../timeline";
import { useTypewriterText } from "../use-typewriter-text";

export function ConversationTimeline(props: { items: TimelineItem[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {props.items.map((item, index) => (
        <TimelineItemView item={item} key={`${item.type}-${index}`} />
      ))}
    </div>
  );
}

function TimelineItemView({ item }: { item: TimelineItem }) {
  if (item.type === "message") {
    return <PersistedMessage message={item.message} />;
  }
  if (item.type === "pending") {
    return <AssistantBubble>{item.label}</AssistantBubble>;
  }
  if (item.type === "assistant-stream") {
    return (
      <AssistantStreamBubble
        content={item.content}
        smooth={item.delivery === "smooth"}
      />
    );
  }
  if (item.type === "tool-activity") {
    const label = item.status === "running"
      ? `Running ${item.name}`
      : item.status === "completed"
        ? `Completed ${item.name}`
        : `Failed ${item.name}`;
    return (
      <details className="rounded-lg border border-forge-line bg-slate-50 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">{label}</summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
          {JSON.stringify({ input: item.input, output: item.output }, null, 2)}
        </pre>
      </details>
    );
  }
  if (item.type === "notice") {
    return <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{item.message}</div>;
  }
  return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{item.message}</div>;
}

function PersistedMessage({ message }: { message: PersistedMessageView }) {
  if (message.role === "tool") {
    return (
      <details className="rounded-lg border border-forge-line bg-slate-50 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {message.ok ? "Completed" : "Failed"}: {message.name}
        </summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
          {message.content}
        </pre>
      </details>
    );
  }
  const isUser = message.role === "user";
  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-xl px-4 py-3 text-sm leading-6 ${
        isUser ? "bg-forge-ink text-white" : "border border-forge-line bg-white"
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </article>
  );
}

function AssistantStreamBubble(props: { content: string; smooth: boolean }) {
  const visibleText = useTypewriterText(props.content, props.smooth);

  return <AssistantBubble>{visibleText}</AssistantBubble>;
}

function AssistantBubble({ children }: { children: string }) {
  return (
    <article className="flex justify-start">
      <div className="max-w-[82%] rounded-xl border border-forge-line bg-white px-4 py-3 text-sm leading-6">
        <div className="whitespace-pre-wrap">{children}</div>
      </div>
    </article>
  );
}
```

- [ ] **Step 6: Use the timeline in AgentWorkspace**

Modify `apps/desktop/src/renderer/components/agent-workspace.tsx`.

Import:

```ts
import { ConversationTimeline } from "./conversation-timeline";
import { buildTimeline } from "../timeline";
```

Inside the component before `return`:

```ts
  const timelineItems = buildTimeline({
    session: props.session,
    activities: props.activities,
    activeTurnId: props.activeTurnId,
  });
```

Replace the current messages/activity block in the scroll area with:

```tsx
          <>
            {props.session.messages.length === 0 && timelineItems.length === 0 ? (
              <div className="mx-auto max-w-3xl rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">
                Ask StoryForge to inspect code, edit workspace files, or run an allowed development command.
              </div>
            ) : (
              <ConversationTimeline items={timelineItems} />
            )}
          </>
```

Remove the old local `Message` and `Activity` functions after the new component covers their behavior.

- [ ] **Step 7: Run renderer tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add apps/desktop/src/renderer/timeline.ts apps/desktop/src/renderer/use-typewriter-text.ts apps/desktop/src/renderer/components/conversation-timeline.tsx apps/desktop/src/renderer/components/agent-workspace.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat: show progressive conversation timeline"
```

---

### Task 9: Integration Verification and Cleanup

**Files:**
- Modify only these planned files when verification exposes integration issues:
  `packages/shared/src/settings.ts`, `packages/shared/src/events.ts`, `packages/shared/src/index.ts`, `packages/shared/src/events.test.ts`, `apps/desktop/src/main/app-settings-store.ts`, `apps/desktop/src/main/app-settings-store.test.ts`, `apps/desktop/src/shared/story-forge-api.ts`, `apps/desktop/src/main/ipc-handlers.ts`, `apps/desktop/src/main/ipc-handlers.test.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/main.ts`, `packages/model-gateway/src/model-provider.ts`, `packages/model-gateway/src/openai-compatible.ts`, `packages/model-gateway/src/openai-compatible.test.ts`, `packages/agent-core/src/agent-loop.ts`, `packages/agent-core/src/agent-loop.test.ts`, `apps/desktop/src/main/agent-coordinator.ts`, `apps/desktop/src/main/agent-coordinator.test.ts`, `apps/desktop/src/renderer/components/settings-page.tsx`, `apps/desktop/src/renderer/components/primary-navigation.tsx`, `apps/desktop/src/renderer/components/conversation-timeline.tsx`, `apps/desktop/src/renderer/timeline.ts`, `apps/desktop/src/renderer/use-typewriter-text.ts`, `apps/desktop/src/renderer/components/agent-workspace.tsx`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/App.test.tsx`.

- [ ] **Step 1: Run package-level tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/model-gateway test
corepack pnpm --filter @story-forge/agent-core test
corepack pnpm --filter @story-forge/desktop test
```

Expected: all tests pass.

- [ ] **Step 2: Run desktop typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: `tsc -p tsconfig.json --noEmit` exits 0.

- [ ] **Step 3: Run root typecheck if package tests pass**

Run:

```bash
corepack pnpm typecheck
```

Expected: turbo typecheck exits 0.

- [ ] **Step 4: Manual dev verification**

Run:

```bash
corepack pnpm dev
```

Expected:

- Electron opens.
- Settings page has `Auto`, `Live`, and `Smooth`.
- Switching modes persists after reload.
- Sending a prompt immediately shows `Thinking...`.
- Smooth mode shows waiting state and then typewriter playback.
- Live mode streams OpenAI-compatible content when the configured provider supports SSE.
- Tool calls appear inline as running/completed/failed items.

- [ ] **Step 5: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status should show no changes after the task commits unless Step 1-4 required an integration fix.

- [ ] **Step 6: Commit integration fixes only when verification changed planned files**

When `git status --short` shows changes in the planned files listed above, commit them with this exact file list:

```bash
git add packages/shared/src/settings.ts packages/shared/src/events.ts packages/shared/src/index.ts packages/shared/src/events.test.ts apps/desktop/src/main/app-settings-store.ts apps/desktop/src/main/app-settings-store.test.ts apps/desktop/src/shared/story-forge-api.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-handlers.test.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/main.ts packages/model-gateway/src/model-provider.ts packages/model-gateway/src/openai-compatible.ts packages/model-gateway/src/openai-compatible.test.ts packages/agent-core/src/agent-loop.ts packages/agent-core/src/agent-loop.test.ts apps/desktop/src/main/agent-coordinator.ts apps/desktop/src/main/agent-coordinator.test.ts apps/desktop/src/renderer/components/settings-page.tsx apps/desktop/src/renderer/components/primary-navigation.tsx apps/desktop/src/renderer/components/conversation-timeline.tsx apps/desktop/src/renderer/timeline.ts apps/desktop/src/renderer/use-typewriter-text.ts apps/desktop/src/renderer/components/agent-workspace.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "fix: polish response mode integration"
```

When `git status --short` shows no changes in the planned files, do not create this commit.
