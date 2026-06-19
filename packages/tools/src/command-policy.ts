import path from "node:path";

export type CommandExecutionMode = "sentinel" | "cruise" | "unleashed";

export type CommandRisk =
  | "safe"
  | "low"
  | "unknown"
  | "destructive"
  | "elevated"
  | "invalid";

export type CommandPolicyDecision =
  | { action: "allow"; reason: string; risk: "safe" | "low" }
  | { action: "confirm"; reason: string; risk: "unknown" | "destructive" | "elevated" }
  | { action: "deny"; reason: string; risk: "invalid" };

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
  "which",
  "pwd",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SHELL_PROGRAMS = new Set(["sh", "bash", "zsh", "fish"]);
const ELEVATED_PROGRAMS = new Set(["sudo", "su"]);
const DESTRUCTIVE_PROGRAMS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "trash",
  "chmod",
  "chown",
]);

export function classifyCommand(input: {
  mode: CommandExecutionMode;
  program: string;
  args: string[];
}): CommandPolicyDecision {
  const program = input.program.trim();
  const args = input.args;

  if (!program) {
    return {
      action: "deny",
      reason: "Command program is empty.",
      risk: "invalid",
    };
  }

  if (input.mode !== "unleashed" && /[\\/]/.test(program)) {
    return {
      action: "deny",
      reason: "Command executable paths are not allowed in this mode.",
      risk: "invalid",
    };
  }

  if (input.mode !== "unleashed" && args.some((argument) => isUnsafeArgument(argument))) {
    return {
      action: "deny",
      reason: "Command arguments must stay inside the workspace.",
      risk: "invalid",
    };
  }

  if (input.mode === "unleashed") {
    return {
      action: "allow",
      reason: "无缰模式 allows command execution without confirmation.",
      risk: "low",
    };
  }

  if (isElevatedCommand(program)) {
    return {
      action: "confirm",
      reason: "This command may request elevated privileges.",
      risk: "elevated",
    };
  }

  if (isDestructiveCommand(program, args)) {
    return {
      action: "confirm",
      reason: "This command may modify or delete files.",
      risk: "destructive",
    };
  }

  if (isKnownSafeCommand(program, args)) {
    return {
      action: "allow",
      reason: "Command matches the safe allowlist.",
      risk: "safe",
    };
  }

  if (input.mode === "cruise") {
    return {
      action: "allow",
      reason: "巡航模式 allows non-destructive commands.",
      risk: "low",
    };
  }

  return {
    action: "confirm",
    reason: "Command is outside the safe allowlist.",
    risk: "unknown",
  };
}

export function isUnsafeArgument(argument: string): boolean {
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

function isKnownSafeCommand(program: string, args: string[]): boolean {
  if (program === "git") {
    return Boolean(args[0] && SAFE_GIT_COMMANDS.has(args[0]));
  }

  if (PACKAGE_MANAGERS.has(program)) {
    return isSafePackageManagerCommand(args);
  }

  if (program === "corepack") {
    const packageManager = args[0];
    return Boolean(
      packageManager
      && packageManager !== "bun"
      && PACKAGE_MANAGERS.has(packageManager)
      && isSafePackageManagerCommand(args.slice(1)),
    );
  }

  if (SAFE_DIRECT_PROGRAMS.has(program)) {
    return true;
  }

  if (program === "vite" && ["build", "dev"].includes(args[0] ?? "")) {
    return true;
  }
  if (program === "cargo" && ["test", "build", "check", "fmt", "clippy"].includes(args[0] ?? "")) {
    return true;
  }
  if (program === "go" && ["test", "build", "fmt", "vet"].includes(args[0] ?? "")) {
    return true;
  }

  return false;
}

function isSafePackageManagerCommand(args: string[]): boolean {
  const command = args[0];
  const script = command === "run" ? args[1] : command;
  return Boolean(script && SAFE_SCRIPT_NAMES.test(script));
}

function isElevatedCommand(program: string): boolean {
  return ELEVATED_PROGRAMS.has(program);
}

function isDestructiveCommand(program: string, args: string[]): boolean {
  if (DESTRUCTIVE_PROGRAMS.has(program)) {
    return true;
  }

  if (program === "git") {
    return isDestructiveGitCommand(args);
  }

  if (PACKAGE_MANAGERS.has(program)) {
    return isPackageRemovalCommand(args);
  }

  if (program === "corepack") {
    return isPackageRemovalCommand(args.slice(1));
  }

  if (SHELL_PROGRAMS.has(program)) {
    return args.some((argument) => containsDestructiveShellFragment(argument));
  }

  return false;
}

function isDestructiveGitCommand(args: string[]): boolean {
  const [command, ...rest] = args;
  if (command === "reset" && rest.includes("--hard")) {
    return true;
  }
  if (command === "clean") {
    return true;
  }
  if ((command === "checkout" || command === "restore") && rest.includes("--")) {
    return true;
  }
  if (command === "branch" && rest.includes("-D")) {
    return true;
  }
  return false;
}

function isPackageRemovalCommand(args: string[]): boolean {
  const command = args[0];
  return ["uninstall", "remove"].includes(command ?? "");
}

function containsDestructiveShellFragment(value: string): boolean {
  return (
    /\brm\s+-/.test(value)
    || /\brmdir\b/.test(value)
    || /\bunlink\b/.test(value)
    || /\btrash\b/.test(value)
    || /\bchmod\b/.test(value)
    || /\bchown\b/.test(value)
    || /(^|\s)>\s*\S/.test(value)
    || /(^|\s)>>\s*\S/.test(value)
  );
}
