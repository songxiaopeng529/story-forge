import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceSandbox } from "./workspace-sandbox";

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "story-forge-tools-"));
  await writeFile(path.join(root, "chapter.txt"), "Once upon a forge");
  return root;
}

describe("WorkspaceSandbox", () => {
  it("reads text files inside the workspace root", async () => {
    const root = await createWorkspace();
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.readTextFile("chapter.txt")).resolves.toBe("Once upon a forge");
  });

  it("lists directories inside the workspace root by default", async () => {
    const root = await createWorkspace();
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.listDirectory()).resolves.toEqual(["chapter.txt"]);
  });

  it("blocks relative path traversal outside the workspace root", async () => {
    const root = await createWorkspace();
    const outsidePath = path.join(path.dirname(root), "outside.txt");
    await writeFile(outsidePath, "secret");
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.readTextFile("../outside.txt")).rejects.toThrow("Path escapes workspace root: ../outside.txt");
  });

  it("blocks absolute paths outside the workspace root", async () => {
    const root = await createWorkspace();
    const outsidePath = path.join(path.dirname(root), "absolute-outside.txt");
    await writeFile(outsidePath, "secret");
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.readTextFile(outsidePath)).rejects.toThrow(`Path escapes workspace root: ${outsidePath}`);
  });

  it("blocks symlinks that resolve outside the workspace root", async () => {
    const root = await createWorkspace();
    const outsidePath = path.join(path.dirname(root), "symlink-outside.txt");
    const linkPath = path.join(root, "linked-secret.txt");
    await writeFile(outsidePath, "secret");
    await symlink(outsidePath, linkPath);
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.readTextFile("linked-secret.txt")).rejects.toThrow(
      "Path escapes workspace root: linked-secret.txt",
    );
    await expect(readFile(outsidePath, "utf8")).resolves.toBe("secret");
  });
});
