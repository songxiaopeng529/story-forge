import type {
  AgentEvent,
  AutomationProposalView,
  ContextCompactedEvent,
  HumanInputRequestEvent,
  MessageDeliveryMode,
  SessionTask,
  TurnId,
  UnsequencedAgentEvent,
} from "@story-forge/shared";
import type {
  ImageAttachmentView,
  PersistedMessageView,
  SessionView,
} from "../../shared/story-forge-api";

type TimelineAgentEvent = AgentEvent | UnsequencedAgentEvent;

export type AutomationProposalTimelineState = {
  proposalId: string;
  proposal: AutomationProposalView;
  status: "pending" | "created";
};

const HUMAN_INPUT_TOOL_NAME = "ask_user";
const AGENT_DELEGATE_TOOL_NAME = "agent_delegate";

export type TimelineItem =
  | {
      type: "user-message";
      id: string;
      content: string;
      imageAttachments?: ImageAttachmentView[];
    }
  | {
      type: "assistant-message";
      id: string;
      content: string;
      streaming?: boolean;
      delivery?: MessageDeliveryMode;
    }
  | { type: "reasoning"; id: string; content: string }
  | { type: "summary"; id: string; content: string }
  | { type: "plan"; id: string; content: string }
  | {
      type: "tool-step";
      id: string;
      callId: string;
      name: string;
      status: "running" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
    }
  | {
      type: "delegate-summary";
      id: string;
      callId: string;
      status: "running" | "completed" | "failed";
      taskCount: number;
      objectives: string[];
      resultStatus?: "completed" | "partial" | "failed" | "cancelled";
      completedCount: number;
      failedCount: number;
      cancelledCount: number;
    }
  | {
      type: "automation-proposal";
      id: string;
      proposalId: string;
      proposal: AutomationProposalView;
      status: "pending" | "created";
    }
  | {
      type: "human-input";
      id: string;
      request: HumanInputRequestEvent;
      responding: boolean;
    }
  | {
      type: "task-list";
      id: string;
      tasks: SessionTask[];
      completedCount: number;
      totalCount: number;
      blockedCount: number;
      currentTask?: SessionTask;
    }
  | { type: "notice"; id: string; message: string }
  | { type: "error"; id: string; message: string };

