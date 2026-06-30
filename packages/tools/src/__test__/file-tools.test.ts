import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceFileTools } from "../file-tools";
import { WorkspaceSandbox } from "../workspace-sandbox";

describe("createWorkspaceFileTools", () => {
  it("searches text files and returns bounded line snippets", async () => {
    const root = await createWorkspace();
    const search = getTool("workspace.searchText", root);

    const output = await search.execute({
      query: "needle",
      maxResults: 2,
    }, {});

    expect(output).toEqual({
      query: "needle",
      matches: [
        { path: "notes/a.txt", line: 1, snippet: "needle in the first file" },
        { path: "notes/b.txt", line: 2, snippet: "another needle appears" },
      ],
      truncated: true,
    });
  });

  it("searches within a workspace-relative path", async () => {
    const root = await createWorkspace();
    const search = getTool("workspace.searchText", root);

    const output = await search.execute({
      query: "needle",
      path: "notes/b.txt",
    }, {});

    expect(output).toEqual({
      query: "needle",
      matches: [
        { path: "notes/b.txt", line: 2, snippet: "another needle appears" },
        { path: "notes/b.txt", line: 3, snippet: "needle again" },
      ],
      truncated: false,
    });
  });

  it("rejects empty queries", async () => {
    const root = await createWorkspace();
    const search = getTool("workspace.searchText", root);

    await expect(search.execute({ query: " " }, {})).rejects.toThrow(
      "workspace.searchText requires a non-empty query",
    );
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "story-forge-search-"));
  await mkdir(path.join(root, "notes"));
  await writeFile(path.join(root, "notes", "a.txt"), "needle in the first file\nno match here");
  await writeFile(path.join(root, "notes", "b.txt"), "intro\nanother needle appears\nneedle again");
  await writeFile(path.join(root, "notes", "binary.bin"), Buffer.from([0x00, 0x6e, 0x65, 0x65]));
  return root;
}

function getTool(name: string, root: string) {
  const sandbox = new WorkspaceSandbox(root);
  const tool = createWorkspaceFileTools(sandbox).find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}
