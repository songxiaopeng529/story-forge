# Developer Mode Model Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings-controlled developer mode that shows the exact model request messages for the current session in a right-side chat drawer.

**Architecture:** Extend shared settings and runtime events with `developerMode` and `model.request`. The main process reads developer mode per turn, passes inspect metadata to `AgentLoop`, and emits request payloads immediately before `chat()` or `streamChat()`. The renderer keeps captured requests in memory only and renders them through a docked `ModelRequestDrawer`.

**Tech Stack:** TypeScript, React, Electron IPC/preload, Vitest, existing `AppSettingsStore`, `AgentLoop`, and renderer state patterns.

---

## Scope Notes

- Use the approved spec at `docs/superpowers/specs/2026-06-19-developer-mode-model-messages-design.md`.
- Do not persist model request debug payloads to session files.
- Developer mode is off by default.
- Keep the drawer rough but readable.
- Do not implement MCP or Skills management in this plan.

## File Structure

- `packages/shared/src/settings.ts`: add `developerMode` to `AppSettingsView`.
- `packages/shared/src/events.ts`: add inspectable model request event and JSON-safe inspectable message/tool types.
- `packages/shared/src/events.test.ts`: verify defaults and `model.request` non-terminal behavior.
- `apps/desktop/src/main/app-settings-store.ts`: accept and persist `developerMode`.
- `apps/desktop/src/main/app-settings-store.test.ts`: defaults, persistence, and partial save tests.
- `apps/desktop/src/main/ipc-handlers.test.ts`: validation coverage for `developerMode` settings saves.
- `packages/agent-core/src/agent-loop.ts`: emit `model.request` before model calls when inspection is enabled.
- `packages/agent-core/src/agent-loop.test.ts`: verify debug events for chat, streamChat, multi-step tool turns, and disabled mode.
- `apps/desktop/src/main/agent-coordinator.ts`: pass provider/model/developer mode inspect options into `AgentLoop`.
- `apps/desktop/src/main/agent-coordinator.test.ts`: verify coordinator enables model request events only when settings say so.
- `apps/desktop/src/renderer/components/settings-page.tsx`: add `Developer mode` toggle.
- `apps/desktop/src/renderer/components/model-request-drawer.tsx`: new docked inspector drawer.
- `apps/desktop/src/renderer/components/agent-workspace.tsx`: add header button and two-column drawer layout.
- `apps/desktop/src/renderer/App.tsx`: load/save developer mode, keep model request events in memory, clear per-session debug state on new prompt.
- `apps/desktop/src/renderer/App.test.tsx`: settings toggle, inspector visibility, drawer rendering, clear-on-new-turn, and copy JSON tests.

---

### Task 1: Shared Settings And Model Request Event

**Files:**
- Modify: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/events.test.ts`

- [ ] **Step 1: Write failing shared tests**

Add this fixture to `packages/shared/src/events.test.ts` near the other event fixtures:

```ts
const modelRequestEvent = {
  type: "model.request",
  sessionId,
  turnId,
  requestId: "model-request-1",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  responseMode: "live",
  messages: [
    { role: "system", content: "You are StoryForge." },
    { role: "user", content: "Inspect auth" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "workspace.readFile", input: { path: "README.md" } }],
    },
    { role: "tool", content: "contents", name: "workspace.readFile", toolCallId: "call_1" },
  ],
  tools: [
    {
      name: "workspace.readFile",
      description: "Read a file",
      parameters: { type: "object" },
    },
  ],
} satisfies AgentEvent;
```

Add it to `agentEventFixtures`.

Extend the settings test:

```ts
it("accepts the developer mode default shape", () => {
  const settings = {
    schemaVersion: 1,
    responseMode: "auto",
    developerMode: false,
  } satisfies AppSettingsView;

  expect(settings.developerMode).toBe(false);
});
```

Add a non-terminal event test:

```ts
it("allows model request inspection events without marking them terminal", () => {
  expect(modelRequestEvent.messages[0]).toMatchObject({ role: "system" });
  expect(isTerminalAgentEvent(modelRequestEvent)).toBe(false);
});
```

- [ ] **Step 2: Run the shared test to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/shared test -- events.test.ts
```

Expected: FAIL because `AppSettingsView` has no `developerMode` and `AgentEvent` has no `model.request`.

- [ ] **Step 3: Add shared settings and event types**

Update `packages/shared/src/settings.ts`:

```ts
export type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
  developerMode: boolean;
};
```

Update `packages/shared/src/events.ts`:

