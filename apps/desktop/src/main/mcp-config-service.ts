import {
  NodeMcpConnectionTester,
  parseMcpConfig,
  type McpConnectionTester,
} from "@story-forge/mcp";
import type { McpConfigView, McpServerView, McpToolView } from "@story-forge/shared";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

const mcpToolSchema: z.ZodType<McpToolView> = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});

const mcpServerSchema: z.ZodType<McpServerView> = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "http", "sse", "ws"]),
  enabled: z.boolean(),
  status: z.enum(["untested", "success", "failed"]),
  lastTestedAt: z.string().optional(),
  lastError: z.string().optional(),
  tools: z.array(mcpToolSchema),
});

const mcpConfigSchema: z.ZodType<McpConfigView> = z.object({
  schemaVersion: z.literal(1),
  rawJson: z.string(),
  servers: z.array(mcpServerSchema),
});

const defaultRawJson = JSON.stringify({ mcpServers: {} }, null, 2);

export class McpConfigService {
  private readonly configPath: string;
  private readonly tester: McpConnectionTester;

  constructor(options: { rootDir: string; tester?: McpConnectionTester }) {
    this.configPath = join(options.rootDir, "mcp.json");
    this.tester = options.tester ?? new NodeMcpConnectionTester();
  }

  get(): Promise<McpConfigView> {
    return readJson(this.configPath, mcpConfigSchema, {
      schemaVersion: 1,
      rawJson: defaultRawJson,
      servers: [],
    });
  }

  async saveRawJson(rawJson: string): Promise<McpConfigView> {
    const parsed = parseMcpConfig(rawJson);
    const current = await this.get();
    const servers = parsed.servers.map((server) => {
      const existing = current.servers.find((candidate) => candidate.name === server.name);
      return existing
        ? {
            ...server,
            status: existing.status,
            tools: existing.tools,
            ...(existing.lastTestedAt ? { lastTestedAt: existing.lastTestedAt } : {}),
            ...(existing.lastError ? { lastError: existing.lastError } : {}),
          }
        : server;
    });
    const view = { schemaVersion: 1 as const, rawJson, servers };
    await writeJsonAtomic(this.configPath, mcpConfigSchema.parse(view));
    return view;
  }

  async testServer(name: string): Promise<McpServerView> {
    const current = await this.get();
    const parsed = parseMcpConfig(current.rawJson);
    const parsedServer = parsed.parsedServers.find((server) => server.name === name);
    if (!parsedServer) {
      throw new Error(`MCP server not found: ${name}`);
    }

    const existing = current.servers.find((server) => server.name === name);
    const now = new Date().toISOString();
    let updated: McpServerView;
    try {
      const result = await this.tester.testServer(parsedServer);
      updated = {
        name,
        transport: parsedServer.transport,
        enabled: existing?.enabled ?? parsedServer.enabled,
        status: "success",
        lastTestedAt: now,
        tools: result.tools,
      };
    } catch (error) {
      updated = {
        name,
        transport: parsedServer.transport,
        enabled: existing?.enabled ?? parsedServer.enabled,
        status: "failed",
        lastTestedAt: now,
        lastError: redactKnownEnvValues(
          error instanceof Error ? error.message : String(error),
          parsedServer.raw,
        ),
        tools: [],
      };
    }

    const existingServers = current.servers.length > 0 ? current.servers : parsed.servers;
    const next = {
      schemaVersion: 1 as const,
      rawJson: current.rawJson,
      servers: existingServers.map((server) => (server.name === name ? updated : server)),
    };
    await writeJsonAtomic(this.configPath, mcpConfigSchema.parse(next));
    return updated;
  }
}

function redactKnownEnvValues(message: string, raw: Record<string, unknown>): string {
  const env = raw.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return message;
  }

  return Object.values(env).reduce((current, value) => {
    return typeof value === "string" && value
      ? current.split(value).join("[REDACTED]")
      : current;
  }, message);
}
