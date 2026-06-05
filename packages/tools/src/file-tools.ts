import type { ToolDefinition } from "./tool-registry";
import type { WorkspaceSandbox } from "./workspace-sandbox";

export function createWorkspaceFileTools(sandbox: WorkspaceSandbox): ToolDefinition[] {
  return [
    {
      name: "workspace.readFile",
      description: "Read a text file inside the active workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path to read.",
          },
        },
        required: ["path"],
      },
      execute: async (input) => {
        const filePath = readStringPath(input, "workspace.readFile");
        return sandbox.readTextFile(filePath);
      },
    },
    {
      name: "workspace.listDirectory",
      description: "List a directory inside the active workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative directory path to list. Defaults to the workspace root.",
          },
        },
      },
      execute: async (input) => {
        const directoryPath = input.path === undefined ? "." : readStringPath(input, "workspace.listDirectory");
        return sandbox.listDirectory(directoryPath);
      },
    },
  ];
}

function readStringPath(input: Record<string, unknown>, toolName: string): string {
  if (typeof input.path !== "string") {
    throw new Error(`${toolName} requires a string path`);
  }

  if (!input.path.trim()) {
    throw new Error(`${toolName} requires a non-empty path`);
  }

  return input.path;
}