```ts
import type { MessageDeliveryMode, ResponseMode } from "./settings";

export type InspectableModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      reasoningContent?: string;
      toolCalls?: Array<{ id: string; name: string; input: unknown }>;
    }
  | { role: "tool"; content: string; name: string; toolCallId: string };

export type InspectableModelTool = {
  name: string;
  description: string;
  parameters: unknown;
};

export type ModelRequestEvent = {
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

Include `ModelRequestEvent` in `AgentEvent`.

- [ ] **Step 4: Run shared tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test -- events.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/shared/src/settings.ts packages/shared/src/events.ts packages/shared/src/events.test.ts
git commit -m "feat: add model request debug event"
```

---

### Task 2: Persist Developer Mode Setting

**Files:**
- Modify: `apps/desktop/src/main/app-settings-store.ts`
- Modify: `apps/desktop/src/main/app-settings-store.test.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`

- [ ] **Step 1: Write failing settings store tests**

Update the default expectation in `apps/desktop/src/main/app-settings-store.test.ts`:

```ts
await expect(store.get()).resolves.toEqual({
  schemaVersion: 1,
  responseMode: "auto",
  developerMode: false,
});
```

Add this test:

```ts
it("persists developer mode without changing the response mode", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
  const store = new AppSettingsStore({ rootDir });

  await expect(store.save({ developerMode: true })).resolves.toEqual({
    schemaVersion: 1,
    responseMode: "auto",
    developerMode: true,
  });
  await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
    schemaVersion: 1,
    responseMode: "smooth",
    developerMode: true,
  });
});
```

Update existing persistence expectations to include `developerMode: false`.

- [ ] **Step 2: Write failing IPC validation test**

In `apps/desktop/src/main/ipc-handlers.test.ts`, extend the settings save assertion:

```ts
await expect(
  fixture.invoke(IPC_CHANNELS.settingsSave, { developerMode: true }),
).resolves.toEqual({
  schemaVersion: 1,
  responseMode: "auto",
  developerMode: true,
});
```

Add invalid input coverage:

```ts
await expect(
  fixture.invoke(IPC_CHANNELS.settingsSave, { developerMode: "yes" }),
).rejects.toThrow("Invalid IPC payload");
```

- [ ] **Step 3: Run desktop settings tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- app-settings-store.test.ts ipc-handlers.test.ts
```

Expected: FAIL because schemas do not know `developerMode`.

- [ ] **Step 4: Update settings schema**

In `apps/desktop/src/main/app-settings-store.ts`, make the schema and defaults include developer mode:

```ts
const defaultSettings: AppSettingsView = {
  schemaVersion: 1,
  responseMode: "auto",
  developerMode: false,
};

const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  responseMode: z.enum(["auto", "live", "smooth"]),
  developerMode: z.boolean().default(false),
});
```

Keep `save(input: Partial<Pick<AppSettingsView, "responseMode" | "developerMode">>)` style behavior so each setting can be saved independently.

Update the IPC save schema in `apps/desktop/src/main/ipc-handlers.ts`:

```ts
const settingsSaveSchema = z.object({
  responseMode: z.enum(["auto", "live", "smooth"]).optional(),
  developerMode: z.boolean().optional(),
});
```

- [ ] **Step 5: Run desktop settings tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- app-settings-store.test.ts ipc-handlers.test.ts
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/desktop/src/main/app-settings-store.ts apps/desktop/src/main/app-settings-store.test.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-handlers.test.ts
git commit -m "feat: persist developer mode setting"
```

---

### Task 3: Emit Model Request Events From AgentLoop

**Files:**
- Modify: `packages/agent-core/src/agent-loop.ts`
- Modify: `packages/agent-core/src/agent-loop.test.ts`

- [ ] **Step 1: Write failing AgentLoop tests**

Add a test for normal chat:

```ts
it("emits model request events before chat when inspection is enabled", async () => {
  const events: AgentEvent[] = [];
  let chatCalls = 0;
  const provider = fakeProvider(async () => {
    chatCalls += 1;
    return { content: "Done", toolCalls: [] };
  });

  await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
    sessionId,
    turnId,
    responseMode: "smooth",
    inspectModelRequests: {
      enabled: true,
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    },
    messages: [{ role: "user", content: "Hello" }],
    onEvent: (event) => events.push(event),
  });

  expect(chatCalls).toBe(1);
  expect(events).toContainEqual(expect.objectContaining({
    type: "model.request",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    responseMode: "smooth",
    messages: [{ role: "user", content: "Hello" }],
  }));
});
```

Add a disabled-mode test:

