// @vitest-environment node

import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateLegacyStoryForgeHome,
  resolveStoryForgePaths,
} from "../persistence/storyforge-home";

describe("StoryForge home", () => {
  it("resolves the default and configured StoryForge home", () => {
    expect(resolveStoryForgePaths({
      userHomeDir: "/Users/storyforge",
      env: {},
    })).toMatchObject({
      rootDir: "/Users/storyforge/.story-forge",
      agentDir: "/Users/storyforge/.story-forge/agent",
      sessionMetadataDir: "/Users/storyforge/.story-forge/sessions/metadata",
      sessionTranscriptsDir: "/Users/storyforge/.story-forge/sessions/transcripts",
    });

    expect(resolveStoryForgePaths({
      userHomeDir: "/Users/storyforge",
      env: { STORYFORGE_HOME: "~/custom-storyforge" },
    }).rootDir).toBe("/Users/storyforge/custom-storyforge");
  });

  it("migrates durable Electron data and rewrites embedded absolute paths", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "storyforge-home-"));
    const legacyRootDir = join(testDir, "electron-user-data");
    const paths = resolveStoryForgePaths({ homeDir: join(testDir, ".story-forge") });
    const legacyTranscript = join(
      legacyRootDir,
      "pi-sessions",
      "sf_workspace_one",
      "session.jsonl",
    );
    const legacySkillRoot = join(legacyRootDir, "skills", "demo");
    const legacyAgentExtension = join(legacyRootDir, "pi-agent", "extensions", "demo.ts");

    try {
      await writeJson(join(legacyRootDir, "settings.json"), { developerMode: true });
      await writeJson(join(legacyRootDir, "automations", "automations.json"), {
        schemaVersion: 1,
        automations: [],
      });
      await writeJson(join(legacyRootDir, "sessions", "sf_session_one.json"), {
        schemaVersion: 2,
        id: "sf_session_one",
        piSessionFile: legacyTranscript,
      });
      await writeFileEnsured(legacyTranscript, "{\"type\":\"session\"}\n");
      await writeFileEnsured(join(legacySkillRoot, "SKILL.md"), "# Demo\n");
      await writeJson(join(legacyRootDir, "skills", "skills.json"), {
        schemaVersion: 1,
        skills: [{
          id: "demo",
          rootDir: legacySkillRoot,
          entrypointPath: join(legacySkillRoot, "SKILL.md"),
        }],
      });
      await writeJson(join(legacyRootDir, "pi-agent", "settings.json"), {
        extensions: [legacyAgentExtension],
      });
      const legacyAuthPath = join(legacyRootDir, "pi-agent", "auth.json");
      await writeJson(legacyAuthPath, { deepseek: { type: "api_key", key: "secret" } });
      await chmod(legacyAuthPath, 0o600);

      const result = await migrateLegacyStoryForgeHome({ legacyRootDir, paths });

      expect(result).toMatchObject({ status: "migrated", copiedFiles: 8 });
      await expect(readFile(paths.appSettingsPath, "utf8")).resolves.toContain("developerMode");
      await expect(readFile(
        join(paths.sessionTranscriptsDir, "sf_workspace_one", "session.jsonl"),
        "utf8",
      )).resolves.toContain("session");

      const session = await readJson(join(paths.sessionMetadataDir, "sf_session_one.json"));
      expect(session.piSessionFile).toBe(
        join(paths.sessionTranscriptsDir, "sf_workspace_one", "session.jsonl"),
      );
      const skillIndex = await readJson(join(paths.skillsDir, "skills.json"));
      expect(skillIndex.skills).toEqual([expect.objectContaining({
        rootDir: join(paths.skillsDir, "demo"),
        entrypointPath: join(paths.skillsDir, "demo", "SKILL.md"),
      })]);
      const piSettings = await readJson(join(paths.agentDir, "settings.json"));
      expect(piSettings.extensions).toEqual([join(paths.agentDir, "extensions", "demo.ts")]);
      expect((await stat(join(paths.agentDir, "auth.json"))).mode & 0o777).toBe(0o600);
      await expect(readFile(legacyTranscript, "utf8")).resolves.toContain("session");

      await writeJson(paths.appSettingsPath, { developerMode: false });
      await expect(migrateLegacyStoryForgeHome({ legacyRootDir, paths })).resolves.toMatchObject({
        status: "already-migrated",
        copiedFiles: 0,
      });
      await expect(readJson(paths.appSettingsPath)).resolves.toEqual({ developerMode: false });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFileEnsured(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileEnsured(filePath: string, value: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, any>;
}
