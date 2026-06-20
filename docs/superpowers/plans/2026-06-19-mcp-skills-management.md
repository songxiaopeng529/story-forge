# MCP And Skills Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MCP & Skills` desktop page where Skills are installed and invoked in real agent turns, while MCP servers are configured, validated, tested, and listed without being injected into the agent tool pool.

**Architecture:** Define shared view types first, then implement focused services in the main process: `SkillService` owns installed skill storage and invocation lookup, and `McpConfigService` owns MCP JSON persistence plus test results. `AgentCoordinator` resolves explicit `/skill-name` prompts and injects an additional system message for the current turn. The renderer adds a new navigation page with `Skills` and `MCP Servers` tabs, using IPC APIs only.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Zod, Vitest, existing `atomic-json`, `@story-forge/skills`, `@story-forge/mcp`, `AgentCoordinator`, and `ToolRegistry` patterns.

---

## Scope Notes

- Use the approved spec at `docs/superpowers/specs/2026-06-19-mcp-skills-management-design.md`.
- Skills are explicitly invoked with `/skill-name`; no automatic skill matching in this plan.
- Skills are loaded as text-only system context; ignore skill frontmatter fields that grant tools, run hooks, or select subagents.
- MCP config supports JSON validation and per-server testing, but MCP tools are not registered in `AgentLoop`.
- The main process owns file selection and MCP test execution.
- Zip extraction uses a small direct dependency on `extract-zip` in `@story-forge/desktop`; tests inject a fake extractor to avoid binary zip fixtures.
- MCP protocol testing uses `@story-forge/mcp` interfaces plus a real stdio JSON-RPC tester. HTTP/SSE/WS entries validate and save, but their connection test returns an explicit unsupported-transport failure in v1.

## File Structure

- `packages/shared/src/extensions.ts`: shared view types for Skills and MCP configuration.
- `packages/shared/src/index.ts`: export extension types.
- `packages/shared/src/extensions.test.ts`: type and shape tests for extension views.
- `packages/skills/src/skill-manifest.ts`: expand parsing and skill-name normalization.
- `packages/skills/src/skill-manifest.test.ts`: parser and normalization tests.
- `packages/mcp/src/mcp-config.ts`: parse and normalize `mcpServers` JSON.
- `packages/mcp/src/mcp-config.test.ts`: MCP JSON validation tests.
- `packages/mcp/src/mcp-client.ts`: MCP client/tester interfaces and stdio JSON-RPC tester implementation.
- `packages/mcp/src/mcp-client.test.ts`: tester transport and protocol tests.
- `packages/mcp/src/index.ts`: export new MCP config and client APIs.
- `apps/desktop/package.json`: add direct dependencies on `@story-forge/skills`, `@story-forge/mcp`, and `extract-zip`.
- `apps/desktop/src/main/skill-service.ts`: installed skill storage, upload extraction, enable/disable/delete, invocation lookup.
- `apps/desktop/src/main/skill-service.test.ts`: service tests with fake extractor.
- `apps/desktop/src/main/mcp-config-service.ts`: MCP config storage and test result caching.
- `apps/desktop/src/main/mcp-config-service.test.ts`: service tests with fake MCP tester.
- `apps/desktop/src/main/agent-coordinator.ts`: skill invocation parsing and active-skill system message injection.
- `apps/desktop/src/main/agent-coordinator.test.ts`: skill invocation tests.
- `apps/desktop/src/shared/story-forge-api.ts`: IPC channel constants and `StoryForgeApi` extension APIs.
- `apps/desktop/src/preload/index.ts`: expose `skills` and `mcp` APIs.
- `apps/desktop/src/main/ipc-handlers.ts`: validate and register Skills/MCP handlers.
- `apps/desktop/src/main/ipc-handlers.test.ts`: input validation and handler tests.
- `apps/desktop/src/main/main.ts`: instantiate services and pass them to IPC/coordinator.
- `apps/desktop/src/renderer/components/mcp-skills-page.tsx`: new page UI.
- `apps/desktop/src/renderer/components/primary-navigation.tsx`: add `MCP & Skills` nav item.
- `apps/desktop/src/renderer/App.tsx`: load and route new page data.
- `apps/desktop/src/renderer/App.test.tsx`: renderer coverage for navigation, Skills, MCP save/test.

---

### Task 1: Shared Extension Types

**Files:**
- Create: `packages/shared/src/extensions.ts`
- Create: `packages/shared/src/extensions.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing shared extension tests**

Create `packages/shared/src/extensions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  McpConfigView,
  McpServerView,
  SkillView,
} from "./extensions";

describe("extension view types", () => {
  it("accepts installed skill views", () => {
    const skill = {
      id: "code-review",
      name: "code-review",
      description: "Review code changes",
      invocationName: "/code-review",
      enabled: true,
      installedAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    } satisfies SkillView;

    expect(skill.invocationName).toBe("/code-review");
  });

  it("accepts MCP config and server views", () => {
    const server = {
      name: "github",
      transport: "stdio",
      enabled: true,
      status: "success",
      lastTestedAt: "2026-06-19T00:00:00.000Z",
      tools: [{
        name: "list_issues",
        description: "List issues",
        inputSchema: { type: "object" },
      }],
    } satisfies McpServerView;
    const config = {
      schemaVersion: 1,
      rawJson: "{\"mcpServers\":{}}",
      servers: [server],
    } satisfies McpConfigView;

    expect(config.servers[0]?.tools[0]?.name).toBe("list_issues");
  });
});
```

- [ ] **Step 2: Run shared typecheck to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/shared typecheck
```

Expected: FAIL because `./extensions` does not exist.

- [ ] **Step 3: Add shared extension view types**

Create `packages/shared/src/extensions.ts`:

```ts
export type SkillView = {
  id: string;
  name: string;
  description: string;
  invocationName: `/${string}`;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
};

export type InstalledSkillRecord = SkillView & {
  rootDir: string;
  entrypointPath: string;
  body: string;
  contentHash: string;
};

export type McpTransport = "stdio" | "http" | "sse" | "ws";

export type McpToolView = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerView = {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: "untested" | "success" | "failed";
  lastTestedAt?: string;
  lastError?: string;
  tools: McpToolView[];
};

export type McpConfigView = {
  schemaVersion: 1;
  rawJson: string;
  servers: McpServerView[];
};
```

Update `packages/shared/src/index.ts`:

```ts
export * from "./events";
export * from "./extensions";
export * from "./settings";
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/shared test -- extensions.test.ts
corepack pnpm --filter @story-forge/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/shared/src/extensions.ts packages/shared/src/extensions.test.ts packages/shared/src/index.ts
git commit -m "feat: add extension view types"
```

---

