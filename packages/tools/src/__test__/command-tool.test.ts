import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { classifyCommand } from "../command-policy";
import {
  createWorkspaceCommandTool,
  validateCommand,
  type WorkspaceCommandToolOptions,
} from "../command-tool";
import { ToolRegistry } from "../tool-registry";
import { WorkspaceSandbox } from "../workspace-sandbox";

describe("validateCommand", () => {
  it("allows project development scripts and read-only git commands", () => {
    expect(() => validateCommand("pnpm", ["test"])).not.toThrow();
    expect(() => validateCommand("npm", ["run", "typecheck"])).not.toThrow();
    expect(() => validateCommand("git", ["status", "--short"])).not.toThrow();
    expect(() => validateCommand("git", ["diff", "--stat"])).not.toThrow();
  });

  it("rejects shells, privilege escalation, dependency changes, publishing, and destructive git", () => {
    expect(() => validateCommand("sh", ["-c", "echo unsafe"])).toThrow("Command is not allowed");
    expect(() => validateCommand("sudo", ["pnpm", "test"])).toThrow("Command is not allowed");
    expect(() => validateCommand("npm", ["install", "left-pad"])).toThrow("Command is not allowed");
    expect(() => validateCommand("pnpm", ["publish"])).toThrow("Command is not allowed");
    expect(() => validateCommand("git", ["reset", "--hard"])).toThrow("Command is not allowed");
    expect(() => validateCommand("git", ["checkout", "--", "file.txt"])).toThrow("Command is not allowed");
    expect(() => validateCommand("git", ["diff", "--output=/tmp/leak"])).toThrow("Command is not allowed");
    expect(() => validateCommand("prettier", ["--write", "../outside.ts"])).toThrow("Command is not allowed");
  });
});

describe("classifyCommand", () => {
  it("allows read-only discovery in sentinel mode", () => {
    expect(classifyCommand({
      mode: "sentinel",
      program: "which",
      args: ["agent-browser"],
    })).toMatchObject({ action: "allow", risk: "safe" });
  });

  it("confirms unknown commands in sentinel mode", () => {
    expect(classifyCommand({
      mode: "sentinel",
      program: "agent-browser",
      args: ["screenshot"],
    })).toMatchObject({ action: "confirm", risk: "unknown" });
  });

  it("allows non-destructive unknown commands in cruise mode", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "agent-browser",
      args: ["screenshot"],
    })).toMatchObject({ action: "allow", risk: "low" });
  });

  it("confirms destructive commands in cruise mode", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "rm",
      args: ["-rf", "dist"],
    })).toMatchObject({ action: "confirm", risk: "destructive" });
  });

  it("allows destructive commands in unleashed mode", () => {
    expect(classifyCommand({
      mode: "unleashed",
      program: "rm",
      args: ["-rf", "dist"],
    })).toMatchObject({ action: "allow", risk: "low" });
  });

  it("confirms high-risk commands in sentinel and cruise but not unleashed", () => {
    expect(classifyCommand({
      mode: "sentinel",
      program: "bash",
      args: ["-lc", "echo hi"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "bash",
      args: ["-lc", "echo hi"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "unleashed",
      program: "bash",
      args: ["-lc", "echo hi"],
    })).toMatchObject({ action: "allow", risk: "low" });
  });

  it("treats secret inspection and remote access as high-risk", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "node",
      args: ["-e", "console.log(process.env)"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "ssh",
      args: ["example.com"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "env",
      args: [],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "cat",
      args: [".env"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "bash",
      args: ["-lc", "cat .env"],
    })).toMatchObject({ action: "confirm", risk: "high" });
  });

  it("does not classify curl or wget as high-risk by themselves", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "curl",
      args: ["https://example.com/file"],
    })).toMatchObject({ action: "allow", risk: "low" });
    expect(classifyCommand({
      mode: "cruise",
      program: "wget",
      args: ["https://example.com/file"],
    })).toMatchObject({ action: "allow", risk: "low" });
    expect(classifyCommand({
      mode: "sentinel",
      program: "curl",
      args: ["https://example.com/file"],
    })).toMatchObject({ action: "confirm", risk: "unknown" });
  });
});

