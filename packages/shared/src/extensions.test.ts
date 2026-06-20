import { describe, expect, it } from "vitest";
import type { McpConfigView, McpServerView, SkillView } from "./extensions";

describe("extension view types", () => {
  it("accepts installed skill views", () => {
    const skill = {
      id: "code-review",
      name: "code-review",
      description: "Review code changes",
      invocationName: "/code-review",
      enabled: true,
      installedAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    } satisfies SkillView;

    expect(skill.invocationName).toBe("/code-review");
  });

  it("accepts MCP config and server views", () => {
    const server = {
      name: "github",
      transport: "stdio",
      enabled: true,
      status: "success",
      lastTestedAt: "2026-06-19T00:00:00.000Z",
      tools: [
        {
          name: "list_issues",
          description: "List issues",
          inputSchema: { type: "object" },
        },
      ],
    } satisfies McpServerView;
    const config = {
      schemaVersion: 1,
      rawJson: "{\"mcpServers\":{}}",
      servers: [server],
    } satisfies McpConfigView;

    expect(config.servers[0]?.tools[0]?.name).toBe("list_issues");
  });
});
