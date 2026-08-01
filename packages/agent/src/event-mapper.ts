import type {
  AgentEvent,
  AgentStopReason,
  ImageAttachmentView,
  InspectableModelMessage,
  InspectableModelTool,
} from "@story-forge/shared";

export function toPiImageContent(attachment: ImageAttachmentView) {
  return {
    type: "image" as const,
    data: attachment.data,
    mimeType: attachment.mediaType,
  };
}

export function stopReasonFromPiMessages(
  messages: unknown[],
  aborted: boolean,
): AgentStopReason {
  if (aborted) {
    return "user-stopped";
  }
  const lastAssistant = [...messages].reverse().find((message) => {
    const role = toRecord(message).role;
    return role === "assistant";
  });
  const stopReason = toRecord(lastAssistant).stopReason;
  if (stopReason === "aborted") {
    return "user-stopped";
  }
  if (stopReason === "error") {
    return "unrecoverable-error";
  }
  if (stopReason === "length") {
    return "time-limit";
  }
  return "completed";
}

export function normalizeModelRequestPayload(
  payload: unknown,
): Pick<Extract<AgentEvent, { type: "model.request" }>, "messages" | "tools"> {
  const record = toRecord(payload);
  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeModelMessage).filter(isInspectableModelMessage)
    : [];
  const tools = Array.isArray(record.tools)
    ? record.tools.map(normalizeModelTool).filter(isInspectableModelTool)
    : [];
  return { messages, tools };
}

function normalizeModelMessage(message: unknown): InspectableModelMessage | undefined {
  const record = toRecord(message);
  const role = typeof record.role === "string" ? record.role : undefined;
  if (role === "system") {
    return { role, content: stringifyContent(record.content) };
  }
  if (role === "user") {
    return { role, content: stringifyContent(record.content) };
  }
  if (role === "assistant") {
    return {
      role,
      content: stringifyContent(record.content),
    };
  }
  if (role === "tool") {
    return {
      role,
      content: stringifyContent(record.content),
      name: typeof record.name === "string" ? record.name : "tool",
      toolCallId: typeof record.toolCallId === "string" ? record.toolCallId : "",
    };
  }
  return undefined;
}

function normalizeModelTool(tool: unknown): InspectableModelTool | undefined {
  const record = toRecord(tool);
  const name = typeof record.name === "string" ? record.name : undefined;
  if (!name) {
    return undefined;
  }
  return {
    name,
    description: typeof record.description === "string" ? record.description : "",
    parameters: record.parameters,
  };
}

function isInspectableModelMessage(
  message: InspectableModelMessage | undefined,
): message is InspectableModelMessage {
  return message !== undefined;
}

function isInspectableModelTool(
  tool: InspectableModelTool | undefined,
): tool is InspectableModelTool {
  return tool !== undefined;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const record = toRecord(item);
        return typeof record.text === "string" ? record.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(value ?? "");
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
