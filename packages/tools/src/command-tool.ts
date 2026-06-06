import { spawn } from "node:child_process";
import path from "node:path";
import type { ToolDefinition, ToolExecutionContext } from "./tool-registry";
import type { WorkspaceSandbox } from "./workspace-sandbox";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const SAFE_SCRIPT_NAMES = /^(dev|start|test|build|typecheck|check|lint|format)(:.+)?$/;
const SAFE_GIT_COMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "grep",
  "ls-files",
  "rev-parse",
]);
const SAFE_DIRECT_PROGRAMS = new Set([
  "tsc",
  "vitest",
  "jest",
  "eslint",
  "prettier",
  "pytest",
]);

export type CommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
};

export function createWorkspaceCommandTool(sandbox: WorkspaceSandbox): ToolDefinition {
  return {
    name: "workspace.runCommand",
    description:
      "Run an allowlisted development, test, build, formatting, lint, or read-only Git command.",
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
      validateCommand(program, args);
      const cwd = await sandbox.resolveDirectory(cwdInput);
      return runCommand({ program, args, cwd, timeoutMs }, context);
    },
  };
}

export function validateCommand(program: string, args: string[]): void {
  if (!program || /[\\/]/.test(program)) {
    throw commandNotAllowed(program, args);
  }
  if (args.some((argument) => isUnsafeArgument(argument))) {
    throw commandNotAllowed(program, args);
  }

  if (program === "git") {
    if (!args[0] || !SAFE_GIT_COMMANDS.has(args[0])) {
      throw commandNotAllowed(program, args);
    }
    return;
  }

  if (["npm", "pnpm", "yarn", "bun"].includes(program)) {
    validatePackageManagerCommand(program, args);
    return;
  }

  if (program === "corepack") {
    const packageManager = args[0];
    if (!packageManager || !["npm", "pnpm", "yarn"].includes(packageManager)) {
      throw commandNotAllowed(program, args);
    }
    validatePackageManagerCommand(packageManager, args.slice(1));
    return;
  }

  if (SAFE_DIRECT_PROGRAMS.has(program)) {
    return;
  }

  if (program === "vite" && ["build", "dev"].includes(args[0] ?? "")) {
    return;
  }
  if (program === "cargo" && ["test", "build", "check", "fmt", "clippy"].includes(args[0] ?? "")) {
    return;
  }
  if (program === "go" && ["test", "build", "fmt", "vet"].includes(args[0] ?? "")) {
    return;
  }

  throw commandNotAllowed(program, args);
}

function validatePackageManagerCommand(program: string, args: string[]): void {
  const command = args[0];
  const script = command === "run" ? args[1] : command;
  if (!script || !SAFE_SCRIPT_NAMES.test(script)) {
    throw commandNotAllowed(program, args);
  }
}

async function runCommand(
  input: { program: string; args: string[]; cwd: string; timeoutMs: number },
  context: ToolExecutionContext,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.program, input.args, {
      cwd: input.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
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

function isUnsafeArgument(argument: string): boolean {
  if (
    ["--prefix", "--cwd", "--dir", "--global", "-C"].includes(argument)
    || ["--prefix=", "--cwd=", "--dir=", "--global=", "-C"].some((prefix) =>
      argument.startsWith(prefix)
    )
    || argument === "--ext-diff"
    || argument.startsWith("--output")
  ) {
    return true;
  }

  const value = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : argument;
  return (
    path.isAbsolute(value)
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.split(/[\\/]+/).includes("..")
  );
}
