# Structured Runtime Context Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 1 of the structured runtime context manager: one XML system context document, project `AGENTS.md` loading, empty MCP and soul sections, and unchanged role-preserving conversation messages.

**Architecture:** Add focused `agent-core` modules for XML document serialization and project instruction discovery, then wire them into `RuntimeContextAssembler`. The native runtime keeps consuming `context.messages`, but that message list now starts with exactly one structured XML system message followed by persisted conversation messages.

**Tech Stack:** TypeScript, Vitest, Node `fs/promises`, existing `@story-forge/model-gateway` chat message types, existing `@story-forge/shared` Skill types.

---

## File Structure

- Create `packages/agent-core/src/storyforge-context-document.ts`
  - Owns `StoryForgeContextDocument` types and `serializeStoryForgeContextDocument`.
  - Escapes XML safely and renders all Phase 1 sections.
- Create `packages/agent-core/src/storyforge-context-document.test.ts`
  - Unit tests XML escaping, section order, Skills, project info, empty MCP, and empty soul.
- Create `packages/agent-core/src/project-instructions.ts`
  - Loads `AGENTS.override.md` when present; otherwise `AGENTS.md`.
  - Applies a byte cap and reports source metadata.
- Create `packages/agent-core/src/project-instructions.test.ts`
  - Unit tests missing files, override precedence, empty files, and truncation.
- Modify `packages/agent-core/src/runtime-context.ts`
  - Replaces multiple system messages with one XML system message.
  - Calls project instruction loader.
  - Keeps active Skill resolution and conversation message conversion.
- Modify `packages/agent-core/src/native-agent-runtime.test.ts`
  - Updates expectations around the new XML system message.
  - Adds regression coverage that conversation messages remain outside XML.
- Modify `packages/agent-core/src/index.ts`
  - Exports new modules if useful for future tests and adapters.

---

### Task 1: XML Context Document Serializer

**Files:**
- Create: `packages/agent-core/src/storyforge-context-document.ts`
- Test: `packages/agent-core/src/storyforge-context-document.test.ts`

- [ ] **Step 1: Write the failing serializer test**

Add `packages/agent-core/src/storyforge-context-document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeStoryForgeContextDocument } from "./storyforge-context-document";

describe("serializeStoryForgeContextDocument", () => {
  it("renders ordered XML sections and escapes markdown content", () => {
    const xml = serializeStoryForgeContextDocument({
      version: 1,
      main: {
        content: "Use <workspace> safely & inspect first.",
      },
      skills: {
        available: [{
          invocationName: "/review",
          name: "Review",
          description: "Review <diff> & tests",
        }],
        active: {
          invocationName: "/review",
          name: "Review",
          argumentsText: "auth <flow>",
          body: "Check `a < b && c > d`.",
        },
      },
      mcp: {
        servers: [],
        warnings: [],
      },
      projectInfo: {
        sources: [{
          path: "/repo/AGENTS.md",
          scope: "project",
          content: "Run `pnpm test` before PRs & commits.",
          truncated: false,
          byteCount: 39,
        }],
        warnings: [],
      },
      soul: {
        status: "empty",
        sources: [],
        content: "No long-term memory has been recorded yet.",
        warnings: [],
      },
    });

    expect(xml).toContain("<storyforge-context version=\"1\">");
    expect(xml.indexOf("<main>")).toBeLessThan(xml.indexOf("<skills"));
    expect(xml.indexOf("<skills")).toBeLessThan(xml.indexOf("<mcp"));
    expect(xml.indexOf("<mcp")).toBeLessThan(xml.indexOf("<project-info"));
    expect(xml.indexOf("<project-info")).toBeLessThan(xml.indexOf("<soul"));
    expect(xml).toContain("Use &lt;workspace&gt; safely &amp; inspect first.");
    expect(xml).toContain("<skill invocation=\"/review\" name=\"Review\">");
    expect(xml).toContain("Review &lt;diff&gt; &amp; tests");
    expect(xml).toContain("<active-skill invocation=\"/review\" name=\"Review\">");
    expect(xml).toContain("auth &lt;flow&gt;");
    expect(xml).toContain("a &lt; b &amp;&amp; c &gt; d");
    expect(xml).toContain("<mcp server-count=\"0\" tool-count=\"0\">");
    expect(xml).toContain("<project-info source-count=\"1\">");
    expect(xml).toContain("<soul source-count=\"0\" status=\"empty\">");
  });
});
```

