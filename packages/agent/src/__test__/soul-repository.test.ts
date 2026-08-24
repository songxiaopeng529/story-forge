// @vitest-environment node

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SOUL_MAX_BYTES } from "@story-forge/shared";
import { SoulRepository } from "../persistence/soul-repository";

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SoulRepository", () => {
  it("reads a missing document and atomically persists normalized Markdown", async () => {
    const rootDir = await createTestDir();
    const filePath = join(rootDir, "soul.md");
    const repository = new SoulRepository({ filePath });
    const missing = await repository.get();

    expect(missing).toMatchObject({
      content: "",
      exists: false,
      byteLength: 0,
      maxBytes: SOUL_MAX_BYTES,
      filePath,
    });

    const saved = await repository.save({
      content: "# Soul\r\n\r\n- Prefers Chinese.  ",
      expectedRevision: missing.revision,
    });

    expect(saved.content).toBe("# Soul\n\n- Prefers Chinese.\n");
    expect(saved.exists).toBe(true);
    expect(saved.revision).not.toBe(missing.revision);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(repository.get()).resolves.toEqual(saved);
  });

  it("rejects stale revisions and oversized documents", async () => {
    const rootDir = await createTestDir();
    const repository = new SoulRepository({ filePath: join(rootDir, "soul.md") });
    const initial = await repository.get();
    const saved = await repository.save({
      content: "# Soul\n",
      expectedRevision: initial.revision,
    });

    await expect(repository.save({
      content: "# Replaced\n",
      expectedRevision: initial.revision,
    })).rejects.toThrow("changed since it was loaded");
    await expect(repository.save({
      content: "x".repeat(SOUL_MAX_BYTES + 1),
      expectedRevision: saved.revision,
    })).rejects.toThrow("must not exceed");
  });
});

async function createTestDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "storyforge-soul-"));
  testDirs.push(directory);
  return directory;
}
