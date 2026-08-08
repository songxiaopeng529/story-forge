import { execFile } from "node:child_process";
import { devNull } from "node:os";
import type {
  GitBranchView,
  GitChangedFileView,
  GitFileStatusView,
  GitRepositoryView,
} from "../shared/story-forge-api";
import type { WorkspaceRepository } from "./workspace-repository";

const GIT_COMMAND_TIMEOUT_MS = 5_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const GIT_CONFIG_PREFIX = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

export type GitCommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
};

export type GitCommandRunner = (
  args: readonly string[],
  options: GitCommandOptions,
) => Promise<GitCommandResult>;

type GitRepositoryServiceOptions = {
  workspaces: Pick<WorkspaceRepository, "get">;
  runner?: GitCommandRunner;
  now?: () => number;
};

type StatusSnapshot = {
  head: {
    branch: string | null;
    commit: string | null;
    detached: boolean;
    unborn: boolean;
  };
  upstream: {
    name: string;
    ahead: number;
    behind: number;
    gone: boolean;
  } | null;
  changes: Extract<GitRepositoryView, { status: "ready" }>["changes"];
};

type ParsedBranch = {
  view: GitBranchView;
};

type GitFailureView = Extract<
  GitRepositoryView,
  { status: "not-repository" | "unavailable" }
>;

export class GitRepositoryService {
  private readonly workspaces: Pick<WorkspaceRepository, "get">;
  private readonly runner: GitCommandRunner;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<GitRepositoryView>>();

