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
import type { AgentEvent, AppSettingsView, McpConfigView, SkillView } from "@story-forge/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderView,
  SessionView,
  StoryForgeApi,
  WorkspaceView,
} from "../shared/story-forge-api";
import { App } from "./App";

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

    await waitFor(() => expect(fixture.getSession).toHaveBeenCalledWith("sf_session_existing"));
    expect(screen.queryByText("Running workspace.readFile")).not.toBeInTheDocument();
  });

  it("shows pending status, live deltas, and inline tool progress while a turn runs", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "live",
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
    expect(screen.getByText("Completed workspace.readFile")).toBeInTheDocument();
    expect(screen.queryByText("Running workspace.readFile")).not.toBeInTheDocument();
  });

  it("renders failed tool steps before later assistant text in the active turn", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "live",
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

    const failedStep = screen.getByText("Failed workspace.runCommand");
    const answer = screen.getByText("I found the failure.");
    expect(
      failedStep.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("plays smooth deltas without exposing intermediate text as persisted messages", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "smooth",
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
    expect(screen.getByTestId("agent-message-scroll")).toHaveClass("overflow-y-auto");
  });

  it("shows the model request drawer only when developer mode is enabled", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
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

  it("hides the model request inspector when developer mode is disabled", async () => {
    installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
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
        responseMode: "auto",
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
        responseMode: "auto",
        messages: [{ role: "user", content: "Inspect auth" }],
        tools: [],
      });
    });
    expect(screen.getByText("Model Request #1")).toBeInTheDocument();

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
        responseMode: "auto",
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
        responseMode: "auto",
        messages: [{ role: "user", content: "Inspect auth" }],
        tools: [],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("model-request-1"),
    ));
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

  it("loads and saves the global response mode from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const responseModeGroup = await screen.findByRole("radiogroup", {
      name: "Response mode",
    });
    expect(within(responseModeGroup).getByRole("radio", { name: "Auto" }))
      .toHaveAttribute("aria-checked", "true");
    expect(within(responseModeGroup).getByRole("radio", { name: "Smooth" }))
      .toHaveAccessibleDescription(
        "Show waiting status, then play back completed responses.",
      );

    fireEvent.click(within(responseModeGroup).getByRole("radio", { name: "Smooth" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      responseMode: "smooth",
    }));
    expect(within(responseModeGroup).getByRole("radio", { name: "Smooth" }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("loads and saves developer mode from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
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

  it("loads and saves command execution mode from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const commandModeGroup = await screen.findByRole("radiogroup", {
      name: "Command execution",
    });
    expect(within(commandModeGroup).getByRole("radio", { name: "哨兵模式" }))
      .toHaveAttribute("aria-checked", "true");
    expect(within(commandModeGroup).getByRole("radio", { name: "无缰模式" }))
      .toHaveAccessibleDescription(
        "完全放开。命令不会再弹出确认，请只在你信任当前 Agent 时使用。",
      );

    fireEvent.click(within(commandModeGroup).getByRole("radio", { name: "巡航模式" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      commandExecutionMode: "cruise",
    }));
    expect(within(commandModeGroup).getByRole("radio", { name: "巡航模式" }))
      .toHaveAttribute("aria-checked", "true");
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

  it("rolls back the response mode and shows an error when saving fails", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
      saveSettings: vi.fn(async () => {
        throw new Error("Unable to save settings");
      }),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const responseModeGroup = await screen.findByRole("radiogroup", {
      name: "Response mode",
    });
    fireEvent.click(within(responseModeGroup).getByRole("radio", { name: "Smooth" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      responseMode: "smooth",
    }));
    expect(await screen.findByText("Unable to save settings")).toBeInTheDocument();
    expect(within(responseModeGroup).getByRole("radio", { name: "Auto" }))
      .toHaveAttribute("aria-checked", "true");
    expect(within(responseModeGroup).getByRole("radio", { name: "Smooth" }))
      .toHaveAttribute("aria-checked", "false");
  });

  it("disables response mode choices while settings are saving", async () => {
    const pendingSave = createDeferred<AppSettingsView>();
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
        developerMode: false,
        commandExecutionMode: "sentinel",
      },
      saveSettings: vi.fn(async (input) => ({
        ...(await pendingSave.promise),
        ...input,
      })),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const responseModeGroup = await screen.findByRole("radiogroup", {
      name: "Response mode",
    });
    fireEvent.click(within(responseModeGroup).getByRole("radio", { name: "Live" }));
    fireEvent.click(within(responseModeGroup).getByRole("radio", { name: "Smooth" }));
    expect(fixture.saveSettings).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(within(responseModeGroup).getByRole("radio", { name: "Auto" }))
      .toBeDisabled());
    expect(within(responseModeGroup).getByRole("radio", { name: "Live" })).toBeDisabled();
    expect(within(responseModeGroup).getByRole("radio", { name: "Smooth" })).toBeDisabled();

    await act(async () => {
      pendingSave.resolve({
        schemaVersion: 1,
        responseMode: "live",
        developerMode: false,
        commandExecutionMode: "sentinel",
      });
    });
    await waitFor(() => expect(within(responseModeGroup).getByRole("radio", { name: "Live" }))
      .not.toBeDisabled());
  });
});

function installApi(options: {
  settings?: AppSettingsView;
  saveSettings?: StoryForgeApi["settings"]["save"];
  skills?: SkillView[];
  mcpConfig?: McpConfigView;
} = {}) {
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
  const respondPermission = vi.fn(async () => undefined);
  const getSession = vi.fn(async () => session);
  const settings = options.settings ?? {
    schemaVersion: 1 as const,
    responseMode: "auto" as const,
    developerMode: false,
    commandExecutionMode: "sentinel" as const,
  };
  const saveSettings = options.saveSettings
    ? vi.mocked(options.saveSettings)
    : vi.fn(async (input) => ({ ...settings, ...input }));
  const saveProvider = vi.fn(async (input) => ({
    ...provider,
    baseUrl: input.baseUrl,
    model: input.model,
    hasSecret: provider.hasSecret || Boolean(input.apiKey),
  }));
  let currentSkills = options.skills ?? [];
  let currentMcpConfig = options.mcpConfig ?? {
    schemaVersion: 1 as const,
    rawJson: "{\"mcpServers\":{}}",
    servers: [],
  };
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
  const api = {
    version: "0.1.0",
    settings: {
      get: vi.fn(async () => settings),
      save: saveSettings,
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
    permissions: {
      respond: respondPermission,
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
  } as StoryForgeApi;
  Object.defineProperty(window, "storyForge", {
    configurable: true,
    value: api,
  });
  return {
    start,
    stop,
    respondPermission,
    getSession,
    saveSettings,
    saveProvider,
    importSkill,
    setSkillEnabled,
    saveMcp,
    testMcp,
    emit: (event: AgentEvent) => eventListener?.(event),
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
