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
    {
      name: "workspace.writeFile",
      description: "Create or overwrite a UTF-8 text file inside the active workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path to write.",
          },
          content: {
            type: "string",
            description: "Complete UTF-8 file content.",
          },
        },
        required: ["path", "content"],
      },
      execute: async (input) => {
        const filePath = readStringPath(input, "workspace.writeFile");
        const content = readString(input, "content", "workspace.writeFile");
        return sandbox.writeTextFile(filePath, content);
      },
    },
    {
      name: "workspace.replaceText",
      description: "Replace exact text in a UTF-8 file inside the active workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path to edit.",
          },
          oldText: {
            type: "string",
            description: "Exact text to find.",
          },
          newText: {
            type: "string",
            description: "Replacement text.",
          },
          replaceAll: {
            type: "boolean",
            description: "Replace every occurrence instead of only the first.",
          },
        },
        required: ["path", "oldText", "newText"],
      },
      execute: async (input) => {
        const filePath = readStringPath(input, "workspace.replaceText");
        const oldText = readString(input, "oldText", "workspace.replaceText");
        const newText = readString(input, "newText", "workspace.replaceText");
        if (input.replaceAll !== undefined && typeof input.replaceAll !== "boolean") {
          throw new Error("workspace.replaceText requires boolean replaceAll");
        }
        return sandbox.replaceText(filePath, oldText, newText, {
          ...(typeof input.replaceAll === "boolean" ? { replaceAll: input.replaceAll } : {}),
        });
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

function readString(
  input: Record<string, unknown>,
  key: string,
  toolName: string,
): string {
  if (typeof input[key] !== "string") {
    throw new Error(`${toolName} requires string ${key}`);
  }
  return input[key];
}
