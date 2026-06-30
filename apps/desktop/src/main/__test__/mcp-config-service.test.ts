// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpConfigService } from "../mcp-config-service";

describe("McpConfigService", () => {
  it("saves config and normalizes server views", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-mcp-"));
    const service = new McpConfigService({ rootDir });

    await expect(service.saveRawJson(JSON.stringify({
      mcpServers: { github: { command: "npx", args: ["server"] } },
    }))).resolves.toMatchObject({
      schemaVersion: 1,
      servers: [expect.objectContaining({ name: "github", transport: "stdio" })],
    });
  });

  it("tests a server and caches returned tools", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-mcp-"));
    const service = new McpConfigService({
      rootDir,
      tester: {
        testServer: async () => ({
          tools: [
            { name: "list_issues", description: "List issues", inputSchema: { type: "object" } },
          ],
        }),
      },
    });
    await service.saveRawJson(JSON.stringify({
      mcpServers: { github: { command: "npx", args: ["server"] } },
    }));

    await expect(service.testServer("github")).resolves.toMatchObject({
      name: "github",
      status: "success",
      tools: [expect.objectContaining({ name: "list_issues" })],
    });
    await expect(service.get()).resolves.toMatchObject({
      servers: [expect.objectContaining({ status: "success" })],
    });
  });

  it("stores a redacted failure when testing fails", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-mcp-"));
    const service = new McpConfigService({
      rootDir,
      tester: {
        testServer: async () => {
          throw new Error("bad secret-value");
        },
      },
    });
    await service.saveRawJson(JSON.stringify({
      mcpServers: { github: { command: "npx", env: { TOKEN: "secret-value" } } },
    }));

    await expect(service.testServer("github")).resolves.toMatchObject({
      status: "failed",
      lastError: "bad [REDACTED]",
    });
  });
});
