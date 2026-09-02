import { describe, expect, it, vi } from "vitest";
import { createEmptyAgentExecutionUsage } from "@story-forge/shared";
import {
  createAgentDelegateTool,
  readAgentDelegateInput,
} from "../subagents/agent-delegate-tool";

describe("agent_delegate", () => {
  it("normalizes one to four bounded tasks and preserves their order", () => {
    expect(readAgentDelegateInput({
      tasks: [
        { role: "explorer", objective: " Map files ", scope: ["./packages/agent"] },
        { role: "reviewer", objective: "Review the result" },
      ],
    })).toEqual({
      tasks: [
        { role: "explorer", objective: "Map files", scope: ["packages/agent"] },
        { role: "reviewer", objective: "Review the result" },
      ],
    });
    expect(() => readAgentDelegateInput({ tasks: [] })).toThrow("requires 1-4 tasks");
    expect(() => readAgentDelegateInput({
      tasks: Array.from({ length: 5 }, () => ({ role: "explorer", objective: "x" })),
    })).toThrow("requires 1-4 tasks");
  });

  it("rejects unsupported roles, escaped scope, and policy smuggling", () => {
    expect(() => readAgentDelegateInput({
      tasks: [{ role: "writer", objective: "write" }],
    })).toThrow("role must be explorer or reviewer");
    expect(() => readAgentDelegateInput({
      tasks: [{ role: "explorer", objective: "read", scope: ["../secret"] }],
    })).toThrow("paths must stay relative");
    for (const [field, value] of [
      ["provider", "openai"],
      ["model", "gpt"],
      ["cwd", "/tmp"],
      ["tools", ["bash"]],
      ["budget", 999],
      ["depth", 2],
      ["transcriptPath", "/tmp/x"],
    ] as const) {
      expect(() => readAgentDelegateInput({
        tasks: [{ role: "explorer", objective: "read", [field]: value }],
      })).toThrow(`unsupported field: ${field}`);
    }
  });

  it("calls the injected coordinator once and forwards cancellation", async () => {
    const delegate = vi.fn(async () => ({
      status: "completed" as const,
      results: [{
        executionId: "sf_agent_execution_child" as const,
        role: "explorer" as const,
        status: "completed" as const,
        report: {
          summary: "done",
          findings: [],
          evidence: [],
          filesInspected: [],
          unresolved: [],
        },
        usage: createEmptyAgentExecutionUsage(),
        truncated: false,
      }],
    }));
    const tool = createAgentDelegateTool({ delegate });
    const input = { tasks: [{ role: "explorer", objective: "Map files" }] };

    await expect(tool.execute(input, {})).resolves.toMatchObject({ status: "completed" });
    expect(delegate).toHaveBeenCalledOnce();

    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute(input, { signal: controller.signal })).resolves.toEqual({
      status: "cancelled",
      results: [],
    });
    expect(delegate).toHaveBeenCalledOnce();
  });
});
