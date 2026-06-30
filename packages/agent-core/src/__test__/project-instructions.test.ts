import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectInstructions } from "../project-instructions";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadProjectInstructions", () => {
  it("returns an empty context when no AGENTS file exists", async () => {
    const workspace = await createTempWorkspace();

    await expect(loadProjectInstructions(workspace)).resolves.toEqual({
      sources: [],
      warnings: [],
    });
  });

  it("loads AGENTS.override.md before AGENTS.md", async () => {
    const workspace = await createTempWorkspace();
    await writeFile(join(workspace, "AGENTS.md"), "Base project rules", "utf8");
    await writeFile(join(workspace, "AGENTS.override.md"), "Override project rules", "utf8");

    const context = await loadProjectInstructions(workspace);

    expect(context.warnings).toEqual([]);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]).toMatchObject({
      path: join(workspace, "AGENTS.override.md"),
      scope: "project",
      content: "Override project rules",
      truncated: false,
      byteCount: Buffer.byteLength("Override project rules", "utf8"),
    });
  });

  it("skips empty instruction files", async () => {
    const workspace = await createTempWorkspace();
    await writeFile(join(workspace, "AGENTS.md"), "   \n\t", "utf8");

    await expect(loadProjectInstructions(workspace)).resolves.toEqual({
      sources: [],
      warnings: [],
    });
  });

  it("truncates instructions by UTF-8 byte length and records a warning", async () => {
    const workspace = await createTempWorkspace();
    await writeFile(join(workspace, "AGENTS.md"), "abcdef", "utf8");

    const context = await loadProjectInstructions(workspace, { maxBytes: 3 });

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]).toMatchObject({
      content: "abc",
      truncated: true,
      byteCount: 6,
    });
    expect(context.warnings).toEqual([
      `Project instructions truncated at 3 bytes: ${join(workspace, "AGENTS.md")}`,
    ]);
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "story-forge-agent-core-"));
  tempDirs.push(dir);
  return dir;
}