### Task 2: Skill Manifest Parsing And Normalization

**Files:**
- Modify: `packages/skills/src/skill-manifest.ts`
- Modify: `packages/skills/src/skill-manifest.test.ts`

- [ ] **Step 1: Write failing skill parser tests**

Extend `packages/skills/src/skill-manifest.test.ts`:

```ts
import {
  normalizeSkillName,
  parseSkillManifest,
} from "./skill-manifest";

it("normalizes skill names for slash invocation", () => {
  expect(normalizeSkillName("Code Review")).toBe("code-review");
  expect(normalizeSkillName("  MCP.Tools_123  ")).toBe("mcp-tools-123");
});

it("rejects skill names that normalize to empty", () => {
  expect(() => normalizeSkillName("!!!")).toThrow("Skill name must contain letters or numbers");
});

it("rejects empty skill bodies", () => {
  expect(() =>
    parseSkillManifest(`---
name: empty
description: Empty skill
---

`)
  ).toThrow("Skill manifest body must not be empty");
});
```

- [ ] **Step 2: Run skills tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/skills test -- skill-manifest.test.ts
```

Expected: FAIL because `normalizeSkillName` does not exist and empty body is accepted.

- [ ] **Step 3: Implement conservative parser and normalization**

Update `packages/skills/src/skill-manifest.ts`:

```ts
export type SkillManifest = {
  name: string;
  normalizedName: string;
  invocationName: `/${string}`;
  description: string;
  body: string;
};

export function parseSkillManifest(markdown: string): SkillManifest {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Skill manifest requires frontmatter");
  }

  const [, frontmatter = "", body = ""] = match;
  const name = readFrontmatterValue(frontmatter, "name");
  const normalizedName = normalizeSkillName(name);
  const trimmedBody = body.replace(/^\n/, "");
  if (!trimmedBody.trim()) {
    throw new Error("Skill manifest body must not be empty");
  }

  return {
    name,
    normalizedName,
    invocationName: `/${normalizedName}`,
    description: readFrontmatterValue(frontmatter, "description"),
    body: trimmedBody,
  };
}

export function normalizeSkillName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Skill name must contain letters or numbers");
  }
  return normalized;
}

function readFrontmatterValue(frontmatter: string, key: string): string {
  const line = frontmatter.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) {
    throw new Error(`Skill manifest missing ${key}`);
  }

  const value = line.slice(key.length + 1).trim();
  if (!value) {
    throw new Error(`Skill manifest missing ${key}`);
  }
  return value;
}
```

Update the first existing parser assertion to expect `normalizedName` and `invocationName`:

```ts
expect(manifest).toEqual({
  name: "code-review",
  normalizedName: "code-review",
  invocationName: "/code-review",
  description: "Review code changes",
  body: "# Code Review\n\nCheck diffs and tests.\n",
});
```

- [ ] **Step 4: Run skills tests and typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/skills test -- skill-manifest.test.ts
corepack pnpm --filter @story-forge/skills typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/skills/src/skill-manifest.ts packages/skills/src/skill-manifest.test.ts
git commit -m "feat: normalize skill manifests"
```

---

### Task 3: Installed Skill Service

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/skill-service.ts`
- Create: `apps/desktop/src/main/skill-service.test.ts`

- [ ] **Step 1: Add direct zip dependency**

Run:

```bash
corepack pnpm --filter @story-forge/desktop add @story-forge/skills@workspace:* @story-forge/mcp@workspace:* extract-zip
```

Expected: `apps/desktop/package.json` gains `@story-forge/skills`, `@story-forge/mcp`, and `extract-zip`. If the command fails because of network sandboxing, rerun it with approval.

- [ ] **Step 2: Write failing SkillService tests**

Create `apps/desktop/src/main/skill-service.test.ts`:

```ts
// @vitest-environment node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SkillService } from "./skill-service";

describe("SkillService", () => {
  it("imports a skill archive through an injected extractor", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-skills-"));
    const archivePath = join(rootDir, "skill.zip");
    await writeFile(archivePath, "fake zip");
    const service = new SkillService({
      rootDir,
      extractArchive: async (_archive, destination) => {
        await mkdir(join(destination, "review"), { recursive: true });
        await writeFile(join(destination, "review", "SKILL.md"), `---
name: Code Review
description: Review code changes
---

Review the current code carefully.
`);
      },
    });

    await expect(service.importZip(archivePath)).resolves.toMatchObject({
      name: "Code Review",
      invocationName: "/code-review",
      enabled: true,
    });
    await expect(service.list()).resolves.toHaveLength(1);
    await expect(readFile(join(rootDir, "skills", "skills.json"), "utf8"))
      .resolves.toContain("code-review");
  });

  it("supports enable, disable, delete, and invocation lookup", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-skills-"));
    const archivePath = join(rootDir, "skill.zip");
    await writeFile(archivePath, "fake zip");
    const service = new SkillService({
      rootDir,
      extractArchive: async (_archive, destination) => {
        await writeFile(join(destination, "SKILL.md"), `---
name: Deploy
description: Deploy safely
---

Run the deployment checklist.
`);
      },
    });

    const installed = await service.importZip(archivePath);
    expect(await service.resolveInvocation("/deploy")).toMatchObject({ id: installed.id });
    await service.setEnabled(installed.id, false);
    await expect(service.resolveInvocation("/deploy")).resolves.toMatchObject({
      id: installed.id,
      enabled: false,
    });
    await expect(service.setEnabled(installed.id, true)).resolves.toMatchObject({ enabled: true });
    await service.remove(installed.id);
    await expect(service.list()).resolves.toEqual([]);
  });

  it("rejects archives without SKILL.md", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-skills-"));
    const archivePath = join(rootDir, "empty.zip");
    await writeFile(archivePath, "fake zip");
    const service = new SkillService({
      rootDir,
      extractArchive: async (_archive, destination) => {
        await writeFile(join(destination, "README.md"), "missing skill");
      },
    });

    await expect(service.importZip(archivePath)).rejects.toThrow("Skill archive must contain SKILL.md");
  });
});
```

- [ ] **Step 3: Run SkillService tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- skill-service.test.ts
```

Expected: FAIL because `skill-service.ts` does not exist.

- [ ] **Step 4: Implement SkillService**

Create `apps/desktop/src/main/skill-service.ts` with:

