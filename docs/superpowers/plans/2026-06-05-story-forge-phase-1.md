# StoryForge Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial `story-forge` pnpm monorepo with a self-authored Agent Core, a minimal model gateway, a safe tool layer, and an Electron + React + Tailwind desktop app that can start a local coding-agent session.

**Architecture:** StoryForge is organized around a stable `AgentRuntime` event protocol. The desktop app talks to the runtime through typed IPC, while the runtime composes model providers, context assembly, memory, tools, and sandbox policies through small package boundaries. External agent SDKs are not used in Phase 1, but the runtime interface is shaped so future adapters can implement the same contract.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, tsup, Electron, electron-vite, React, Tailwind CSS, lucide-react, zod.

---

## Scope

Phase 1 builds the local desktop skeleton and the native Agent Loop foundation:

- Monorepo structure under `/Users/bytedance/Desktop/code/story-forge`
- Native `AgentRuntime` with event streaming
- OpenAI-compatible model gateway interface and first provider
- Tool registry with sandboxed workspace file tools
- Minimal memory store
- Minimal skill manifest loader
- Minimal MCP package boundary with a disabled concrete client
- Desktop UI with settings, workspace summary, event stream, and composer
- Typed Electron IPC between desktop and core packages

Phase 1 intentionally does not build:

- Full autonomous code editing across large repositories
- Long-term vector memory
- Real MCP server process management
- Mobile app
- Web app
- External SDK runtime adapters
- Production packaging/signing

## File Map

Create these files:

- `/Users/bytedance/Desktop/code/story-forge/package.json` - root scripts and package manager metadata
- `/Users/bytedance/Desktop/code/story-forge/pnpm-workspace.yaml` - workspace package globs
- `/Users/bytedance/Desktop/code/story-forge/tsconfig.base.json` - shared TypeScript options and path aliases
- `/Users/bytedance/Desktop/code/story-forge/turbo.json` - task orchestration
- `/Users/bytedance/Desktop/code/story-forge/.gitignore` - generated file exclusions
- `/Users/bytedance/Desktop/code/story-forge/README.md` - local development guide
- `/Users/bytedance/Desktop/code/story-forge/docs/architecture.md` - Phase 1 architecture notes
- `/Users/bytedance/Desktop/code/story-forge/packages/shared/*` - shared schemas and event types
- `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/*` - model provider contracts and OpenAI-compatible client
- `/Users/bytedance/Desktop/code/story-forge/packages/tools/*` - tool registry, sandbox, and file tools
- `/Users/bytedance/Desktop/code/story-forge/packages/memory/*` - memory store contract and in-memory implementation
- `/Users/bytedance/Desktop/code/story-forge/packages/skills/*` - skill manifest parser
- `/Users/bytedance/Desktop/code/story-forge/packages/mcp/*` - MCP package boundary
- `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/*` - native Agent Runtime and context assembly
- `/Users/bytedance/Desktop/code/story-forge/apps/desktop/*` - Electron, React, Tailwind desktop app

## Package Names

- `@story-forge/shared`
- `@story-forge/model-gateway`
- `@story-forge/tools`
- `@story-forge/memory`
- `@story-forge/skills`
- `@story-forge/mcp`
- `@story-forge/agent-core`
- `@story-forge/desktop`

---

### Task 1: Bootstrap the pnpm Monorepo

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/pnpm-workspace.yaml`
- Create: `/Users/bytedance/Desktop/code/story-forge/tsconfig.base.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/turbo.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/.gitignore`

- [ ] **Step 1: Initialize the repository**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git init
```

Expected: Git creates `.git/`.

- [ ] **Step 2: Create the root package files**

Create `/Users/bytedance/Desktop/code/story-forge/package.json`:

```json
{
  "name": "story-forge",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.11.0",
  "type": "module",
  "scripts": {
    "build": "turbo run build",
    "dev": "pnpm --filter @story-forge/desktop dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {}
}
```

Create `/Users/bytedance/Desktop/code/story-forge/pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `/Users/bytedance/Desktop/code/story-forge/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@story-forge/shared": ["packages/shared/src/index.ts"],
      "@story-forge/model-gateway": ["packages/model-gateway/src/index.ts"],
      "@story-forge/tools": ["packages/tools/src/index.ts"],
      "@story-forge/memory": ["packages/memory/src/index.ts"],
      "@story-forge/skills": ["packages/skills/src/index.ts"],
      "@story-forge/mcp": ["packages/mcp/src/index.ts"],
      "@story-forge/agent-core": ["packages/agent-core/src/index.ts"]
    }
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "out/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "outputs": []
    },
    "typecheck": {
      "outputs": []
    }
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/.gitignore`:

```gitignore
.DS_Store
node_modules
dist
out
coverage
*.log
.turbo
.env
.env.*
!.env.example
```

- [ ] **Step 3: Install root development dependencies with pnpm**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm add -D -w typescript vitest tsup vite-tsconfig-paths @types/node turbo
```