- [ ] **Step 2: Run the serializer test to verify it fails**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/storyforge-context-document.test.ts
```

Expected: fail because `./storyforge-context-document` does not exist.

- [ ] **Step 3: Implement the serializer**

Create `packages/agent-core/src/storyforge-context-document.ts`:

```ts
export type StoryForgeContextDocument = {
  version: 1;
  main: {
    content: string;
  };
  skills: StoryForgeSkillsContext;
  mcp: StoryForgeMcpContext;
  projectInfo: StoryForgeProjectInfoContext;
  soul: StoryForgeSoulContext;
};

export type StoryForgeSkillsContext = {
  available: StoryForgeAvailableSkill[];
  active?: StoryForgeActiveSkill | undefined;
};

export type StoryForgeAvailableSkill = {
  invocationName: `/${string}`;
  name: string;
  description: string;
};

export type StoryForgeActiveSkill = StoryForgeAvailableSkill & {
  argumentsText: string;
  body: string;
};

export type StoryForgeMcpContext = {
  servers: StoryForgeMcpServer[];
  warnings: string[];
};

export type StoryForgeMcpServer = {
  name: string;
  transport: string;
  status: "available" | "disabled" | "failed" | "untested";
  instructions?: string | undefined;
  tools: StoryForgeMcpTool[];
};

export type StoryForgeMcpTool = {
  name: string;
  description: string;
  inputSchemaSummary?: string | undefined;
};

export type StoryForgeProjectInfoContext = {
  sources: StoryForgeProjectInfoSource[];
  warnings: string[];
};

export type StoryForgeProjectInfoSource = {
  path: string;
  scope: "project";
  content: string;
  truncated: boolean;
  byteCount: number;
};

export type StoryForgeSoulContext = {
  status: "empty" | "available" | "unavailable";
  sources: StoryForgeSoulSource[];
  content: string;
  warnings: string[];
};

export type StoryForgeSoulSource = {
  title: string;
  content: string;
  updatedAt?: string | undefined;
};

export function serializeStoryForgeContextDocument(document: StoryForgeContextDocument): string {
  const toolCount = document.mcp.servers.reduce((total, server) => total + server.tools.length, 0);
  return [
    `<storyforge-context version="${document.version}">`,
    "  <main>",
    indentText(escapeXml(document.main.content), 4),
    "  </main>",
    "",
    `  <skills count="${document.skills.available.length}"${document.skills.active ? ` active="${escapeAttribute(document.skills.active.invocationName)}"` : ""}>`,
    renderSkills(document.skills),
    "  </skills>",
    "",
    `  <mcp server-count="${document.mcp.servers.length}" tool-count="${toolCount}">`,
    renderMcp(document.mcp),
    "  </mcp>",
    "",
    `  <project-info source-count="${document.projectInfo.sources.length}">`,
    renderProjectInfo(document.projectInfo),
    "  </project-info>",
    "",
    `  <soul source-count="${document.soul.sources.length}" status="${document.soul.status}">`,
    indentText(escapeXml(document.soul.content), 4),
    renderWarnings(document.soul.warnings, 4),
    "  </soul>",
    "</storyforge-context>",
  ].filter((line) => line !== undefined).join("\n");
}
```

Then add helper functions in the same file: `renderSkills`, `renderMcp`,
`renderProjectInfo`, `renderWarnings`, `escapeXml`, `escapeAttribute`, `indentText`,
and `singleLine`. They should use XML escaping instead of CDATA.

- [ ] **Step 4: Run the serializer test to verify it passes**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/storyforge-context-document.test.ts
```

Expected: pass.

---

### Task 2: Project Instructions Loader

**Files:**
- Create: `packages/agent-core/src/project-instructions.ts`
- Test: `packages/agent-core/src/project-instructions.test.ts`

