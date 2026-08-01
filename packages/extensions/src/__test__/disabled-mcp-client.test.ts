import { describe, expect, it } from "vitest";
import { DisabledMcpClient } from "../mcp/disabled-client";

describe("DisabledMcpClient", () => {
  it("returns no tools while MCP is disabled in Phase 1", async () => {
    const client = new DisabledMcpClient();

    await expect(client.listTools()).resolves.toEqual([]);
  });
});