```ts
import type { InstalledSkillRecord, SkillView } from "@story-forge/shared";
import { parseSkillManifest } from "@story-forge/skills";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import extractZip from "extract-zip";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

type ExtractArchive = (archivePath: string, destination: string) => Promise<void>;

const skillRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  invocationName: z.string().startsWith("/"),
  enabled: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  rootDir: z.string(),
  entrypointPath: z.string(),
  body: z.string(),
  contentHash: z.string(),
});

const skillIndexSchema = z.object({
  schemaVersion: z.literal(1),
  skills: z.array(skillRecordSchema),
});

type SkillIndex = z.infer<typeof skillIndexSchema>;

export class SkillService {
  private readonly skillsDir: string;
  private readonly indexPath: string;
  private readonly extractArchive: ExtractArchive;

  constructor(options: {
    rootDir: string;
    extractArchive?: ExtractArchive;
  }) {
    this.skillsDir = join(options.rootDir, "skills");
    this.indexPath = join(this.skillsDir, "skills.json");
    this.extractArchive = options.extractArchive ?? ((archive, destination) =>
      extractZip(archive, { dir: destination })
    );
  }

  async list(): Promise<SkillView[]> {
    const index = await this.readIndex();
    return index.skills.map(toView);
  }

  async importZip(archivePath: string): Promise<SkillView> {
    const stagingDir = join(this.skillsDir, `.import-${process.pid}-${Date.now()}`);
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });
    try {
      await this.extractArchive(archivePath, stagingDir);
      const entrypointPath = await findSkillEntrypoint(stagingDir);
      const markdown = await readFile(entrypointPath, "utf8");
      const manifest = parseSkillManifest(markdown);
      const now = new Date().toISOString();
      const contentHash = createHash("sha256").update(markdown).digest("hex").slice(0, 12);
      const id = manifest.normalizedName;
      const rootDir = join(this.skillsDir, id);
      await rm(rootDir, { recursive: true, force: true });
      await mkdir(rootDir, { recursive: true });
      await cp(dirname(entrypointPath), rootDir, { recursive: true });

      const index = await this.readIndex();
      const existing = index.skills.find((skill) => skill.id === id);
      const record: InstalledSkillRecord = {
        id,
        name: manifest.name,
        description: manifest.description,
        invocationName: manifest.invocationName,
        enabled: existing?.enabled ?? true,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        rootDir,
        entrypointPath: join(rootDir, "SKILL.md"),
        body: manifest.body,
        contentHash,
      };
      await this.writeIndex({
        schemaVersion: 1,
        skills: [...index.skills.filter((skill) => skill.id !== id), record],
      });
      return toView(record);
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillView> {
    const index = await this.readIndex();
    const skill = index.skills.find((candidate) => candidate.id === skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    const updated = { ...skill, enabled, updatedAt: new Date().toISOString() };
    await this.writeIndex({
      schemaVersion: 1,
      skills: index.skills.map((candidate) => candidate.id === skillId ? updated : candidate),
    });
    return toView(updated);
  }

  async remove(skillId: string): Promise<void> {
    const index = await this.readIndex();
    const skill = index.skills.find((candidate) => candidate.id === skillId);
    await this.writeIndex({
      schemaVersion: 1,
      skills: index.skills.filter((candidate) => candidate.id !== skillId),
    });
    if (skill) {
      await rm(skill.rootDir, { recursive: true, force: true });
    }
  }

  async resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined> {
    const index = await this.readIndex();
    return index.skills.find((skill) => skill.invocationName === command);
  }

  private readIndex(): Promise<SkillIndex> {
    return readJson(this.indexPath, skillIndexSchema, { schemaVersion: 1, skills: [] });
  }

  private async writeIndex(index: SkillIndex): Promise<void> {
    await writeJsonAtomic(this.indexPath, index);
  }
}

function toView(record: InstalledSkillRecord): SkillView {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    invocationName: record.invocationName,
    enabled: record.enabled,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
  };
}

async function findSkillEntrypoint(rootDir: string): Promise<string> {
  const candidates = [
    join(rootDir, "SKILL.md"),
    ...await findNestedSkillEntrypoints(rootDir),
  ];
  const entrypoint = candidates[0];
  if (!entrypoint) {
    throw new Error("Skill archive must contain SKILL.md");
  }
  return entrypoint;
}

async function findNestedSkillEntrypoints(rootDir: string): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  const entries = await readdir(rootDir);
  const candidates: string[] = [];
  for (const entry of entries) {
    const path = join(rootDir, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      const candidate = join(path, "SKILL.md");
      try {
        await stat(candidate);
        candidates.push(candidate);
      } catch {
        continue;
      }
    }
  }
  return candidates;
}

```

- [ ] **Step 5: Run SkillService tests and typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- skill-service.test.ts
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/main/skill-service.ts apps/desktop/src/main/skill-service.test.ts
git commit -m "feat: persist installed skills"
```

---

### Task 4: Skill Invocation In AgentCoordinator

**Files:**
- Modify: `apps/desktop/src/main/agent-coordinator.ts`
- Modify: `apps/desktop/src/main/agent-coordinator.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

Add to `apps/desktop/src/main/agent-coordinator.test.ts`:

```ts
it("injects an enabled slash-invoked skill as a system message", async () => {
  const fixture = await createFixture();
  const requests: Parameters<ModelProvider["chat"]>[0]["messages"][] = [];
  const coordinator = new AgentCoordinator({
    providerStore: fixture.providerStore,
    sessionRepository: fixture.sessionRepository,
    workspaceRepository: fixture.workspaceRepository,
    providerFactory: {
      createProvider: () => fakeProvider(async (messages) => {
        requests.push(messages);
        return { content: "Reviewed", toolCalls: [] };
      }),
    },
    skillResolver: {
      resolveInvocation: async (command) => command === "/code-review"
        ? {
            id: "code-review",
            name: "Code Review",
            description: "Review code",
            invocationName: "/code-review",
            enabled: true,
            installedAt: "2026-06-19T00:00:00.000Z",
            updatedAt: "2026-06-19T00:00:00.000Z",
            rootDir: "/tmp/skill",
            entrypointPath: "/tmp/skill/SKILL.md",
            body: "Review regressions and missing tests.",
            contentHash: "hash",
          }
        : undefined,
    },
    emit: () => undefined,
  });

  const { turnId } = await coordinator.start({
    sessionId: fixture.session.id,
    prompt: "/code-review focus on regressions",
  });
  await coordinator.waitForTurn(turnId);

  expect(requests[0]).toContainEqual(expect.objectContaining({
    role: "system",
    content: expect.stringContaining("Active StoryForge skill: Code Review"),
  }));
  expect(requests[0]).toContainEqual(expect.objectContaining({
    role: "user",
    content: "/code-review focus on regressions",
  }));
});

it("rejects unknown slash skill invocations before appending a user message", async () => {
  const fixture = await createFixture();
  const coordinator = new AgentCoordinator({
    providerStore: fixture.providerStore,
    sessionRepository: fixture.sessionRepository,
    workspaceRepository: fixture.workspaceRepository,
    providerFactory: {
      createProvider: () => fakeProvider(async () => ({ content: "unexpected", toolCalls: [] })),
    },
    skillResolver: { resolveInvocation: async () => undefined },
    emit: () => undefined,
  });

  await expect(coordinator.start({
    sessionId: fixture.session.id,
    prompt: "/missing do work",
  })).rejects.toThrow("Skill not found: /missing");
  await expect(fixture.sessionRepository.get(fixture.session.id))
    .resolves.toMatchObject({ messages: [] });
});

it("rejects disabled slash skill invocations with a distinct error", async () => {
  const fixture = await createFixture();
  const coordinator = new AgentCoordinator({
    providerStore: fixture.providerStore,
    sessionRepository: fixture.sessionRepository,
    workspaceRepository: fixture.workspaceRepository,
    providerFactory: {
      createProvider: () => fakeProvider(async () => ({ content: "unexpected", toolCalls: [] })),
    },
    skillResolver: {
      resolveInvocation: async () => ({
        id: "code-review",
        name: "Code Review",
        description: "Review code",
        invocationName: "/code-review",
        enabled: false,
        installedAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:00.000Z",
        rootDir: "/tmp/skill",
        entrypointPath: "/tmp/skill/SKILL.md",
        body: "Review regressions and missing tests.",
        contentHash: "hash",
      }),
    },
    emit: () => undefined,
  });

  await expect(coordinator.start({
    sessionId: fixture.session.id,
    prompt: "/code-review focus on regressions",
  })).rejects.toThrow("Skill is disabled: /code-review");
  await expect(fixture.sessionRepository.get(fixture.session.id))
    .resolves.toMatchObject({ messages: [] });
});
```

