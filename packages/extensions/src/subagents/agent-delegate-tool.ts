import {
  isChildAgentRole,
  isRecord,
  type AgentDelegateInput,
  type DelegateResult,
  type DelegateTaskInput,
} from "@story-forge/shared";
import type { ToolDefinition, ToolExecutionContext } from "../tool-definition";

export const AGENT_DELEGATE_TOOL_NAME = "agent_delegate";
export const MAX_DELEGATE_TASKS = 4;

const TASK_KEYS = new Set([
  "role",
  "objective",
  "scope",
  "constraints",
  "expectedOutput",
]);

export type AgentDelegateHandler = (
  input: AgentDelegateInput,
  context: ToolExecutionContext,
) => Promise<DelegateResult>;

export function createAgentDelegateTool(options: {
  delegate: AgentDelegateHandler;
}): ToolDefinition<Record<string, unknown>, DelegateResult> {
  return {
    name: AGENT_DELEGATE_TOOL_NAME,
    description:
      "Delegate 1-4 independent read-only exploration or review tasks to isolated StoryForge child agents and wait for their structured results.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: MAX_DELEGATE_TASKS,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "objective"],
            properties: {
              role: { type: "string", enum: ["explorer", "reviewer"] },
              objective: { type: "string", minLength: 1, maxLength: 4_000 },
              scope: {
                type: "array",
                maxItems: 16,
                items: { type: "string", minLength: 1, maxLength: 512 },
              },
              constraints: {
                type: "array",
                maxItems: 16,
                items: { type: "string", minLength: 1, maxLength: 512 },
              },
              expectedOutput: { type: "string", minLength: 1, maxLength: 2_000 },
            },
          },
        },
      },
    },
    execute: async (rawInput, context) => {
      const input = readAgentDelegateInput(rawInput);
      if (context.signal?.aborted) {
        return { status: "cancelled", results: [] };
      }
      return options.delegate(input, context);
    },
  };
}

export function readAgentDelegateInput(value: unknown): AgentDelegateInput {
  if (!isRecord(value)) {
    throw new Error("agent_delegate requires an object input");
  }
  assertOnlyKeys(value, new Set(["tasks"]), "agent_delegate input");
  if (!Array.isArray(value.tasks)) {
    throw new Error("agent_delegate requires tasks to be an array");
  }
  if (value.tasks.length < 1 || value.tasks.length > MAX_DELEGATE_TASKS) {
    throw new Error(`agent_delegate requires 1-${MAX_DELEGATE_TASKS} tasks`);
  }
  return { tasks: value.tasks.map((task, index) => readDelegateTask(task, index)) };
}

function readDelegateTask(value: unknown, index: number): DelegateTaskInput {
  const label = `agent_delegate task ${index + 1}`;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertOnlyKeys(value, TASK_KEYS, label);
  if (!isChildAgentRole(value.role)) {
    throw new Error(`${label} role must be explorer or reviewer`);
  }
  const objective = readBoundedString(value.objective, `${label} objective`, 4_000);
  const scope = readStringArray(value.scope, `${label} scope`, {
    maxItems: 16,
    maxLength: 512,
    normalizePath: true,
  });
  const constraints = readStringArray(value.constraints, `${label} constraints`, {
    maxItems: 16,
    maxLength: 512,
  });
  const expectedOutput = value.expectedOutput === undefined
    ? undefined
    : readBoundedString(value.expectedOutput, `${label} expectedOutput`, 2_000);
  return {
    role: value.role,
    objective,
    ...(scope ? { scope } : {}),
    ...(constraints ? { constraints } : {}),
    ...(expectedOutput ? { expectedOutput } : {}),
  };
}

function readStringArray(
  value: unknown,
  label: string,
  options: { maxItems: number; maxLength: number; normalizePath?: boolean },
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > options.maxItems) {
    throw new Error(`${label} must contain at most ${options.maxItems} strings`);
  }
  return value.map((item, index) => {
    const string = readBoundedString(item, `${label} item ${index + 1}`, options.maxLength);
    return options.normalizePath ? normalizeWorkspaceRelativeHint(string, label) : string;
  });
}

function normalizeWorkspaceRelativeHint(value: string, label: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || segments.includes("..")
    || normalized.includes("\0")
    || segments.length === 0
  ) {
    throw new Error(`${label} paths must stay relative to the workspace`);
  }
  return segments.join("/");
}

function readBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new Error(`${label} contains unsupported field: ${unknown}`);
  }
}
