import type { McpConfigView, McpServerView, McpTransport } from "@story-forge/shared";

export type ParsedMcpServer = {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  raw: Record<string, unknown>;
};

export type ParsedMcpConfig = McpConfigView & {
  parsedServers: ParsedMcpServer[];
};

export function parseMcpConfig(rawJson: string): ParsedMcpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error("Invalid MCP JSON", { cause: error });
  }

  if (!parsed || typeof parsed !== "object" || !("mcpServers" in parsed)) {
    throw new Error("MCP JSON must contain mcpServers");
  }
  const serversObject = (parsed as { mcpServers: unknown }).mcpServers;
  if (!serversObject || typeof serversObject !== "object" || Array.isArray(serversObject)) {
    throw new Error("mcpServers must be an object");
  }

  const parsedServers = Object.entries(serversObject).map(([name, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`MCP server ${name} must be an object`);
    }
    const record = raw as Record<string, unknown>;
    return {
      name,
      transport: inferTransport(name, record),
      enabled: record.disabled === true || record.enabled === false ? false : true,
      raw: record,
    };
  });

  return {
    schemaVersion: 1,
    rawJson,
    servers: parsedServers.map(toUntestedServerView),
    parsedServers,
  };
}

function inferTransport(name: string, raw: Record<string, unknown>): McpTransport {
  if (typeof raw.command === "string" && raw.command.trim()) {
    return "stdio";
  }
  if (typeof raw.url === "string" && raw.url.trim()) {
    const type = raw.type;
    if (type === "sse") {
      return "sse";
    }
    if (type === "ws" || type === "websocket") {
      return "ws";
    }
    return "http";
  }
  throw new Error(`MCP server ${name} must define command or url`);
}

function toUntestedServerView(server: ParsedMcpServer): McpServerView {
  return {
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    status: "untested",
    tools: [],
  };
}
