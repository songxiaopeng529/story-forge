// @vitest-environment node

import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkspaceToolCall } from "../workspace/guard";

describe("checkWorkspaceToolCall", () => {
  it("allows read-only paths contained by the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-forge-workspace-guard-"));
    const file = join(root, "src", "index.ts");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(file, "export {};\n", "utf8");

    await expect(checkWorkspaceToolCall(root, "read", { path: "src/index.ts" }))
      .resolves.toBeUndefined();
    await expect(checkWorkspaceToolCall(root, "grep", { path: "src" }))
      .resolves.toBeUndefined();
  });

  it("blocks lexical traversal and absolute paths outside the workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "story-forge-workspace-guard-"));
    const root = join(parent, "workspace");
    await mkdir(root, { recursive: true });

    await expect(checkWorkspaceToolCall(root, "read", { path: "../secret.txt" }))
      .resolves.toMatchObject({ block: true });
    await expect(checkWorkspaceToolCall(root, "ls", { path: join(parent, "outside") }))
      .resolves.toMatchObject({ block: true });
  });

  it("blocks an existing symlink that resolves outside the workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "story-forge-workspace-guard-"));
    const root = join(parent, "workspace");
    const outside = join(parent, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, join(root, "linked"));

    await expect(checkWorkspaceToolCall(root, "read", {
      path: "linked/secret.txt",
    })).resolves.toEqual({
      block: true,
      reason: "read path resolves outside the current workspace.",
    });
  });

  it("blocks a missing target below a symlinked outside directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "story-forge-workspace-guard-"));
    const root = join(parent, "workspace");
    const outside = join(parent, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(root, "linked"));

    await expect(checkWorkspaceToolCall(root, "find", {
      path: "linked/not-created-yet",
    })).resolves.toMatchObject({ block: true });
  });

  it("ignores non-filesystem tools", async () => {
    await expect(checkWorkspaceToolCall("/missing", "current_time", {
      path: "../outside",
    })).resolves.toBeUndefined();
  });
});
