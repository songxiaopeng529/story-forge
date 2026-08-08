// @vitest-environment node

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  GitRepositoryService,
  type GitCommandOptions,
  type GitCommandResult,
} from "../git-repository-service";

const HEAD_OID = "0123456789abcdef0123456789abcdef01234567";
const OTHER_OID = "89abcdef0123456789abcdef0123456789abcdef";
const execFile = promisify(execFileCallback);

describe("GitRepositoryService", () => {
  it("reads a real repository without mutating it", async () => {
    const root = await mkdtemp(join(tmpdir(), "story-forge-git-view-"));
    try {
      await execFile("git", ["init"], { cwd: root });
      await writeFile(join(root, "tracked.txt"), "initial\n", "utf8");
      await execFile("git", ["add", "tracked.txt"], { cwd: root });
      await execFile("git", [
        "-c",
        "user.name=StoryForge Test",
        "-c",
        "user.email=storyforge@example.invalid",
        "commit",
        "-m",
        "Initial commit",
      ], { cwd: root });
      await writeFile(join(root, "tracked.txt"), "changed\n", "utf8");
      await writeFile(join(root, "untracked.txt"), "new\n", "utf8");

      const service = new GitRepositoryService({
        workspaces: {
          get: vi.fn(async () => ({
            id: "workspace-real",
            path: root,
            displayName: "real",
            createdAt: "2026-08-07T00:00:00.000Z",
            lastOpenedAt: "2026-08-07T00:00:00.000Z",
          })),
        },
        now: () => 1_725_000_001,
      });

      const before = await snapshotRepository(root);
      const repository = await readyResult(service.get("workspace-real"));
      const after = await snapshotRepository(root);
      expect(repository.rootPath).toBe(await realpath(root));
      expect(repository.head.branch).toBeTruthy();
      expect(repository.lastCommit).toMatchObject({ subject: "Initial commit" });
      expect(repository.changes).toMatchObject({
        total: 2,
        staged: 0,
        modified: 1,
        untracked: 1,
      });
      expect(after).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns repository, changes, commit, and local/remote-tracking branch information", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(
        nulRecords(
          `# branch.oid ${HEAD_OID}`,
          "# branch.head feature/sidebar",
          "# branch.upstream origin/main",
          "# branch.ab +2 -1",
          ordinary("M.", "src/staged.ts"),
          ordinary(".D", "src/deleted.ts"),
          "? notes.txt",
        ),
      ),
      log: result("0123456\x00Add repository panel\x001698765432\n"),
      "for-each-ref": result(
        [
          refRecord(
            "refs/heads/feature/sidebar",
            "feature/sidebar",
            "*",
            HEAD_OID,
            "origin/main",
          ),
          refRecord("refs/heads/main", "main", " ", OTHER_OID, "origin/main"),
          refRecord("refs/remotes/origin/main", "origin/main", " ", OTHER_OID, ""),
          refRecord(
            "refs/remotes/origin/HEAD",
            "origin/HEAD",
            " ",
            OTHER_OID,
            "",
            "refs/remotes/origin/main",
          ),
        ].join(""),
      ),
    });

    await expect(createService(runner).get("workspace-1")).resolves.toEqual({
      status: "ready",
      workspaceId: "workspace-1",
      checkedAt: 1_725_000_000,
      rootPath: "/workspace",
      head: {
        branch: "feature/sidebar",
        commit: HEAD_OID,
        detached: false,
        unborn: false,
      },
      upstream: { name: "origin/main", ahead: 2, behind: 1, gone: false },
      lastCommit: {
        shortHash: "0123456",
        subject: "Add repository panel",
        committedAt: 1_698_765_432,
      },
      changes: {
        total: 3,
        staged: 1,
        modified: 1,
        added: 0,
        deleted: 1,
        renamed: 0,
        untracked: 1,
        conflicted: 0,
        files: [
          file("src/staged.ts", "modified", null),
          file("src/deleted.ts", null, "deleted"),
          {
            path: "notes.txt",
            originalPath: null,
            indexStatus: null,
            worktreeStatus: null,
            untracked: true,
            conflicted: false,
          },
        ],
      },
      branches: {
        local: [
          branch("feature/sidebar", "local", true, HEAD_OID, "origin/main", 2, 1),
          branch("main", "local", false, OTHER_OID, "origin/main"),
        ],
        remote: [branch("origin/main", "remote", false, OTHER_OID, null)],
      },
    });

    expect(runner.mock.calls.map(([args]) => commandArgs(args))).toEqual([
      ["rev-parse", "--show-toplevel"],
      [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=normal",
        "--ignore-submodules=all",
      ],
      [
        "for-each-ref",
        "--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(objectname)%00%(upstream:short)%00%(symref)",
        "refs/heads",
        "refs/remotes",
      ],
      ["log", "-1", "--format=%h%x00%s%x00%ct"],
    ]);
    expect(runner.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/workspace",
      timeout: 5_000,
      env: {
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_NO_LAZY_FETCH: "1",
        LC_ALL: "C",
      },
    });
    expect(runner.mock.calls[0]?.[0].slice(0, 4)).toEqual([
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
    ]);
    expect(runner.mock.calls[0]?.[1].env).not.toHaveProperty("HOME");
    expect(runner.mock.calls[0]?.[1].maxBuffer).toBeGreaterThan(0);
  });

  it("returns not-repository for an ordinary directory", async () => {
    const runner = fakeRunner({
      "rev-parse": gitError(
        "fatal: not a git repository (or any of the parent directories): .git",
      ),
    });

    await expect(createService(runner, 101).get("workspace-1")).resolves.toEqual({
      status: "not-repository",
      workspaceId: "workspace-1",
      checkedAt: 101,
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("represents detached HEAD without inventing a branch or upstream", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(nulRecords(`# branch.oid ${HEAD_OID}`, "# branch.head (detached)")),
      log: result("0123456\x00Detached commit\x001700000000\n"),
      "for-each-ref": result(
        refRecord("refs/heads/main", "main", " ", HEAD_OID, "origin/main"),
      ),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.head).toEqual({
      branch: null,
      commit: HEAD_OID,
      detached: true,
      unborn: false,
    });
    expect(repository.upstream).toBeNull();
    expect(repository.branches.local[0]?.current).toBe(false);
  });

  it("parses NUL-delimited rename paths including spaces", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(
        nulRecords(
          `# branch.oid ${HEAD_OID}`,
          "# branch.head main",
          renamed("R.", "src/new name.ts"),
          "src/old name.ts",
        ),
      ),
      log: result("0123456\x00Rename file\x001700000000\n"),
      "for-each-ref": result(
        refRecord("refs/heads/main", "main", "*", HEAD_OID, ""),
      ),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.changes).toMatchObject({ total: 1, staged: 1, renamed: 1 });
    expect(repository.changes.files).toEqual([
      {
        ...file("src/new name.ts", "renamed", null),
        originalPath: "src/old name.ts",
      },
    ]);
  });

  it("marks unmerged records as conflicted without counting them as staged", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(
        nulRecords(
          `# branch.oid ${HEAD_OID}`,
          "# branch.head main",
          unmerged("UU", "src/conflict.ts"),
        ),
      ),
      log: result("0123456\x00Conflict\x001700000000\n"),
      "for-each-ref": result(
        refRecord("refs/heads/main", "main", "*", HEAD_OID, ""),
      ),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.changes).toMatchObject({ total: 1, staged: 0, conflicted: 1 });
    expect(repository.changes.files[0]).toEqual({
      path: "src/conflict.ts",
      originalPath: null,
      indexStatus: "unmerged",
      worktreeStatus: "unmerged",
      untracked: false,
      conflicted: true,
    });
  });

  it("handles an unborn branch without invoking git log", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(
        nulRecords("# branch.oid (initial)", "# branch.head main", "? README.md"),
      ),
      "for-each-ref": result(""),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.head).toEqual({
      branch: "main",
      commit: null,
      detached: false,
      unborn: true,
    });
    expect(repository.lastCommit).toBeNull();
    expect(runner.mock.calls.map(([args]) => commandArgs(args)[0])).not.toContain("log");
  });

  it("marks a missing tracked ref as a gone upstream", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(
        nulRecords(
          `# branch.oid ${HEAD_OID}`,
          "# branch.head feature/old",
          "# branch.upstream origin/old",
        ),
      ),
      log: result("0123456\x00Old branch\x001700000000\n"),
      "for-each-ref": result(
        refRecord(
          "refs/heads/feature/old",
          "feature/old",
          "*",
          HEAD_OID,
          "origin/old",
        ),
      ),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.upstream).toEqual({
      name: "origin/old",
      ahead: 0,
      behind: 0,
      gone: true,
    });
  });

  it("uses one primary category for mixed index and worktree states", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(
        nulRecords(
          `# branch.oid ${HEAD_OID}`,
          "# branch.head main",
          renamed("RM", "src/renamed.ts"),
          "src/original.ts",
          ordinary("MD", "src/deleted-after-stage.ts"),
        ),
      ),
      log: result("0123456\x00Mixed changes\x001700000000\n"),
      "for-each-ref": result(refRecord("refs/heads/main", "main", "*", HEAD_OID, "")),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.changes).toMatchObject({
      total: 2,
      staged: 2,
      modified: 0,
      deleted: 1,
      renamed: 1,
    });
  });

  it("keeps core status available when optional branch or log reads fail", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: result(nulRecords(`# branch.oid ${HEAD_OID}`, "# branch.head main")),
      log: gitError("corrupt commit metadata at /private/workspace"),
      "for-each-ref": gitError("unable to enumerate refs"),
    });

    const repository = await readyResult(createService(runner).get("workspace-1"));
    expect(repository.head.branch).toBe("main");
    expect(repository.lastCommit).toBeNull();
    expect(repository.branches).toEqual({ local: [], remote: [] });
  });

  it("coalesces concurrent reads for the same workspace", async () => {
    const root = createDeferred<GitCommandResult>();
    const fallback = fakeRunner({
      status: result(nulRecords(`# branch.oid ${HEAD_OID}`, "# branch.head main")),
      log: result("0123456\x00Commit\x001700000000\n"),
      "for-each-ref": result(refRecord("refs/heads/main", "main", "*", HEAD_OID, "")),
    });
    const runner = vi.fn(async (args: readonly string[], options: GitCommandOptions) => {
      if (commandArgs(args)[0] === "rev-parse") {
        return root.promise;
      }
      return fallback(args, options);
    });
    const service = createService(runner);

    const first = service.get("workspace-1");
    const second = service.get("workspace-1");
    expect(second).toBe(first);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));

    root.resolve(result("/workspace\n"));
    await expect(first).resolves.toMatchObject({ status: "ready" });
  });

  it("does not expose raw Git diagnostics", async () => {
    const runner = fakeRunner({
      "rev-parse": result("/workspace\n"),
      status: gitError("secret-token in /private/workspace/.git/config"),
    });

    await expect(createService(runner, 303).get("workspace-1")).resolves.toEqual({
      status: "unavailable",
      workspaceId: "workspace-1",
      checkedAt: 303,
      message: "Git repository information is unavailable.",
    });
  });

  it("returns unavailable when git is missing", async () => {
    const error = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });

    await expect(createService(fakeRunner({ "rev-parse": error }), 202).get("workspace-1"))
      .resolves.toEqual({
        status: "unavailable",
        workspaceId: "workspace-1",
        checkedAt: 202,
        message: "Git is not installed or is not available on PATH.",
      });
  });
});