Expected: `pnpm-lock.yaml` is created and root dev dependencies are recorded.

- [ ] **Step 4: Verify the empty workspace**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm install
pnpm typecheck
```

Expected: `pnpm install` exits 0. `pnpm typecheck` exits 0 with no package tasks yet.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add package.json pnpm-workspace.yaml tsconfig.base.json turbo.json .gitignore pnpm-lock.yaml
git commit -m "chore: bootstrap story-forge monorepo"
```

---

### Task 2: Add Shared Agent Contracts

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/shared/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/shared/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/shared/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/shared/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/shared/src/events.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/shared/src/events.test.ts`

- [ ] **Step 1: Write the failing event contract tests**

Create `/Users/bytedance/Desktop/code/story-forge/packages/shared/src/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSessionId, isTerminalAgentEvent } from "./events";

describe("shared agent event contracts", () => {
  it("creates readable session identifiers with the StoryForge prefix", () => {
    const sessionId = createSessionId();

    expect(sessionId).toMatch(/^sf_session_[a-z0-9]+$/);
  });

  it("detects terminal agent events", () => {
    expect(isTerminalAgentEvent({ type: "runtime.completed", sessionId: "sf_session_abc" })).toBe(true);
    expect(isTerminalAgentEvent({ type: "runtime.error", sessionId: "sf_session_abc", message: "failed" })).toBe(true);
    expect(isTerminalAgentEvent({ type: "message.delta", sessionId: "sf_session_abc", content: "hello" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run packages/shared/src/events.test.ts
```

Expected: FAIL because `./events` does not exist.

- [ ] **Step 3: Add the shared package implementation**

Create `/Users/bytedance/Desktop/code/story-forge/packages/shared/package.json`:

```json
{
  "name": "@story-forge/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/shared/src/events.ts`:

```ts
export type SessionId = `sf_session_${string}`;

export type AgentEvent =
  | { type: "runtime.started"; sessionId: SessionId; createdAt: string }
  | { type: "runtime.completed"; sessionId: SessionId }
  | { type: "runtime.error"; sessionId: SessionId; message: string }
  | { type: "message.delta"; sessionId: SessionId; content: string }
  | { type: "tool.call"; sessionId: SessionId; callId: string; name: string; input: unknown }
  | { type: "tool.result"; sessionId: SessionId; callId: string; name: string; ok: boolean; output: unknown }
  | { type: "permission.request"; sessionId: SessionId; requestId: string; reason: string }
  | { type: "memory.write"; sessionId: SessionId; key: string; value: string };

export function createSessionId(): SessionId {
  return `sf_session_${Math.random().toString(36).slice(2)}`;
}

export function isTerminalAgentEvent(event: AgentEvent): boolean {
  return event.type === "runtime.completed" || event.type === "runtime.error";
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/shared/src/index.ts`:

```ts
export * from "./events";
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm --filter @story-forge/shared test
pnpm --filter @story-forge/shared typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add packages/shared
git commit -m "feat: add shared agent event contracts"
```

---

### Task 3: Add the Model Gateway Package

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/model-provider.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/openai-compatible.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/openai-compatible.test.ts`

- [ ] **Step 1: Write the failing OpenAI-compatible provider tests**

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/openai-compatible.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible";

describe("OpenAICompatibleProvider", () => {
  it("normalizes base URLs and sends bearer authenticated chat completions requests", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hello from model" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://models.example.com/v1/",
      model: "story-model",
      fetch: fetchMock
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.content).toBe("hello from model");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://models.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          model: "story-model",
          messages: [{ role: "user", content: "hi" }],
          tools: undefined
        })
      })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run packages/model-gateway/src/openai-compatible.test.ts
```

Expected: FAIL because `./openai-compatible` does not exist.

- [ ] **Step 3: Add the model gateway implementation**

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/package.json`:

```json
{
  "name": "@story-forge/model-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/model-provider.ts`:

```ts
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSchema[];
}

export interface ChatResponse {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: unknown;
  }>;
}

export interface ModelCapabilities {
  toolCalling: boolean;
  streaming: boolean;
  jsonSchema: boolean;
  contextWindowTokens: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/openai-compatible.ts`:

```ts
import type { ChatRequest, ChatResponse, ModelCapabilities, ModelProvider } from "./model-provider";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}

interface OpenAIChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
}

interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[];
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities = {
    toolCalling: true,
    streaming: false,
    jsonSchema: false,
    contextWindowTokens: 128000
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.fetchImpl = options.fetch ?? fetch;
    this.id = `openai-compatible:${options.model}`;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        tools: request.tools
      })
    });

    if (!response.ok) {
      throw new Error(`Model request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    const message = payload.choices?.[0]?.message;

    return {
      content: message?.content ?? "",
      toolCalls:
        message?.tool_calls?.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments)
        })) ?? []
    };
  }
}

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/model-gateway/src/index.ts`:

```ts
export * from "./model-provider";
export * from "./openai-compatible";
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm --filter @story-forge/model-gateway test
pnpm --filter @story-forge/model-gateway typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add packages/model-gateway
git commit -m "feat: add openai compatible model gateway"
```

---

### Task 4: Add Tool Registry and Workspace Sandbox

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/tool-registry.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/workspace-sandbox.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/file-tools.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/tool-registry.test.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/workspace-sandbox.test.ts`

- [ ] **Step 1: Write the failing tool registry tests**

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/tool-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tool-registry";

describe("ToolRegistry", () => {
  it("executes registered tools by name", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "Echoes input text",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async (input) => ({ text: (input as { text: string }).text })
    });

    const result = await registry.execute("echo", { text: "StoryForge" });

    expect(result).toEqual({ ok: true, output: { text: "StoryForge" } });
  });

  it("returns a structured error for unknown tools", async () => {
    const registry = new ToolRegistry();

    const result = await registry.execute("missing", {});

    expect(result).toEqual({ ok: false, error: "Tool not found: missing" });
  });
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/workspace-sandbox.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSandbox } from "./workspace-sandbox";

let workspaceRoot = "";

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "story-forge-tools-"));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("WorkspaceSandbox", () => {
  it("allows reading files inside the workspace", async () => {
    await writeFile(join(workspaceRoot, "notes.txt"), "inside");
    const sandbox = new WorkspaceSandbox(workspaceRoot);

    const content = await sandbox.readTextFile("notes.txt");

    expect(content).toBe("inside");
  });

  it("blocks path traversal outside the workspace", async () => {
    const sandbox = new WorkspaceSandbox(workspaceRoot);

    await expect(sandbox.readTextFile("../outside.txt")).rejects.toThrow("Path escapes workspace");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run packages/tools/src/tool-registry.test.ts packages/tools/src/workspace-sandbox.test.ts
```

Expected: FAIL because `tool-registry` and `workspace-sandbox` do not exist.

- [ ] **Step 3: Add the tools implementation**

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/package.json`:

```json
{
  "name": "@story-forge/tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/tool-registry.ts`:

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
}

export type ToolExecutionResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  schemas(): Array<Pick<ToolDefinition, "name" | "description" | "parameters">> {
    return this.list().map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  async execute(name: string, input: unknown): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: `Tool not found: ${name}` };
    }

    try {
      const output = await tool.execute(input);
      return { ok: true, output };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/workspace-sandbox.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

export class WorkspaceSandbox {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  resolveInsideWorkspace(path: string): string {
    const resolved = resolve(this.root, path);
    const relativePath = relative(this.root, resolved);

    if (relativePath.startsWith("..") || relativePath === ".." || resolve(resolved) === this.root) {
      if (relativePath.startsWith("..")) {
        throw new Error(`Path escapes workspace: ${path}`);
      }
    }

    return resolved;
  }

  async readTextFile(path: string): Promise<string> {
    return readFile(this.resolveInsideWorkspace(path), "utf8");
  }

  async listDirectory(path = "."): Promise<string[]> {
    return readdir(this.resolveInsideWorkspace(path));
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/file-tools.ts`:

```ts
import type { ToolDefinition } from "./tool-registry";
import { WorkspaceSandbox } from "./workspace-sandbox";

export function createFileTools(workspaceRoot: string): ToolDefinition[] {
  const sandbox = new WorkspaceSandbox(workspaceRoot);

  return [
    {
      name: "workspace.readFile",
      description: "Reads a UTF-8 text file inside the active workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      execute: async (input) => {
        const { path } = input as { path: string };
        return { path, content: await sandbox.readTextFile(path) };
      }
    },
    {
      name: "workspace.listDirectory",
      description: "Lists direct children inside a workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        }
      },
      execute: async (input) => {
        const { path = "." } = input as { path?: string };
        return { path, entries: await sandbox.listDirectory(path) };
      }
    }
  ];
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/tools/src/index.ts`:

```ts
export * from "./file-tools";
export * from "./tool-registry";
export * from "./workspace-sandbox";
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm --filter @story-forge/tools test
pnpm --filter @story-forge/tools typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add packages/tools
git commit -m "feat: add sandboxed tool registry"
```

---

### Task 5: Add Memory, Skill, and MCP Package Boundaries

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/memory/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/memory/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/memory/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/memory/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/memory/src/in-memory-memory-store.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/memory/src/in-memory-memory-store.test.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/skills/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/skills/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/skills/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/skills/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/skills/src/skill-manifest.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/skills/src/skill-manifest.test.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/mcp/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/mcp/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/mcp/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/mcp/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/mcp/src/disabled-mcp-client.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/mcp/src/disabled-mcp-client.test.ts`

- [ ] **Step 1: Write the failing package boundary tests**

Create `/Users/bytedance/Desktop/code/story-forge/packages/memory/src/in-memory-memory-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "./in-memory-memory-store";

describe("InMemoryMemoryStore", () => {
  it("stores and queries memories by text match", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ scope: "project", key: "style", value: "Use pnpm for StoryForge." });

    const results = await store.query({ scope: "project", query: "pnpm" });

    expect(results).toEqual([{ scope: "project", key: "style", value: "Use pnpm for StoryForge." }]);
  });
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/skills/src/skill-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSkillManifest } from "./skill-manifest";

describe("parseSkillManifest", () => {
  it("extracts skill metadata from markdown frontmatter", () => {
    const manifest = parseSkillManifest(`---
name: code-review
description: Review code changes
---

# Code Review

Check diffs and tests.
`);

    expect(manifest).toEqual({
      name: "code-review",
      description: "Review code changes",
      body: "# Code Review\n\nCheck diffs and tests.\n"
    });
  });
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/mcp/src/disabled-mcp-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DisabledMcpClient } from "./disabled-mcp-client";

describe("DisabledMcpClient", () => {
  it("returns no tools while MCP is disabled in Phase 1", async () => {
    const client = new DisabledMcpClient();

    await expect(client.listTools()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run packages/memory/src/in-memory-memory-store.test.ts packages/skills/src/skill-manifest.test.ts packages/mcp/src/disabled-mcp-client.test.ts
```

Expected: FAIL because the three packages do not exist.

- [ ] **Step 3: Add memory package files**

Create `/Users/bytedance/Desktop/code/story-forge/packages/memory/package.json`:

```json
{
  "name": "@story-forge/memory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/memory/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/memory/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/memory/src/in-memory-memory-store.ts`:

```ts
export interface MemoryEntry {
  scope: "session" | "project" | "user";
  key: string;
  value: string;
}

export interface MemoryQuery {
  scope: MemoryEntry["scope"];
  query: string;
}

export interface MemoryStore {
  write(entry: MemoryEntry): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries: MemoryEntry[] = [];

  async write(entry: MemoryEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const normalizedQuery = query.query.toLowerCase();

    return this.entries.filter((entry) => {
      return entry.scope === query.scope && `${entry.key} ${entry.value}`.toLowerCase().includes(normalizedQuery);
    });
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/memory/src/index.ts`:

```ts
export * from "./in-memory-memory-store";
```

- [ ] **Step 4: Add skills package files**

Create `/Users/bytedance/Desktop/code/story-forge/packages/skills/package.json`:

```json
{
  "name": "@story-forge/skills",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/skills/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/skills/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/skills/src/skill-manifest.ts`:

```ts
export interface SkillManifest {
  name: string;
  description: string;
  body: string;
}

export function parseSkillManifest(markdown: string): SkillManifest {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Skill manifest requires frontmatter");
  }

  const frontmatter = match[1];
  const body = match[2];
  const name = readFrontmatterValue(frontmatter, "name");
  const description = readFrontmatterValue(frontmatter, "description");

  return { name, description, body };
}

function readFrontmatterValue(frontmatter: string, key: string): string {
  const line = frontmatter.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) {
    throw new Error(`Skill manifest missing ${key}`);
  }

  return line.slice(key.length + 1).trim();
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/skills/src/index.ts`:

```ts
export * from "./skill-manifest";
```

- [ ] **Step 5: Add MCP package files**

Create `/Users/bytedance/Desktop/code/story-forge/packages/mcp/package.json`:

```json
{
  "name": "@story-forge/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/mcp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/mcp/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/mcp/src/disabled-mcp-client.ts`:

```ts
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
}

export class DisabledMcpClient implements McpClient {
  async listTools(): Promise<McpToolDescriptor[]> {
    return [];
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/mcp/src/index.ts`:

```ts
export * from "./disabled-mcp-client";
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm --filter @story-forge/memory test
pnpm --filter @story-forge/skills test
pnpm --filter @story-forge/mcp test
pnpm --filter @story-forge/memory typecheck
pnpm --filter @story-forge/skills typecheck
pnpm --filter @story-forge/mcp typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add packages/memory packages/skills packages/mcp
git commit -m "feat: add memory skill and mcp boundaries"
```

---

### Task 6: Add the Native Agent Runtime

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/vitest.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/agent-runtime.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/native-agent-runtime.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/context-manager.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/native-agent-runtime.test.ts`

- [ ] **Step 1: Write the failing runtime tests**

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/native-agent-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModelProvider } from "@story-forge/model-gateway";
import { ToolRegistry } from "@story-forge/tools";
import { NativeAgentRuntime } from "./native-agent-runtime";

describe("NativeAgentRuntime", () => {
  it("streams a started event, assistant content, and a completed event", async () => {
    const provider: ModelProvider = {
      id: "fake",
      capabilities: {
        toolCalling: true,
        streaming: false,
        jsonSchema: false,
        contextWindowTokens: 4096
      },
      chat: async () => ({ content: "I can help with this repository.", toolCalls: [] })
    };

    const runtime = new NativeAgentRuntime({
      provider,
      tools: new ToolRegistry(),
      workspaceRoot: "/tmp/story-forge"
    });

    const events = [];
    for await (const event of runtime.runTurn("Review this project")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "runtime.started",
      "message.delta",
      "runtime.completed"
    ]);
    expect(events[1]).toMatchObject({ type: "message.delta", content: "I can help with this repository." });
  });

  it("executes one model-requested tool call and returns the tool result event", async () => {
    const provider: ModelProvider = {
      id: "fake",
      capabilities: {
        toolCalling: true,
        streaming: false,
        jsonSchema: false,
        contextWindowTokens: 4096
      },
      chat: async () => ({
        content: "",
        toolCalls: [{ id: "call_1", name: "story.echo", input: { text: "forge" } }]
      })
    };

    const tools = new ToolRegistry();
    tools.register({
      name: "story.echo",
      description: "Echoes text",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async (input) => ({ text: (input as { text: string }).text })
    });

    const runtime = new NativeAgentRuntime({
      provider,
      tools,
      workspaceRoot: "/tmp/story-forge"
    });

    const events = [];
    for await (const event of runtime.runTurn("Use a tool")) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "tool.result",
      sessionId: expect.stringMatching(/^sf_session_/),
      callId: "call_1",
      name: "story.echo",
      ok: true,
      output: { text: "forge" }
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run packages/agent-core/src/native-agent-runtime.test.ts
```

Expected: FAIL because `native-agent-runtime` does not exist.

- [ ] **Step 3: Add the agent-core implementation**

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/package.json`:

```json
{
  "name": "@story-forge/agent-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@story-forge/shared": "workspace:*",
    "@story-forge/model-gateway": "workspace:*",
    "@story-forge/tools": "workspace:*"
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/vitest.config.ts`:

```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node"
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/agent-runtime.ts`:

```ts
import type { AgentEvent } from "@story-forge/shared";

export interface AgentRuntime {
  runTurn(userInput: string): AsyncIterable<AgentEvent>;
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/context-manager.ts`:

```ts
import type { ChatMessage } from "@story-forge/model-gateway";

export interface ContextManagerInput {
  userInput: string;
  workspaceRoot: string;
}

export class ContextManager {
  buildMessages(input: ContextManagerInput): ChatMessage[] {
    return [
      {
        role: "system",
        content:
          "You are StoryForge, a local coding agent. Be concise, inspect before editing, and use tools only when they help the task."
      },
      {
        role: "user",
        content: `Workspace: ${input.workspaceRoot}\n\nTask: ${input.userInput}`
      }
    ];
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/native-agent-runtime.ts`:

```ts
import type { ModelProvider } from "@story-forge/model-gateway";
import { createSessionId, type AgentEvent } from "@story-forge/shared";
import type { ToolRegistry } from "@story-forge/tools";
import type { AgentRuntime } from "./agent-runtime";
import { ContextManager } from "./context-manager";

export interface NativeAgentRuntimeOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  workspaceRoot: string;
  contextManager?: ContextManager;
}

export class NativeAgentRuntime implements AgentRuntime {
  private readonly provider: ModelProvider;
  private readonly tools: ToolRegistry;
  private readonly workspaceRoot: string;
  private readonly contextManager: ContextManager;

  constructor(options: NativeAgentRuntimeOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.workspaceRoot = options.workspaceRoot;
    this.contextManager = options.contextManager ?? new ContextManager();
  }

  async *runTurn(userInput: string): AsyncIterable<AgentEvent> {
    const sessionId = createSessionId();
    yield { type: "runtime.started", sessionId, createdAt: new Date().toISOString() };

    try {
      const response = await this.provider.chat({
        messages: this.contextManager.buildMessages({ userInput, workspaceRoot: this.workspaceRoot }),
        tools: this.tools.schemas()
      });

      for (const toolCall of response.toolCalls) {
        yield {
          type: "tool.call",
          sessionId,
          callId: toolCall.id,
          name: toolCall.name,
          input: toolCall.input
        };

        const result = await this.tools.execute(toolCall.name, toolCall.input);
        yield {
          type: "tool.result",
          sessionId,
          callId: toolCall.id,
          name: toolCall.name,
          ok: result.ok,
          output: result.ok ? result.output : result.error
        };
      }

      if (response.content.length > 0) {
        yield { type: "message.delta", sessionId, content: response.content };
      }

      yield { type: "runtime.completed", sessionId };
    } catch (error) {
      yield {
        type: "runtime.error",
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
```

Create `/Users/bytedance/Desktop/code/story-forge/packages/agent-core/src/index.ts`:

```ts
export * from "./agent-runtime";
export * from "./context-manager";
export * from "./native-agent-runtime";
```

- [ ] **Step 4: Run package tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm install
pnpm --filter @story-forge/agent-core test
pnpm --filter @story-forge/agent-core typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add packages/agent-core
git commit -m "feat: add native agent runtime"
```

---

### Task 7: Add the Electron React Tailwind Desktop App

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/package.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/tsconfig.json`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/electron.vite.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/index.html`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/tailwind.config.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/postcss.config.cjs`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/main.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/preload/index.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/main.tsx`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.tsx`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/styles.css`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.test.tsx`

- [ ] **Step 1: Install desktop dependencies with pnpm**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm add -F @story-forge/desktop react react-dom lucide-react zod
pnpm add -D -F @story-forge/desktop electron electron-vite vite @vitejs/plugin-react tailwindcss postcss autoprefixer @types/react @types/react-dom @testing-library/react @testing-library/jest-dom jsdom
```

Expected: pnpm reports dependencies added for `@story-forge/desktop`.

- [ ] **Step 2: Write the failing renderer test**

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the StoryForge agent workspace", () => {
    render(<App />);

    expect(screen.getByText("StoryForge")).toBeInTheDocument();
    expect(screen.getByText("Agent Core")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask StoryForge to inspect, explain, or change code...")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the renderer test to verify it fails**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run apps/desktop/src/renderer/App.test.tsx --environment jsdom
```

Expected: FAIL because `./App` does not exist.

- [ ] **Step 4: Add the desktop app files**

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/package.json`:

```json
{
  "name": "@story-forge/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "build": "electron-vite build",
    "dev": "electron-vite dev",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@story-forge/agent-core": "workspace:*",
    "@story-forge/model-gateway": "workspace:*",
    "@story-forge/tools": "workspace:*"
  },
  "devDependencies": {}
}
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals", "jsdom"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "electron.vite.config.ts", "tailwind.config.ts"]
}
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/electron.vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/main.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react()],
    root: "."
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StoryForge</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forge: {
          ink: "#141414",
          panel: "#f5f5f2",
          line: "#d9d5ca",
          ember: "#c4492d",
          moss: "#4e6b52"
        }
      }
    }
  },
  plugins: []
} satisfies Config;
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/postcss.config.cjs`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/main.ts`:

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "StoryForge",
    backgroundColor: "#f5f5f2",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/preload/index.ts`:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("storyForge", {
  version: "0.1.0"
});
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.tsx`:

```tsx
import { Bot, FolderOpen, KeyRound, Play, Settings, TerminalSquare } from "lucide-react";

const timeline = [
  { label: "Runtime", value: "Native Loop" },
  { label: "Tools", value: "Workspace read/list" },
  { label: "Memory", value: "In-memory" },
  { label: "MCP", value: "Disabled" }
];

export function App(): JSX.Element {
  return (
    <main className="grid h-screen grid-cols-[280px_1fr] bg-forge-panel text-forge-ink">
      <aside className="border-r border-forge-line bg-white/60 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-forge-ink text-white">
            <Bot size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-6">StoryForge</h1>
            <p className="text-sm text-stone-600">Coding agent desktop</p>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <button className="flex w-full items-center gap-3 rounded-md bg-forge-ink px-3 py-2 text-left text-sm font-medium text-white">
            <TerminalSquare size={16} aria-hidden="true" />
            Agent Core
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-stone-700 hover:bg-white">
            <FolderOpen size={16} aria-hidden="true" />
            Workspace
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-stone-700 hover:bg-white">
            <KeyRound size={16} aria-hidden="true" />
            Models
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-stone-700 hover:bg-white">
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-forge-line bg-white/70 px-6">
          <div>
            <h2 className="text-base font-semibold">Native Agent Session</h2>
            <p className="text-sm text-stone-600">Self-authored runtime with typed events and sandboxed tools.</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white hover:bg-[#a93d27]">
            <Play size={16} aria-hidden="true" />
            Run
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col p-6">
            <div className="flex-1 rounded-md border border-forge-line bg-white p-4">
              <div className="rounded-md bg-stone-100 p-4 text-sm text-stone-700">
                StoryForge is ready to connect a workspace, model provider, and native agent runtime.
              </div>
            </div>

            <label className="mt-4 block">
              <span className="sr-only">Agent prompt</span>
              <textarea
                className="h-28 w-full resize-none rounded-md border border-forge-line bg-white p-3 text-sm outline-none ring-forge-ember focus:ring-2"
                placeholder="Ask StoryForge to inspect, explain, or change code..."
              />
            </label>
          </div>

          <aside className="border-l border-forge-line bg-white/50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Runtime Map</h3>
            <div className="mt-4 space-y-3">
              {timeline.map((item) => (
                <div key={item.label} className="rounded-md border border-forge-line bg-white p-3">
                  <div className="text-xs font-medium uppercase text-stone-500">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
```

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
textarea {
  font: inherit;
}
```

- [ ] **Step 5: Run desktop tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm install
pnpm --filter @story-forge/desktop test
pnpm --filter @story-forge/desktop typecheck
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add apps/desktop package.json pnpm-lock.yaml
git commit -m "feat: add electron desktop shell"
```

---

### Task 8: Wire Desktop IPC to the Native Runtime

**Files:**
- Modify: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/main.ts`
- Modify: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/preload/index.ts`
- Modify: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.tsx`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/runtime-factory.ts`
- Create: `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/runtime-factory.test.ts`

- [ ] **Step 1: Write the failing runtime factory test**

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/runtime-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDesktopRuntime } from "./runtime-factory";

describe("createDesktopRuntime", () => {
  it("creates a runtime with workspace file tools", async () => {
    const runtime = createDesktopRuntime({
      workspaceRoot: "/tmp/story-forge",
      providerConfig: {
        apiKey: "key",
        baseUrl: "https://models.example.com/v1",
        model: "story-model"
      },
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ready" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });

    const events = [];
    for await (const event of runtime.runTurn("Say ready")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "runtime.started",
      "message.delta",
      "runtime.completed"
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm exec vitest run apps/desktop/src/main/runtime-factory.test.ts --environment node
```

Expected: FAIL because `runtime-factory` does not exist.

- [ ] **Step 3: Add the runtime factory**

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/runtime-factory.ts`:

```ts
import { NativeAgentRuntime } from "@story-forge/agent-core";
import { OpenAICompatibleProvider } from "@story-forge/model-gateway";
import { createFileTools, ToolRegistry } from "@story-forge/tools";

export interface DesktopProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DesktopRuntimeOptions {
  workspaceRoot: string;
  providerConfig: DesktopProviderConfig;
  fetch?: typeof fetch;
}

export function createDesktopRuntime(options: DesktopRuntimeOptions): NativeAgentRuntime {
  const tools = new ToolRegistry();
  for (const tool of createFileTools(options.workspaceRoot)) {
    tools.register(tool);
  }

  return new NativeAgentRuntime({
    workspaceRoot: options.workspaceRoot,
    tools,
    provider: new OpenAICompatibleProvider({
      apiKey: options.providerConfig.apiKey,
      baseUrl: options.providerConfig.baseUrl,
      model: options.providerConfig.model,
      fetch: options.fetch
    })
  });
}
```

- [ ] **Step 4: Add typed IPC bridge**

Modify `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

export interface StoryForgeBridge {
  version: string;
  runTurn(input: {
    workspaceRoot: string;
    providerConfig: {
      apiKey: string;
      baseUrl: string;
      model: string;
    };
    prompt: string;
  }): Promise<unknown[]>;
}

const bridge: StoryForgeBridge = {
  version: "0.1.0",
  runTurn: (input) => ipcRenderer.invoke("agent:run-turn", input) as Promise<unknown[]>
};

contextBridge.exposeInMainWorld("storyForge", bridge);
```

Modify `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/main.ts`:

```ts
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { createDesktopRuntime } from "./runtime-factory";

interface RunTurnInput {
  workspaceRoot: string;
  providerConfig: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  prompt: string;
}

ipcMain.handle("agent:run-turn", async (_event, input: RunTurnInput) => {
  const runtime = createDesktopRuntime({
    workspaceRoot: input.workspaceRoot,
    providerConfig: input.providerConfig
  });

  const events = [];
  for await (const event of runtime.runTurn(input.prompt)) {
    events.push(event);
  }
  return events;
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "StoryForge",
    backgroundColor: "#f5f5f2",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

- [ ] **Step 5: Add a global bridge type and connect the renderer form**

Create `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/story-forge-bridge.d.ts`:

```ts
export {};

declare global {
  interface Window {
    storyForge: {
      version: string;
      runTurn(input: {
        workspaceRoot: string;
        providerConfig: {
          apiKey: string;
          baseUrl: string;
          model: string;
        };
        prompt: string;
      }): Promise<unknown[]>;
    };
  }
}
```

Modify `/Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.tsx` so the composer keeps prompt and event state:

```tsx
import { Bot, FolderOpen, KeyRound, Play, Settings, TerminalSquare } from "lucide-react";
import { useState } from "react";

const timeline = [
  { label: "Runtime", value: "Native Loop" },
  { label: "Tools", value: "Workspace read/list" },
  { label: "Memory", value: "In-memory" },
  { label: "MCP", value: "Disabled" }
];

export function App(): JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<unknown[]>([]);

  async function runAgent(): Promise<void> {
    const nextEvents = await window.storyForge.runTurn({
      workspaceRoot: "/Users/bytedance/Desktop/code/story-forge",
      providerConfig: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini"
      },
      prompt
    });
    setEvents(nextEvents);
  }

  return (
    <main className="grid h-screen grid-cols-[280px_1fr] bg-forge-panel text-forge-ink">
      <aside className="border-r border-forge-line bg-white/60 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-forge-ink text-white">
            <Bot size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-6">StoryForge</h1>
            <p className="text-sm text-stone-600">Coding agent desktop</p>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <button className="flex w-full items-center gap-3 rounded-md bg-forge-ink px-3 py-2 text-left text-sm font-medium text-white">
            <TerminalSquare size={16} aria-hidden="true" />
            Agent Core
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-stone-700 hover:bg-white">
            <FolderOpen size={16} aria-hidden="true" />
            Workspace
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-stone-700 hover:bg-white">
            <KeyRound size={16} aria-hidden="true" />
            Models
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-stone-700 hover:bg-white">
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-forge-line bg-white/70 px-6">
          <div>
            <h2 className="text-base font-semibold">Native Agent Session</h2>
            <p className="text-sm text-stone-600">Self-authored runtime with typed events and sandboxed tools.</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white hover:bg-[#a93d27]"
            onClick={() => void runAgent()}
            type="button"
          >
            <Play size={16} aria-hidden="true" />
            Run
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col p-6">
            <div className="flex-1 overflow-auto rounded-md border border-forge-line bg-white p-4">
              {events.length === 0 ? (
                <div className="rounded-md bg-stone-100 p-4 text-sm text-stone-700">
                  StoryForge is ready to connect a workspace, model provider, and native agent runtime.
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-xs text-stone-700">{JSON.stringify(events, null, 2)}</pre>
              )}
            </div>

            <label className="mt-4 block">
              <span className="sr-only">Agent prompt</span>
              <textarea
                className="h-28 w-full resize-none rounded-md border border-forge-line bg-white p-3 text-sm outline-none ring-forge-ember focus:ring-2"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask StoryForge to inspect, explain, or change code..."
                value={prompt}
              />
            </label>
          </div>

          <aside className="border-l border-forge-line bg-white/50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Runtime Map</h3>
            <div className="mt-4 space-y-3">
              {timeline.map((item) => (
                <div key={item.label} className="rounded-md border border-forge-line bg-white p-3">
                  <div className="text-xs font-medium uppercase text-stone-500">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm --filter @story-forge/desktop test
pnpm --filter @story-forge/desktop typecheck
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add apps/desktop
git commit -m "feat: wire desktop app to native runtime"
```

---

### Task 9: Add Documentation and Full Verification

**Files:**
- Create: `/Users/bytedance/Desktop/code/story-forge/README.md`
- Create: `/Users/bytedance/Desktop/code/story-forge/docs/architecture.md`

- [ ] **Step 1: Create the project README**

Create `/Users/bytedance/Desktop/code/story-forge/README.md`:

```md
# StoryForge

StoryForge is a desktop-first coding agent platform built around a self-authored native Agent Runtime.

## Development

Install dependencies:

\`\`\`bash
pnpm install
\`\`\`

Run tests:

\`\`\`bash
pnpm test
\`\`\`

Run type checks:

\`\`\`bash
pnpm typecheck
\`\`\`

Start the desktop app:

\`\`\`bash
pnpm dev
\`\`\`

## Phase 1 Packages

- `@story-forge/shared` provides typed runtime events.
- `@story-forge/model-gateway` provides model provider contracts and an OpenAI-compatible provider.
- `@story-forge/tools` provides the tool registry and workspace sandbox.
- `@story-forge/memory` provides the first memory store contract.
- `@story-forge/skills` provides the first skill manifest parser.
- `@story-forge/mcp` provides the first MCP package boundary.
- `@story-forge/agent-core` provides the native Agent Runtime.
- `@story-forge/desktop` provides the Electron desktop app.
```

- [ ] **Step 2: Create the architecture document**

Create `/Users/bytedance/Desktop/code/story-forge/docs/architecture.md`:

```md
# StoryForge Architecture

StoryForge separates the product shell from the agent engine.

## Runtime Protocol

The desktop app consumes `AgentEvent` values. This keeps renderer UI independent from the internal implementation of the native runtime and leaves room for future runtime adapters.

## Native Agent Runtime

The Phase 1 runtime performs one model request per turn. It builds context, exposes tool schemas, executes model-requested tool calls, and emits structured events.

## Tool System

Tools are registered through `ToolRegistry`. Workspace file tools use `WorkspaceSandbox` so file access stays inside the selected root.

## Model Gateway

The first provider targets OpenAI-compatible chat completions APIs through configurable `apiKey`, `baseUrl`, and `model` fields.

## Memory, Skills, and MCP

Memory, Skills, and MCP are package boundaries in Phase 1. Each has a concrete minimal behavior and tests so future expansion can happen behind existing interfaces.

## Desktop App

The Electron main process owns runtime creation. The renderer calls it through a preload bridge and renders the returned event stream.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

Run:

```bash
cd /Users/bytedance/Desktop/code/story-forge
git add README.md docs/architecture.md
git commit -m "docs: document story-forge phase one"
```

---

## Self-Review Checklist

- Spec coverage: Phase 1 covers monorepo, self-authored native runtime, model gateway, tools, sandbox, context management, memory boundary, skill boundary, MCP boundary, and desktop app.
- Placeholder scan: The plan avoids unresolved placeholder tasks and gives concrete files, commands, and code snippets.
- Type consistency: Package names, import paths, and runtime event names stay consistent across tasks.
- Scope check: Full autonomous code editing, vector memory, real MCP process management, mobile, web, and external SDK adapters are excluded from Phase 1 so this plan remains implementable as one coherent milestone.

## Execution Options

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, and iterate quickly.
2. **Inline Execution** - Execute tasks in this session with checkpoints after each task.
