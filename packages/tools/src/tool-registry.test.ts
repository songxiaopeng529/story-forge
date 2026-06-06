import { describe, expect, it } from "vitest";
import { createWorkspaceFileTools } from "./file-tools";
import { ToolRegistry, type ToolDefinition } from "./tool-registry";
import { WorkspaceSandbox } from "./workspace-sandbox";

describe("ToolRegistry", () => {
  it("registers tools and exposes schemas without executors", () => {
    const registry = new ToolRegistry();
    const definition: ToolDefinition = {
      name: "echo",
      description: "Echo text",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
      execute: (input) => input,
    };

    registry.register(definition);

    expect(registry.list()).toEqual([definition]);
    expect(registry.schemas()).toEqual([
      {
        name: "echo",
        description: "Echo text",
        parameters: definition.parameters,
      },
    ]);
  });

  it("executes a known tool and wraps output in an ok result", async () => {
    const registry = new ToolRegistry([
      {
        name: "uppercase",
        description: "Uppercase text",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
        },
        execute: (input) => String(input.text).toUpperCase(),
      },
    ]);

    await expect(registry.execute("uppercase", { text: "forge" })).resolves.toEqual({
      ok: true,
      output: "FORGE",
    });
  });

  it("returns a structured error for unknown tools", async () => {
    const registry = new ToolRegistry();

    await expect(registry.execute("missing", {})).resolves.toEqual({
      ok: false,
      error: "Tool not found: missing",
    });
  });

  it("catches execution errors and returns the error message", async () => {
    const registry = new ToolRegistry([
      {
        name: "explode",
        description: "Explode",
        parameters: { type: "object" },
        execute: () => {
          throw new Error("boom");
        },
      },
    ]);

    await expect(registry.execute("explode", {})).resolves.toEqual({
      ok: false,
      error: "boom",
    });
  });

  it("provides sandboxed workspace file tools with structured validation errors", async () => {
    const registry = new ToolRegistry(createWorkspaceFileTools(new WorkspaceSandbox(process.cwd())));

    expect(registry.schemas().map((schema) => schema.name)).toEqual([
      "workspace.readFile",
      "workspace.listDirectory",
      "workspace.writeFile",
      "workspace.replaceText",
    ]);
    await expect(registry.execute("workspace.readFile", {})).resolves.toEqual({
      ok: false,
      error: "workspace.readFile requires a string path",
    });
  });

  it("rejects empty or whitespace-only file tool paths", async () => {
    const registry = new ToolRegistry(createWorkspaceFileTools(new WorkspaceSandbox(process.cwd())));

    await expect(registry.execute("workspace.readFile", { path: "" })).resolves.toEqual({
      ok: false,
      error: "workspace.readFile requires a non-empty path",
    });
    await expect(registry.execute("workspace.listDirectory", { path: "  " })).resolves.toEqual({
      ok: false,
      error: "workspace.listDirectory requires a non-empty path",
    });
  });

  it("allows omitted listDirectory path to mean the workspace root", async () => {
    const registry = new ToolRegistry(createWorkspaceFileTools(new WorkspaceSandbox(process.cwd())));

    const result = await registry.execute("workspace.listDirectory", {});

    expect(result.ok).toBe(true);
  });

  it("validates write and replace tool inputs", async () => {
    const registry = new ToolRegistry(createWorkspaceFileTools(new WorkspaceSandbox(process.cwd())));

    await expect(registry.execute("workspace.writeFile", { path: "file.txt" })).resolves.toEqual({
      ok: false,
      error: "workspace.writeFile requires string content",
    });
    await expect(
      registry.execute("workspace.replaceText", {
        path: "file.txt",
        oldText: "before",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "workspace.replaceText requires string newText",
    });
  });
});