  constructor(options: GitRepositoryServiceOptions) {
    this.workspaces = options.workspaces;
    this.runner = options.runner ?? runGitCommand;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  get(workspaceId: string): Promise<GitRepositoryView> {
    const existing = this.inFlight.get(workspaceId);
    if (existing) {
      return existing;
    }
    const request = this.inspect(workspaceId);
    this.inFlight.set(workspaceId, request);
    const clear = () => {
      if (this.inFlight.get(workspaceId) === request) {
        this.inFlight.delete(workspaceId);
      }
    };
    void request.then(clear, clear);
    return request;
  }

  private async inspect(workspaceId: string): Promise<GitRepositoryView> {
    const workspace = await this.workspaces.get(workspaceId);
    const checkedAt = this.now();

    let rootPath: string;
    try {
      const result = await this.run(workspace.path, ["rev-parse", "--show-toplevel"]);
      rootPath = removeTrailingLineEnding(result.stdout);
      if (rootPath.length === 0) {
        return unavailable(workspaceId, checkedAt, "Git returned an empty repository root.");
      }
    } catch (error) {
      return viewForGitError(workspaceId, checkedAt, error);
    }

    let status: StatusSnapshot;
    try {
      const result = await this.run(workspace.path, [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=normal",
        "--ignore-submodules=all",
      ]);
      status = parseStatus(result.stdout);
    } catch (error) {
      return viewForGitError(workspaceId, checkedAt, error);
    }

    let branches: ParsedBranch[] = [];
    try {
      const result = await this.run(workspace.path, [
        "for-each-ref",
        "--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(objectname)%00%(upstream:short)%00%(symref)",
        "refs/heads",
        "refs/remotes",
      ]);
      branches = parseBranches(result.stdout);
    } catch {
      // Branch enumeration is supplementary; head and changes remain useful.
    }

    const lastCommit = status.head.unborn
      ? null
      : await this.readLastCommit(workspace.path);

    const currentBranch = branches.find(
      ({ view }) =>
        view.kind === "local" &&
        (view.current || (status.head.branch !== null && view.name === status.head.branch)),
    );
    if (
      status.upstream !== null &&
      currentBranch?.view.upstream === status.upstream.name
    ) {
      currentBranch.view.ahead = status.upstream.ahead;
      currentBranch.view.behind = status.upstream.behind;
      status.upstream.gone = !branches.some(
        ({ view }) => view.name === status.upstream?.name,
      );
    }

    return {
      status: "ready",
      workspaceId,
      checkedAt,
      rootPath,
      head: status.head,
      upstream: status.upstream,
      lastCommit,
      changes: status.changes,
      branches: {
        local: branches
          .filter(({ view }) => view.kind === "local")
          .map(({ view }) => view)
          .sort(compareBranches),
        remote: branches
          .filter(({ view }) => view.kind === "remote")
          .map(({ view }) => view)
          .sort(compareBranches),
      },
    };
  }

  private run(cwd: string, args: readonly string[]): Promise<GitCommandResult> {
    return this.runner([...GIT_CONFIG_PREFIX, ...args], {
      cwd,
      env: createGitEnvironment(),
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    });
  }

  private async readLastCommit(
    cwd: string,
  ): Promise<{ shortHash: string; subject: string; committedAt: number } | null> {
    try {
      const result = await this.run(cwd, ["log", "-1", "--format=%h%x00%s%x00%ct"]);
      return parseLastCommit(result.stdout);
    } catch {
      return null;
    }
  }
}

function runGitCommand(
  args: readonly string[],
  options: GitCommandOptions,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function createGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  const safeInheritedKeys = new Set([
    "COMSPEC",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && safeInheritedKeys.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  return {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
}

function parseStatus(stdout: string): StatusSnapshot {
  let branchName: string | null = null;
  let commit: string | null = null;
  let detached = false;
  let unborn = false;
  let upstreamName: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitChangedFileView[] = [];
  const records = stdout.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length === 0) {
      continue;
    }

    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length);
      unborn = oid === "(initial)" || /^0+$/.test(oid);
      commit = unborn ? null : oid;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length);
      detached = head === "(detached)";
      branchName = detached || head === "(unknown)" ? null : head;
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstreamName = record.slice("# branch.upstream ".length);
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match !== null) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }

    const ordinary = /^1 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/s.exec(record);
    if (ordinary !== null) {
      files.push(changedFile(ordinary[2] ?? "", null, ordinary[1] ?? ".."));
      continue;
    }

    const renamed = /^2 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/s.exec(record);
    if (renamed !== null) {
      const originalPath = records[index + 1] ?? "";
      index += 1;
      files.push(changedFile(renamed[2] ?? "", originalPath, renamed[1] ?? ".."));
      continue;
    }

    const unmerged = /^u [^ ]{2} [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/s.exec(
      record,
    );
    if (unmerged !== null) {
      files.push({
        path: unmerged[1] ?? "",
        originalPath: null,
        indexStatus: "unmerged",
        worktreeStatus: "unmerged",
        untracked: false,
        conflicted: true,
      });
      continue;
    }

    if (record.startsWith("? ")) {
      files.push({
        path: record.slice(2),
        originalPath: null,
        indexStatus: null,
        worktreeStatus: null,
        untracked: true,
        conflicted: false,
      });
    }
  }

  return {
    head: { branch: branchName, commit, detached, unborn },
    upstream:
      upstreamName === null ? null : { name: upstreamName, ahead, behind, gone: false },
    changes: summarizeChanges(files),
  };
}

function changedFile(path: string, originalPath: string | null, xy: string): GitChangedFileView {
  return {
    path,
    originalPath,
    indexStatus: statusForCode(xy[0]),
    worktreeStatus: statusForCode(xy[1]),
    untracked: false,
    conflicted: isConflictCode(xy),
  };
}

function statusForCode(code: string | undefined): GitFileStatusView | null {
  switch (code) {
    case "M":
      return "modified";
    case "T":
      return "type-changed";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    default:
      return null;
  }
}

function isConflictCode(xy: string): boolean {
  return xy.includes("U") || ["DD", "AA"].includes(xy);
}

function summarizeChanges(files: GitChangedFileView[]): StatusSnapshot["changes"] {
  const categories = files.map(primaryChangeCategory);

  return {
    total: files.length,
    staged: files.filter((file) => !file.conflicted && file.indexStatus !== null).length,
    modified: categories.filter((category) => category === "modified").length,
    added: categories.filter((category) => category === "added").length,
    deleted: categories.filter((category) => category === "deleted").length,
    renamed: categories.filter((category) => category === "renamed").length,
    untracked: categories.filter((category) => category === "untracked").length,
    conflicted: categories.filter((category) => category === "conflicted").length,
    files,
  };
}