- [ ] **Step 2: Run coordinator tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- agent-coordinator.test.ts
```

Expected: FAIL because `skillResolver` option does not exist and skill injection is missing.

- [ ] **Step 3: Add skill resolver option and prompt parsing**

Modify `apps/desktop/src/main/agent-coordinator.ts`:

```ts
import type { InstalledSkillRecord } from "@story-forge/shared";

export type SkillInvocationResolver = {
  resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined>;
};

export type AgentCoordinatorOptions = {
  // existing fields
  skillResolver?: SkillInvocationResolver;
};
```

Add a private field and constructor default:

```ts
private readonly skillResolver: SkillInvocationResolver | undefined;

this.skillResolver = options.skillResolver;
```

At the top of `start()` after prompt trimming validation and before `appendMessage()`:

```ts
const skillInvocation = await this.resolveSkillInvocation(input.prompt);
```

Pass it into `executeTurn(session, turnId, controller.signal, skillInvocation)`.

Update `executeTurn` signature:

```ts
private async executeTurn(
  session: SessionRecord,
  turnId: TurnId,
  signal: AbortSignal,
  skillInvocation: ActiveSkillInvocation | undefined,
): Promise<void>
```

Add helper types and functions near other helpers:

```ts
type ActiveSkillInvocation = {
  skill: InstalledSkillRecord;
  argumentsText: string;
};

private async resolveSkillInvocation(prompt: string): Promise<ActiveSkillInvocation | undefined> {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const [command = "", ...argumentParts] = trimmed.split(/\s+/);
  if (!command || command === "/") {
    return undefined;
  }
  const skill = await this.skillResolver?.resolveInvocation(command);
  if (!skill) {
    throw new Error(`Skill not found: ${command}`);
  }
  if (!skill.enabled) {
    throw new Error(`Skill is disabled: ${command}`);
  }
  return {
    skill,
    argumentsText: argumentParts.join(" "),
  };
}

function createSkillSystemMessage(invocation: ActiveSkillInvocation): ChatMessage {
  return {
    role: "system",
    content: [
      `Active StoryForge skill: ${invocation.skill.name}`,
      "",
      `Invocation: ${invocation.skill.invocationName}`,
      `Arguments: ${invocation.argumentsText}`,
      "",
      "Follow this skill for the current turn. The skill instructions apply in addition to StoryForge's normal coding-agent rules. If the skill conflicts with higher-priority system instructions, follow the higher-priority instructions.",
      "",
      invocation.skill.body,
    ].join("\n"),
  };
}
```

In the `messages` array passed to `loop.run`, insert:

```ts
...(skillInvocation ? [createSkillSystemMessage(skillInvocation)] : []),
```

between the base system message and persisted messages.

- [ ] **Step 4: Run coordinator tests and desktop typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- agent-coordinator.test.ts
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/desktop/src/main/agent-coordinator.ts apps/desktop/src/main/agent-coordinator.test.ts
git commit -m "feat: invoke skills in agent turns"
```

---

### Task 5: MCP Config Package And Service

**Files:**
- Create: `packages/mcp/src/mcp-config.ts`
- Create: `packages/mcp/src/mcp-config.test.ts`
- Create: `packages/mcp/src/mcp-client.ts`
- Create: `packages/mcp/src/mcp-client.test.ts`
- Modify: `packages/mcp/src/index.ts`
- Create: `apps/desktop/src/main/mcp-config-service.ts`
- Create: `apps/desktop/src/main/mcp-config-service.test.ts`

- [ ] **Step 1: Write failing MCP package tests**

Create `packages/mcp/src/mcp-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMcpConfig } from "./mcp-config";

describe("parseMcpConfig", () => {
  it("normalizes stdio and http mcpServers entries", () => {
    const config = parseMcpConfig(JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "server"], env: { TOKEN: "$TOKEN" } },
        docs: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    }));

    expect(config.servers).toEqual([
      expect.objectContaining({ name: "github", transport: "stdio", status: "untested" }),
      expect.objectContaining({ name: "docs", transport: "http", status: "untested" }),
    ]);
  });

  it("rejects invalid JSON and invalid server shapes", () => {
    expect(() => parseMcpConfig("{")).toThrow("Invalid MCP JSON");
    expect(() => parseMcpConfig(JSON.stringify({ mcpServers: { bad: { args: [] } } })))
      .toThrow("MCP server bad must define command or url");
  });
});
```