describe("workspace.runCommand", () => {
  it("runs an allowed command in a workspace-relative directory without a shell", async () => {
    const root = await createCommandWorkspace();
    const nested = path.join(root, "nested");
    await mkdir(nested);
    const registry = commandRegistry(root);

    const result = await registry.execute("workspace.runCommand", {
      program: "pwd",
      args: [],
      cwd: "nested",
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        exitCode: 0,
        timedOut: false,
        truncated: false,
      },
    });
    if (result.ok) {
      expect(result.output).toMatchObject({ stdout: expect.stringContaining("nested") });
    }
  });

  it("runs commands with a sanitized environment and StoryForge-owned HOME", async () => {
    const root = await createCommandWorkspace();
    const previousTavilyKey = process.env.Tavily_API_KEY;
    const previousSerpApiKey = process.env.SerpApi_API_KEY;
    const previousSecret = process.env.STORY_FORGE_SECRET_FOR_TEST;
    process.env.Tavily_API_KEY = "tavily-secret";
    process.env.SerpApi_API_KEY = "serp-secret";
    process.env.STORY_FORGE_SECRET_FOR_TEST = "custom-secret";
    try {
      const resolvedRoot = await realpath(root);
      const result = await commandRegistry(root, { mode: "unleashed" }).execute("workspace.runCommand", {
        program: "node",
        args: [
          "-e",
          "console.log(JSON.stringify({home:process.env.HOME,pathPresent:Boolean(process.env.PATH),tavily:process.env.Tavily_API_KEY??null,serp:process.env.SerpApi_API_KEY??null,secret:process.env.STORY_FORGE_SECRET_FOR_TEST??null}))",
        ],
      });

      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        const output = JSON.parse((result.output as { stdout: string }).stdout);
        expect(output).toEqual({
          home: path.join(resolvedRoot, ".storyforge-command-home"),
          pathPresent: true,
          tavily: null,
          serp: null,
          secret: null,
        });
      }
    } finally {
      restoreEnvValue("Tavily_API_KEY", previousTavilyKey);
      restoreEnvValue("SerpApi_API_KEY", previousSerpApiKey);
      restoreEnvValue("STORY_FORGE_SECRET_FOR_TEST", previousSecret);
    }
  });

  it("uses a configured command home when provided", async () => {
    const root = await createCommandWorkspace();
    const commandHome = path.join(root, "custom-command-home");

    const result = await commandRegistry(root, { commandHome, mode: "unleashed" }).execute(
      "workspace.runCommand",
      {
        program: "node",
        args: ["-e", "console.log(process.env.HOME)"],
      },
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect((result.output as { stdout: string }).stdout.trim()).toBe(commandHome);
    }
  });

  it("terminates commands that exceed their timeout", async () => {
    const root = await createCommandWorkspace();
    const result = await commandRegistry(root).execute("workspace.runCommand", {
      program: "npm",
      args: ["run", "test:slow"],
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('"timedOut":true'),
    });
  });

  it("caps combined stdout and stderr at one MiB and marks truncation", async () => {
    const root = await createCommandWorkspace();
    const result = await commandRegistry(root).execute("workspace.runCommand", {
      program: "npm",
      args: ["run", "test:output"],
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        exitCode: 0,
        truncated: true,
      },
    });
    if (result.ok) {
      const output = result.output as { stdout: string; stderr: string };
      expect(Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr)).toBeLessThanOrEqual(
        1024 * 1024,
      );
    }
  });

  it("terminates the process group when the execution signal is aborted", async () => {
    const root = await createCommandWorkspace();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await commandRegistry(root).execute(
      "workspace.runCommand",
      {
        program: "npm",
        args: ["run", "test:slow"],
      },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('"aborted":true'),
    });
  });

  it("marks non-zero command exits as failed while preserving diagnostic output", async () => {
    const root = await createCommandWorkspace();
    const result = await commandRegistry(root).execute("workspace.runCommand", {
      program: "npm",
      args: ["run", "test:fail"],
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('"exitCode":7'),
    });
    if (!result.ok) {
      expect(result.error).toContain("expected failure");
    }
  });

  it("runs a confirm-worthy command after permission approval", async () => {
    const root = await createCommandWorkspace();
    const resolvedRoot = await realpath(root);
    const requestPermission = vi.fn(async () => true);
    const result = await commandRegistry(root, { requestPermission }).execute("workspace.runCommand", {
      program: "node",
      args: ["-e", "console.log('approved')"],
    });

    expect(requestPermission).toHaveBeenCalledWith({
      reason: "This command can run arbitrary code, inspect secrets, or access remote systems.",
      risk: "high",
      command: {
        program: "node",
        args: ["-e", "console.log('approved')"],
        cwd: resolvedRoot,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      output: {
        exitCode: 0,
        stdout: "approved\n",
      },
    });
  });

  it("fails a confirm-worthy command when permission is denied", async () => {
    const root = await createCommandWorkspace();
    const requestPermission = vi.fn(async () => false);
    const result = await commandRegistry(root, { requestPermission }).execute("workspace.runCommand", {
      program: "node",
      args: ["-e", "console.log('denied')"],
    });

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: false,
      error: "Command denied: This command can run arbitrary code, inspect secrets, or access remote systems.",
    });
  });

  it("allows safe commands but denies confirm-worthy commands in read-only mode", async () => {
    const root = await createCommandWorkspace();
    const requestPermission = vi.fn(async () => true);
    const registry = commandRegistry(root, { readOnly: true, requestPermission });

    await expect(registry.execute("workspace.runCommand", {
      program: "which",
      args: ["node"],
    })).resolves.toMatchObject({ ok: true });

    await expect(registry.execute("workspace.runCommand", {
      program: "node",
      args: ["-e", "console.log('blocked')"],
    })).resolves.toEqual({
      ok: false,
      error: "Command is not allowed: node -e console.log('blocked')",
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("rejects command arguments whose nearest existing path escapes through a symlink", async () => {
    const root = await createCommandWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "story-forge-command-outside-"));
    await writeFile(path.join(outside, "outside.txt"), "outside");
    await symlink(outside, path.join(root, "linked"));

    await expect(commandRegistry(root).execute("workspace.runCommand", {
      program: "prettier",
      args: ["--write", "linked/outside.txt"],
    })).resolves.toEqual({
      ok: false,
      error: "Command argument escapes workspace root: linked/outside.txt",
    });
  });
});

function commandRegistry(
  root: string,
  options: WorkspaceCommandToolOptions = {},
): ToolRegistry {
  const sandbox = new WorkspaceSandbox(root);
  return new ToolRegistry([createWorkspaceCommandTool(sandbox, options)]);
}

async function createCommandWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "story-forge-command-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        "test:cwd": "node -e \"console.log(process.cwd())\"",
        "test:slow": "node -e \"setTimeout(() => {}, 10000)\"",
        "test:output": "node -e \"process.stdout.write('x'.repeat(1100000))\"",
        "test:fail": "node -e \"console.error('expected failure');process.exit(7)\"",
      },
    }),
  );
  return root;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
