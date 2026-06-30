// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceRepository } from "../workspace-repository";

describe("WorkspaceRepository", () => {
  it("deduplicates workspaces by canonical path", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-workspaces-"));
    const workspacePath = await mkdtemp(join(tmpdir(), "story-forge-project-"));
    const repository = new WorkspaceRepository({ rootDir });

    const first = await repository.open(workspacePath);
    const second = await repository.open(join(workspacePath, "."));

    expect(second.id).toBe(first.id);
    expect(await repository.list()).toHaveLength(1);
  });
});