Create `packages/mcp/src/mcp-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NodeMcpConnectionTester } from "./mcp-client";

describe("NodeMcpConnectionTester", () => {
  it("fails explicitly for unsupported transports", async () => {
    await expect(new NodeMcpConnectionTester().testServer({
      name: "docs",
      transport: "http",
      raw: { url: "https://example.com/mcp" },
    })).rejects.toThrow("MCP transport not supported for testing yet: http");
  });

  it("lists tools from a stdio MCP server", async () => {
    const script = `
      const tools = [{ name: "search", description: "Search docs", inputSchema: { type: "object" } }];
      let buffer = Buffer.alloc(0);
      process.stdin.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
          if (headerEnd === -1) return;
          const header = buffer.subarray(0, headerEnd).toString("utf8");
          const match = header.match(/Content-Length: (\\d+)/i);
          if (!match) return;
          const length = Number(match[1]);
          const bodyStart = headerEnd + 4;
          const bodyEnd = bodyStart + length;
          if (buffer.length < bodyEnd) return;
          const request = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
          buffer = buffer.subarray(bodyEnd);
          if (request.method === "initialize") {
            respond(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } });
          } else if (request.method === "tools/list") {
            respond(request.id, { tools });
          }
        }
      });
      function respond(id, result) {
        const body = JSON.stringify({ jsonrpc: "2.0", id, result });
        process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
      }
    `;

    await expect(new NodeMcpConnectionTester({ timeoutMs: 2_000 }).testServer({
      name: "fixture",
      transport: "stdio",
      raw: { command: process.execPath, args: ["-e", script] },
    })).resolves.toEqual({
      tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object" } }],
    });
  });
});
```

- [ ] **Step 2: Run MCP package tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/mcp test -- mcp-config.test.ts mcp-client.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement MCP config parser and tester interface**

Create `packages/mcp/src/mcp-config.ts`:

```ts
import type { McpConfigView, McpServerView, McpTransport } from "@story-forge/shared";

export type ParsedMcpServer = {
  name: string;
  transport: McpTransport;
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
    const transport = inferTransport(name, record);
    return { name, transport, raw: record };
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
    enabled: true,
    status: "untested",
    tools: [],
  };
}
```

Create `packages/mcp/src/mcp-client.ts`:

```ts
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
    const command = typeof server.raw.command === "string" ? server.raw.command : "";
    if (!command) {
      throw new Error(`MCP server ${server.name} must define command`);
    }
    const client = new StdioMcpJsonRpcClient({
      command,
      args: Array.isArray(server.raw.args) ? server.raw.args.filter((arg): arg is string => typeof arg === "string") : [],
      env: readStringEnv(server.raw.env),
      timeoutMs: this.options.timeoutMs ?? 10_000,
    });
    try {
      await client.initialize();
      const tools = await client.listTools();
      return { tools };
    } finally {
      client.close();
    }
  }
}

class StdioMcpJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();

  constructor(private readonly options: {
    command: string;
    args: string[];
    env: Record<string, string>;
    timeoutMs: number;
  }) {
    this.child = spawn(options.command, options.args, {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
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
    const result = await this.request("tools/list", {});
    return normalizeToolsResult(result);
  }

  close(): void {
    this.child.kill();
  }

  // Private methods below perform Content-Length framing, request correlation,
  // timeout cleanup, JSON-RPC error rejection, child-exit rejection, and stderr
  // collection for readable connection failures.
}
```

Update `packages/mcp/src/index.ts`:

```ts
export * from "./mcp-client";
export * from "./mcp-config";
```

- [ ] **Step 4: Run MCP package tests and typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/mcp test -- mcp-config.test.ts mcp-client.test.ts
corepack pnpm --filter @story-forge/mcp typecheck
```

Expected: PASS.

- [ ] **Step 5: Write failing MCP config service tests**

Create `apps/desktop/src/main/mcp-config-service.test.ts`:

```ts
// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpConfigService } from "./mcp-config-service";

describe("McpConfigService", () => {
  it("saves config and normalizes server views", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-mcp-"));
    const service = new McpConfigService({ rootDir });

    await expect(service.saveRawJson(JSON.stringify({
      mcpServers: { github: { command: "npx", args: ["server"] } },
    }))).resolves.toMatchObject({
      schemaVersion: 1,
      servers: [expect.objectContaining({ name: "github", transport: "stdio" })],
    });
  });

  it("tests a server and caches returned tools", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-mcp-"));
    const service = new McpConfigService({
      rootDir,
      tester: {
        testServer: async () => ({
          tools: [{ name: "list_issues", description: "List issues", inputSchema: { type: "object" } }],
        }),
      },
    });
    await service.saveRawJson(JSON.stringify({
      mcpServers: { github: { command: "npx", args: ["server"] } },
    }));

    await expect(service.testServer("github")).resolves.toMatchObject({
      name: "github",
      status: "success",
      tools: [expect.objectContaining({ name: "list_issues" })],
    });
    await expect(service.get()).resolves.toMatchObject({
      servers: [expect.objectContaining({ status: "success" })],
    });
  });

  it("stores a redacted failure when testing fails", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-mcp-"));
    const service = new McpConfigService({
      rootDir,
      tester: { testServer: async () => { throw new Error("bad secret-value"); } },
    });
    await service.saveRawJson(JSON.stringify({
      mcpServers: { github: { command: "npx", env: { TOKEN: "secret-value" } } },
    }));

    await expect(service.testServer("github")).resolves.toMatchObject({
      status: "failed",
      lastError: "bad [REDACTED]",
    });
  });
});
```

- [ ] **Step 6: Run MCP service tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- mcp-config-service.test.ts
```

Expected: FAIL because `mcp-config-service.ts` does not exist.

- [ ] **Step 7: Implement MCP config service**

Create `apps/desktop/src/main/mcp-config-service.ts`:

```ts
import {
  NodeMcpConnectionTester,
  parseMcpConfig,
  type McpConnectionTester,
} from "@story-forge/mcp";
import type { McpConfigView, McpServerView } from "@story-forge/shared";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

const mcpToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});

const mcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "http", "sse", "ws"]),
  enabled: z.boolean(),
  status: z.enum(["untested", "success", "failed"]),
  lastTestedAt: z.string().optional(),
  lastError: z.string().optional(),
  tools: z.array(mcpToolSchema),
});

const mcpConfigSchema = z.object({
  schemaVersion: z.literal(1),
  rawJson: z.string(),
  servers: z.array(mcpServerSchema),
});

const defaultRawJson = JSON.stringify({ mcpServers: {} }, null, 2);

export class McpConfigService {
  private readonly configPath: string;
  private readonly tester: McpConnectionTester;

  constructor(options: {
    rootDir: string;
    tester?: McpConnectionTester;
  }) {
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
      return existing ? { ...server, status: existing.status, lastTestedAt: existing.lastTestedAt, lastError: existing.lastError, tools: existing.tools } : server;
    });
    const view = { schemaVersion: 1 as const, rawJson, servers };
    await writeJsonAtomic(this.configPath, view);
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
        enabled: existing?.enabled ?? true,
        status: "success",
        lastTestedAt: now,
        tools: result.tools,
      };
    } catch (error) {
      updated = {
        name,
        transport: parsedServer.transport,
        enabled: existing?.enabled ?? true,
        status: "failed",
        lastTestedAt: now,
        lastError: redactKnownEnvValues(error instanceof Error ? error.message : String(error), parsedServer.raw),
        tools: [],
      };
    }
    const next = {
      schemaVersion: 1 as const,
      rawJson: current.rawJson,
      servers: current.servers.map((server) => server.name === name ? updated : server),
    };
    await writeJsonAtomic(this.configPath, next);
    return updated;
  }
}

function redactKnownEnvValues(message: string, raw: Record<string, unknown>): string {
  const env = raw.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return message;
  }
  return Object.values(env).reduce((current, value) =>
    typeof value === "string" && value ? current.split(value).join("[REDACTED]") : current,
  message);
}
```

