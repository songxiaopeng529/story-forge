import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AgentEvent } from "@story-forge/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderView,
  SessionView,
  StoryForgeApi,
  WorkspaceView,
} from "../shared/story-forge-api";
import { App } from "./App";

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("loads persisted workspace sessions and messages", async () => {
    installApi();

    render(<App />);

    expect(await screen.findByText("Previous question")).toBeInTheDocument();
    expect(screen.getByText("Previous answer")).toBeInTheDocument();
    expect(screen.getByText("Project session")).toBeInTheDocument();
  });

  it("sends with Enter, preserves Shift+Enter and IME composition, and stops active turns", async () => {
    const fixture = installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "Line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(fixture.start).not.toHaveBeenCalled();

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fixture.start).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fixture.start).toHaveBeenCalledWith({
      sessionId: "sf_session_existing",
      prompt: "Line one",
    }));
    fireEvent.change(input, { target: { value: "Duplicate" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fixture.start).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(fixture.stop).toHaveBeenCalledWith("sf_turn_active"));
  });

  it("updates from correlated turn events and reloads the persisted session on completion", async () => {
    const fixture = installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );
    fireEvent.change(input, { target: { value: "Run a tool" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fixture.start).toHaveBeenCalled());

    await act(async () => {
      fixture.emit({
        type: "tool.call",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        callId: "call_1",
        name: "workspace.readFile",
        input: { path: "README.md" },
      });
      fixture.emit({
        type: "runtime.completed",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        stopReason: "completed",
        steps: 2,
      });
    });

    expect(await screen.findByText("workspace.readFile")).toBeInTheDocument();
    await waitFor(() => expect(fixture.getSession).toHaveBeenCalledWith("sf_session_existing"));
  });

  it("keeps the app shell fixed while only the conversation pane scrolls", async () => {
    installApi();
    render(<App />);

    expect(await screen.findByText("Previous question")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-screen", "overflow-hidden");
    expect(screen.getByTestId("agent-layout")).toHaveClass("min-h-0", "overflow-hidden");
    expect(screen.getByTestId("agent-workspace")).toHaveClass("min-h-0", "overflow-hidden");
    expect(screen.getByTestId("agent-header")).not.toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("agent-message-scroll")).toHaveClass("overflow-y-auto");
  });

  it("saves provider settings and shows a saved-key indicator without exposing plaintext", async () => {
    const fixture = installApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Models" }));
    const keyInput = await screen.findByLabelText("API key");

    expect(keyInput).toHaveAttribute("type", "password");
    expect(keyInput).toHaveValue("************");
    fireEvent.focus(keyInput);
    expect(keyInput).toHaveValue("");
    fireEvent.blur(keyInput);
    expect(keyInput).toHaveValue("************");
    fireEvent.focus(keyInput);
    fireEvent.change(keyInput, { target: { value: "new-local-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(fixture.saveProvider).toHaveBeenCalledWith({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      apiKey: "new-local-secret",
    }));
    await waitFor(() => expect(keyInput).toHaveValue("************"));
    expect(screen.queryByDisplayValue("new-local-secret")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await waitFor(() => expect(fixture.saveProvider).toHaveBeenCalledTimes(2));
    expect(fixture.saveProvider.mock.calls[1]?.[0]).toEqual({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
    });
  });
});

function installApi() {
  const provider: ProviderView = {
    providerId: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    isDefault: true,
    hasSecret: true,
    lastTestStatus: "success",
  };
  const workspace: WorkspaceView = {
    id: "workspace-1",
    path: "/tmp/project",
    displayName: "project",
    createdAt: "2026-06-07T00:00:00.000Z",
    lastOpenedAt: "2026-06-07T00:00:00.000Z",
  };
  const session: SessionView = {
    schemaVersion: 1,
    id: "sf_session_existing",
    workspaceId: workspace.id,
    title: "Project session",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    status: "idle",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Previous question",
        createdAt: "2026-06-07T00:00:00.000Z",
      },
      {
        id: "message-2",
        role: "assistant",
        content: "Previous answer",
        createdAt: "2026-06-07T00:00:01.000Z",
      },
    ],
  };
  let eventListener: ((event: AgentEvent) => void) | undefined;
  const start = vi.fn(async () => ({ turnId: "sf_turn_active" as const }));
  const stop = vi.fn(async () => undefined);
  const getSession = vi.fn(async () => session);
  const saveProvider = vi.fn(async (input) => ({
    ...provider,
    baseUrl: input.baseUrl,
    model: input.model,
    hasSecret: provider.hasSecret || Boolean(input.apiKey),
  }));
  const api = {
    version: "0.1.0",
    settings: {
      get: vi.fn(async () => ({ schemaVersion: 1, responseMode: "auto" })),
      save: vi.fn(async (input) => ({ schemaVersion: 1, ...input })),
    },
    providers: {
      list: vi.fn(async () => [provider]),
      save: saveProvider,
      test: vi.fn(async () => ({ models: provider.recommendedModels })),
      clearSecret: vi.fn(async () => undefined),
      setDefault: vi.fn(async () => undefined),
      discoverModels: vi.fn(async () => provider.recommendedModels),
    },
    workspaces: {
      list: vi.fn(async () => [workspace]),
      open: vi.fn(async () => workspace),
      remove: vi.fn(async () => undefined),
    },
    sessions: {
      list: vi.fn(async () => [session]),
      create: vi.fn(async () => session),
      get: getSession,
      rename: vi.fn(async (_sessionId, title) => ({ ...session, title })),
      delete: vi.fn(async () => undefined),
    },
    turns: {
      start,
      stop,
      onEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      }),
    },
  } as StoryForgeApi;
  Object.defineProperty(window, "storyForge", {
    configurable: true,
    value: api,
  });
  return {
    start,
    stop,
    getSession,
    saveProvider,
    emit: (event: AgentEvent) => eventListener?.(event),
  };
}
