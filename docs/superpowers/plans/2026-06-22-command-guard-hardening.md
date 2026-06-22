# Command Guard Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden StoryForge host command execution by adding high-risk command confirmation in guarded modes, sanitizing child process env, and clarifying that host commands are not OS-sandboxed.

**Architecture:** Keep the current `workspace.runCommand` API and command policy entry point. Extend `command-policy.ts` with a `high` risk that confirms in `sentinel` and `cruise` but is bypassed by the existing early `unleashed` allow. Extend `command-tool.ts` to build a minimal child environment and accept a StoryForge-controlled command home directory from the desktop coordinator.

**Tech Stack:** TypeScript, Node `child_process.spawn`, Vitest, React Testing Library, Electron main process services.

---

## File Structure

- Modify `packages/tools/src/command-policy.ts`: add `high` risk and high-risk classification.
- Modify `packages/tools/src/command-tool.test.ts`: add policy and env-isolation tests.
- Modify `packages/tools/src/command-tool.ts`: add sanitized env and command home options.
- Modify `apps/desktop/src/main/agent-coordinator.ts`: pass command home to command tool.
- Modify `apps/desktop/src/main/agent-coordinator.test.ts`: assert command home/env behavior through coordinator where useful.
- Modify `apps/desktop/src/renderer/components/settings-page.tsx`: clarify host command guard copy.
- Modify `apps/desktop/src/renderer/App.test.tsx`: assert updated Settings copy.

There are existing uncommitted changes in `apps/desktop/src/main/env-loader.ts` and `apps/desktop/src/main/env-loader.test.ts`. Do not stage or modify them for this plan.

## Task 1: High-Risk Command Policy

**Files:**
- Modify: `packages/tools/src/command-policy.ts`
- Test: `packages/tools/src/command-tool.test.ts`

- [ ] **Step 1: Write failing policy tests**

Add tests under `describe("classifyCommand")`:

```ts
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
```

- [ ] **Step 2: Run failing tests**

Run: `corepack pnpm --filter @story-forge/tools exec vitest run src/command-tool.test.ts -t "high-risk|curl"`

Expected: FAIL because `high` risk does not exist and cruise currently allows shells/interpreters.

- [ ] **Step 3: Implement minimal policy change**

Update `CommandRisk` and `CommandPolicyDecision`:

```ts
export type CommandRisk =
  | "safe"
  | "low"
  | "unknown"
  | "high"
  | "destructive"
  | "elevated"
  | "invalid";

export type CommandPolicyDecision =
  | { action: "allow"; reason: string; risk: "safe" | "low" }
  | { action: "confirm"; reason: string; risk: "unknown" | "high" | "destructive" | "elevated" }
  | { action: "deny"; reason: string; risk: "invalid" };
```

Add high-risk sets:

```ts
const HIGH_RISK_PROGRAMS = new Set([
  "sh", "bash", "zsh", "fish",
  "node", "python", "python3", "ruby", "perl",
  "ssh", "scp", "rsync", "nc", "netcat",
  "env", "printenv",
]);

const SECRET_INDICATORS = [
  ".env", "~/.ssh", ".ssh/", "id_rsa", "id_ed25519",
  "api_key", "token", "secret", "password", "private_key",
];
```

In `classifyCommand`, after elevated/destructive checks and before safe allowlist:

```ts
if (isHighRiskCommand(program, args)) {
  return {
    action: "confirm",
    reason: "This command can run arbitrary code, inspect secrets, or access remote systems.",
    risk: "high",
  };
}
```

Implement:

```ts
function isHighRiskCommand(program: string, args: string[]): boolean {
  if (HIGH_RISK_PROGRAMS.has(program)) {
    return true;
  }
  if (SHELL_PROGRAMS.has(program) || ["node", "python", "python3", "ruby", "perl"].includes(program)) {
    return args.some((argument) => containsSecretIndicator(argument));
  }
  return false;
}

function containsSecretIndicator(value: string): boolean {
  const normalized = value.toLowerCase();
  return SECRET_INDICATORS.some((indicator) => normalized.includes(indicator));
}
```

