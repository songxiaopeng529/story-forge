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
  AppSettingsView,
  AutomationView,
  McpConfigView,
  SkillView,
} from "@story-forge/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
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

  it("shows the provider configured on the current session in the run context", async () => {
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

    expect(await screen.findByText("Volcano Engine")).toBeInTheDocument();
    expect(screen.queryByText("DeepSeek")).not.toBeInTheDocument();
  });

  it("offers enabled skills in the slash command menu and inserts the selected invocation", async () => {
    installApi({
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

    fireEvent.change(input, { target: { value: "/agent" } });

    const command = await screen.findByRole("option", { name: /\/agent-browser/i });
    expect(screen.queryByRole("option", { name: /\/drafting/i })).not.toBeInTheDocument();

    fireEvent.click(command);

    expect(input).toHaveValue("/agent-browser ");
  });

  it("runs built-in slash commands from the prompt", async () => {
    installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "/timer" } });
    fireEvent.click(await screen.findByRole("option", { name: /\/timer/i }));

    expect(await screen.findByLabelText("Schedule description")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("starts a plan mode turn from the slash command", async () => {
    const fixture = installApi();
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "/plan" } });
    fireEvent.click(await screen.findByRole("option", { name: /\/plan/i }));

    expect(input).toHaveValue("");
    expect(screen.getByText("Plan")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Investigate the runtime" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fixture.start).toHaveBeenCalledWith({
      sessionId: "sf_session_existing",
      prompt: "Investigate the runtime",
      mode: "plan",
    }));
  });

  it("shows a progress indicator while the /compact command runs", async () => {
    const deferred = createDeferred<undefined>();
    const fixture = installApi({ compact: vi.fn(() => deferred.promise) });
    render(<App />);
    const input = await screen.findByPlaceholderText(
      "Ask StoryForge to inspect, explain, or change code...",
    );

    fireEvent.change(input, { target: { value: "/compact" } });
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

    expect(screen.getByText("Runtime instructions")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("User request")).toBeInTheDocument();
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
      expect.stringContaining("\"model\": \"deepseek-v4-pro\""),
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
        "完全放开。任何命令都不会弹出确认，会以当前系统用户身份执行。",
      );
    expect(screen.getByText(
      "StoryForge 使用命令守卫和隔离后的命令环境；这不是 OS 级沙箱，无缰模式会以当前系统用户身份执行。",
    )).toBeInTheDocument();

    fireEvent.click(within(commandModeGroup).getByRole("radio", { name: "巡航模式" }));

    await waitFor(() => expect(fixture.saveSettings).toHaveBeenCalledWith({
      commandExecutionMode: "cruise",
    }));
    expect(within(commandModeGroup).getByRole("radio", { name: "巡航模式" }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("loads and saves Web Search Coverage from Settings", async () => {
    const fixture = installApi({
      settings: {
        schemaVersion: 1,
        responseMode: "auto",
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
        webAccessEnabled: false,
        webSearchCoverage: "focused",
      });
    });
    await waitFor(() => expect(within(responseModeGroup).getByRole("radio", { name: "Live" }))
      .not.toBeDisabled());
  });
});

function installApi(options: {
  settings?: Partial<AppSettingsView>;
  saveSettings?: StoryForgeApi["settings"]["save"];
  providers?: ProviderView[];
  session?: Partial<SessionView>;
  skills?: SkillView[];
  mcpConfig?: McpConfigView;
  automations?: AutomationView[];
  compact?: StoryForgeApi["turns"]["compact"];
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
    supportsImageInput: false,
  };
  const providers = options.providers ?? [provider];
  const workspace: WorkspaceView = {
    id: "workspace-1",
    path: "/tmp/project",
    displayName: "project",
    createdAt: "2026-06-07T00:00:00.000Z",
    lastOpenedAt: "2026-06-07T00:00:00.000Z",
  };
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
    schemaVersion: 1,
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
  let eventListener: ((event: AgentEvent) => void) | undefined;
  const start = vi.fn(async () => ({ turnId: "sf_turn_active" as const }));
  const stop = vi.fn(async () => undefined);
  const compact = options.compact
    ? vi.mocked(options.compact)
    : vi.fn(async () => undefined);
  const respondPermission = vi.fn(async () => undefined);
  const getSession = vi.fn(async () => session);
  const settings: AppSettingsView = {
    schemaVersion: 1 as const,
    responseMode: "auto" as const,
    developerMode: false,
    commandExecutionMode: "sentinel" as const,
    webAccessEnabled: false,
    webSearchCoverage: "focused" as const,
    ...options.settings,
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
    providers: {
      list: vi.fn(async () => providers),
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
      compact,
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
    getSession,
    saveSettings,
    saveProvider,
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
    emit: (event: AgentEvent) => eventListener?.(event),
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