- [ ] **Step 8: Run MCP service tests and typechecks**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- mcp-config-service.test.ts
corepack pnpm --filter @story-forge/mcp typecheck
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add packages/mcp/src/mcp-config.ts packages/mcp/src/mcp-config.test.ts packages/mcp/src/mcp-client.ts packages/mcp/src/mcp-client.test.ts packages/mcp/src/index.ts apps/desktop/src/main/mcp-config-service.ts apps/desktop/src/main/mcp-config-service.test.ts
git commit -m "feat: manage mcp server config"
```

---

### Task 6: IPC, Preload, And Main Wiring

**Files:**
- Modify: `apps/desktop/src/shared/story-forge-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Write failing IPC handler tests**

Extend `apps/desktop/src/main/ipc-handlers.test.ts` fixture with `skills` and `mcp` service fakes:

```ts
const skills = {
  list: vi.fn(async () => []),
  importZip: vi.fn(async () => ({
    id: "code-review",
    name: "Code Review",
    description: "Review code",
    invocationName: "/code-review",
    enabled: true,
    installedAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
  })),
  setEnabled: vi.fn(async ({ skillId, enabled }) => ({
    id: skillId,
    name: "Code Review",
    description: "Review code",
    invocationName: "/code-review",
    enabled,
    installedAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
  })),
  remove: vi.fn(async () => undefined),
};
const mcp = {
  get: vi.fn(async () => ({ schemaVersion: 1 as const, rawJson: "{\"mcpServers\":{}}", servers: [] })),
  saveRawJson: vi.fn(async (rawJson: string) => ({ schemaVersion: 1 as const, rawJson, servers: [] })),
  testServer: vi.fn(async (name: string) => ({
    name,
    transport: "stdio" as const,
    enabled: true,
    status: "success" as const,
    tools: [],
  })),
};
```

Add assertions:

```ts
expect(fixture.handlers.has(IPC_CHANNELS.skillsList)).toBe(true);
expect(fixture.handlers.has(IPC_CHANNELS.mcpGet)).toBe(true);
await expect(fixture.invoke(IPC_CHANNELS.skillsSetEnabled, {
  skillId: "code-review",
  enabled: false,
})).resolves.toMatchObject({ enabled: false });
await expect(fixture.invoke(IPC_CHANNELS.mcpSave, {
  rawJson: "{\"mcpServers\":{}}",
})).resolves.toMatchObject({ schemaVersion: 1 });
await expect(fixture.invoke(IPC_CHANNELS.mcpTestServer, "github"))
  .resolves.toMatchObject({ name: "github" });
await expect(fixture.invoke(IPC_CHANNELS.skillsSetEnabled, {
  skillId: "",
  enabled: false,
})).rejects.toThrow("Invalid IPC payload");
```

- [ ] **Step 2: Run IPC tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- ipc-handlers.test.ts
```

Expected: FAIL because new channels/services do not exist.

- [ ] **Step 3: Extend API contracts**

Update `apps/desktop/src/shared/story-forge-api.ts` imports:

```ts
import type {
  AgentEvent,
  AgentStopReason,
  AppSettingsView,
  McpConfigView,
  McpServerView,
  ResponseMode,
  SessionId,
  SkillView,
  TurnId,
} from "@story-forge/shared";
```

Add channels:

```ts
skillsList: "story-forge:skills:list",
skillsImportZip: "story-forge:skills:import-zip",
skillsSetEnabled: "story-forge:skills:set-enabled",
skillsRemove: "story-forge:skills:remove",
mcpGet: "story-forge:mcp:get",
mcpSave: "story-forge:mcp:save",
mcpTestServer: "story-forge:mcp:test-server",
```

Add API groups:

```ts
skills: {
  list(): Promise<SkillView[]>;
  importZip(): Promise<SkillView | undefined>;
  setEnabled(input: { skillId: string; enabled: boolean }): Promise<SkillView>;
  remove(skillId: string): Promise<void>;
};
mcp: {
  get(): Promise<McpConfigView>;
  save(input: { rawJson: string }): Promise<McpConfigView>;
  testServer(name: string): Promise<McpServerView>;
};
```

- [ ] **Step 4: Extend preload API**

Update `apps/desktop/src/preload/index.ts`:

```ts
skills: {
  list: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList),
  importZip: () => ipcRenderer.invoke(IPC_CHANNELS.skillsImportZip),
  setEnabled: (input) => ipcRenderer.invoke(IPC_CHANNELS.skillsSetEnabled, input),
  remove: (skillId) => ipcRenderer.invoke(IPC_CHANNELS.skillsRemove, skillId),
},
mcp: {
  get: () => ipcRenderer.invoke(IPC_CHANNELS.mcpGet),
  save: (input) => ipcRenderer.invoke(IPC_CHANNELS.mcpSave, input),
  testServer: (name) => ipcRenderer.invoke(IPC_CHANNELS.mcpTestServer, name),
},
```

- [ ] **Step 5: Wire IPC handlers**

In `apps/desktop/src/main/ipc-handlers.ts`, import service types:

```ts
import type { McpConfigService } from "./mcp-config-service";
import type { SkillService } from "./skill-service";
```

Add options:

```ts
skills: SkillService;
mcp: McpConfigService;
selectSkillArchive: () => Promise<string | undefined>;
```

Add schemas:

```ts
const skillIdSchema = z.string().min(1);
const skillEnabledSchema = z.object({ skillId: skillIdSchema, enabled: z.boolean() });
const mcpSaveSchema = z.object({ rawJson: z.string().min(1) });
const mcpServerNameSchema = z.string().min(1);
```

Register handlers:

```ts
handle(options.ipc, IPC_CHANNELS.skillsList, z.undefined(), () => options.skills.list());
handle(options.ipc, IPC_CHANNELS.skillsImportZip, z.undefined(), async () => {
  const archivePath = await options.selectSkillArchive();
  return archivePath ? options.skills.importZip(archivePath) : undefined;
});
handle(options.ipc, IPC_CHANNELS.skillsSetEnabled, skillEnabledSchema, (input) =>
  options.skills.setEnabled(input.skillId, input.enabled)
);
handle(options.ipc, IPC_CHANNELS.skillsRemove, skillIdSchema, (skillId) =>
  options.skills.remove(skillId)
);
handle(options.ipc, IPC_CHANNELS.mcpGet, z.undefined(), () => options.mcp.get());
handle(options.ipc, IPC_CHANNELS.mcpSave, mcpSaveSchema, (input) =>
  options.mcp.saveRawJson(input.rawJson)
);
handle(options.ipc, IPC_CHANNELS.mcpTestServer, mcpServerNameSchema, (name) =>
  options.mcp.testServer(name)
);
```

- [ ] **Step 6: Wire main process**

Update `apps/desktop/src/main/main.ts`:

```ts
import { McpConfigService } from "./mcp-config-service";
import { SkillService } from "./skill-service";
```

Instantiate:

```ts
const skillService = new SkillService({ rootDir });
const mcpConfigService = new McpConfigService({ rootDir });
```

Pass `skillResolver: skillService` into `AgentCoordinator`.

Pass `skills`, `mcp`, and `selectSkillArchive` into `registerIpcHandlers`:

```ts
skills: skillService,
mcp: mcpConfigService,
selectSkillArchive: async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Skill archives", extensions: ["zip"] }],
    title: "Import StoryForge skill",
  });
  return result.canceled ? undefined : result.filePaths[0];
},
```

- [ ] **Step 7: Run IPC tests and desktop typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- ipc-handlers.test.ts
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/desktop/src/shared/story-forge-api.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/ipc-handlers.ts apps/desktop/src/main/ipc-handlers.test.ts apps/desktop/src/main/main.ts apps/desktop/src/renderer/story-forge-bridge.d.ts
git commit -m "feat: expose mcp and skills ipc"
```

