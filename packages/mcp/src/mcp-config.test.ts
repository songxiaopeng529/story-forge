import { describe, expect, it } from "vitest";
import { parseMcpConfig } from "./mcp-config";

describe("parseMcpConfig", () => {
  it("normalizes stdio and http mcpServers entries", () => {
    const config = parseMcpConfig(JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "server"], env: { TOKEN: "$TOKEN" } },
        docs: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    }));

    expect(config.servers).toEqual([
      expect.objectContaining({ name: "github", transport: "stdio", status: "untested" }),
      expect.objectContaining({ name: "docs", transport: "http", status: "untested" }),
    ]);
  });

  it("rejects invalid JSON and invalid server shapes", () => {
    expect(() => parseMcpConfig("{")).toThrow("Invalid MCP JSON");
    expect(() => parseMcpConfig(JSON.stringify({ mcpServers: { bad: { args: [] } } })))
      .toThrow("MCP server bad must define command or url");
  });
});
