import path from "node:path";
import { readOptionalStringField, toRecord } from "@story-forge/shared";

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
