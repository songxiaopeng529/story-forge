import { describe, expect, it } from "vitest";
import { PI_TODO_TOOL_NAME, resolvePiTodoExtensionPath } from "../todo/pi9-todo";

describe("PI todo extension", () => {
  it("resolves the installed extension source and tool name", () => {
    expect(resolvePiTodoExtensionPath()).toMatch(/@pi9\/todo\/src\/index\.ts$/u);
    expect(PI_TODO_TOOL_NAME).toBe("todo");
  });
});
