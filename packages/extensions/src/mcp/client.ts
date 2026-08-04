import type { McpToolView } from "@story-forge/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ParsedMcpServer } from "./config";
import type { ToolDefinition } from "../tool-definition";

export type McpConnectionTestResult = {
  tools: McpToolView[];
};

export interface McpConnectionTester {
  testServer(server: ParsedMcpServer): Promise<McpConnectionTestResult>;
}

export type McpRuntimeDiagnostic = {
  serverName: string;
  error: string;
};

export type McpRuntimeTools = {
  tools: ToolDefinition[];
  diagnostics: McpRuntimeDiagnostic[];
};

/** Owns the live MCP connections used by one PI AgentSession. */
export class NodeMcpToolSession {
  private readonly clients: StdioMcpJsonRpcClient[] = [];

  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async loadTools(servers: ParsedMcpServer[]): Promise<McpRuntimeTools> {
    const tools: ToolDefinition[] = [];
    const diagnostics: McpRuntimeDiagnostic[] = [];
    const toolNames = new Set<string>();

    for (const server of servers.filter((candidate) => candidate.enabled)) {
      if (server.transport !== "stdio") {
        diagnostics.push({
          serverName: server.name,
          error: `MCP runtime transport not supported yet: ${server.transport}`,
        });
        continue;
      }

      let client: StdioMcpJsonRpcClient | undefined;
      try {
        client = createStdioClient(server, this.options.timeoutMs ?? 30_000);
        await client.initialize();
        const descriptors = await client.listTools();
        this.clients.push(client);
        for (const descriptor of descriptors) {
          const name = createMcpToolName(server.name, descriptor.name);
          if (toolNames.has(name)) {
            diagnostics.push({
              serverName: server.name,
              error: `MCP tool name collision: ${name}`,
            });
            continue;
          }
          toolNames.add(name);
          tools.push({
            name,
            description: [
              `MCP tool ${server.name}/${descriptor.name}.`,
              descriptor.description,
            ].filter(Boolean).join(" "),
            parameters: descriptor.inputSchema,
            execute: (input, context) => client!.callTool(
              descriptor.name,
              input,
              context.signal,
            ),
          });
        }
      } catch (error) {
        client?.close();
        diagnostics.push({
          serverName: server.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { tools, diagnostics };
  }

  close(): void {
    for (const client of this.clients.splice(0)) {
      client.close();
    }
  }
}

export class NodeMcpConnectionTester implements McpConnectionTester {
  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async testServer(server: ParsedMcpServer): Promise<McpConnectionTestResult> {
    if (server.transport !== "stdio") {
      throw new Error(`MCP transport not supported for testing yet: ${server.transport}`);
    }
    const command = typeof server.raw.command === "string" ? server.raw.command.trim() : "";
    if (!command) {
      throw new Error(`MCP server ${server.name} must define command`);
    }

    const client = createStdioClient(server, this.options.timeoutMs ?? 10_000);
    try {
      await client.initialize();
      return { tools: await client.listTools() };
    } finally {
      client.close();
    }
  }
}

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { message?: string };
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
};

class StdioMcpJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private stderr = "";

  constructor(
    private readonly options: {
      command: string;
      args: string[];
      env: Record<string, string>;
      timeoutMs: number;
    },
  ) {
    this.child = spawn(options.command, options.args, {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-4096);
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("exit", (code, signal) => {
      if (this.pending.size > 0) {
        this.rejectAll(new Error(
          `MCP server exited before responding (${signal ?? code ?? "unknown"})${this.stderrSuffix()}`,
        ));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "story-forge", version: "0.0.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpToolView[]> {
    return normalizeToolsResult(await this.request("tools/list", {}));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const result = await this.request("tools/call", { name, arguments: args }, signal);
    const record = isRecord(result) ? result : {};
    if (record.isError === true) {
      throw new Error(readMcpErrorMessage(record.content) || `MCP tool failed: ${name}`);
    }
    return result;
  }

  close(): void {
    this.rejectAll(new Error("MCP connection closed"));
    this.child.kill();
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(`MCP request aborted: ${method}`));
        return;
      }
      const timer = setTimeout(() => {
        this.removePending(id);
        reject(new Error(`MCP request timed out: ${method}${this.stderrSuffix()}`));
      }, this.options.timeoutMs);
      timer.unref?.();
      const onAbort = signal
        ? () => {
            this.removePending(id);
            this.notify("notifications/cancelled", {
              requestId: id,
              reason: "StoryForge turn aborted",
            });
            reject(new Error(`MCP request aborted: ${method}`));
          }
        : undefined;
      if (signal && onAbort) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.set(id, {
        method,
        resolve,
        reject,
        timer,
        ...(signal ? { signal } : {}),
        ...(onAbort ? { onAbort } : {}),
      });
      this.writeMessage({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.writeMessage({ jsonrpc: "2.0", method, params });
  }

  private writeMessage(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.buffer.subarray(0, 15).toString("utf8").toLowerCase() === "content-length:") {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const header = this.buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length: (\d+)/i);
        if (!match?.[1]) {
          this.rejectAll(new Error("Malformed MCP response header"));
          return;
        }
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + Number(match[1]);
        if (this.buffer.length < bodyEnd) {
          return;
        }
        const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
        this.buffer = this.buffer.subarray(bodyEnd);
        this.handleMessage(body);
        continue;
      }

      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }
      const body = this.buffer.subarray(0, lineEnd).toString("utf8").trim();
      this.buffer = this.buffer.subarray(lineEnd + 1);
      if (body) {
        this.handleMessage(body);
      }
    }
  }

  private handleMessage(body: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(body) as JsonRpcResponse;
    } catch (error) {
      this.rejectAll(new Error("Malformed MCP JSON response", { cause: error }));
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.removePending(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `MCP request failed: ${pending.method}`));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.removePending(id);
      pending.reject(error);
    }
  }

  private removePending(id: number): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    this.pending.delete(id);
  }

  private stderrSuffix(): string {
    const stderr = this.stderr.trim();
    return stderr ? `: ${stderr}` : "";
  }
}

function createStdioClient(server: ParsedMcpServer, timeoutMs: number): StdioMcpJsonRpcClient {
  const command = typeof server.raw.command === "string" ? server.raw.command.trim() : "";
  if (!command) {
    throw new Error(`MCP server ${server.name} must define command`);
  }
  return new StdioMcpJsonRpcClient({
    command,
    args: readStringArray(server.raw.args),
    env: readStringEnv(server.raw.env),
    timeoutMs,
  });
}

function createMcpToolName(serverName: string, toolName: string): string {
  const normalize = (value: string) => value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unnamed";
  return `mcp__${normalize(serverName)}__${normalize(toolName)}`.slice(0, 64);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readStringEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizeToolsResult(result: unknown): McpToolView[] {
  if (!result || typeof result !== "object" || !Array.isArray((result as { tools?: unknown }).tools)) {
    return [];
  }
  return (result as { tools: unknown[] }).tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") {
      return [];
    }
    const record = tool as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name) {
      return [];
    }
    return [{
      name: record.name,
      description: typeof record.description === "string" ? record.description : "",
      inputSchema: isRecord(record.inputSchema) ? record.inputSchema : {},
    }];
  });
}

function readMcpErrorMessage(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      const record = isRecord(item) ? item : {};
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
