import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ProjectInstructionSource = {
  path: string;
  scope: "project";
  content: string;
  truncated: boolean;
  byteCount: number;
};

export type ProjectInstructionsContext = {
  sources: ProjectInstructionSource[];
  warnings: string[];
};

const PROJECT_INSTRUCTION_FILENAMES = ["AGENTS.override.md", "AGENTS.md"] as const;
const DEFAULT_MAX_PROJECT_INSTRUCTION_BYTES = 32 * 1024;

export async function loadProjectInstructions(
  workspacePath: string,
  options: { maxBytes?: number } = {},
): Promise<ProjectInstructionsContext> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PROJECT_INSTRUCTION_BYTES;
  const warnings: string[] = [];

  for (const filename of PROJECT_INSTRUCTION_FILENAMES) {
    const path = join(workspacePath, filename);
    const content = await readInstructionFile(path, warnings);
    if (content === undefined || !content.trim()) {
      continue;
    }

    const byteCount = Buffer.byteLength(content, "utf8");
    const truncated = byteCount > maxBytes;
    if (truncated) {
      warnings.push(`Project instructions truncated at ${maxBytes} bytes: ${path}`);
    }

    return {
      sources: [{
        path,
        scope: "project",
        content: truncated ? truncateUtf8(content, maxBytes) : content,
        truncated,
        byteCount,
      }],
      warnings,
    };
  }

  return {
    sources: [],
    warnings,
  };
}

async function readInstructionFile(
  path: string,
  warnings: string[],
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    warnings.push(`Unable to read project instructions: ${path}`);
    return undefined;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  let usedBytes = 0;
  let result = "";
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (usedBytes + nextBytes > maxBytes) {
      break;
    }
    result += character;
    usedBytes += nextBytes;
  }
  return result;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}