---

### Task 7: Renderer MCP & Skills Page

**Files:**
- Create: `apps/desktop/src/renderer/components/mcp-skills-page.tsx`
- Modify: `apps/desktop/src/renderer/components/primary-navigation.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Extend `installApi()` in `apps/desktop/src/renderer/App.test.tsx` with fake `skills` and `mcp` APIs:

```ts
const skills = options.skills ?? [{
  id: "code-review",
  name: "Code Review",
  description: "Review code",
  invocationName: "/code-review",
  enabled: true,
  installedAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
}];
const mcpConfig = options.mcpConfig ?? {
  schemaVersion: 1 as const,
  rawJson: JSON.stringify({ mcpServers: { github: { command: "npx" } } }, null, 2),
  servers: [{
    name: "github",
    transport: "stdio" as const,
    enabled: true,
    status: "untested" as const,
    tools: [],
  }],
};
const listSkills = vi.fn(async () => skills);
const importSkill = vi.fn(async () => skills[0]);
const setSkillEnabled = vi.fn(async ({ skillId, enabled }) => ({ ...skills[0], id: skillId, enabled }));
const removeSkill = vi.fn(async () => undefined);
const getMcp = vi.fn(async () => mcpConfig);
const saveMcp = vi.fn(async ({ rawJson }) => ({ ...mcpConfig, rawJson }));
const testMcpServer = vi.fn(async (name) => ({
  name,
  transport: "stdio" as const,
  enabled: true,
  status: "success" as const,
  tools: [{ name: "list_issues", description: "List issues", inputSchema: { type: "object" } }],
}));
```

Add tests:

```ts
it("opens the MCP & Skills page and lists installed skills", async () => {
  const fixture = installApi();
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "MCP & Skills" }));

  expect(await screen.findByText("Code Review")).toBeInTheDocument();
  expect(screen.getByText("/code-review")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Enable Code Review" }));
  await waitFor(() => expect(fixture.setSkillEnabled).toHaveBeenCalledWith({
    skillId: "code-review",
    enabled: false,
  }));
});

it("imports skills from a zip archive", async () => {
  const fixture = installApi();
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "MCP & Skills" }));
  fireEvent.click(await screen.findByRole("button", { name: "Upload skill" }));

  await waitFor(() => expect(fixture.importSkill).toHaveBeenCalled());
});