function primaryChangeCategory(
  file: GitChangedFileView,
): "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted" {
  if (file.conflicted) {
    return "conflicted";
  }
  if (file.untracked) {
    return "untracked";
  }
  const statuses = [file.indexStatus, file.worktreeStatus];
  if (statuses.includes("deleted")) {
    return "deleted";
  }
  if (statuses.includes("renamed")) {
    return "renamed";
  }
  if (statuses.includes("added") || statuses.includes("copied")) {
    return "added";
  }
  return "modified";
}

function parseBranches(stdout: string): ParsedBranch[] {
  const branches: ParsedBranch[] = [];
  for (const record of stdout.split("\n")) {
    if (record.length === 0) {
      continue;
    }
    const fields = record.split("\0");
    const refname = fields[0];
    const name = fields[1];
    const headMarker = fields[2];
    const commit = fields[3];
    const upstream = fields[4];
    const symref = fields[5];
    if (
      refname === undefined ||
      name === undefined ||
      commit === undefined ||
      refname.length === 0 ||
      name.length === 0 ||
      commit.length === 0 ||
      (symref !== undefined && symref.length > 0)
    ) {
      continue;
    }
    const kind = refname.startsWith("refs/heads/")
      ? "local"
      : refname.startsWith("refs/remotes/")
        ? "remote"
        : null;
    if (kind === null) {
      continue;
    }
    branches.push({
      view: {
        name,
        kind,
        current: kind === "local" && headMarker?.trim() === "*",
        commit,
        upstream: upstream === undefined || upstream.length === 0 ? null : upstream,
        ahead: null,
        behind: null,
      },
    });
  }
  return branches;
}

function parseLastCommit(
  stdout: string,
): { shortHash: string; subject: string; committedAt: number } | null {
  const [shortHash, subject, rawCommittedAt] = stdout.split("\0");
  if (shortHash === undefined || subject === undefined || rawCommittedAt === undefined) {
    return null;
  }
  const committedAt = Number(removeTrailingLineEnding(rawCommittedAt));
  if (shortHash.length === 0 || !Number.isFinite(committedAt)) {
    return null;
  }
  return { shortHash, subject, committedAt };
}

function compareBranches(left: GitBranchView, right: GitBranchView): number {
  if (left.current !== right.current) {
    return left.current ? -1 : 1;
  }
  if (left.name === right.name) {
    return 0;
  }
  return left.name < right.name ? -1 : 1;
}

function removeTrailingLineEnding(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function viewForGitError(
  workspaceId: string,
  checkedAt: number,
  error: unknown,
): GitFailureView {
  const detail = errorDetail(error);
  if (/not a git repository|outside repository|must be run in a work tree/i.test(detail)) {
    return { status: "not-repository", workspaceId, checkedAt };
  }
  if (isErrorWithCode(error, "ENOENT")) {
    return unavailable(workspaceId, checkedAt, "Git is not installed or is not available on PATH.");
  }
  if (
    isErrorWithCode(error, "ETIMEDOUT") ||
    (typeof error === "object" && error !== null && "killed" in error && error.killed === true)
  ) {
    return unavailable(workspaceId, checkedAt, "Git status check timed out.");
  }
  if (isErrorWithCode(error, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")) {
    return unavailable(workspaceId, checkedAt, "This repository is too large to inspect safely.");
  }
  return unavailable(workspaceId, checkedAt, "Git repository information is unavailable.");
}

function unavailable(workspaceId: string, checkedAt: number, message: string) {
  return { status: "unavailable" as const, workspaceId, checkedAt, message };
}

function errorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) {
      return stderr.trim();
    }
  }
  return error instanceof Error ? error.message.trim() : String(error).trim();
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
