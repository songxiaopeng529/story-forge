import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent, HumanInputRequestPayload } from "@story-forge/shared";
import { HUMAN_INPUT_TOOL_NAME, type HumanInputToolResponse } from "@story-forge/extensions";
import { describe, expect, it } from "vitest";
import {
  StoryForgeAgentHarness,
  toContextUsageEvent,
} from "../runtime/storyforge-agent-harness";
import type { SessionMetadataRecord, SessionRepository } from "../persistence/session-repository";
import type { PiModelService } from "../pi/pi-model-service";
import type { PiSessionAdapter } from "../pi/pi-session-adapter";
import type { StoryForgeWorkspaceStore } from "../ports/host";

const sessionId = "sf_session_context" as const;
const turnId = "sf_turn_context" as const;

describe("toContextUsageEvent", () => {
  it("maps PI context usage into the renderer event contract", () => {
    expect(toContextUsageEvent({
      sessionId,
      turnId,
      usage: {
        tokens: 4_096.4,
        contextWindow: 8_192,
        percent: 50,
      },
    })).toEqual({
      type: "context.usage",
      sessionId,
      turnId,
      usedTokens: 4_096,
      budgetTokens: 8_192,
      windowTokens: 8_192,
      source: "estimate",
    });
  });

  it.each([
    undefined,
    { tokens: null, contextWindow: 8_192, percent: null },
    { tokens: Number.NaN, contextWindow: 8_192, percent: null },
    { tokens: 128, contextWindow: 0, percent: 0 },
  ])("skips unavailable or invalid usage %#", (usage) => {
    expect(toContextUsageEvent({ sessionId, turnId, usage })).toBeUndefined();
  });
});

describe("StoryForgeAgentHarness context usage events", () => {
  it("retries usage at agent_end after the final post-compaction message is persisted", () => {
    const emitted: AgentEvent[] = [];
    const harness = new StoryForgeAgentHarness({
      sessionRepository: {} as SessionRepository,
      workspaceRepository: {} as StoryForgeWorkspaceStore,
      piModels: {} as PiModelService,
      piSessions: {} as PiSessionAdapter,
      emit: (event) => emitted.push(event),
    });
    let finalAssistantPersisted = false;
    const active = {
      sessionId,
      storyForgeSession: {},
      controller: new AbortController(),
      piSession: {
        getContextUsage: () => finalAssistantPersisted
          ? { tokens: 4_096, contextWindow: 8_192, percent: 50 }
          : { tokens: null, contextWindow: 8_192, percent: null },
      } as AgentSession,
      terminalEmitted: false,
      stopReason: "completed",
      errorMessage: undefined,
      steps: 0,
      metadataSync: Promise.resolve(),
    };
    const mapPiEvent = (
      harness as unknown as {
        mapPiEvent(input: {
          active: typeof active;
          turnId: typeof turnId;
          event: AgentSessionEvent;
        }): void;
      }
    ).mapPiEvent.bind(harness);

    mapPiEvent({
      active,
      turnId,
      event: {
        type: "compaction_end",
        reason: "threshold",
        result: {} as never,
        aborted: false,
        willRetry: false,
      },
    });
    mapPiEvent({
      active,
      turnId,
      event: {
        type: "message_end",
        message: { role: "assistant" },
      } as AgentSessionEvent,
    });

    expect(emitted.map((event) => event.type)).toEqual(["context.compacted"]);

    finalAssistantPersisted = true;
    mapPiEvent({
      active,
      turnId,
      event: {
        type: "agent_end",
        messages: [{ role: "assistant", stopReason: "stop" }],
        willRetry: false,
      } as AgentSessionEvent,
    });

    expect(emitted.at(-1)).toEqual({
      type: "context.usage",
      sessionId,
      turnId,
      usedTokens: 4_096,
      budgetTokens: 8_192,
      windowTokens: 8_192,
      source: "estimate",
    });
  });
});

describe("StoryForgeAgentHarness human input", () => {
  it("registers the ask_user tool with StoryForge tools", () => {
    const harness = createHarness([]);
    const createStoryForgeTools = (
      harness as unknown as {
        createStoryForgeTools(input: {
          session: SessionMetadataRecord;
          turnId: typeof turnId;
          workspacePath: string;
          settings: {
            developerMode: boolean;
            commandExecutionMode: "sentinel";
            webAccessEnabled: boolean;
            webSearchCoverage: "focused";
          };
          signal: AbortSignal;
        }): Array<{ name: string }>;
      }
    ).createStoryForgeTools.bind(harness);

    const tools = createStoryForgeTools({
      session: {
        id: sessionId,
        workspaceId: "workspace-1",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
      } as unknown as SessionMetadataRecord,
      turnId,
      workspacePath: "/workspace/project",
      settings: {
        developerMode: false,
        commandExecutionMode: "sentinel",
        webAccessEnabled: false,
        webSearchCoverage: "focused",
      },
      signal: new AbortController().signal,
    });

    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([HUMAN_INPUT_TOOL_NAME]));
  });

  it("emits human input requests and resolves with renderer responses", async () => {
    const emitted: AgentEvent[] = [];
    const harness = createHarness(emitted);
    const requestHumanInput = (
      harness as unknown as {
        requestHumanInput(input: {
          sessionId: typeof sessionId;
          turnId: typeof turnId;
          request: HumanInputRequestPayload;
          signal?: AbortSignal;
        }): Promise<HumanInputToolResponse>;
      }
    ).requestHumanInput.bind(harness);

    const response = requestHumanInput({
      sessionId,
      turnId,
      request: {
        title: "Choose implementation scope",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope should StoryForge use?",
            type: "single_select",
            options: [
              { id: "minimal", label: "Minimal" },
              { id: "full", label: "Full" },
            ],
          },
        ],
      },
      signal: new AbortController().signal,
    });

    const request = emitted.at(-1);
    expect(request).toMatchObject({
      type: "human.input.request",
      sessionId,
      turnId,
      title: "Choose implementation scope",
      questions: [
        expect.objectContaining({
          id: "scope",
          type: "single_select",
        }),
      ],
    });
    if (!request || request.type !== "human.input.request") {
      throw new Error("Expected human input request");
    }

    harness.respondToHumanInput({
      requestId: request.requestId,
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
    });

    await expect(response).resolves.toEqual({
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
    });
  });
});

function createHarness(emitted: AgentEvent[]): StoryForgeAgentHarness {
  return new StoryForgeAgentHarness({
    sessionRepository: {} as SessionRepository,
    workspaceRepository: {} as StoryForgeWorkspaceStore,
    piModels: {} as PiModelService,
    piSessions: {} as PiSessionAdapter,
    emit: (event) => emitted.push(event),
  });
}