function createService(runner: ReturnType<typeof fakeRunner>, checkedAt = 1_725_000_000) {
  return new GitRepositoryService({
    workspaces: {
      get: vi.fn(async (workspaceId: string) => ({
        id: workspaceId,
        path: "/workspace",
        displayName: "workspace",
        createdAt: "2026-08-07T00:00:00.000Z",
        lastOpenedAt: "2026-08-07T00:00:00.000Z",
      })),
    },
    runner,
    now: () => checkedAt,
  });
}

function fakeRunner(responses: Record<string, GitCommandResult | Error>) {
  return vi.fn(async (args: readonly string[], _options: GitCommandOptions) => {
    const command = commandArgs(args)[0] ?? "";
    const response = responses[command];
    if (response === undefined) {
      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

async function readyResult(resultPromise: ReturnType<GitRepositoryService["get"]>) {
  const repository = await resultPromise;
  if (repository.status !== "ready") {
    throw new Error(`Expected ready, received ${repository.status}`);
  }
  return repository;
}

function result(stdout: string): GitCommandResult {
  return { stdout, stderr: "" };
}

function nulRecords(...records: string[]): string {
  return `${records.join("\0")}\0`;
}

function ordinary(xy: string, path: string): string {
  return `1 ${xy} N... 100644 100644 100644 ${HEAD_OID} ${HEAD_OID} ${path}`;
}

function renamed(xy: string, path: string): string {
  return `2 ${xy} N... 100644 100644 100644 ${HEAD_OID} ${HEAD_OID} R100 ${path}`;
}

function unmerged(xy: string, path: string): string {
  return `u ${xy} N... 100644 100644 100644 100644 ${HEAD_OID} ${HEAD_OID} ${HEAD_OID} ${path}`;
}

function file(
  path: string,
  indexStatus: "modified" | "renamed" | null,
  worktreeStatus: "deleted" | null,
) {
  return {
    path,
    originalPath: null,
    indexStatus,
    worktreeStatus,
    untracked: false,
    conflicted: false,
  };
}

function branch(
  name: string,
  kind: "local" | "remote",
  current: boolean,
  commit: string,
  upstream: string | null,
  ahead: number | null = null,
  behind: number | null = null,
) {
  return { name, kind, current, commit, upstream, ahead, behind };
}

function refRecord(
  refname: string,
  name: string,
  headMarker: string,
  commit: string,
  upstream: string,
  symref = "",
): string {
  return [refname, name, headMarker, commit, upstream, symref].join("\0") + "\n";
}

function commandArgs(args: readonly string[]): readonly string[] {
  return args.slice(4);
}

function gitError(stderr: string): Error {
  return Object.assign(new Error("git failed"), { code: 128, stderr });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function snapshotRepository(root: string) {
  const readOnlyGit = async (args: string[]) => execFile("git", [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    ...args,
  ], {
    cwd: root,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
  });
  const [refs, status, config, index] = await Promise.all([
    readOnlyGit(["show-ref", "--head"]),
    readOnlyGit([
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=all",
    ]),
    readFile(join(root, ".git", "config")),
    readFile(join(root, ".git", "index")),
  ]);
  return {
    refs: refs.stdout,
    status: status.stdout,
    config,
    index,
  };
}
