import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  AgentEvent,
  AgentRunView,
  AppSettingsView,
  AutomationView,
  McpConfigView,
  SkillView,
  UnsequencedAgentEvent,
} from "@story-forge/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GitRepositoryView,
  ProviderView,
  SessionView,
  StoryForgeApi,
  WorkspaceView,
} from "../../shared/story-forge-api";
import { App } from "../App";

afterEach(() => {
  vi.useRealTimers();
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

  it("hydrates the last Agent run and keeps child activity out of the root timeline", async () => {
    const run = sampleAgentRun();
    const fixture = installApi({
      session: {
        status: "running",
        currentTurnId: run.turnId,
        lastTurnId: run.turnId,
      },
      agentRun: run,
    });

    render(<App />);

    expect(await screen.findByRole("region", { name: "Agent run tree" })).toBeInTheDocument();
    expect(fixture.getAgentRun).toHaveBeenCalledWith(run.turnId);
    expect(screen.getByRole("article", { name: "Explorer agent: Map persisted runtime state" }))
      .toBeInTheDocument();

    act(() => fixture.emit({
      type: "message.delta",
      eventId: "sf_agent_event_private",
      sequence: 2,
      occurredAt: "2026-08-28T08:00:02.000Z",
      sessionId: run.sessionId,
      turnId: run.turnId,
      agentExecutionId: "sf_agent_execution_explorer",
      parentAgentExecutionId: run.rootExecutionId,
      content: "CHILD PRIVATE STREAM",
      delivery: "live",
    }));
    act(() => fixture.emit({
      type: "tool.call",
      eventId: "sf_agent_event_child_tool",
      sequence: 3,
      occurredAt: "2026-08-28T08:00:03.000Z",
      sessionId: run.sessionId,
      turnId: run.turnId,
      agentExecutionId: "sf_agent_execution_explorer",
      parentAgentExecutionId: run.rootExecutionId,
      callId: "child-read",
      name: "read",
      input: { path: "README.md" },
    }));

    expect(screen.queryByText("CHILD PRIVATE STREAM")).not.toBeInTheDocument();
    expect(await screen.findByText("1 tool")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-activity-group")).not.toBeInTheDocument();

    act(() => fixture.emit({
      type: "message.delta",
      sessionId: run.sessionId,
      turnId: run.turnId,
      content: "ROOT VISIBLE STREAM",
      delivery: "live",
    }));
    expect(await screen.findByText("ROOT VISIBLE STREAM")).toBeInTheDocument();
  });

  it("loads repository context for the selected workspace", async () => {
    const fixture = installApi({ repository: sampleGitRepository() });

    render(<App />);

    expect(await screen.findByText("chore/code-optimization")).toBeInTheDocument();
    expect(screen.getByTitle("origin/main ↑0 ↓0")).toBeInTheDocument();
    expect(screen.getByTitle("7316a95 · Merge pull request #22")).toBeInTheDocument();
    expect(fixture.getRepository).toHaveBeenCalledWith("workspace-1");
  });

  it("coalesces focus refreshes while a repository read is still running", async () => {
    const repository = createDeferred<GitRepositoryView>();
    const getRepository = vi.fn(() => repository.promise);
    installApi({ getRepository });

    render(<App />);
    await screen.findByText("Previous question");
    await waitFor(() => expect(getRepository).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(getRepository).toHaveBeenCalledTimes(1);

    await act(async () => {
      repository.resolve(sampleGitRepository());
      await repository.promise;
    });
    expect(await screen.findByText("chore/code-optimization")).toBeInTheDocument();
  });

  it("does not show repository data from the previously selected workspace", async () => {
    const secondWorkspace: WorkspaceView = {
      id: "workspace-2",
      path: "/tmp/project-two",
      displayName: "project-two",
      createdAt: "2026-06-07T00:00:00.000Z",
      lastOpenedAt: "2026-06-07T00:00:00.000Z",
    };
    const secondRepository = createDeferred<GitRepositoryView>();
    const firstRepository = sampleGitRepository();
    const getRepository = vi.fn((workspaceId: string) =>
      workspaceId === "workspace-1"
        ? Promise.resolve(firstRepository)
        : secondRepository.promise
    );
    installApi({
      getRepository,
      workspaces: [
        {
          id: "workspace-1",
          path: "/tmp/project",
          displayName: "project",
          createdAt: "2026-06-07T00:00:00.000Z",
          lastOpenedAt: "2026-06-07T00:00:00.000Z",
        },
        secondWorkspace,
      ],
    });

    render(<App />);
    expect(await screen.findByText("chore/code-optimization")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "project-two" }));
    expect(screen.queryByText("chore/code-optimization")).not.toBeInTheDocument();
    await waitFor(() => expect(getRepository).toHaveBeenCalledWith("workspace-2"));

    await act(async () => {
      secondRepository.resolve({
        ...firstRepository,
        workspaceId: "workspace-2",
        rootPath: "/tmp/project-two",
        head: { ...firstRepository.head, branch: "feature/project-two" },
      });
      await secondRepository.promise;
    });
    expect(await screen.findByText("feature/project-two")).toBeInTheDocument();
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

  it("grows the compact prompt bar with its content and caps it at 100px", async () => {
    installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 96 });
    fireEvent.change(input, { target: { value: "Line one\nLine two\nLine three" } });
    expect(input).toHaveStyle({ height: "96px", overflowY: "hidden" });
    expect(screen.getByTestId("prompt-bar")).toHaveAttribute("data-expanded", "true");

    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 220 });
    fireEvent.change(input, { target: { value: Array.from({ length: 12 }, () => "Line").join("\n") } });
    expect(input).toHaveStyle({ height: "100px", overflowY: "auto" });

    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 28 });
    fireEvent.change(input, { target: { value: "Short" } });
    expect(screen.getByTestId("prompt-bar")).toHaveAttribute("data-expanded", "false");
  });

  it("selects and persists command mode from the prompt bar", async () => {
    const fixture = installApi();
    render(<App />);

    const trigger = await screen.findByRole("button", { name: "Sentinel mode" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Command mode" });
    expect(within(menu).getByRole("menuitemradio", { name: "Sentinel mode" }))
      .toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Cruise mode" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      commandExecutionMode: "cruise",
    }));
    expect(await screen.findByRole("button", { name: "Cruise mode" })).toBeEnabled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the command mode and slash command menus mutually exclusive", async () => {
    installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sentinel mode" }));
    expect(screen.getByRole("menu", { name: "Command mode" })).toBeInTheDocument();
    changePrompt(input, "/");
    expect(screen.queryByRole("menu", { name: "Command mode" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sentinel mode" }));
    expect(screen.queryByRole("listbox", { name: "Slash commands" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Command mode" })).toBeInTheDocument();
  });

  it("prevents sending until a command mode save finishes", async () => {
    const pendingSave = createDeferred<AppSettingsView>();
    const saveSettings = vi.fn(() => pendingSave.promise);
    const fixture = installApi({ saveSettings });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );
    fireEvent.change(input, { target: { value: "Run the checks" } });

    fireEvent.click(screen.getByRole("button", { name: "Sentinel mode" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Cruise mode" }));

    expect(await screen.findByRole("button", { name: "Cruise mode" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fixture.start).not.toHaveBeenCalled();

    await act(async () => {
      pendingSave.resolve({
        schemaVersion: 1,
        language: "en",
        developerMode: false,
        commandExecutionMode: "cruise",
        webAccessEnabled: false,
        webSearchCoverage: "focused",
        soulMode: "ask",
      });
      await pendingSave.promise;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1));
  });

  it("locks command mode immediately while a turn start request is pending", async () => {
    const pendingStart = createDeferred<{ turnId: "sf_turn_pending" }>();
    const start = vi.fn(() => pendingStart.promise);
    const fixture = installApi({ start });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );
    fireEvent.change(input, { target: { value: "Inspect the repository" } });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Starting" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sentinel mode" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(start).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const commandModeGroup = await screen.findByRole("radiogroup", {
      name: "Command execution",
    });
    expect(within(commandModeGroup).getByRole("radio", { name: "Cruise mode" }))
      .toBeDisabled();
    expect(screen.getByText(/Command mode is locked while a turn is running/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coding Agent" }));

    await act(async () => {
      pendingStart.resolve({ turnId: "sf_turn_pending" });
      await pendingStart.promise;
    });
    expect(await screen.findByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sentinel mode" })).toBeDisabled();
    expect(fixture.start).toBe(start);
  });

  it("restores command mode locking and Stop from a running session snapshot", async () => {
    const fixture = installApi({
      session: {
        status: "running",
        currentTurnId: "sf_turn_restored",
      },
    });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sentinel mode" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(fixture.stop).toHaveBeenCalledWith("sf_turn_restored"));
  });

  it("rolls the prompt bar mode back when persistence fails", async () => {
    const fixture = installApi({
      saveSettings: vi.fn(async () => Promise.reject(new Error("Mode save failed"))),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Sentinel mode" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Unleashed mode" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      commandExecutionMode: "unleashed",
    }));
    expect(await screen.findByRole("button", { name: "Sentinel mode" })).toBeEnabled();
    expect(screen.getByText("Mode save failed")).toBeInTheDocument();
  });

  it("attaches image files as base64 payloads when starting a turn", async () => {
    const fixture = installApi({
      providers: [{
        providerId: "volcano",
        displayName: "Volcano Engine",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "ep-vision",
        recommendedModels: [],
        isDefault: true,
        hasSecret: true,
        lastTestStatus: "success",
        supportsImageInput: true,
      }],
      session: {
        providerId: "volcano",
        model: "ep-vision",
      },
    });
    render(<App />);

    const imageInput = await screen.findByLabelText("Choose image");
    const promptInput = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", { type: "image/png" });

    fireEvent.change(imageInput, { target: { files: [file] } });

    expect(await screen.findByText("screen.png")).toBeInTheDocument();
    fireEvent.change(promptInput, { target: { value: "What is this?" } });
    fireEvent.keyDown(promptInput, { key: "Enter" });

    await waitFor(() => expect(fixture.start).toHaveBeenCalledWith({
      sessionId: "sf_session_existing",
      prompt: "What is this?",
      imageAttachments: [
        expect.objectContaining({
          name: "screen.png",
          mediaType: "image/png",
          data: "AQID",
          size: 3,
        }),
      ],
    }));
  });

  it("keeps an attached image when switching to a model without image input", async () => {
    const fixture = installApi({
      providers: [{
        providerId: "volcano",
        displayName: "Volcano Engine",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "ep-vision",
        recommendedModels: ["ep-vision", "ep-text"],
        isDefault: true,
        defaultModel: "ep-vision",
        hasSecret: true,
        lastTestStatus: "success",
        supportsImageInput: true,
      }],
      modelImageSupport: {
        "ep-vision": true,
        "ep-text": false,
      },
      session: {
        providerId: "volcano",
        model: "ep-vision",
      },
    });
    render(<App />);

    const imageInput = await screen.findByLabelText("Choose image");
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", { type: "image/png" });
    fireEvent.change(imageInput, { target: { files: [file] } });
    expect(await screen.findByText("screen.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "ep-text" }));
    await waitFor(() => expect(fixture.setDefaultProvider).toHaveBeenCalledWith({
      providerId: "volcano",
      model: "ep-text",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Coding Agent" }));

    expect(await screen.findByText("screen.png")).toBeInTheDocument();
    const promptInput = screen.getByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );
    fireEvent.change(promptInput, { target: { value: "What is this?" } });
    fireEvent.keyDown(promptInput, { key: "Enter" });

    expect(fixture.start).not.toHaveBeenCalled();
    expect(screen.getByText("screen.png")).toBeInTheDocument();
  });

  it("shows the current default provider for an existing session", async () => {
    installApi({
      providers: [
        {
          providerId: "deepseek",
          displayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          recommendedModels: ["deepseek-v4-pro"],
          isDefault: true,
          hasSecret: true,
          lastTestStatus: "success",
          supportsImageInput: false,
        },
        {
          providerId: "volcano",
          displayName: "Volcano Engine",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          model: "ep-vision",
          recommendedModels: [],
          isDefault: false,
          hasSecret: true,
          lastTestStatus: "success",
          supportsImageInput: true,
        },
      ],
      session: {
        providerId: "volcano",
        model: "ep-vision",
      },
    });

    render(<App />);

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    expect(screen.queryByText("Volcano Engine")).not.toBeInTheDocument();
  });

  it("offers enabled skills in the slash command menu and shows a command pill when selected", async () => {
    const fixture = installApi({
      skills: [
        {
          id: "agent-browser",
          name: "Agent Browser",
          description: "Inspect and operate browser pages",
          invocationName: "/agent-browser",
          enabled: true,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        },
        {
          id: "drafting",
          name: "Drafting",
          description: "Draft release notes",
          invocationName: "/drafting",
          enabled: false,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    changePrompt(input, "/agent");

    const command = await screen.findByRole("option", { name: /\/agent-browser/i });
    expect(screen.queryByRole("option", { name: /\/drafting/i })).not.toBeInTheDocument();

    fireEvent.click(command);

    const pill = await screen.findByTestId("active-slash-command");
    expect(pill).toHaveTextContent("/agent-browser");
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "open the docs page" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fixture.start).toHaveBeenCalledWith({
      sessionId: "sf_session_existing",
      prompt: "/agent-browser open the docs page",
    }));
  });

  it("keeps the arrow-key highlight after key release in the slash menu", async () => {
    installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    changePrompt(input, "/");
    await screen.findByRole("listbox", { name: "Slash commands" });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyUp(input, { key: "ArrowDown" });

    const optionsAfter = screen.getAllByRole("option");
    expect(optionsAfter[0]).toHaveAttribute("aria-selected", "false");
    expect(optionsAfter[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", optionsAfter[1]?.id);
  });

  it("sends a skill command pill without extra arguments", async () => {
    const fixture = installApi({
      skills: [
        {
          id: "agent-browser",
          name: "Agent Browser",
          description: "Inspect and operate browser pages",
          invocationName: "/agent-browser",
          enabled: true,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    changePrompt(input, "/agent");
    fireEvent.click(await screen.findByRole("option", { name: /\/agent-browser/i }));
    await screen.findByTestId("active-slash-command");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fixture.start).toHaveBeenCalledWith({
      sessionId: "sf_session_existing",
      prompt: "/agent-browser",
    }));
  });

  it("runs built-in slash commands from the prompt", async () => {
    installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    changePrompt(input, "/timer");
    fireEvent.click(await screen.findByRole("option", { name: /\/timer/i }));

    expect(await screen.findByLabelText("Schedule description")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("bridges PI extension prompts through the extension UI", async () => {
    const fixture = installApi();
    render(<App />);

    await screen.findByText("Previous answer");
    await act(async () => {
      fixture.emit({
        type: "extension.ui.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "extension_action",
        method: "select",
        title: "Choose action",
        options: ["Continue", "Cancel"],
      });
    });

    expect(screen.getByRole("dialog", { name: "Choose action" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Continue" }));

    await waitFor(() => expect(fixture.respondExtensionUi).toHaveBeenCalledWith({
      requestId: "extension_action",
      value: "Continue",
    }));
  });

  it("shows a progress indicator while the /compact command runs", async () => {
    const deferred = createDeferred<undefined>();
    const fixture = installApi({ compact: vi.fn(() => deferred.promise) });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    changePrompt(input, "/compact");
    fireEvent.click(await screen.findByRole("option", { name: /\/compact/i }));

    expect(await screen.findByTestId("compaction-indicator")).toBeInTheDocument();
    expect(fixture.compact).toHaveBeenCalledWith("sf_session_existing");

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });

    await waitFor(() =>
      expect(screen.queryByTestId("compaction-indicator")).not.toBeInTheDocument()
    );
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

    await waitFor(() => expect(fixture.getSession).toHaveBeenCalledWith("sf_session_existing"));
    expect(screen.queryByRole("button", { name: /Read file.*Running/ })).not.toBeInTheDocument();
  });

  it("counts tool calls, not model requests, as turn steps", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    await act(async () => {
      fixture.emit({
        type: "runtime.started",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        createdAt: "2026-06-07T00:00:00.000Z",
      });
      fixture.emit({
        type: "model.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "request-steps",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Inspect the repo" }],
        tools: [],
      });
    });

    let stepsRow = screen.getByText("Steps").parentElement;
    expect(stepsRow).not.toBeNull();
    expect(within(stepsRow as HTMLElement).getByText("0 steps")).toBeInTheDocument();

    await act(async () => {
      fixture.emit({
        type: "tool.call",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        callId: "call-steps",
        name: "workspace.readFile",
        input: { path: "README.md" },
      });
    });

    stepsRow = screen.getByText("Steps").parentElement;
    expect(within(stepsRow as HTMLElement).getByText("1 step")).toBeInTheDocument();
  });

  it("shows pending status, live deltas, and inline tool progress while a turn runs", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
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
    expect(screen.getByRole("button", { name: /Tool activity 1 tool 1 completed/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tool activity.*running/ })).not.toBeInTheDocument();
  });

  it("renders failed tool steps before later assistant text in the active turn", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "Check tools" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fixture.start).toHaveBeenCalled());

    await act(async () => {
      fixture.emit({
        type: "tool.call",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        callId: "call_cmd",
        name: "workspace.runCommand",
        input: { command: "pnpm missing" },
      });
      fixture.emit({
        type: "tool.result",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        callId: "call_cmd",
        name: "workspace.runCommand",
        ok: false,
        output: "command failed",
      });
      fixture.emit({
        type: "message.delta",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        content: "I found the failure.",
        delivery: "live",
      });
    });

    const failedStep = screen.getByRole("button", { name: /Run command pnpm missing Failed/ });
    const answer = screen.getByText("I found the failure.");
    expect(
      failedStep.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("plays smooth deltas without exposing intermediate text as persisted messages", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "Explain" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fixture.start).toHaveBeenCalled());
    vi.useFakeTimers();
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
  });

  it("keeps the app shell fixed while only the conversation pane scrolls", async () => {
    installApi();
    render(<App />);

    expect(await screen.findByText("Previous question")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("h-screen", "overflow-hidden");
    expect(screen.getByTestId("agent-layout")).toHaveClass("min-h-0", "overflow-hidden");
    expect(screen.getByTestId("agent-workspace")).toHaveClass("min-h-0", "overflow-hidden");
    expect(screen.getByTestId("agent-header")).not.toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("agent-message-scroll")).toHaveClass(
      "overflow-y-auto",
      "scrollbar-hidden",
    );
  });

  it("keeps the reader's position and surfaces new activity after they scroll up", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous answer");
    const messageScroll = screen.getByTestId("agent-message-scroll");
    Object.defineProperties(messageScroll, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, value: 120, writable: true },
    });
    const scrollTo = vi.fn();
    Object.defineProperty(messageScroll, "scrollTo", { configurable: true, value: scrollTo });
    fireEvent.scroll(messageScroll);

    await act(async () => {
      fixture.emit({
        type: "runtime.started",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        createdAt: "2026-08-13T00:00:00.000Z",
      });
    });

    expect(scrollTo).not.toHaveBeenCalled();
    const latestButton = screen.getByRole("button", { name: "1 new update" });
    fireEvent.click(latestButton);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 1_200 });
    expect(screen.queryByRole("button", { name: /new update/ })).not.toBeInTheDocument();
  });

  it("shows the model request drawer only when developer mode is enabled", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: true,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    const button = await screen.findByRole("button", {
      name: "Open model request inspector",
    });
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
        messages: [
          { role: "system", content: "You are StoryForge." },
          { role: "user", content: "Inspect auth" },
        ],
        tools: [],
      });
    });

    expect(screen.getByText("Runtime instructions")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("User request")).toBeInTheDocument();
  });

  it("hides the model request inspector when developer mode is disabled", async () => {
    installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    expect(await screen.findByText("Previous question")).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Open model request inspector",
    })).not.toBeInTheDocument();
  });

  it("clears captured model requests when sending a new prompt", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: true,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Open model request inspector",
    }));
    await act(async () => {
      fixture.emit({
        type: "model.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "model-request-1",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Inspect auth" }],
        tools: [],
      });
    });
    expect(screen.getByText("User request")).toBeInTheDocument();

    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );
    fireEvent.change(input, { target: { value: "Next request" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fixture.start).toHaveBeenCalled());
    expect(screen.getByText("No model requests captured yet.")).toBeInTheDocument();
  });

  it("copies the selected model request JSON", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: true,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Open model request inspector",
    }));
    await act(async () => {
      fixture.emit({
        type: "model.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "model-request-1",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Inspect auth" }],
        tools: [],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("\"model\": \"deepseek-v4-pro\""),
    ));
  });

  it("saves provider settings and shows a saved-key indicator without exposing plaintext", async () => {
    const fixture = installApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Models" }));
    const keyInput = await screen.findByLabelText("API key");

    expect(screen.getByTestId("models-page")).toHaveClass("min-h-0", "overflow-hidden");
    expect(screen.getByTestId("model-provider-list")).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(screen.getByRole("img", { name: "DeepSeek provider logo" })).toBeInTheDocument();
    expect(screen.getByTestId("provider-model-options")).toHaveTextContent("deepseek-v4-flash");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("Connection succeeded · 2 models")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "deepseek-v4-flash" }));
    expect(screen.getByLabelText("Model ID")).toHaveValue("deepseek-v4-flash");
    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: "deepseek-v4-pro" },
    });
    expect(keyInput).toHaveAttribute("type", "password");
    expect(keyInput).toHaveValue("************");
    fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
    await waitFor(() => expect(fixture.revealSecret).toHaveBeenCalledWith("deepseek"));
    expect(keyInput).toHaveAttribute("type", "text");
    expect(keyInput).toHaveValue("saved-local-secret");
    fireEvent.click(screen.getByRole("button", { name: "Hide API key" }));
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

  it("keeps provider saving separate and selects an exact default model on double-click", async () => {
    const fixture = installApi({
      providers: [
        {
          providerId: "deepseek",
          displayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          recommendedModels: ["deepseek-v4-pro"],
          isDefault: true,
          defaultModel: "deepseek-v4-pro",
          hasSecret: true,
          lastTestStatus: "success",
          supportsImageInput: false,
        },
        {
          providerId: "volcano",
          displayName: "Volcano Engine (火山引擎)",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          model: "doubao-seed-2-0-lite-260215",
          recommendedModels: [
            "doubao-seed-2-0-lite-260215",
            "ep-custom-endpoint",
          ],
          isDefault: false,
          hasSecret: true,
          lastTestStatus: "success",
          supportsImageInput: false,
        },
      ],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Models" }));
    const volcanoProvider = screen.getByRole("button", { name: /Volcano Engine/ });
    fireEvent.doubleClick(volcanoProvider);
    await waitFor(() => expect(fixture.setDefaultProvider).toHaveBeenCalledWith({
      providerId: "volcano",
      model: "doubao-seed-2-0-lite-260215",
    }));
    fixture.setDefaultProvider.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await waitFor(() => expect(fixture.saveProvider).toHaveBeenCalled());
    expect(fixture.setDefaultProvider).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("Default provider")).toHaveLength(1);

    const customModel = screen.getByRole("button", { name: "ep-custom-endpoint" });
    fireEvent.click(customModel);
    expect(screen.getByLabelText("Model ID")).toHaveValue("ep-custom-endpoint");
    expect(fixture.setDefaultProvider).not.toHaveBeenCalled();

    fireEvent.doubleClick(customModel);
    await waitFor(() => expect(fixture.setDefaultProvider).toHaveBeenCalledWith({
      providerId: "volcano",
      model: "ep-custom-endpoint",
    }));
    expect(await screen.findByText("Default model set to ep-custom-endpoint"))
      .toBeInTheDocument();
    expect(screen.getAllByText("Default")).toHaveLength(1);
    expect(screen.getAllByLabelText("Default provider")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Coding Agent" }));
    expect(await screen.findByText("project / ep-custom-endpoint / live response"))
      .toBeInTheDocument();
  });

  it("does not let a stale session refresh restore the previous model", async () => {
    let resolveSession: ((session: SessionView) => void) | undefined;
    const staleSession = new Promise<SessionView>((resolve) => {
      resolveSession = resolve;
    });
    const getSession = vi.fn(() => staleSession);
    const fixture = installApi({
      getSession,
      providers: [
        {
          providerId: "deepseek",
          displayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          recommendedModels: ["deepseek-v4-pro"],
          isDefault: true,
          defaultModel: "deepseek-v4-pro",
          hasSecret: true,
          lastTestStatus: "success",
          supportsImageInput: false,
        },
        {
          providerId: "volcano",
          displayName: "Volcano Engine (火山引擎)",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          model: "doubao-new",
          recommendedModels: ["doubao-new"],
          isDefault: false,
          hasSecret: true,
          lastTestStatus: "success",
          supportsImageInput: false,
        },
      ],
    });
    render(<App />);
    await screen.findByText("Previous answer");

    await act(async () => {
      fixture.emit({
        type: "runtime.completed",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        stopReason: "completed",
        steps: 1,
      });
    });
    expect(getSession).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /Volcano Engine/ }));
    await waitFor(() => expect(fixture.setDefaultProvider).toHaveBeenCalledWith({
      providerId: "volcano",
      model: "doubao-new",
    }));

    await act(async () => {
      resolveSession?.({
        schemaVersion: 2,
        id: "sf_session_existing",
        workspaceId: "workspace-1",
        title: "Project session",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        status: "completed",
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
        messages: [],
        tasks: [],
      });
      await staleSession;
    });

    fireEvent.click(screen.getByRole("button", { name: "Coding Agent" }));
    expect(await screen.findByText("project / doubao-new / live response"))
      .toBeInTheDocument();
  });

  it("manages installed skills from the MCP and Skills page", async () => {
    const fixture = installApi({
      skills: [{
        id: "code-review",
        name: "Code Review",
        description: "Review code",
        invocationName: "/code-review",
        enabled: true,
        installedAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
      }],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "MCP & Skills" }));

    expect(screen.getByRole("tablist")).toHaveClass("inline-grid", "grid-cols-2");
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveClass("w-36");
    expect(screen.getByRole("tab", { name: "MCP Servers" })).toHaveClass("w-36");
    expect(await screen.findByText("/code-review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Enable Code Review" }));
    await waitFor(() => expect(fixture.setSkillEnabled).toHaveBeenCalledWith({
      skillId: "code-review",
      enabled: false,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Import Skill" }));
    await waitFor(() => expect(fixture.importSkill).toHaveBeenCalled());
    expect(await screen.findByText("/deploy")).toBeInTheDocument();
  });

  it("saves MCP JSON and tests a configured server", async () => {
    const fixture = installApi({
      mcpConfig: {
        schemaVersion: 1,
        rawJson: "{\"mcpServers\":{\"github\":{\"command\":\"node\"}}}",
        servers: [{
          name: "github",
          transport: "stdio",
          enabled: true,
          status: "untested",
          tools: [],
        }],
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "MCP & Skills" }));
    fireEvent.click(await screen.findByRole("tab", { name: "MCP Servers" }));
    const editor = await screen.findByLabelText("MCP configuration JSON");
    fireEvent.change(editor, {
      target: { value: "{\"mcpServers\":{\"github\":{\"command\":\"node\",\"args\":[\"server.js\"]}}}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save MCP config" }));

    await waitFor(() => expect(fixture.saveMcp).toHaveBeenCalledWith({
      rawJson: "{\"mcpServers\":{\"github\":{\"command\":\"node\",\"args\":[\"server.js\"]}}}",
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Test github" }));

    await waitFor(() => expect(fixture.testMcp).toHaveBeenCalledWith("github"));
    expect(await screen.findByText("list_issues")).toBeInTheDocument();
  });

  it("creates an automation from the Automations page", async () => {
    const fixture = installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Automations" }));
    expect(await screen.findByRole("heading", { name: "Automations" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Automation name"), {
      target: { value: "Daily risk audit" },
    });
    fireEvent.change(screen.getByLabelText("Schedule description"), {
      target: { value: "每天早上 9 点" },
    });
    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: { value: "Review repository risk." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate schedule" }));

    await waitFor(() => expect(fixture.interpretAutomationSchedule).toHaveBeenCalledWith({
      scheduleText: "每天早上 9 点",
      timezone: "Asia/Shanghai",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    }));
    expect(await screen.findByDisplayValue("0 9 * * *")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }));

    await waitFor(() => expect(fixture.createAutomation).toHaveBeenCalledWith({
      name: "Daily risk audit",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "每天早上 9 点",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      },
      prompt: "Review repository risk.",
    }));
    expect(await screen.findByText("Daily risk audit")).toBeInTheDocument();
  });

  it("runs, pauses, resumes, and deletes automations", async () => {
    const fixture = installApi({
      automations: [sampleAutomation()],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Automations" }));
    expect(await screen.findByText("Daily risk audit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run Daily risk audit now" }));
    await waitFor(() => expect(fixture.runAutomationNow).toHaveBeenCalledWith("sf_automation_daily"));

    fireEvent.click(screen.getByRole("button", { name: "Pause Daily risk audit" }));
    await waitFor(() => expect(fixture.updateAutomation).toHaveBeenCalledWith({
      automationId: "sf_automation_daily",
      status: "paused",
    }));

    fireEvent.click(await screen.findByRole("button", { name: "Resume Daily risk audit" }));
    await waitFor(() => expect(fixture.updateAutomation).toHaveBeenCalledWith({
      automationId: "sf_automation_daily",
      status: "active",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Delete Daily risk audit" }));
    await waitFor(() => expect(fixture.deleteAutomation).toHaveBeenCalledWith("sf_automation_daily"));
    await waitFor(() => expect(screen.queryByText("Daily risk audit")).not.toBeInTheDocument());
  });

  it("shows automation scope labels for scheduled chats and session timers", async () => {
    installApi({
      automations: [sampleAutomation(), sampleThreadAutomation()],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Automations" }));

    expect(await screen.findByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Session timer")).toBeInTheDocument();
    expect(screen.getByText("Session: Project session")).toBeInTheDocument();
  });

  it("creates an automation from a chat proposal card", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    await act(async () => {
      fixture.emit({
        type: "automation.proposal",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
          proposalId: "automation-proposal-1",
          proposal: {
            kind: "scheduled_chat",
            name: "Daily risk audit",
            scheduleText: "每天早上 9 点",
          cron: "0 9 * * *",
          timezone: "Asia/Shanghai",
          summary: "Every day at 09:00",
          nextRuns: ["2026-06-20T01:00:00.000Z"],
          prompt: "Review repository risk.",
          workspaceId: "workspace-1",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
        },
      });
    });

    expect(await screen.findByText("Automation proposal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create automation Daily risk audit" }));

    await waitFor(() => expect(fixture.createAutomation).toHaveBeenCalledWith({
      kind: "scheduled_chat",
      name: "Daily risk audit",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "每天早上 9 点",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      },
      prompt: "Review repository risk.",
    }));
    expect(await screen.findByText("Automation created")).toBeInTheDocument();
  });

  it("dismisses chat automation proposal cards locally", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    await act(async () => {
      fixture.emit({
        type: "automation.proposal",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
          proposalId: "automation-proposal-2",
          proposal: {
            kind: "scheduled_chat",
            name: "Daily risk audit",
            scheduleText: "每天早上 9 点",
          cron: "0 9 * * *",
          timezone: "Asia/Shanghai",
          summary: "Every day at 09:00",
          nextRuns: ["2026-06-20T01:00:00.000Z"],
          prompt: "Review repository risk.",
          workspaceId: "workspace-1",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
        },
      });
    });

    fireEvent.click(await screen.findByRole("button", {
      name: "Cancel automation Daily risk audit",
    }));

    await waitFor(() => expect(screen.queryByText("Automation proposal")).not.toBeInTheDocument());
  });

  it("creates a thread timer from the chat header", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    fireEvent.click(screen.getByRole("button", { name: "Create session timer" }));
    fireEvent.change(screen.getByLabelText("Schedule description"), {
      target: { value: "每小时" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate schedule" }));
    await waitFor(() => expect(fixture.interpretAutomationSchedule).toHaveBeenCalledWith({
      scheduleText: "每小时",
      timezone: expect.any(String),
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    }));
    fireEvent.change(screen.getByLabelText("Timer name"), {
      target: { value: "Thread follow-up" },
    });
    fireEvent.change(screen.getByLabelText("Timer prompt"), {
      target: { value: "Continue the current investigation." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create timer" }));

    await waitFor(() => expect(fixture.createAutomation).toHaveBeenCalledWith({
      kind: "thread_chat",
      name: "Thread follow-up",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      sessionId: "sf_session_existing",
      schedule: {
        sourceText: "每小时",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      },
      prompt: "Continue the current investigation.",
    }));
  });

  it("creates a thread timer from a chat proposal card", async () => {
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
          name: "Thread follow-up",
          sessionId: "sf_session_existing",
          scheduleText: "每小时",
          cron: "0 * * * *",
          timezone: "Asia/Shanghai",
          summary: "Every hour",
          nextRuns: ["2026-06-20T01:00:00.000Z"],
          prompt: "Continue this session.",
          workspaceId: "workspace-1",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
        },
      });
    });

    expect(await screen.findByText("Thread timer proposal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create timer Thread follow-up" }));

    await waitFor(() => expect(fixture.createAutomation).toHaveBeenCalledWith({
      kind: "thread_chat",
      name: "Thread follow-up",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      sessionId: "sf_session_existing",
      schedule: {
        sourceText: "每小时",
        cron: "0 * * * *",
        timezone: "Asia/Shanghai",
        summary: "Every hour",
      },
      prompt: "Continue this session.",
    }));
    expect(await screen.findByText("Thread timer created")).toBeInTheDocument();
  });

  it("loads and saves developer mode from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
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

  it("loads and saves language from Settings and applies it immediately", async () => {
    const fixture = installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const languageGroup = await screen.findByRole("radiogroup", { name: "Language" });
    expect(within(languageGroup).getByRole("radio", { name: "English" }))
      .toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(languageGroup).getByRole("radio", { name: "中文" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      language: "zh",
    }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编码智能体" })).toBeInTheDocument();
  });

  it("loads and saves command execution mode from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const commandModeGroup = await screen.findByRole("radiogroup", {
      name: "Command execution",
    });
    expect(within(commandModeGroup).getByRole("radio", { name: "Sentinel mode" }))
      .toHaveAttribute("aria-checked", "true");
    expect(within(commandModeGroup).getByRole("radio", { name: "Unleashed mode" }))
      .toHaveAccessibleDescription(
        "Unleashed mode runs every command as your current system user without confirmation.",
      );
    expect(screen.getByText(
      "StoryForge uses command guards and an isolated command environment. This is not an OS sandbox; Unleashed mode runs commands as the current system user.",
    )).toBeInTheDocument();

    fireEvent.click(within(commandModeGroup).getByRole("radio", { name: "Cruise mode" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      commandExecutionMode: "cruise",
    }));
    expect(within(commandModeGroup).getByRole("radio", { name: "Cruise mode" }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("loads and saves Web Search Coverage from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        developerMode: false,
        commandExecutionMode: "sentinel",
        webAccessEnabled: false,
        webSearchCoverage: "focused",
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const webAccess = await screen.findByRole("switch", { name: "Web access" });
    const coverageGroup = await screen.findByRole("radiogroup", {
      name: "Web Search Coverage",
    });
    expect(webAccess).not.toBeChecked();
    expect(within(coverageGroup).getByRole("radio", { name: "Focused" })).toBeDisabled();

    fireEvent.click(webAccess);

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      webAccessEnabled: true,
    }));
    expect(within(coverageGroup).getByRole("radio", { name: "Focused" })).not.toBeDisabled();

    fireEvent.click(within(coverageGroup).getByRole("radio", { name: "Wide" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      webSearchCoverage: "wide",
    }));
    expect(within(coverageGroup).getByRole("radio", { name: "Wide" }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("previews and saves soul.md and changes its memory mode", async () => {
    const fixture = installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const editor = await screen.findByRole("textbox", { name: "Soul Markdown" });
    expect(editor).toHaveValue("# Soul\n\n- Prefers concise answers.\n");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Prefers concise answers.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Soul Markdown" }), {
      target: { value: "# Soul\n\n- Prefers Chinese responses." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Soul" }));

    await waitFor(() => expect(fixture.saveSoul).toHaveBeenCalledWith({
      content: "# Soul\n\n- Prefers Chinese responses.",
      expectedRevision: "soul-revision-1",
    }));

    const soulMode = screen.getByRole("radiogroup", { name: "Soul memory mode" });
    fireEvent.click(within(soulMode).getByRole("radio", { name: "Manual" }));
    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      soulMode: "manual",
    }));
  });

  it("responds to command permission requests", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    await act(async () => {
      fixture.emit({
        type: "permission.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "permission_1",
        reason: "Command is outside the safe allowlist.",
        command: {
          program: "agent-browser",
          args: ["screenshot"],
          cwd: "/tmp/project",
        },
        mode: "sentinel",
        risk: "unknown",
      });
    });

    expect(await screen.findByRole("dialog", { name: "Allow command?" }))
      .toBeInTheDocument();
    expect(screen.getByText("agent-browser screenshot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(fixture.respondPermission).toHaveBeenCalledWith({
      requestId: "permission_1",
      approved: true,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Allow command?" }))
      .not.toBeInTheDocument());
  });

  it("denies command permission requests", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    await act(async () => {
      fixture.emit({
        type: "permission.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "permission_2",
        reason: "This command may modify or delete files.",
        command: {
          program: "rm",
          args: ["-rf", "dist"],
          cwd: "/tmp/project",
        },
        mode: "cruise",
        risk: "destructive",
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() => expect(fixture.respondPermission).toHaveBeenCalledWith({
      requestId: "permission_2",
      approved: false,
    }));
  });

  it("responds to human input requests", async () => {
    const fixture = installApi();
    render(<App />);
    await screen.findByText("Previous question");

    await act(async () => {
      fixture.emit({
        type: "human.input.request",
        sessionId: "sf_session_existing",
        turnId: "sf_turn_active",
        requestId: "human_input_1",
        title: "Choose implementation scope",
        description: "StoryForge needs your preference before editing files.",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope should StoryForge use?",
            type: "single_select",
            required: true,
            options: [
              { id: "minimal", label: "Minimal", description: "Touch only requested files." },
              { id: "full", label: "Full", description: "Include the full UI flow." },
            ],
          },
        ],
        remark: {
          enabled: true,
          label: "Additional context",
        },
      });
    });

    const messageScroll = screen.getByTestId("agent-message-scroll");
    expect(await within(messageScroll).findByTestId("human-input-card")).toBeInTheDocument();
    expect(within(messageScroll).getByText("Choose implementation scope")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Minimal/ }));
    fireEvent.change(screen.getByLabelText("Additional context"), {
      target: { value: "Keep it narrow." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(fixture.respondHumanInput).toHaveBeenCalledWith({
      requestId: "human_input_1",
      answers: [
        {
          id: "scope",
          header: "Scope",
          question: "Which scope should StoryForge use?",
          type: "single_select",
          selectedOptionIds: ["minimal"],
          selectedLabels: ["Minimal"],
        },
      ],
      remark: "Keep it narrow.",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose implementation scope" }))
      .not.toBeInTheDocument());
  });

});

function changePrompt(input: HTMLElement, value: string): void {
  const textarea = input as HTMLTextAreaElement;
  fireEvent.change(textarea, {
    target: {
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
    },
  });
  textarea.setSelectionRange(value.length, value.length);
  fireEvent.keyUp(textarea, { key: value.at(-1) ?? "" });
}

function installApi(options: {
  settings?: Partial<AppSettingsView>;
  saveSettings?: StoryForgeApi["settings"]["save"];
  providers?: ProviderView[];
  session?: Partial<SessionView>;
  workspaces?: WorkspaceView[];
  sessions?: SessionView[];
  skills?: SkillView[];
  mcpConfig?: McpConfigView;
  automations?: AutomationView[];
  compact?: StoryForgeApi["turns"]["compact"];
  repository?: GitRepositoryView;
  getRepository?: StoryForgeApi["git"]["get"];
  getSession?: StoryForgeApi["sessions"]["get"];
  modelImageSupport?: Record<string, boolean>;
  start?: StoryForgeApi["turns"]["start"];
  agentRun?: AgentRunView;
  getAgentRun?: StoryForgeApi["agentRuns"]["get"];
} = {}) {
  const provider: ProviderView = {
    providerId: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    isDefault: true,
    defaultModel: "deepseek-v4-pro",
    hasSecret: true,
    lastTestStatus: "success",
    supportsImageInput: false,
  };
  let currentProviders = options.providers ?? [provider];
  const workspace: WorkspaceView = {
    id: "workspace-1",
    path: "/tmp/project",
    displayName: "project",
    createdAt: "2026-06-07T00:00:00.000Z",
    lastOpenedAt: "2026-06-07T00:00:00.000Z",
  };
  const allWorkspaces = options.workspaces ?? [workspace];
  const defaultMessages: SessionView["messages"] = [
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
  ];
  const session: SessionView = {
    schemaVersion: 2,
    id: "sf_session_existing",
    workspaceId: workspace.id,
    title: "Project session",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    status: "idle",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...options.session,
    messages: options.session?.messages ?? defaultMessages,
    tasks: options.session?.tasks ?? [],
  };
  const allSessions = options.sessions ?? [session];
  let eventListener: ((event: AgentEvent) => void) | undefined;
  const start = options.start
    ? vi.mocked(options.start)
    : vi.fn(async () => ({ turnId: "sf_turn_active" as const }));
  const stop = vi.fn(async () => undefined);
  const compact = options.compact
    ? vi.mocked(options.compact)
    : vi.fn(async () => undefined);
  const respondPermission = vi.fn(async () => undefined);
  const respondExtensionUi = vi.fn(async () => undefined);
  const respondHumanInput = vi.fn(async () => undefined);
  const getSession = options.getSession
    ? vi.mocked(options.getSession)
    : vi.fn(async (sessionId: string) =>
      allSessions.find((candidate) => candidate.id === sessionId) ?? session
    );
  const getRepository = options.getRepository
    ? vi.mocked(options.getRepository)
    : vi.fn(async (): Promise<GitRepositoryView> =>
      options.repository ?? {
        status: "not-repository",
        workspaceId: workspace.id,
        checkedAt: 1_786_086_000,
      }
    );
  const getAgentRun = options.getAgentRun
    ? vi.mocked(options.getAgentRun)
    : vi.fn(async (turnId) => options.agentRun?.turnId === turnId ? options.agentRun : undefined);
  const settings: AppSettingsView = {
    schemaVersion: 1 as const,
    language: "en",
    developerMode: false,
    commandExecutionMode: "sentinel" as const,
    webAccessEnabled: false,
    webSearchCoverage: "focused" as const,
    ...options.settings,
    soulMode: options.settings?.soulMode ?? "ask",
  };
  const saveSettings = options.saveSettings
    ? vi.mocked(options.saveSettings)
    : vi.fn(async (input) => ({ ...settings, ...input }));
  const soulDocument = {
    content: "# Soul\n\n- Prefers concise answers.\n",
    revision: "soul-revision-1",
    exists: true,
    byteLength: 35,
    maxBytes: 16_384,
    filePath: "/tmp/.story-forge/soul.md",
    updatedAt: "2026-06-20T00:00:00.000Z",
  } as const;
  const getSoul = vi.fn(async () => soulDocument);
  const saveSoul = vi.fn(async (input: { content: string; expectedRevision: string }) => ({
    content: input.content.trim() ? `${input.content.trim()}\n` : "",
    revision: "soul-revision-2",
    exists: true,
    byteLength: input.content.length,
    maxBytes: 16_384,
    filePath: "/tmp/.story-forge/soul.md",
    updatedAt: "2026-06-20T00:00:01.000Z",
  }));
  const saveProvider = vi.fn(async (input) => {
    const current = currentProviders.find((candidate) =>
      candidate.providerId === input.providerId
    ) ?? provider;
    const saved: ProviderView = {
      ...current,
      baseUrl: input.baseUrl,
      model: input.model,
      recommendedModels: Array.from(new Set([
        input.model,
        ...current.recommendedModels,
      ])),
      hasSecret: current.hasSecret || Boolean(input.apiKey),
    };
    currentProviders = currentProviders.map((candidate) =>
      candidate.providerId === saved.providerId ? saved : candidate
    );
    return saved;
  });
  const setDefaultProvider = vi.fn(async (input: { providerId: string; model: string }) => {
    currentProviders = currentProviders.map((candidate) => {
      if (candidate.providerId === input.providerId) {
        return {
          ...candidate,
          model: input.model,
          isDefault: true,
          defaultModel: input.model,
          supportsImageInput:
            options.modelImageSupport?.[input.model] ?? candidate.supportsImageInput,
        };
      }
      const { defaultModel: _defaultModel, ...rest } = candidate;
      return { ...rest, isDefault: false };
    });
  });
  const revealSecret = vi.fn(async () => "saved-local-secret");
  let currentSkills = options.skills ?? [];
  let currentMcpConfig = options.mcpConfig ?? {
    schemaVersion: 1 as const,
    rawJson: "{\"mcpServers\":{}}",
    servers: [],
  };
  let currentAutomations = options.automations ?? [];
  const importedSkill: SkillView = {
    id: "deploy",
    name: "Deploy",
    description: "Deploy safely",
    invocationName: "/deploy",
    enabled: true,
    installedAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
  };
  const importSkill = vi.fn(async () => {
    currentSkills = [...currentSkills.filter((skill) => skill.id !== importedSkill.id), importedSkill];
    return importedSkill;
  });
  const setSkillEnabled = vi.fn(async ({ skillId, enabled }) => {
    const skill = currentSkills.find((candidate) => candidate.id === skillId) ?? importedSkill;
    const updated = { ...skill, enabled };
    currentSkills = currentSkills.map((candidate) => candidate.id === skillId ? updated : candidate);
    return updated;
  });
  const saveMcp = vi.fn(async ({ rawJson }) => {
    currentMcpConfig = { ...currentMcpConfig, rawJson };
    return currentMcpConfig;
  });
  const testMcp = vi.fn(async (name: string) => {
    const server = {
      name,
      transport: "stdio" as const,
      enabled: true,
      status: "success" as const,
      lastTestedAt: "2026-06-19T00:00:00.000Z",
      tools: [{ name: "list_issues", description: "List issues", inputSchema: { type: "object" } }],
    };
    currentMcpConfig = {
      ...currentMcpConfig,
      servers: currentMcpConfig.servers.map((candidate) =>
        candidate.name === name ? server : candidate
      ),
    };
    return server;
  });
  const interpretAutomationSchedule = vi.fn(async () => ({
    ok: true as const,
    cron: "0 9 * * *",
    timezone: "Asia/Shanghai",
    summary: "Every day at 09:00",
    nextRuns: ["2026-06-20T01:00:00.000Z"],
  }));
  const validateAutomationSchedule = vi.fn(async () => ({
    ok: true as const,
    cron: "0 9 * * *",
    timezone: "Asia/Shanghai",
    summary: "Every day at 09:00",
    nextRuns: ["2026-06-20T01:00:00.000Z"],
  }));
  const createAutomation = vi.fn(async (input) => {
    const automation: AutomationView = {
      schemaVersion: 1,
      id: "sf_automation_created",
      kind: "scheduled_chat",
      ...input,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      nextRunAt: "2026-06-20T01:00:00.000Z",
    };
    currentAutomations = [automation, ...currentAutomations];
    return automation;
  });
  const updateAutomation = vi.fn(async (input) => {
    const current = currentAutomations.find((automation) =>
      automation.id === input.automationId
    );
    const updated: AutomationView = {
      ...(current ?? sampleAutomation()),
      ...input,
      id: input.automationId,
      updatedAt: "2026-06-20T00:00:01.000Z",
    };
    currentAutomations = currentAutomations.map((automation) =>
      automation.id === input.automationId ? updated : automation
    );
    return updated;
  });
  const deleteAutomation = vi.fn(async (automationId: string) => {
    currentAutomations = currentAutomations.filter((automation) => automation.id !== automationId);
  });
  const runAutomationNow = vi.fn(async (automationId: string) => ({
    schemaVersion: 1 as const,
    id: "sf_automation_run_now",
    automationId,
    status: "completed" as const,
    scheduledFor: "2026-06-20T00:00:00.000Z",
    startedAt: "2026-06-20T00:00:00.000Z",
    completedAt: "2026-06-20T00:00:01.000Z",
  }));
  const api = {
    version: "0.1.0",
    settings: {
      get: vi.fn(async () => settings),
      save: saveSettings,
    },
    soul: {
      get: getSoul,
      save: saveSoul,
    },
    providers: {
      list: vi.fn(async () => currentProviders),
      save: saveProvider,
      test: vi.fn(async () => ({ models: provider.recommendedModels })),
      clearSecret: vi.fn(async () => undefined),
      revealSecret,
      setDefault: setDefaultProvider,
      discoverModels: vi.fn(async () => provider.recommendedModels),
    },
    workspaces: {
      list: vi.fn(async () => allWorkspaces),
      open: vi.fn(async () => workspace),
      remove: vi.fn(async () => undefined),
    },
    git: {
      get: getRepository,
    },
    sessions: {
      list: vi.fn(async () => allSessions),
      create: vi.fn(async () => session),
      get: getSession,
      rename: vi.fn(async (_sessionId, title) => ({ ...session, title })),
      delete: vi.fn(async () => undefined),
    },
    turns: {
      start,
      stop,
      compact,
      onEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      }),
    },
    agentRuns: {
      get: getAgentRun,
    },
    permissions: {
      respond: respondPermission,
    },
    extensionUi: {
      respond: respondExtensionUi,
    },
    humanInput: {
      respond: respondHumanInput,
    },
    skills: {
      list: vi.fn(async () => currentSkills),
      importZip: importSkill,
      setEnabled: setSkillEnabled,
      remove: vi.fn(async () => undefined),
    },
    mcp: {
      get: vi.fn(async () => currentMcpConfig),
      save: saveMcp,
      testServer: testMcp,
    },
    automations: {
      list: vi.fn(async () => currentAutomations),
      getRuns: vi.fn(async () => []),
      validateSchedule: validateAutomationSchedule,
      interpretSchedule: interpretAutomationSchedule,
      create: createAutomation,
      update: updateAutomation,
      delete: deleteAutomation,
      runNow: runAutomationNow,
    },
  } as StoryForgeApi;
  Object.defineProperty(window, "storyForge", {
    configurable: true,
    value: api,
  });
  return {
    start,
    stop,
    compact,
    respondPermission,
    respondExtensionUi,
    respondHumanInput,
    getSession,
    getRepository,
    getAgentRun,
    saveSettings,
    getSoul,
    saveSoul,
    saveProvider,
    setDefaultProvider,
    revealSecret,
    importSkill,
    setSkillEnabled,
    saveMcp,
    testMcp,
    interpretAutomationSchedule,
    validateAutomationSchedule,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    runAutomationNow,
    emit: (event: AgentEvent | UnsequencedAgentEvent) => eventListener?.(
      "eventId" in event
        ? event
        : {
            ...event,
            eventId: "sf_agent_event_test",
            sequence: 1,
            occurredAt: "2026-08-28T08:00:00.000Z",
            agentExecutionId: "sf_agent_execution_root",
          } as AgentEvent,
    ),
  };
}

function sampleAgentRun(): AgentRunView {
  const usage = {
    turns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  return {
    schemaVersion: 1,
    sessionId: "sf_session_existing",
    turnId: "sf_turn_team",
    rootExecutionId: "sf_agent_execution_root",
    sequence: 1,
    createdAt: "2026-08-28T08:00:00.000Z",
    updatedAt: "2026-08-28T08:00:01.000Z",
    executions: [
      {
        id: "sf_agent_execution_root",
        role: "root",
        objective: "Answer the user",
        status: "running",
        attempt: 1,
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        createdAt: "2026-08-28T08:00:00.000Z",
        startedAt: "2026-08-28T08:00:00.000Z",
        usage,
      },
      {
        id: "sf_agent_execution_explorer",
        parentExecutionId: "sf_agent_execution_root",
        role: "explorer",
        objective: "Map persisted runtime state",
        status: "running",
        attempt: 1,
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        createdAt: "2026-08-28T08:00:00.000Z",
        startedAt: "2026-08-28T08:00:01.000Z",
        usage,
      },
    ],
  };
}

function sampleAutomation(): AutomationView {
  return {
    schemaVersion: 1,
    id: "sf_automation_daily",
    kind: "scheduled_chat",
    name: "Daily risk audit",
    status: "active",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    schedule: {
      sourceText: "每天早上 9 点",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      summary: "Every day at 09:00",
    },
    prompt: "Review repository risk.",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    nextRunAt: "2026-06-20T01:00:00.000Z",
  };
}

function sampleGitRepository(): Extract<GitRepositoryView, { status: "ready" }> {
  return {
    status: "ready",
    workspaceId: "workspace-1",
    checkedAt: 1_786_086_000,
    rootPath: "/tmp/project",
    head: {
      branch: "chore/code-optimization",
      commit: "7316a95304ce2a41c10d53c052954f892f8b0b90",
      detached: false,
      unborn: false,
    },
    upstream: {
      name: "origin/main",
      ahead: 0,
      behind: 0,
      gone: false,
    },
    lastCommit: {
      shortHash: "7316a95",
      subject: "Merge pull request #22",
      committedAt: 1_786_085_900,
    },
    changes: {
      total: 0,
      staged: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      conflicted: 0,
      files: [],
    },
    branches: {
      local: [{
        name: "chore/code-optimization",
        kind: "local",
        current: true,
        commit: "7316a95304ce2a41c10d53c052954f892f8b0b90",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
      }],
      remote: [{
        name: "origin/main",
        kind: "remote",
        current: false,
        commit: "7316a95304ce2a41c10d53c052954f892f8b0b90",
        upstream: null,
        ahead: 0,
        behind: 0,
      }],
    },
  };
}

function sampleThreadAutomation(): AutomationView {
  return {
    schemaVersion: 1,
    id: "sf_automation_thread",
    kind: "thread_chat",
    name: "Thread follow-up",
    status: "active",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    sessionId: "sf_session_existing",
    schedule: {
      sourceText: "每小时",
      cron: "0 * * * *",
      timezone: "Asia/Shanghai",
      summary: "Every hour",
    },
    prompt: "Continue the current investigation.",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    nextRunAt: "2026-06-20T01:00:00.000Z",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
