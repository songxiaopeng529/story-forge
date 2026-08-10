import {
  isRecord,
  type HumanInputAnswer,
  type HumanInputQuestion,
  type HumanInputQuestionType,
  type HumanInputRemark,
  type HumanInputRequestPayload,
  type HumanInputResponse,
} from "@story-forge/shared";

import type { ToolDefinition, ToolExecutionContext, ToolParameters } from "../tool-definition";

export const HUMAN_INPUT_TOOL_NAME = "ask_user";

export type HumanInputToolResponse = Omit<HumanInputResponse, "requestId">;

export type HumanInputToolResult =
  | {
      cancelled: true;
      reason: "aborted" | "cancelled";
      message: string;
    }
  | {
      cancelled: false;
      answers: HumanInputAnswer[];
      remark?: string;
    };

export type HumanInputToolRequest = (
  request: HumanInputRequestPayload,
  context: ToolExecutionContext,
) => Promise<HumanInputToolResponse> | HumanInputToolResponse;

export const HUMAN_INPUT_TOOL_PARAMETERS: ToolParameters = {
  type: "object",
  additionalProperties: false,
  required: ["title", "questions"],
  properties: {
    title: {
      type: "string",
      description: "Short title shown at the top of the StoryForge human input UI.",
    },
    description: {
      type: "string",
      description: "Optional context explaining why user input is needed.",
    },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      description: "Questions to ask the user. Prefer one question; use up to four when needed.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "header", "question", "type"],
        properties: {
          id: {
            type: "string",
            description: "Stable snake_case identifier used to map the answer.",
          },
          header: {
            type: "string",
            maxLength: 24,
            description: "Short label shown near the question.",
          },
          question: {
            type: "string",
            description: "User-facing question.",
          },
          type: {
            type: "string",
            enum: ["single_select", "multi_select", "text"],
            description: "Question input type.",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            description: "Required for single_select and multi_select questions.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: {
                  type: "string",
                  description: "Stable snake_case identifier for the option.",
                },
                label: {
                  type: "string",
                  description: "Short user-facing option label.",
                },
                description: {
                  type: "string",
                  description: "Optional one-sentence explanation of the option.",
                },
              },
            },
          },
          allowOther: {
            type: "boolean",
            description: "Whether the UI may accept a custom free-form answer.",
          },
          required: {
            type: "boolean",
            description: "Whether the user must answer this question before submitting.",
          },
        },
      },
    },
    remark: {
      type: "object",
      additionalProperties: false,
      required: ["enabled"],
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to show an additional free-form remark field.",
        },
        label: {
          type: "string",
          description: "Optional label for the remark field.",
        },
        placeholder: {
          type: "string",
          description: "Optional placeholder for the remark field.",
        },
        required: {
          type: "boolean",
          description: "Whether the remark field is required.",
        },
      },
    },
  },
};

export function createHumanInputTool(options: {
  request: HumanInputToolRequest;
}): ToolDefinition<Record<string, unknown>, HumanInputToolResult> {
  return {
    name: HUMAN_INPUT_TOOL_NAME,
    description:
      "Ask the user focused clarification or decision questions through StoryForge's built-in human-in-the-loop UI, then wait for their structured response.",
    parameters: HUMAN_INPUT_TOOL_PARAMETERS,
    execute: async (input, context) => {
      const request = readHumanInputRequest(input);
      if (context.signal?.aborted) {
        return abortedResult();
      }

      const response = await options.request(request, context);
      if (context.signal?.aborted) {
        return abortedResult();
      }
      if (response.cancelled) {
        return {
          cancelled: true,
          reason: "cancelled",
          message: "User cancelled the human input request.",
        };
      }

      const remark = typeof response.remark === "string" ? response.remark.trim() : undefined;
      return {
        cancelled: false,
        answers: response.answers ?? [],
        ...(remark ? { remark } : {}),
      };
    },
  };
}

export function readHumanInputRequest(input: unknown): HumanInputRequestPayload {
  if (!isRecord(input)) {
    throw new Error("ask_user requires an object input");
  }
  const title = readString(input, "title");
  const description = readOptionalString(input, "description");
  const questions = readQuestions(input.questions);
  const remark = readRemark(input.remark);

  return {
    title,
    ...(description ? { description } : {}),
    questions,
    ...(remark ? { remark } : {}),
  };
}

