import type { AgentEvent, MessageDeliveryMode, TurnId } from "@story-forge/shared";
import type { PersistedMessageView, SessionView } from "../shared/story-forge-api";

export type TimelineItem =
  | { type: "message"; message: PersistedMessageView }
  | { type: "pending"; turnId: TurnId; label: string }
  | {
      type: "assistant-stream";
      turnId: TurnId;
      content: string;
      delivery: MessageDeliveryMode;
    }
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
  if (input.session?.stopReason && input.session.status !== "completed") {
    items.push({
      type: input.session.status === "error" ? "error" : "notice",
      message: `Session ${input.session.status}: ${input.session.stopReason}`,
    });
  }

  if (input.activeTurnId) {
    const activeDeltas = input.activities.filter(
      (event): event is Extract<AgentEvent, { type: "message.delta" }> =>
        event.type === "message.delta" && event.turnId === input.activeTurnId,
    );
    const activeContent = activeDeltas.map((event) => event.content).join("");
    if (activeContent) {
      items.push({
        type: "assistant-stream",
        turnId: input.activeTurnId,
        content: activeContent,
        delivery: activeDeltas.at(-1)?.delivery ?? "smooth",
      });
    } else {
      items.push({
        type: "pending",
        turnId: input.activeTurnId,
        label: "Thinking...",
      });
    }
  }

  for (const event of input.activities) {
    if (event.type === "tool.call") {
      items.push({
        type: "tool-activity",
        callId: event.callId,
        name: event.name,
        status: "running",
        input: event.input,
      });
    }
    if (event.type === "tool.result") {
      items.push({
        type: "tool-activity",
        callId: event.callId,
        name: event.name,
        status: event.ok ? "completed" : "failed",
        output: event.output,
      });
    }
    if (event.type === "response.fallback") {
      items.push({ type: "notice", message: "Switched to smooth playback" });
    }
    if (event.type === "runtime.error") {
      items.push({ type: "error", message: event.message });
    }
  }

  return items;
}
