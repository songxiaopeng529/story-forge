import path from "node:path";

export type WorkspaceToolBlock = { block: true; reason: string };

export function checkWorkspaceToolCall(
  workspacePath: string,
  toolName: string,
  rawInput: unknown,
): WorkspaceToolBlock | undefined {
  if (!["read", "write", "edit", "grep", "find", "ls"].includes(toolName)) {
    return undefined;
  }
  const inputPath = readOptionalStringField(rawInput, "path");
  if (!inputPath) {
    return undefined;
  }
  const resolved = path.resolve(workspacePath, inputPath);
  if (!isInsidePath(workspacePath, resolved)) {
    return {
      block: true,
      reason: `${toolName} path is outside the current workspace.`,
    };
  }
  return undefined;
}

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readOptionalStringField(input: unknown, field: string): string | undefined {
  const value = toRecord(input)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