function readQuestions(value: unknown): HumanInputQuestion[] {
  if (!Array.isArray(value)) {
    throw new Error("ask_user requires questions to be an array");
  }
  if (value.length < 1 || value.length > 4) {
    throw new Error("ask_user requires 1-4 questions");
  }

  const ids = new Set<string>();
  return value.map((rawQuestion, questionIndex) => {
    if (!isRecord(rawQuestion)) {
      throw new Error(`ask_user question ${questionIndex + 1} must be an object`);
    }

    const id = readId(rawQuestion, "id", `question ${questionIndex + 1}`);
    if (ids.has(id)) {
      throw new Error(`ask_user question ${questionIndex + 1} id must be unique`);
    }
    ids.add(id);

    const type = readQuestionType(rawQuestion.type, questionIndex);
    const options = readQuestionOptions(rawQuestion.options, type, questionIndex);
    const header = readString(rawQuestion, "header", `question ${questionIndex + 1}`);
    if (header.length > 24) {
      throw new Error(`ask_user question ${questionIndex + 1} header must be 24 characters or fewer`);
    }
    const question = readString(rawQuestion, "question", `question ${questionIndex + 1}`);
    const allowOther = readOptionalBoolean(rawQuestion.allowOther, "allowOther", `question ${questionIndex + 1}`);
    const required = readOptionalBoolean(rawQuestion.required, "required", `question ${questionIndex + 1}`);

    return {
      id,
      header,
      question,
      type,
      ...(options ? { options } : {}),
      ...(allowOther !== undefined ? { allowOther } : {}),
      ...(required !== undefined ? { required } : {}),
    };
  });
}

function readQuestionOptions(
  value: unknown,
  type: HumanInputQuestionType,
  questionIndex: number,
): HumanInputQuestion["options"] {
  if (type === "text") {
    if (value !== undefined) {
      throw new Error(`ask_user text question ${questionIndex + 1} must not include options`);
    }
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`ask_user ${type} question ${questionIndex + 1} requires options`);
  }
  if (value.length < 2 || value.length > 6) {
    throw new Error(`ask_user question ${questionIndex + 1} options must contain 2-6 items`);
  }

  const ids = new Set<string>();
  return value.map((rawOption, optionIndex) => {
    if (!isRecord(rawOption)) {
      throw new Error(`ask_user question ${questionIndex + 1} option ${optionIndex + 1} must be an object`);
    }
    const id = readId(rawOption, "id", `question ${questionIndex + 1} option ${optionIndex + 1}`);
    if (ids.has(id)) {
      throw new Error(`ask_user question ${questionIndex + 1} option ${optionIndex + 1} id must be unique`);
    }
    ids.add(id);

    const label = readString(rawOption, "label", `question ${questionIndex + 1} option ${optionIndex + 1}`);
    const description = readOptionalString(
      rawOption,
      "description",
      `question ${questionIndex + 1} option ${optionIndex + 1}`,
    );
    return {
      id,
      label,
      ...(description ? { description } : {}),
    };
  });
}

function readRemark(value: unknown): HumanInputRemark | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("ask_user remark must be an object");
  }

  const enabled = readBoolean(value.enabled, "enabled", "remark");
  if (!enabled) {
    return undefined;
  }
  const label = readOptionalString(value, "label", "remark");
  const placeholder = readOptionalString(value, "placeholder", "remark");
  const required = readOptionalBoolean(value.required, "required", "remark");

  return {
    enabled,
    ...(label ? { label } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(required !== undefined ? { required } : {}),
  };
}

function readQuestionType(value: unknown, questionIndex: number): HumanInputQuestionType {
  if (value === "single_select" || value === "multi_select" || value === "text") {
    return value;
  }
  throw new Error(`ask_user question ${questionIndex + 1} type must be single_select, multi_select, or text`);
}

function readId(input: Record<string, unknown>, field: string, owner: string): string {
  const id = readString(input, field, owner);
  if (!/^[a-z][a-z0-9_]*$/u.test(id)) {
    throw new Error(`ask_user ${owner} ${field} must be snake_case`);
  }
  return id;
}

function readString(input: Record<string, unknown>, field: string, owner?: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ask_user ${owner ? `${owner} ` : ""}requires a non-empty string ${field}`);
  }
  return value.trim();
}

function readOptionalString(input: Record<string, unknown>, field: string, owner?: string): string | undefined {
  const value = input[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`ask_user ${owner ? `${owner} ` : ""}requires string ${field}`);
  }
  return value.trim() || undefined;
}

function readBoolean(value: unknown, field: string, owner: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`ask_user ${owner} requires boolean ${field}`);
  }
  return value;
}

function readOptionalBoolean(value: unknown, field: string, owner: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readBoolean(value, field, owner);
}

function abortedResult(): HumanInputToolResult {
  return {
    cancelled: true,
    reason: "aborted",
    message: "Human input request was cancelled because the turn stopped.",
  };
}