```ts
it("does not emit model request events when inspection is disabled", async () => {
  const events: AgentEvent[] = [];
  await new AgentLoop({
    provider: fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
    tools: new ToolRegistry(),
  }).run({
    sessionId,
    turnId,
    messages: [{ role: "user", content: "Hello" }],
    onEvent: (event) => events.push(event),
  });

  expect(events.some((event) => event.type === "model.request")).toBe(false);
});
```

Add a multi-step tool test by extending the existing tool turn test or adding a focused one:

```ts
expect(events.filter((event) => event.type === "model.request")).toHaveLength(2);
```

- [ ] **Step 2: Run AgentLoop tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- agent-loop.test.ts
```

Expected: FAIL because `inspectModelRequests` is not accepted and no event is emitted.

- [ ] **Step 3: Add inspect input and conversion helpers**

In `packages/agent-core/src/agent-loop.ts`, extend `AgentLoopRunInput`:

```ts
inspectModelRequests?: {
  enabled: boolean;
  providerId: string;
  model: string;
};
```

Before `requestModelResponse`, build the exact request once:

```ts
const request: ModelRequest = {
  messages: trimMessagesToContext(
    messages,
    Math.floor(this.provider.capabilities.contextWindowTokens * 0.8),
  ),
  tools: this.tools.schemas(),
};
await this.emitModelRequest({ input, request, responseMode: input.responseMode ?? "auto" });
const response = await this.requestModelResponse({
  request,
  options: { signal: abort.signal },
  responseMode: input.responseMode ?? "auto",
  sessionId: input.sessionId,
  turnId: input.turnId,
  onEvent: input.onEvent,
});
```

Add a private helper:

```ts
private async emitModelRequest(input: {
  input: AgentLoopRunInput;
  request: ModelRequest;
  responseMode: ResponseMode;
}): Promise<void> {
  const inspect = input.input.inspectModelRequests;
  if (!inspect?.enabled) {
    return;
  }
  await emit(input.input, {
    type: "model.request",
    sessionId: input.input.sessionId,
    turnId: input.input.turnId,
    requestId: `model-request-${this.nextModelRequestIndex++}`,
    providerId: inspect.providerId,
    model: inspect.model,
    responseMode: input.responseMode,
    messages: input.request.messages.map(toInspectableMessage),
    tools: input.request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  });
}
```

Add `private nextModelRequestIndex = 1;` to the class.

Add `toInspectableMessage(message: ChatMessage)` near other helpers, returning the shared inspectable shapes.

- [ ] **Step 4: Run AgentLoop tests**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- agent-loop.test.ts
corepack pnpm --filter @story-forge/agent-core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/agent-core/src/agent-loop.ts packages/agent-core/src/agent-loop.test.ts
git commit -m "feat: emit model request debug events"
```

---

### Task 4: Wire Developer Mode Through Desktop Coordinator

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Write failing coordinator tests**

Add a test where `getDeveloperMode` returns true and emitted events include `model.request`:

```ts
it("passes developer mode inspection into the agent loop", async () => {
  const fixture = await createFixture();
  const events: AgentEvent[] = [];
  const coordinator = new AgentCoordinator({
    providerStore: fixture.providerStore,
    sessionRepository: fixture.sessionRepository,
    workspaceRepository: fixture.workspaceRepository,
    providerFactory: { createProvider: () => fakeProvider(async () => ({ content: "Done", toolCalls: [] })) },
    getResponseMode: async () => "smooth",
    getDeveloperMode: async () => true,
    emit: (event) => events.push(event),
  });

  const { turnId } = await coordinator.start({ sessionId: fixture.session.id, prompt: "hello" });
  await coordinator.waitForTurn(turnId);

  expect(events).toContainEqual(expect.objectContaining({
    type: "model.request",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
  }));
});
```

Add a disabled test:

```ts
expect(events.some((event) => event.type === "model.request")).toBe(false);
```

- [ ] **Step 2: Run coordinator tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- agent-coordinator.test.ts
```

Expected: FAIL because `getDeveloperMode` does not exist.

- [ ] **Step 3: Add coordinator option and pass inspect metadata**

In `AgentCoordinatorOptions`:

```ts
getDeveloperMode?: () => Promise<boolean>;
```

Initialize:

```ts
this.getDeveloperMode = options.getDeveloperMode ?? (async () => false);
```

Before `loop.run`:

```ts
const [responseMode, developerMode] = await Promise.all([
  this.getResponseMode(),
  this.getDeveloperMode(),
]);
```

Pass:

```ts
inspectModelRequests: {
  enabled: developerMode,
  providerId: session.providerId,
  model: session.model,
},
```

In `apps/desktop/src/main/main.ts`, wire:

```ts
getDeveloperMode: async () => (await settingsStore.get()).developerMode,
```

- [ ] **Step 4: Run desktop tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- agent-coordinator.test.ts
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/desktop/src/main/agent-coordinator.ts apps/desktop/src/main/agent-coordinator.test.ts apps/desktop/src/main/main.ts
git commit -m "feat: wire developer mode into agent turns"
```

