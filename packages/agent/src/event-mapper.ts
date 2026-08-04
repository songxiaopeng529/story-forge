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

export function errorMessageFromPiMessages(messages: unknown[]): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => {
    const record = toRecord(message);
    return record.role === "assistant" && record.stopReason === "error";
  });
  const errorMessage = toRecord(lastAssistant).errorMessage;
  return typeof errorMessage === "string" && errorMessage.trim()
    ? errorMessage.trim()
    : undefined;
}

export function normalizeModelRequestPayload(
  payload: unknown,
): Pick<Extract<AgentEvent, { type: "model.request" }>, "messages" | "tools"> {
  const record = toRecord(payload);
  const providerMessages = Array.isArray(record.messages)
    ? record.messages.map(normalizeModelMessage).filter(isInspectableModelMessage)
    : [];
  const systemContent = normalizeProviderSystemContent(
    record.system ?? record.systemInstruction,
  );
  const messages = systemContent && !providerMessages.some((message) => message.role === "system")
    ? [{ role: "system" as const, content: systemContent }, ...providerMessages]
    : providerMessages;
  const tools = flattenProviderTools(record.tools)
    .map(normalizeModelTool)
    .filter(isInspectableModelTool);
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
  const definition = isRecord(record.function) ? record.function : record;
  const name = typeof definition.name === "string" ? definition.name : undefined;
  if (!name) {
    return undefined;
  }
  return {
    name,
    description: typeof definition.description === "string" ? definition.description : "",
    parameters: definition.parameters
      ?? definition.input_schema
      ?? definition.inputSchema
      ?? definition.parametersJsonSchema,
  };
}

function flattenProviderTools(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((tool) => {
    const record = toRecord(tool);
    return Array.isArray(record.functionDeclarations) ? record.functionDeclarations : [tool];
  });
}

function normalizeProviderSystemContent(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (isRecord(value) && "parts" in value) {
    return stringifyContent(value.parts);
  }
  return stringifyContent(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
