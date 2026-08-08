import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import {
  StoryForgeAgentHarness,
  toContextUsageEvent,
} from "./storyforge-agent-harness";
import type { SessionRepository } from "../persistence/session-repository";
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