---

### Task 5: Settings UI Developer Mode Toggle

**Files:**
- Modify: `apps/desktop/src/renderer/components/settings-page.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing renderer settings test**

In `apps/desktop/src/renderer/App.test.tsx`, add:

```ts
it("loads and saves developer mode from Settings", async () => {
  const fixture = installApi({
    settings: { schemaVersion: 1, responseMode: "auto", developerMode: false },
  });
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  const developerMode = await screen.findByRole("switch", { name: "Developer mode" });
  expect(developerMode).not.toBeChecked();

  fireEvent.click(developerMode);

  await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
    developerMode: true,
  }));
  expect(developerMode).toBeChecked();
});
```

Update test fixtures so default settings include `developerMode: false`.

- [ ] **Step 2: Run App tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: FAIL because no developer mode switch exists.

- [ ] **Step 3: Add settings UI state and switch**

In `App.tsx`, add state:

```ts
const [developerMode, setDeveloperMode] = useState(false);
const persistedDeveloperModeRef = useRef(false);
```

On settings load:

```ts
persistedDeveloperModeRef.current = nextSettings.developerMode;
setDeveloperMode(nextSettings.developerMode);
```

Add `saveDeveloperMode(nextDeveloperMode: boolean)` mirroring `saveResponseMode`, using:

```ts
window.storyForge.settings.save({ developerMode: nextDeveloperMode })
```

Pass to `SettingsPage`.

In `SettingsPage`, add a switch:

```tsx
<label className="flex items-center justify-between rounded-lg border border-forge-line bg-white p-4">
  <span>
    <span className="block text-sm font-semibold">Developer mode</span>
    <span className="mt-1 block text-xs text-slate-500">
      Show the exact model request messages in the chat inspector.
    </span>
  </span>
  <input
    aria-label="Developer mode"
    checked={props.developerMode}
    disabled={props.saving}
    onChange={(event) => props.onDeveloperModeChange(event.currentTarget.checked)}
    role="switch"
    type="checkbox"
  />
</label>
```

- [ ] **Step 4: Run App tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/desktop/src/renderer/components/settings-page.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat: add developer mode setting"
```

---

### Task 6: Renderer Model Request Drawer

**Files:**
- Create: `apps/desktop/src/renderer/components/model-request-drawer.tsx`
- Modify: `apps/desktop/src/renderer/components/agent-workspace.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing drawer tests**

Add tests in `App.test.tsx`:

```ts
it("shows the model request drawer only when developer mode is enabled", async () => {
  const fixture = installApi({
    settings: { schemaVersion: 1, responseMode: "auto", developerMode: true },
  });
  render(<App />);

  const button = await screen.findByRole("button", { name: "Open model request inspector" });
  fireEvent.click(button);
  expect(screen.getByText("No model requests captured yet.")).toBeInTheDocument();

  await act(async () => {
    fixture.emit({
      type: "model.request",
      sessionId: "sf_session_existing",
      turnId: "sf_turn_active",
      requestId: "model-request-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      responseMode: "auto",
      messages: [
        { role: "system", content: "You are StoryForge." },
        { role: "user", content: "Inspect auth" },
      ],
      tools: [],
    });
  });

  expect(screen.getByText("Model Request #1")).toBeInTheDocument();
  expect(screen.getByText("system")).toBeInTheDocument();
  expect(screen.getByText("You are StoryForge.")).toBeInTheDocument();
});
```

Add a disabled-mode test:

```ts
expect(screen.queryByRole("button", { name: "Open model request inspector" })).not.toBeInTheDocument();
```

Add a copy test with a clipboard mock:

```ts
const writeText = vi.fn(async () => undefined);
Object.assign(navigator, { clipboard: { writeText } });
fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("model-request-1")));
```

- [ ] **Step 2: Run App tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: FAIL because drawer and state do not exist.

- [ ] **Step 3: Add drawer component**

Create `apps/desktop/src/renderer/components/model-request-drawer.tsx`:

```tsx
import type { ModelRequestEvent } from "@story-forge/shared";
import { Copy, X } from "lucide-react";
import { useEffect, useState } from "react";