it("saves MCP JSON and tests a server", async () => {
  const fixture = installApi();
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "MCP & Skills" }));
  fireEvent.click(await screen.findByRole("tab", { name: "MCP Servers" }));
  const editor = await screen.findByLabelText("MCP JSON configuration");
  fireEvent.change(editor, { target: { value: "{\"mcpServers\":{}}" } });
  fireEvent.click(screen.getByRole("button", { name: "Save MCP config" }));
  await waitFor(() => expect(fixture.saveMcp).toHaveBeenCalledWith({
    rawJson: "{\"mcpServers\":{}}",
  }));

  fireEvent.click(screen.getByRole("button", { name: "Test github" }));
  expect(await screen.findByText("list_issues")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run App tests to verify failure**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
```

Expected: FAIL because the page and API fakes do not exist.

- [ ] **Step 3: Add navigation page type**

Update `apps/desktop/src/renderer/components/primary-navigation.tsx`:

```ts
import { Bot, KeyRound, Puzzle, Settings } from "lucide-react";

export type Page = "agent" | "models" | "extensions" | "settings";
```

Add the nav button between Models and Settings:

```tsx
<NavButton
  active={props.page === "extensions"}
  icon={<Puzzle size={17} />}
  label="MCP & Skills"
  onClick={() => props.onChange("extensions")}
/>
```

- [ ] **Step 4: Create MCP & Skills page component**

Create `apps/desktop/src/renderer/components/mcp-skills-page.tsx`:

```tsx
import type { McpConfigView, SkillView } from "@story-forge/shared";
import { Upload } from "lucide-react";
import { useState } from "react";

export function McpSkillsPage(props: {
  skills: SkillView[];
  mcpConfig: McpConfigView | undefined;
  loading: boolean;
  saving: boolean;
  error: string | undefined;
  onUploadSkill: () => void;
  onSkillEnabledChange: (skillId: string, enabled: boolean) => void;
  onRemoveSkill: (skillId: string) => void;
  onMcpJsonChange: (rawJson: string) => void;
  onSaveMcp: () => void;
  onTestMcpServer: (name: string) => void;
}) {
  const [tab, setTab] = useState<"skills" | "mcp">("skills");
  return (
    <section className="min-h-0 min-w-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-xl font-semibold">MCP & Skills</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage callable skills and MCP server configuration.
        </p>
        <div className="mt-6 flex gap-2 border-b border-forge-line">
          <button className={tab === "skills" ? "border-b-2 border-forge-ember px-3 py-2 text-sm font-semibold text-forge-ember" : "px-3 py-2 text-sm text-slate-600"} onClick={() => setTab("skills")} role="tab" type="button">Skills</button>
          <button className={tab === "mcp" ? "border-b-2 border-forge-ember px-3 py-2 text-sm font-semibold text-forge-ember" : "px-3 py-2 text-sm text-slate-600"} onClick={() => setTab("mcp")} role="tab" type="button">MCP Servers</button>
        </div>
        {props.error ? <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{props.error}</div> : null}
        {tab === "skills" ? (
          <div className="mt-5">
            <button className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white" onClick={props.onUploadSkill} type="button">
              <Upload size={15} />
              Upload skill
            </button>
            <div className="mt-4 divide-y divide-forge-line rounded-lg border border-forge-line bg-white">
              {props.skills.length ? props.skills.map((skill) => (
                <div className="flex items-center justify-between gap-4 p-4" key={skill.id}>
                  <div className="min-w-0">
                    <div className="font-semibold">{skill.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{skill.description}</div>
                    <div className="mt-1 font-mono text-xs text-slate-500">{skill.invocationName}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input aria-label={`Enable ${skill.name}`} checked={skill.enabled} onChange={(event) => props.onSkillEnabledChange(skill.id, event.currentTarget.checked)} role="switch" type="checkbox" />
                    <button className="secondary-button" onClick={() => props.onRemoveSkill(skill.id)} type="button">Delete</button>
                  </div>
                </div>
              )) : <div className="p-5 text-sm text-slate-500">Upload a zip archive containing SKILL.md.</div>}
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px]">
            <div>
              <textarea aria-label="MCP JSON configuration" className="h-[420px] w-full rounded-lg border border-forge-line bg-white p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-orange-200" onChange={(event) => props.onMcpJsonChange(event.currentTarget.value)} value={props.mcpConfig?.rawJson ?? ""} />
              <button className="mt-3 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={props.saving} onClick={props.onSaveMcp} type="button">Save MCP config</button>
            </div>
            <div className="space-y-3">
              {(props.mcpConfig?.servers ?? []).map((server) => (
                <div className="rounded-lg border border-forge-line bg-white p-3" key={server.name}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{server.name}</div>
                      <div className="text-xs text-slate-500">{server.transport} / {server.status}</div>
                    </div>
                    <button className="secondary-button" onClick={() => props.onTestMcpServer(server.name)} type="button">Test {server.name}</button>
                  </div>
                  {server.lastError ? <div className="mt-2 text-xs text-red-600">{server.lastError}</div> : null}
                  {server.tools.length ? (
                    <div className="mt-3 space-y-1">
                      {server.tools.map((tool) => <div className="rounded bg-slate-50 px-2 py-1 text-xs" key={tool.name}>{tool.name}</div>)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire renderer state in App**

In `apps/desktop/src/renderer/App.tsx`, import shared types and page:

```ts
import type { McpConfigView, SkillView } from "@story-forge/shared";
import { McpSkillsPage } from "./components/mcp-skills-page";
```

Add state:

```ts
const [skills, setSkills] = useState<SkillView[]>([]);
const [mcpConfig, setMcpConfig] = useState<McpConfigView>();
const [extensionsLoading, setExtensionsLoading] = useState(false);
const [extensionsSaving, setExtensionsSaving] = useState(false);
```

Add loader:

```ts
async function loadExtensions(): Promise<void> {
  setExtensionsLoading(true);
  try {
    const [nextSkills, nextMcp] = await Promise.all([
      window.storyForge.skills.list(),
      window.storyForge.mcp.get(),
    ]);
    setSkills(nextSkills);
    setMcpConfig(nextMcp);
  } catch (extensionsError) {
    setError(formatError(extensionsError));
  } finally {
    setExtensionsLoading(false);
  }
}
```

When `page === "extensions"`, render `McpSkillsPage` and call `loadExtensions()` from the nav handler or a `useEffect` watching `page`.

Add handlers:

```ts
async function uploadSkill(): Promise<void> {
  try {
    const imported = await window.storyForge.skills.importZip();
    if (imported) {
      setSkills((current) => [...current.filter((skill) => skill.id !== imported.id), imported]);
    }
  } catch (skillError) {
    setError(formatError(skillError));
  }
}

async function setSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
  try {
    const updated = await window.storyForge.skills.setEnabled({ skillId, enabled });
    setSkills((current) => current.map((skill) => skill.id === skillId ? updated : skill));
  } catch (skillError) {
    setError(formatError(skillError));
  }
}

async function removeSkill(skillId: string): Promise<void> {
  try {
    await window.storyForge.skills.remove(skillId);
    setSkills((current) => current.filter((skill) => skill.id !== skillId));
  } catch (skillError) {
    setError(formatError(skillError));
  }
}

async function saveMcp(): Promise<void> {
  if (!mcpConfig) {
    return;
  }
  setExtensionsSaving(true);
  try {
    setMcpConfig(await window.storyForge.mcp.save({ rawJson: mcpConfig.rawJson }));
  } catch (mcpError) {
    setError(formatError(mcpError));
  } finally {
    setExtensionsSaving(false);
  }
}

async function testMcpServer(name: string): Promise<void> {
  try {
    const tested = await window.storyForge.mcp.testServer(name);
    setMcpConfig((current) => current ? {
      ...current,
      servers: current.servers.map((server) => server.name === name ? tested : server),
    } : current);
  } catch (mcpError) {
    setError(formatError(mcpError));
  }
}
```

- [ ] **Step 6: Run App tests and typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test -- App.test.tsx
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add apps/desktop/src/renderer/components/mcp-skills-page.tsx apps/desktop/src/renderer/components/primary-navigation.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat: add mcp and skills page"
```

---

### Task 8: Integration Verification And Dev Restart

**Files:**
- Modify only planned files if verification exposes issues.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/shared test
corepack pnpm --filter @story-forge/skills test
corepack pnpm --filter @story-forge/mcp test
corepack pnpm --filter @story-forge/agent-core test
corepack pnpm --filter @story-forge/desktop test
```

Expected: all pass.

- [ ] **Step 2: Run typechecks**

Run:

```bash
corepack pnpm --filter @story-forge/desktop typecheck
corepack pnpm typecheck
```

Expected: all pass.

- [ ] **Step 3: Check diff hygiene and branch state**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors and no uncommitted changes after commits.

- [ ] **Step 4: Restart dev server**

Stop the current `corepack pnpm dev` session with `Ctrl-C`, confirm port `5173` is free, then run:

```bash
corepack pnpm dev
```

Expected: Electron opens and renderer dev server is available at `http://localhost:5173/`.

- [ ] **Step 5: Push branch**

Run:

```bash
git push
```

Expected: `origin/codex/response-mode-streaming` updates the existing PR branch.
