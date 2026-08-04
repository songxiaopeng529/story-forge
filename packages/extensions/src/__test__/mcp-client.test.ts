import { describe, expect, it } from "vitest";
import { NodeMcpConnectionTester, NodeMcpToolSession } from "../mcp/client";

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
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (true) {
          const lineEnd = buffer.indexOf("\\n");
          if (lineEnd === -1) return;
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          if (!line) continue;
          const request = JSON.parse(line);
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
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
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

  it("exposes namespaced tools and executes them over the live MCP session", async () => {
    const script = `
      const tools = [{
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object", properties: { query: { type: "string" } } }
      }];
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (true) {
          const lineEnd = buffer.indexOf("\\n");
          if (lineEnd === -1) return;
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          if (!line) continue;
          const request = JSON.parse(line);
          if (request.method === "initialize") {
            respond(request.id, {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1.0.0" }
            });
          } else if (request.method === "tools/list") {
            respond(request.id, { tools });
          } else if (request.method === "tools/call") {
            respond(request.id, {
              content: [{ type: "text", text: "found:" + request.params.arguments.query }],
              isError: false
            });
          }
        }
      });
      function respond(id, result) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
      }
    `;
    const session = new NodeMcpToolSession({ timeoutMs: 2_000 });
    const runtime = await session.loadTools([{
      name: "docs",
      transport: "stdio",
      enabled: true,
      raw: { command: process.execPath, args: ["-e", script] },
    }]);

    expect(runtime.diagnostics).toEqual([]);
    expect(runtime.tools.map((tool) => tool.name)).toEqual(["mcp__docs__search"]);
    await expect(runtime.tools[0]!.execute({ query: "pi" }, {})).resolves.toMatchObject({
      content: [{ type: "text", text: "found:pi" }],
      isError: false,
    });
    session.close();
  });
});
