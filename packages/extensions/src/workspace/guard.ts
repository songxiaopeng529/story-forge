import path from "node:path";
import { realpath } from "node:fs/promises";
import { readOptionalStringField } from "@story-forge/shared";

export type WorkspaceToolBlock = { block: true; reason: string };

export async function checkWorkspaceToolCall(
  workspacePath: string,
  toolName: string,
  rawInput: unknown,
): Promise<WorkspaceToolBlock | undefined> {
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

  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(workspacePath),
    resolveThroughExistingAncestor(resolved),
  ]);
  if (!isInsidePath(canonicalRoot, canonicalTarget)) {
    return {
      block: true,
      reason: `${toolName} path resolves outside the current workspace.`,
    };
  }
  return undefined;
}

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveThroughExistingAncestor(target: string): Promise<string> {
  let current = target;
  const suffix: string[] = [];
  while (true) {
    try {
      const canonical = await realpath(current);
      return path.resolve(canonical, ...suffix);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw error;
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