export function ModelRequestDrawer(props: {
  requests: ModelRequestEvent[];
  onClose: () => void;
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const selected = props.requests.find((request) => request.requestId === selectedRequestId)
    ?? props.requests.at(-1);

  useEffect(() => {
    setSelectedRequestId(props.requests.at(-1)?.requestId);
  }, [props.requests.length]);

  async function copySelectedRequest(): Promise<void> {
    if (!selected) {
      return;
    }
    await navigator.clipboard?.writeText(JSON.stringify(selected, null, 2));
  }

  return (
    <aside className="flex min-h-0 w-[380px] flex-none flex-col border-l border-forge-line bg-white">
      <header className="flex h-16 flex-none items-center justify-between border-b border-forge-line px-4">
        <div>
          <div className="text-sm font-semibold">Model Messages</div>
          <div className="text-xs text-slate-500">{props.requests.length} captured</div>
        </div>
        <button aria-label="Close model request inspector" className="rounded-md p-2 hover:bg-slate-100" onClick={props.onClose} type="button">
          <X size={16} />
        </button>
      </header>
      {selected ? (
        <div className="grid min-h-0 flex-1 grid-cols-[140px_1fr]">
          <nav className="min-h-0 overflow-y-auto border-r border-forge-line p-2">
            {props.requests.map((request, index) => (
              <button className="w-full rounded-md px-2 py-2 text-left text-xs hover:bg-slate-50" key={request.requestId} onClick={() => setSelectedRequestId(request.requestId)} type="button">
                Model Request #{index + 1}
              </button>
            ))}
          </nav>
          <section className="min-h-0 overflow-y-auto p-4">
            <button className="secondary-button mb-3 inline-flex items-center gap-2" onClick={() => void copySelectedRequest()} type="button">
              <Copy size={14} />
              Copy JSON
            </button>
            <div className="mb-3 text-xs text-slate-500">{selected.providerId} / {selected.model}</div>
            <div className="space-y-3">
              {selected.messages.map((message, index) => (
                <article className="rounded-lg border border-forge-line p-3 text-xs" key={`${message.role}-${index}`}>
                  <div className="mb-2 font-semibold text-slate-700">{message.role}</div>
                  <pre className="whitespace-pre-wrap text-slate-600">{message.content}</pre>
                  {"toolCalls" in message && message.toolCalls?.length ? (
                    <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(message.toolCalls, null, 2)}</pre>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="p-4 text-sm text-slate-500">No model requests captured yet.</div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Wire drawer state and events**

In `App.tsx`, add:

```ts
const [modelRequests, setModelRequests] = useState<Record<string, ModelRequestEvent[]>>({});
const [modelInspectorOpen, setModelInspectorOpen] = useState(false);
```

In the turn event listener:

```ts
if (event.type === "model.request") {
  setModelRequests((current) => ({
    ...current,
    [event.sessionId]: [...(current[event.sessionId] ?? []), event],
  }));
}
```

When starting a prompt:

```ts
setModelRequests((current) => ({ ...current, [session.id]: [] }));
```

Pass developer mode and selected session requests to `AgentWorkspace`.

In `AgentWorkspace`, add a header button and drawer:

```tsx
{props.developerMode ? (
  <button
    aria-label="Open model request inspector"
    className="rounded-md border border-forge-line p-2 text-slate-500 hover:bg-slate-50"
    onClick={props.onModelInspectorOpen}
    type="button"
  >
    <Braces size={16} />
  </button>
) : null}
```

Wrap the existing conversation scroll area and footer inside a new `<div className="flex min-w-0 flex-1 flex-col">`. Then render `ModelRequestDrawer` as a sibling of that flex child inside a parent `<div className="flex min-h-0 flex-1">`. Keep the footer inside the conversation flex child so the drawer spans from below the header to the bottom of the workspace.

- [ ] **Step 5: Run App tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/desktop/src/renderer/components/model-request-drawer.tsx apps/desktop/src/renderer/components/agent-workspace.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat: show model request inspector drawer"
```

---

### Task 7: Integration Verification And Dev Restart

**Files:**
- Modify only planned files if verification exposes issues.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/agent-core test
corepack pnpm --filter @story-forge/desktop test
```

Expected: all pass.

- [ ] **Step 2: Run typechecks**

Run:

```bash
corepack pnpm --filter @story-forge/desktop typecheck
corepack pnpm typecheck
```

Expected: all pass.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors. Working tree is clean after commits.

- [ ] **Step 4: Restart dev server**

Stop the active `corepack pnpm dev` session with `Ctrl-C`, confirm port `5173` is free, then run:

```bash
corepack pnpm dev
```

Expected: Electron opens and the renderer dev server is available at `http://localhost:5173/`.

- [ ] **Step 5: Push branch to update PR**

Run:

```bash
git push
```

Expected: `origin/codex/response-mode-streaming` updates the existing draft PR.
