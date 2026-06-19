import type { McpToolView } from "@story-forge/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ParsedMcpServer } from "./mcp-config";

export type McpConnectionTestResult = {
  tools: McpToolView[];
};

export interface McpConnectionTester {
  testServer(server: ParsedMcpServer): Promise<McpConnectionTestResult>;
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

    const client = new StdioMcpJsonRpcClient({
      command,
      args: readStringArray(server.raw.args),
      env: readStringEnv(server.raw.env),
      timeoutMs: this.options.timeoutMs ?? 10_000,
    });
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

  close(): void {
    this.child.kill();
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}${this.stderrSuffix()}`));
      }, this.options.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer });
      this.writeMessage({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.writeMessage({ jsonrpc: "2.0", method, params });
  }

  private writeMessage(message: Record<string, unknown>): void {
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
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
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) {
        return;
      }
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);
      this.handleMessage(body);
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
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `MCP request failed: ${pending.method}`));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private stderrSuffix(): string {
    const stderr = this.stderr.trim();
    return stderr ? `: ${stderr}` : "";
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
