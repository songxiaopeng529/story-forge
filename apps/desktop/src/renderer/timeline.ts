import type { AgentEvent, MessageDeliveryMode, TurnId } from "@story-forge/shared";
import type { PersistedMessageView, SessionView } from "../shared/story-forge-api";

export type TimelineItem =
  | { type: "user-message"; id: string; content: string }
  | {
      type: "assistant-message";
      id: string;
      content: string;
      streaming?: boolean;
      delivery?: MessageDeliveryMode;
    }
  | { type: "reasoning"; id: string; content: string }
  | {
      type: "tool-step";
      id: string;
      callId: string;
      name: string;
      status: "running" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
    }
  | { type: "notice"; id: string; message: string }
  | { type: "error"; id: string; message: string };

export function buildTimeline(input: {
  session: SessionView | undefined;
  activities: AgentEvent[];
  activeTurnId: TurnId | undefined;
}): TimelineItem[] {
  const items = buildPersistedItems(input.session?.messages ?? []);
  if (input.session?.stopReason && input.session.status !== "completed") {
    items.push({
      type: input.session.status === "error" ? "error" : "notice",
      id: `session-${input.session.id}-${input.session.status}`,
      message: `Session ${input.session.status}: ${input.session.stopReason}`,
    });
  }

  const activeTurnId = input.activeTurnId;
  if (activeTurnId) {
    appendActiveTurnItems(items, input.activities, activeTurnId);
    if (!items.some((item) => isActiveTurnItem(item, activeTurnId))) {
      items.push({
        type: "assistant-message",
        id: `pending-${activeTurnId}`,
        content: "Thinking...",
        streaming: true,
        delivery: "smooth",
      });
    }
  }

  return items;
}

function buildPersistedItems(messages: PersistedMessageView[]): TimelineItem[] {
  const toolResultIds = new Set(
    messages
      .filter((message): message is Extract<PersistedMessageView, { role: "tool" }> =>
        message.role === "tool"
      )
      .map((message) => message.toolCallId),
  );
  const items: TimelineItem[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        type: "user-message",
        id: message.id,
        content: message.content,
      });
      continue;
    }

    if (message.role === "tool") {
      items.push({
        type: "tool-step",
        id: message.id,
        callId: message.toolCallId,
        name: message.name,
        status: message.ok ? "completed" : "failed",
        output: message.content,
      });
      continue;
    }

    const reasoningContent = message.reasoningContent?.trim();
    if (reasoningContent) {
      items.push({
        type: "reasoning",
        id: `${message.id}-reasoning`,
        content: reasoningContent,
      });
    }

    for (const toolCall of message.toolCalls ?? []) {
      if (toolResultIds.has(toolCall.id)) {
        continue;
      }
      items.push({
        type: "tool-step",
        id: `${message.id}-tool-${toolCall.id}`,
        callId: toolCall.id,
        name: toolCall.name,
        status: "running",
        input: toolCall.input,
      });
    }

    if (message.content.trim()) {
      items.push({
        type: "assistant-message",
        id: message.id,
        content: message.content,
      });
    }
  }

  return items;
}

function appendActiveTurnItems(
  items: TimelineItem[],
  activities: AgentEvent[],
  activeTurnId: TurnId,
): void {
  const toolIndexes = new Map<string, number>();
  let streamIndex: number | undefined;
  let streamCount = 0;

  for (const event of activities) {
    if (event.turnId !== activeTurnId) {
      continue;
    }

    if (event.type === "message.delta") {
      if (streamIndex !== undefined) {
        const existing = items[streamIndex];
        if (existing?.type === "assistant-message") {
          const delivery = event.delivery ?? existing.delivery;
          items[streamIndex] = {
            ...existing,
            content: existing.content + event.content,
            ...(delivery ? { delivery } : {}),
          };
          continue;
        }
      }
      streamCount += 1;
      items.push({
        type: "assistant-message",
        id: `stream-${activeTurnId}-${streamCount}`,
        content: event.content,
        streaming: true,
        delivery: event.delivery ?? "smooth",
      });
      streamIndex = items.length - 1;
      continue;
    }

    streamIndex = undefined;

    if (event.type === "tool.call") {
      const index = items.length;
      items.push({
        type: "tool-step",
        id: `tool-${activeTurnId}-${event.callId}`,
        callId: event.callId,
        name: event.name,
        status: "running",
        input: event.input,
      });
      toolIndexes.set(event.callId, index);
      continue;
    }

    if (event.type === "tool.result") {
      const index = toolIndexes.get(event.callId);
      if (index !== undefined && items[index]?.type === "tool-step") {
        const existing = items[index];
        items[index] = {
          ...existing,
          name: event.name,
          status: event.ok ? "completed" : "failed",
          output: event.output,
        };
      } else {
        items.push({
          type: "tool-step",
          id: `tool-${activeTurnId}-${event.callId}`,
          callId: event.callId,
          name: event.name,
          status: event.ok ? "completed" : "failed",
          output: event.output,
        });
      }
      continue;
    }

    if (event.type === "response.fallback") {
      items.push({
        type: "notice",
        id: `fallback-${activeTurnId}-${items.length}`,
        message: "Switched to smooth playback",
      });
      continue;
    }

    if (event.type === "runtime.error") {
      items.push({
        type: "error",
        id: `error-${activeTurnId}-${items.length}`,
        message: event.message,
      });
    }
  }
}

function isActiveTurnItem(item: TimelineItem, activeTurnId: TurnId): boolean {
  return item.id.includes(activeTurnId);
}
