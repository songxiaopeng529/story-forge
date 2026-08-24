import {
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PI_TODO_TOOL_NAME, resolvePiTodoExtensionPath } from "@story-forge/extensions";
import {
  createStoryForgeAgentSession,
  createStoryForgeSystemPrompt,
} from "../pi/create-storyforge-session";
import { PiExtensionUiBridge } from "../pi/pi-extension-ui";

describe("createStoryForgeAgentSession", () => {
  it("loads StoryForge skills and exposes PI, StoryForge, and MCP tools", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-session-"));
    const agentDir = join(rootDir, "agent");
    const skillDir = join(rootDir, "skills", "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---
name: storyforge-review
description: Review StoryForge changes carefully.
---

Run the StoryForge review checklist.
`);
    await writeFile(join(rootDir, "AGENTS.md"), "# Workspace instructions\n\nUse the project test conventions.\n");
    const settingsManager = SettingsManager.create(rootDir, agentDir);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      allowModelNetwork: false,
    });
    const model = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
    expect(model).toBeDefined();
    const customTools = [
      createTestTool("web_search", "Search the web"),
      createTestTool("automation_propose_create", "Propose an automation"),
      createTestTool("mcp__docs__search", "Search docs through MCP"),
    ];

    const session = await createStoryForgeAgentSession({
      cwd: rootDir,
      agentDir,
      modelRuntime,
      model: model!,
      settingsManager,
      sessionManager: SessionManager.inMemory(rootDir),
      additionalSkillPaths: [join(skillDir, "SKILL.md")],
      additionalExtensionPaths: [resolvePiTodoExtensionPath()],
      extensionUiContext: createExtensionUiContext(),
      extensionToolNames: [...customTools.map((tool) => tool.name), PI_TODO_TOOL_NAME],
      extensionFactories: [{
        name: "storyforge-test-tools",
        hidden: true,
        factory: (pi) => {
          for (const tool of customTools) {
            pi.registerTool(tool);
          }
        },
      }],
      systemPrompt: createStoryForgeSystemPrompt({
        extensionTools: customTools,
      }),
      appendSystemPrompt: "<storyforge_soul>Prefers Chinese responses.</storyforge_soul>",
    });

    expect(session.resourceLoader.getSkills().skills.map((skill) => skill.name))
      .toContain("storyforge-review");
    expect(session.systemPrompt).toMatch(/^You are StoryForge/);
    expect(session.systemPrompt).not.toContain("Pi documentation");
    expect(session.systemPrompt).not.toContain("operating inside pi");
    expect(session.systemPrompt).toContain("Use the project test conventions.");
    expect(session.systemPrompt).toContain("storyforge-review");
    expect(session.systemPrompt).toContain("Prefers Chinese responses.");
    expect(session.getActiveToolNames()).toEqual(expect.arrayContaining([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
      "todo",
      "web_search",
      "automation_propose_create",
      "mcp__docs__search",
    ]));
    for (const tool of customTools) {
      expect(session.systemPrompt).toContain(tool.name);
    }
    session.dispose();
  });

  it("uses StoryForge as the runtime identity and leaves tool policy to PI extensions", () => {
    const prompt = createStoryForgeSystemPrompt({
      extensionTools: [],
    });

    expect(prompt).toMatch(/^You are StoryForge/);
    expect(prompt).toContain("- read: Read file contents");
    expect(prompt).toContain("- todo: Maintain a phased task plan");
    expect(prompt).toContain("- write:");
    expect(prompt).toContain("- bash:");
    expect(prompt).not.toContain("Pi documentation");
    expect(prompt).toContain("transient environment context");
    expect(prompt).toContain("call ask_user to ask focused clarification questions");
    expect(prompt).toContain("Use ask_user for decisions only the user can make");
    expect(prompt).toContain("Treat <storyforge_soul> as fallible personalization context");
    expect(prompt).not.toContain("<current_date>");
  });

  it("adds Soul update guidance only when model-managed updates are enabled", () => {
    expect(createStoryForgeSystemPrompt({
      extensionTools: [],
      soulUpdatesEnabled: true,
    })).toContain("Use soul_propose_update");
    expect(createStoryForgeSystemPrompt({
      extensionTools: [],
    })).not.toContain("Use soul_propose_update");
  });

  it("rejects provider-incompatible extension tool names before creating a session", async () => {
    await expect(createStoryForgeAgentSession({
      cwd: "/tmp",
      agentDir: "/tmp",
      modelRuntime: {} as never,
      settingsManager: {} as never,
      sessionManager: {} as never,
      additionalExtensionPaths: [],
      extensionUiContext: createExtensionUiContext(),
      extensionToolNames: ["task.list"],
      extensionFactories: [],
      systemPrompt: "You are StoryForge.",
    })).rejects.toThrow('Invalid tool name "task.list"');
  });
});

function createExtensionUiContext() {
  return new PiExtensionUiBridge(() => undefined).createContext({
    sessionId: "sf_session_test",
    turnId: "sf_turn_test",
    signal: new AbortController().signal,
  });
}

function createTestTool(name: string, description: string) {
  return defineTool({
    name,
    label: name,
    description,
    promptSnippet: description,
    parameters: { type: "object", properties: {} } as never,
    async execute() {
      return { content: [{ type: "text" as const, text: "ok" }], details: {} };
    },
  });
}