Do not add `curl` or `wget` to any high-risk set.

- [ ] **Step 4: Run policy tests**

Run: `corepack pnpm --filter @story-forge/tools exec vitest run src/command-tool.test.ts -t "classifyCommand|validateCommand"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/command-policy.ts packages/tools/src/command-tool.test.ts
git commit -m "feat: confirm high-risk host commands"
```

## Task 2: Sanitized Command Environment

**Files:**
- Modify: `packages/tools/src/command-tool.ts`
- Test: `packages/tools/src/command-tool.test.ts`

- [ ] **Step 1: Write failing env isolation tests**

Add tests under `describe("workspace.runCommand")`:

```ts
it("runs commands with a sanitized environment and command home", async () => {
  const root = await createCommandWorkspace();
  const commandHome = path.join(root, ".storyforge-command-home");
  process.env.Tavily_API_KEY = "host-tavily-secret";
  process.env.OPENAI_API_KEY = "host-openai-secret";
  try {
    const result = await commandRegistry(root, {
      commandHome,
      mode: "unleashed",
    }).execute("workspace.runCommand", {
      program: "node",
      args: [
        "-e",
        "console.log(JSON.stringify({home:process.env.HOME,path:Boolean(process.env.PATH),tavily:process.env.Tavily_API_KEY,openai:process.env.OPENAI_API_KEY}))",
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as { stdout: string };
      expect(JSON.parse(output.stdout)).toEqual({
        home: commandHome,
        path: true,
        tavily: undefined,
        openai: undefined,
      });
    }
  } finally {
    delete process.env.Tavily_API_KEY;
    delete process.env.OPENAI_API_KEY;
  }
});

it("uses a non-user fallback HOME when commandHome is not provided", async () => {
  const root = await createCommandWorkspace();
  const result = await commandRegistry(root, { mode: "unleashed" }).execute("workspace.runCommand", {
    program: "node",
    args: ["-e", "console.log(process.env.HOME)"],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    const output = result.output as { stdout: string };
    expect(output.stdout.trim()).not.toBe(process.env.HOME);
    expect(output.stdout.trim()).toContain(".storyforge-command-home");
  }
});
```

- [ ] **Step 2: Run failing env tests**

Run: `corepack pnpm --filter @story-forge/tools exec vitest run src/command-tool.test.ts -t "sanitized environment|fallback HOME"`

Expected: FAIL because child processes currently inherit host env and real HOME.

- [ ] **Step 3: Implement sanitized env**

Update `WorkspaceCommandToolOptions`:

```ts
export type WorkspaceCommandToolOptions = {
  mode?: CommandExecutionMode;
  commandHome?: string;
  requestPermission?: (request: WorkspaceCommandPermissionRequest) => Promise<boolean>;
};
```

Pass env into `runCommand`:

```ts
const env = createCommandEnvironment({
  commandHome: options.commandHome ?? await sandbox.resolveDirectory(".storyforge-command-home"),
});
const result = await runCommand({ program, args, cwd, timeoutMs, env }, context);
```

Update `runCommand` input and `spawn`:

```ts
const child = spawn(input.program, input.args, {
  cwd: input.cwd,
  env: input.env,
  shell: false,
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
```

Add:

```ts
function createCommandEnvironment(input: { commandHome: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TERM", "TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.HOME = input.commandHome;
  return env;
}
```

- [ ] **Step 4: Run command tool tests**

Run: `corepack pnpm --filter @story-forge/tools exec vitest run src/command-tool.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/command-tool.ts packages/tools/src/command-tool.test.ts
git commit -m "feat: sanitize host command environment"
```

## Task 3: Desktop Command Home and Settings Copy

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Test: `apps/desktop/src/main/agent-coordinator.test.ts`
- Modify: `apps/desktop/src/renderer/components/settings-page.tsx`
- Test: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing desktop tests**

Add an App test asserting the command copy:

```ts
it("explains that command execution is a host guard, not an OS sandbox", async () => {
  installApi();
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

  expect(await screen.findByText(/Local commands run on this machine as your user/i))
    .toBeInTheDocument();
  expect(screen.getByText(/not an OS sandbox/i)).toBeInTheDocument();
});
```

Add an AgentCoordinator test that executes `workspace.runCommand` in `unleashed` mode and checks `HOME` contains `command-home` when wired by coordinator:

```ts
it("passes a StoryForge command home to workspace commands", async () => {
  const fixture = await createFixture();
  let requestCount = 0;
  const provider = fakeProvider(async () => {
    requestCount += 1;
    return requestCount === 1
      ? {
          content: "",
          toolCalls: [{
            id: "call_home",
            name: "workspace.runCommand",
            input: { program: "node", args: ["-e", "console.log(process.env.HOME)"] },
          }],
        }
      : { content: "Done.", toolCalls: [] };
  });
  const events: AgentEvent[] = [];
  const coordinator = new AgentCoordinator({
    providerStore: fixture.providerStore,
    sessionRepository: fixture.sessionRepository,
    workspaceRepository: fixture.workspaceRepository,
    providerFactory: { createProvider: () => provider },
    getCommandExecutionMode: async () => "unleashed",
    commandHome: join(fixture.rootDir, "command-home"),
    emit: (event) => events.push(event),
  });

  const { turnId } = await coordinator.start({ sessionId: fixture.session.id, prompt: "show home" });
  await coordinator.waitForTurn(turnId);

  expect(events).toContainEqual(expect.objectContaining({
    type: "tool.result",
    ok: true,
    output: expect.objectContaining({
      stdout: expect.stringContaining("command-home"),
    }),
  }));
});
```

- [ ] **Step 2: Run failing desktop tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop exec vitest run src/renderer/App.test.tsx -t "host guard"
corepack pnpm --filter @story-forge/desktop exec vitest run src/main/agent-coordinator.test.ts -t "command home"
```

Expected: FAIL because copy and coordinator option do not exist.

- [ ] **Step 3: Implement Settings copy**

Update the Command execution helper text in `settings-page.tsx`:

```tsx
Choose how often StoryForge asks before running host commands. Local commands run on this machine as your user; this guard is not an OS sandbox.
```

- [ ] **Step 4: Implement coordinator command home**

Update `AgentCoordinatorOptions`:

```ts
commandHome?: string;
```

Add private field and default:

```ts
private readonly commandHome: string | undefined;
this.commandHome = options.commandHome;
```

In `createRuntimeTools`:

```ts
createWorkspaceCommandTool(sandbox, {
  mode: context.settings.commandExecutionMode,
  commandHome: this.commandHome,
  requestPermission: ...
})
```

In `apps/desktop/src/main/main.ts`, pass:

```ts
commandHome: join(rootDir, "command-home"),
```

- [ ] **Step 5: Run desktop tests**

Run:

```bash
corepack pnpm --filter @story-forge/desktop exec vitest run src/renderer/App.test.tsx -t "host guard"
corepack pnpm --filter @story-forge/desktop exec vitest run src/main/agent-coordinator.test.ts -t "command home"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/agent-coordinator.ts apps/desktop/src/main/agent-coordinator.test.ts apps/desktop/src/main/main.ts apps/desktop/src/renderer/components/settings-page.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat: clarify host command guard"
```

## Task 4: Verification

**Files:**
- All files changed above.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/tools test
corepack pnpm --filter @story-forge/desktop test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/tools typecheck
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Commit fixes if needed**

If verification required small fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize command guard hardening"
```

If there are no changes after verification, do not create an empty commit.

## Self-Review

- Spec coverage: high-risk classification, `curl`/`wget` exclusion, `unleashed` bypass, sanitized env, non-user HOME, desktop command home, and Settings copy are covered.
- Placeholder scan: no unresolved markers or open-ended steps.
- Type consistency: command mode values remain `sentinel`, `cruise`, `unleashed`; new risk is `high`; command option is `commandHome`.
