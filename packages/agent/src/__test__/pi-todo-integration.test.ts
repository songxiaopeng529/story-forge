import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PI_TODO_TOOL_NAME, resolvePiTodoExtensionPath } from "../../../extensions/src/todo/pi9-todo";

describe("PI todo integration", () => {
  it("loads @pi9/todo as a PI extension without a restricted Plan mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "storyforge-pi-todo-"));
    try {
      const loader = new DefaultResourceLoader({
        cwd: rootDir,
        agentDir: rootDir,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [resolvePiTodoExtensionPath()],
      });

      await loader.reload();
      const loaded = loader.getExtensions();
      const todo = loaded.extensions.find((extension) =>
        extension.tools.has(PI_TODO_TOOL_NAME)
      );

      expect(loaded.errors).toEqual([]);
      expect(todo).toBeDefined();
      expect(todo?.commands.has("plan")).toBe(false);
      expect(todo?.tools.has("todo")).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