- [ ] **Step 1: Write failing project instruction tests**

Add tests for missing files, `AGENTS.override.md` precedence, empty-file skipping, and truncation.

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/project-instructions.test.ts
```

Expected: fail because `./project-instructions` does not exist.

- [ ] **Step 2: Implement `loadProjectInstructions`**

Create `packages/agent-core/src/project-instructions.ts` with:

```ts
export type ProjectInstructionSource = {
  path: string;
  scope: "project";
  content: string;
  truncated: boolean;
  byteCount: number;
};

export type ProjectInstructionsContext = {
  sources: ProjectInstructionSource[];
  warnings: string[];
};

export async function loadProjectInstructions(
  workspacePath: string,
  options: { maxBytes?: number } = {},
): Promise<ProjectInstructionsContext> {
  const maxBytes = options.maxBytes ?? 32 * 1024;
  // Check AGENTS.override.md first, then AGENTS.md.
}
```

Implementation details:

- Use `node:path` `join`.
- Use `node:fs/promises` `readFile`.
- Treat `ENOENT` as missing, not an error.
- Skip empty files.
- Truncate by UTF-8 byte length using `Buffer`.
- Return warnings for unreadable non-missing files and truncation.

- [ ] **Step 3: Run project instruction tests to verify they pass**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/project-instructions.test.ts
```

Expected: pass.

---

### Task 3: Runtime Context Assembler Integration

**Files:**
- Modify: `packages/agent-core/src/runtime-context.ts`
- Modify: `packages/agent-core/src/native-agent-runtime.test.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Write failing runtime integration tests**

Update `NativeAgentRuntime` context test to assert:

- The request contains exactly one `system` message.
- The system message contains `<storyforge-context version="1">`.
- The system message contains `<main>`, `<skills>`, `<mcp>`, `<project-info>`, and `<soul>`.
- Active Skill content is inside the XML.
- `AGENTS.md` content is inside `<project-info>`.
- The user conversation message remains a separate `role: "user"` message.

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/native-agent-runtime.test.ts
```

Expected: fail because the current assembler emits multiple system messages and does not load
`AGENTS.md`.

- [ ] **Step 2: Implement integration in `RuntimeContextAssembler`**

Modify `runtime-context.ts` to:

- Import `loadProjectInstructions`.
- Import `serializeStoryForgeContextDocument`.
- Replace `systemMessages` with one `systemMessage`.
- Build `StoryForgeContextDocument`.
- Keep `session.messages.map(toChatMessage)` unchanged after the system message.
- Keep `validatePrompt` behavior unchanged.

The main prompt content should preserve all existing behavioral instructions, including automation
proposal guidance and command execution guidance.

- [ ] **Step 3: Export new modules**

Modify `packages/agent-core/src/index.ts`:

```ts
export * from "./project-instructions";
export * from "./storyforge-context-document";
```

- [ ] **Step 4: Run runtime integration tests**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test -- src/native-agent-runtime.test.ts
```

Expected: pass.

---

### Task 4: Full Verification And Commit

**Files:**
- All files changed by Tasks 1-3.

- [ ] **Step 1: Run package tests**

Run:

```bash
corepack pnpm --filter @story-forge/agent-core test
```

Expected: all agent-core tests pass.

- [ ] **Step 2: Run repository verification**

Run:

```bash
corepack pnpm typecheck
corepack pnpm test
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit only context-manager files**

Stage only:

```bash
git add \
  docs/superpowers/plans/2026-06-21-structured-runtime-context-manager.md \
  packages/agent-core/src/index.ts \
  packages/agent-core/src/native-agent-runtime.test.ts \
  packages/agent-core/src/project-instructions.ts \
  packages/agent-core/src/project-instructions.test.ts \
  packages/agent-core/src/runtime-context.ts \
  packages/agent-core/src/storyforge-context-document.ts \
  packages/agent-core/src/storyforge-context-document.test.ts
```

Commit:

```bash
git commit -m "feat: add structured runtime context manager"
```

Expected: slash command UI files and untracked `AGENTS.md` remain unstaged.

