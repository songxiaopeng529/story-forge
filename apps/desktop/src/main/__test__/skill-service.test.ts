// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillService } from "../skill-service";

describe("SkillService", () => {
  it("imports a skill archive through an injected extractor", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-skills-"));
    const archivePath = join(rootDir, "skill.zip");
    await writeFile(archivePath, "fake zip");
    const service = new SkillService({
      rootDir,
      extractArchive: async (_archive, destination) => {
        await mkdir(join(destination, "review"), { recursive: true });
        await writeFile(
          join(destination, "review", "SKILL.md"),
          `---
name: Code Review
description: Review code changes
---

Review the current code carefully.
`,
        );
      },
    });

    await expect(service.importZip(archivePath)).resolves.toMatchObject({
      name: "Code Review",
      invocationName: "/code-review",
      enabled: true,
    });
    await expect(service.list()).resolves.toHaveLength(1);
    await expect(readFile(join(rootDir, "skills", "skills.json"), "utf8")).resolves.toContain(
      "code-review",
    );
  });

  it("supports enable, disable, delete, and invocation lookup", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-skills-"));
    const archivePath = join(rootDir, "skill.zip");
    await writeFile(archivePath, "fake zip");
    const service = new SkillService({
      rootDir,
      extractArchive: async (_archive, destination) => {
        await writeFile(
          join(destination, "SKILL.md"),
          `---
name: Deploy
description: Deploy safely
---

Run the deployment checklist.
`,
        );
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
