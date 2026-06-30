import { describe, expect, it } from "vitest";
import { NodeMcpConnectionTester } from "../mcp-client";

describe("NodeMcpConnectionTester", () => {
  it("fails explicitly for unsupported transports", async () => {
    await expect(new NodeMcpConnectionTester().testServer({
      name: "docs",
      transport: "http",
      enabled: true,
      raw: { url: "https://example.com/mcp" },
    })).rejects.toThrow("MCP transport not supported for testing yet: http");
  });

  it("lists tools from a stdio MCP server", async () => {
    const script = `
      const tools = [{
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object" }
      }];
      let buffer = Buffer.alloc(0);
      process.stdin.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
          if (headerEnd === -1) return;
          const header = buffer.subarray(0, headerEnd).toString("utf8");
          const match = header.match(/Content-Length: (\\d+)/i);
          if (!match) return;
          const length = Number(match[1]);
          const bodyStart = headerEnd + 4;
          const bodyEnd = bodyStart + length;
          if (buffer.length < bodyEnd) return;
          const request = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
          buffer = buffer.subarray(bodyEnd);
          if (request.method === "initialize") {
            respond(request.id, {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1.0.0" }
            });
          } else if (request.method === "tools/list") {
            respond(request.id, { tools });
          }
        }
      });
      function respond(id, result) {
        const body = JSON.stringify({ jsonrpc: "2.0", id, result });
        process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
      }
    `;

    await expect(new NodeMcpConnectionTester({ timeoutMs: 2_000 }).testServer({
      name: "fixture",
      transport: "stdio",
      enabled: true,
      raw: { command: process.execPath, args: ["-e", script] },
    })).resolves.toEqual({
      tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object" } }],
    });
  });
});