export function buildTimeline(input: {
  session: SessionView | undefined;
  activities: TimelineAgentEvent[];
  activeTurnId: TurnId | undefined;
  automationProposals?: AutomationProposalTimelineState[];
  humanInputRequest?: HumanInputRequestEvent;
  humanInputResponding?: boolean;
}): TimelineItem[] {
  const items = buildPersistedItems(input.session?.messages ?? []);
  if (
    input.session?.stopReason
    && input.session.status !== "completed"
    && !(input.session.status === "error" && items.some((item) => item.type === "error"))
  ) {
    items.push({
      type: input.session.status === "error" ? "error" : "notice",
      id: `session-${input.session.id}-${input.session.status}`,
      message: `Session ${input.session.status}: ${input.session.stopReason}`,
    });
  }

  const activeTurnId = input.activeTurnId;
  const taskSnapshot = resolveTaskSnapshot({
    persistedTasks: input.session?.tasks ?? [],
    activities: input.activities,
    activeTurnId,
  });
  if (taskSnapshot.length > 0) {
    items.push(createTaskListItem(input.session?.id ?? "unknown-session", taskSnapshot));
  }

  if (activeTurnId) {
    appendActiveTurnItems(items, input.activities, activeTurnId);
  }
  if (input.humanInputRequest) {
    items.push({
      type: "human-input",
      id: `human-input-${input.humanInputRequest.turnId}-${input.humanInputRequest.requestId}`,
      request: input.humanInputRequest,
      responding: input.humanInputResponding ?? false,
    });
  }

  if (activeTurnId) {
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

  for (const event of input.activities) {
    if (event.type !== "context.compacted" || event.trigger !== "manual") {
      continue;
    }
    items.push({
      type: "notice",
      id: `compacted-manual-${event.turnId}`,
      message: formatCompactionNotice(event),
    });
  }

  for (const proposal of input.automationProposals ?? []) {
    items.push({
      type: "automation-proposal",
      id: `automation-proposal-${proposal.proposalId}`,
      proposalId: proposal.proposalId,
      proposal: proposal.proposal,
      status: proposal.status,
    });
  }

  return items;
}

function formatCompactionNotice(event: ContextCompactedEvent | Extract<UnsequencedAgentEvent, { type: "context.compacted" }>): string {
  if (
    event.budgetTokens === undefined
    || event.beforeTokens === undefined
    || event.afterTokens === undefined
    || event.budgetTokens <= 0
  ) {
    return "已压缩上下文";
  }
  const before = Math.round((event.beforeTokens / event.budgetTokens) * 100);
  const after = Math.round((event.afterTokens / event.budgetTokens) * 100);
  return `已压缩上下文（约 ${before}% → ${after}%）`;
}

function createTaskListItem(sessionId: string, tasks: SessionTask[]): TimelineItem {
  const currentTask = tasks.find((task) => task.status === "in_progress");
  return {
    type: "task-list",
    id: `tasks-${sessionId}`,
    tasks,
    completedCount: tasks.filter((task) => task.status === "completed").length,
    totalCount: tasks.length,
    blockedCount: tasks.filter((task) => task.status === "blocked").length,
    ...(currentTask ? { currentTask } : {}),
  };
}

function resolveTaskSnapshot(input: {
  persistedTasks: SessionTask[];
  activities: TimelineAgentEvent[];
  activeTurnId: TurnId | undefined;
}): SessionTask[] {
  if (!input.activeTurnId) {
    return input.persistedTasks;
  }
  for (let index = input.activities.length - 1; index >= 0; index -= 1) {
    const event = input.activities[index];
    if (event?.type === "task.list.updated" && event.turnId === input.activeTurnId) {
      return event.tasks;
    }
  }
  return input.persistedTasks;
}

function buildPersistedItems(messages: PersistedMessageView[]): TimelineItem[] {
  const toolResultIds = new Set(
    messages
      .filter((message): message is Extract<PersistedMessageView, { role: "tool" }> =>
        message.role === "tool"
      )
      .map((message) => message.toolCallId),
  );
  const toolCallsById = new Map(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls ?? []).map((toolCall) => [toolCall.id, toolCall] as const)
        : []
    ),
  );
  const items: TimelineItem[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        type: "user-message",
        id: message.id,
        content: message.content,
        ...(message.imageAttachments?.length ? { imageAttachments: message.imageAttachments } : {}),
      });
      continue;
    }

    if (message.role === "tool") {
      if (message.name === HUMAN_INPUT_TOOL_NAME) {
        continue;
      }
      if (message.name === "plan_mode_complete") {
        items.push({
          type: "plan",
          id: message.id,
          content: normalizePersistedPlan(message.content),
        });
        continue;
      }
      const toolCall = toolCallsById.get(message.toolCallId);
      if (message.name === AGENT_DELEGATE_TOOL_NAME) {
        items.push(createDelegateSummaryItem({
          id: message.id,
          callId: message.toolCallId,
          status: message.ok ? "completed" : "failed",
          input: toolCall?.input,
          output: message.content,
        }));
        continue;
      }
      items.push({
        type: "tool-step",
        id: message.id,
        callId: message.toolCallId,
        name: message.name,
        status: message.ok ? "completed" : "failed",
        ...(toolCall ? { input: toolCall.input } : {}),
        output: message.content,
      });
      continue;
    }

    if (message.kind === "summary") {
      items.push({
        type: "summary",
        id: message.id,
        content: message.content,
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
      if (toolCall.name === HUMAN_INPUT_TOOL_NAME) {
        continue;
      }
      if (toolResultIds.has(toolCall.id)) {
        continue;
      }
      if (toolCall.name === AGENT_DELEGATE_TOOL_NAME) {
        items.push(createDelegateSummaryItem({
          id: `${message.id}-delegate-${toolCall.id}`,
          callId: toolCall.id,
          status: "running",
          input: toolCall.input,
        }));
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

    if (message.error && message.content.trim()) {
      items.push({
        type: "error",
        id: message.id,
        message: message.content,
      });
    } else if (message.content.trim()) {
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
  activities: TimelineAgentEvent[],
  activeTurnId: TurnId,
): void {
  const toolIndexes = new Map<string, number>();
  const delegateIndexes = new Map<string, number>();
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
      if (event.name === "plan_mode_complete" || event.name === HUMAN_INPUT_TOOL_NAME) {
        continue;
      }
      if (event.name === AGENT_DELEGATE_TOOL_NAME) {
        const index = items.length;
        items.push(createDelegateSummaryItem({
          id: `delegate-${activeTurnId}-${event.callId}`,
          callId: event.callId,
          status: "running",
          input: event.input,
        }));
        delegateIndexes.set(event.callId, index);
        continue;
      }
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
      if (event.name === "plan_mode_complete" || event.name === HUMAN_INPUT_TOOL_NAME) {
        continue;
      }
      if (event.name === AGENT_DELEGATE_TOOL_NAME) {
        const index = delegateIndexes.get(event.callId);
        const existing = index === undefined ? undefined : items[index];
        const summary = createDelegateSummaryItem({
          id: existing?.id ?? `delegate-${activeTurnId}-${event.callId}`,
          callId: event.callId,
          status: event.ok ? "completed" : "failed",
          input: existing?.type === "delegate-summary"
            ? { tasks: existing.objectives.map((objective) => ({ objective })) }
            : undefined,
          output: event.output,
        });
        if (index !== undefined && existing?.type === "delegate-summary") {
          items[index] = {
            ...summary,
            taskCount: existing.taskCount || summary.taskCount,
            objectives: existing.objectives.length > 0
              ? existing.objectives
              : summary.objectives,
          };
        } else {
          items.push(summary);
        }
        continue;
      }
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

    if (event.type === "context.compacted") {
      items.push({
        type: "notice",
        id: `compacted-${activeTurnId}-${items.length}`,
        message: formatCompactionNotice(event),
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

function createDelegateSummaryItem(input: {
  id: string;
  callId: string;
  status: "running" | "completed" | "failed";
  input?: unknown;
  output?: unknown;
}): Extract<TimelineItem, { type: "delegate-summary" }> {
  const taskInput = asRecord(input.input);
  const tasks = Array.isArray(taskInput?.tasks) ? taskInput.tasks : [];
  const objectives = tasks.flatMap((task) => {
    const objective = asRecord(task)?.objective;
    return typeof objective === "string" && objective.trim() ? [objective.trim()] : [];
  });
  const result = asRecord(parseJsonObject(input.output));
  const results = Array.isArray(result?.results) ? result.results : [];
  const statuses = results.map((entry) => asRecord(entry)?.status);
  const resultStatus = isDelegateResultStatus(result?.status) ? result.status : undefined;
  return {
    type: "delegate-summary",
    id: input.id,
    callId: input.callId,
    status: input.status,
    taskCount: Math.max(tasks.length, results.length),
    objectives,
    ...(resultStatus ? { resultStatus } : {}),
    completedCount: statuses.filter((status) => status === "completed").length,
    failedCount: statuses.filter((status) => status === "failed").length,
    cancelledCount: statuses.filter((status) => status === "cancelled").length,
  };
}

function parseJsonObject(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isDelegateResultStatus(
  value: unknown,
): value is "completed" | "partial" | "failed" | "cancelled" {
  return value === "completed"
    || value === "partial"
    || value === "failed"
    || value === "cancelled";
}

function normalizePersistedPlan(content: string): string {
  return content.replace(/^\*\*Proposed Plan\*\*\s*/u, "").trim() || content;
}

function isActiveTurnItem(item: TimelineItem, activeTurnId: TurnId): boolean {
  return item.id.includes(activeTurnId);
}
