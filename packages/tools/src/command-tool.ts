import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  classifyCommand,
  type CommandExecutionMode,
  type CommandPolicyDecision,
} from "./command-policy";
import type { ToolDefinition, ToolExecutionContext } from "./tool-registry";
import type { WorkspaceSandbox } from "./workspace-sandbox";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_ENV_PASSTHROUGH_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
];

export type WorkspaceCommandPermissionRequest = {
  reason: string;
  risk: Extract<CommandPolicyDecision, { action: "confirm" }>["risk"];
  command: {
    program: string;
    args: string[];
    cwd: string;
  };
};

export type WorkspaceCommandToolOptions = {
  mode?: CommandExecutionMode;
  commandHome?: string;
  readOnly?: boolean;
  requestPermission?: (request: WorkspaceCommandPermissionRequest) => Promise<boolean>;
};

export type CommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
};

export function createWorkspaceCommandTool(
  sandbox: WorkspaceSandbox,
  options: WorkspaceCommandToolOptions = {},
): ToolDefinition {
  return {
    name: "workspace.runCommand",
    description:
      "Run a workspace command according to the configured StoryForge command execution mode.",
    parameters: {
      type: "object",
      properties: {
        program: { type: "string", description: "Executable name without a path." },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Command arguments passed directly without a shell.",
        },
        cwd: {
          type: "string",
          description: "Optional workspace-relative working directory.",
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds, up to 30 minutes.",
        },
      },
      required: ["program", "args"],
    },
    execute: async (input, context) => {
      const program = readProgram(input.program);
      const args = readArgs(input.args);
      const cwdInput = input.cwd === undefined ? "." : readCwd(input.cwd);
      const timeoutMs = readTimeout(input.timeoutMs);
      const cwd = await sandbox.resolveDirectory(cwdInput);
      const mode = options.mode ?? "sentinel";
      const decision = classifyCommand({
        mode: options.readOnly ? "sentinel" : mode,
        program,
        args,
      });
      if (decision.action === "deny") {
        throw commandNotAllowed(program, args);
      }
      if (options.readOnly && decision.action !== "allow") {
        throw commandNotAllowed(program, args);
      }
      if (decision.action === "confirm") {
        const approved = await options.requestPermission?.({
          reason: decision.reason,
          risk: decision.risk,
          command: { program, args, cwd },
        });
        if (!approved) {
          throw new Error(`Command denied: ${decision.reason}`);
        }
      }
      if (mode !== "unleashed") {
        await sandbox.assertCommandArgumentsInside(cwdInput, args);
      }
      const commandHome = await prepareCommandHome(cwd, options.commandHome);
      const env = createCommandEnvironment(commandHome);
      const result = await runCommand({ program, args, cwd, timeoutMs, env }, context);
      if (result.aborted || result.timedOut || result.exitCode !== 0) {
        throw new Error(`Command failed: ${JSON.stringify(result)}`);
      }
      return result;
    },
  };
}

export function validateCommand(program: string, args: string[]): void {
  if (classifyCommand({ mode: "sentinel", program, args }).action === "allow") {
    return;
  }
  throw commandNotAllowed(program, args);
}

async function runCommand(
  input: {
    program: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  },
  context: ToolExecutionContext,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.program, input.args, {
      cwd: input.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: input.env,
    });
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - capturedBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const captured = chunk.subarray(0, remaining);
      capturedBytes += captured.length;
      if (captured.length < chunk.length) {
        truncated = true;
      }
      if (stream === "stdout") {
        stdout += captured.toString();
      } else {
        stderr += captured.toString();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));

    const terminate = () => {
      if (child.pid === undefined || child.killed) {
        return;
      }
      if (process.platform === "win32") {
        child.kill("SIGTERM");
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
      forceKillTimer ??= setTimeout(() => {
        if (settled || child.pid === undefined) {
          return;
        }
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }, 1000);
      forceKillTimer.unref?.();
    };
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    if (context.signal?.aborted) {
      onAbort();
    } else {
      context.signal?.addEventListener("abort", onAbort, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeout.unref?.();

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      context.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      context.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        aborted,
        truncated,
      });
    });
  });
}

async function prepareCommandHome(cwd: string, configuredHome: string | undefined): Promise<string> {
  const commandHome = path.resolve(cwd, configuredHome ?? ".storyforge-command-home");
  await mkdir(commandHome, { recursive: true });
  return commandHome;
}

function createCommandEnvironment(commandHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of COMMAND_ENV_PASSTHROUGH_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (process.platform === "win32") {
    for (const key of ["ComSpec", "SystemRoot", "WINDIR", "PATHEXT"]) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }

  env.HOME = commandHome;
  return env;
}

function readProgram(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("workspace.runCommand requires a non-empty string program");
  }
  return value.trim();
}

function readArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((argument) => typeof argument !== "string")) {
    throw new Error("workspace.runCommand requires string array args");
  }
  return value;
}

function readCwd(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("workspace.runCommand requires a non-empty string cwd");
  }
  return value;
}

function readTimeout(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > MAX_TIMEOUT_MS) {
    throw new Error(`workspace.runCommand timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return Number(value);
}

function commandNotAllowed(program: string, args: string[]): Error {
  return new Error(`Command is not allowed: ${[program, ...args].join(" ")}`.trim());
}
