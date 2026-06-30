import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceSandbox } from "../workspace-sandbox";

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

    await expect(sandbox.readTextFile(outsidePath)).rejects.toThrow(
      `Path escapes workspace root: ${outsidePath}`,
    );
  });

  it("reads and lists absolute paths when they point inside the workspace", async () => {
    const root = await createWorkspace();
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.readTextFile(path.join(root, "chapter.txt"))).resolves.toBe(
      "Once upon a forge",
    );
    await expect(sandbox.listDirectory(root)).resolves.toEqual(["chapter.txt"]);
  });

  it("writes absolute paths when they point inside the workspace", async () => {
    const root = await createWorkspace();
    const sandbox = new WorkspaceSandbox(root);
    const targetPath = path.join(root, "drafts", "absolute.txt");

    await expect(sandbox.writeTextFile(targetPath, "absolute draft")).resolves.toEqual({
      path: targetPath,
      bytes: Buffer.byteLength("absolute draft"),
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("absolute draft");
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

  it("blocks symlinked directories that resolve outside the workspace root", async () => {
    const root = await createWorkspace();
    const outsideDirectory = await mkdtemp(path.join(path.dirname(root), "outside-directory-"));
    const linkPath = path.join(root, "linked-directory");
    await writeFile(path.join(outsideDirectory, "secret.txt"), "secret");
    await symlink(outsideDirectory, linkPath);
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.listDirectory("linked-directory")).rejects.toThrow(
      "Path escapes workspace root: linked-directory",
    );
  });

  it("writes new files and replaces exact text inside the workspace", async () => {
    const root = await createWorkspace();
    const sandbox = new WorkspaceSandbox(root);

    await sandbox.writeTextFile("drafts/chapter-2.txt", "First draft");
    await sandbox.replaceText("drafts/chapter-2.txt", "First", "Second");

    await expect(readFile(path.join(root, "drafts/chapter-2.txt"), "utf8")).resolves.toBe(
      "Second draft",
    );
  });

  it("validates the nearest existing parent before creating a file", async () => {
    const root = await createWorkspace();
    const outsideDirectory = await mkdtemp(path.join(path.dirname(root), "outside-write-"));
    await symlink(outsideDirectory, path.join(root, "linked-write"));
    const sandbox = new WorkspaceSandbox(root);

    await expect(sandbox.writeTextFile("linked-write/secret.txt", "blocked")).rejects.toThrow(
      "Path escapes workspace root",
    );
  });

  it("limits individual reads and writes to two MiB", async () => {
    const root = await createWorkspace();
    const sandbox = new WorkspaceSandbox(root);
    const oversized = "x".repeat(2 * 1024 * 1024 + 1);
    await writeFile(path.join(root, "oversized.txt"), oversized);

    await expect(sandbox.readTextFile("oversized.txt")).rejects.toThrow("File exceeds 2097152 byte limit");
    await expect(sandbox.writeTextFile("new.txt", oversized)).rejects.toThrow(
      "File exceeds 2097152 byte limit",
    );
  });

  it("rejects replacement when the requested text is absent", async () => {
    const root = await createWorkspace();
    await mkdir(path.join(root, "drafts"));
    await writeFile(path.join(root, "drafts", "chapter.txt"), "Original");
    const sandbox = new WorkspaceSandbox(root);

    await expect(
      sandbox.replaceText("drafts/chapter.txt", "Missing", "Replacement"),
    ).rejects.toThrow("Text to replace was not found");
  });
});
