import type {
  AgentEvent,
  AgentRunView,
  TurnId,
  UnsequencedAgentEvent,
} from "@story-forge/shared";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  FileCode2,
  GitBranch,
  PanelRightClose,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  GitRepositoryView,
  ProviderView,
  SessionView,
} from "../../shared/story-forge-api";
import { AgentRunTree, type ChildAgentActivities } from "./agent-run-tree";

export type RunStatus = "running" | "completed" | "failed" | "waiting-approval";

export type TurnRuntime = {
  turnId: TurnId;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  steps: number;
};

type ReadyRepository = Extract<GitRepositoryView, { status: "ready" }>;
type GitChangedFile = ReadyRepository["changes"]["files"][number];
type ChangeScope = "working-tree" | "last-turn";
type PanelAgentEvent = AgentEvent | UnsequencedAgentEvent;
type PanelToolCallEvent = Extract<PanelAgentEvent, { type: "tool.call" }>;
type PanelModelRequestEvent = Extract<PanelAgentEvent, { type: "model.request" }>;
type PanelContextUsageEvent = Extract<PanelAgentEvent, { type: "context.usage" }>;

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Turn is running",
  completed: "Turn completed",
  failed: "Turn failed",
  "waiting-approval": "Waiting for approval",
};

const DIRECT_EDIT_TOOL_NAMES = new Set(["write", "edit", "replaceText", "writeFile"]);
const MAX_VISIBLE_FILES = 6;
const MAX_VISIBLE_BRANCHES = 4;

export function RunContextPanel(props: {
  session: SessionView | undefined;
  provider: ProviderView | undefined;
  runtime: TurnRuntime | undefined;
  activities: PanelAgentEvent[];
  agentRun: AgentRunView | undefined;
  childAgentActivities: ChildAgentActivities;
  developerMode: boolean;
  workspacePath: string | undefined;
  repository: GitRepositoryView | undefined;
  repositoryLoading: boolean;
  onCollapse: () => void;
  onOpenInspector: () => void;
  onRefreshRepository: () => void;
}) {
  const { runtime } = props;
  const [changeScope, setChangeScope] = useState<ChangeScope>("working-tree");
  const [branchesExpanded, setBranchesExpanded] = useState(false);
  const elapsed = useElapsed(runtime);
  const attributedTurnId = runtime?.turnId ?? props.activities.at(-1)?.turnId;
  const latestRequest = lastModelRequest(props.activities, attributedTurnId);
  const contextUsage = latestContextUsage(props.activities, attributedTurnId);
  const toolCount = latestRequest?.tools.length ?? 0;
  const messageCount = latestRequest?.messages.length ?? props.session?.messages.length ?? 0;
  const repository = props.repository?.status === "ready" ? props.repository : undefined;
  const files = repository?.changes.files ?? [];
  const lastTurnFiles = repository
    ? collectSuccessfulDirectEditFiles(
        props.activities,
        files,
        repository.rootPath,
        props.workspacePath,
        attributedTurnId,
      )
    : [];
  const visibleFiles = changeScope === "working-tree" ? files : lastTurnFiles;

  return (
    <aside
      aria-busy={props.repositoryLoading}
      className="flex min-h-0 flex-col overflow-hidden border-l border-forge-line bg-forge-canvas"
    >
      <div className="flex flex-none items-start justify-between px-4 pt-[18px]">
        <div>
          <div className="text-sm font-semibold text-forge-ink">Workspace context</div>
          <div className="text-[11px] text-forge-muted">Repository, changes, and run</div>
        </div>
        <button
          aria-label="Collapse workspace context"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-white hover:text-forge-ink"
          onClick={props.onCollapse}
          title="Collapse workspace context"
          type="button"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-5 pt-[14px]">
        <Card>
          <CardHeader
            action={(
              <button
                aria-label="Refresh repository"
                className="flex h-6 w-6 items-center justify-center rounded-md text-forge-muted hover:bg-forge-canvas hover:text-forge-ink disabled:cursor-wait disabled:opacity-50"
                disabled={props.repositoryLoading}
                onClick={props.onRefreshRepository}
                title="Refresh repository"
                type="button"
              >
                <RefreshCw className={props.repositoryLoading ? "animate-spin" : ""} size={14} />
              </button>
            )}
            icon={<GitBranch size={16} />}
          >
            Repository
          </CardHeader>
          <RepositoryContent
            branchesExpanded={branchesExpanded}
            loading={props.repositoryLoading}
            onBranchesExpandedChange={setBranchesExpanded}
            repository={props.repository}
          />
        </Card>

        {props.agentRun ? (
          <AgentRunTree
            childActivities={props.childAgentActivities}
            run={props.agentRun}
          />
        ) : null}

        <Card>
          <CardHeader
            action={repository ? (
              <span
                aria-label={`${repository.changes.total} changed files`}
                className="font-mono text-sm font-semibold text-forge-ink"
              >
                {repository.changes.total}
              </span>
            ) : undefined}
            icon={<FileCode2 size={16} />}
          >
            Changes
          </CardHeader>
          {repository ? (
            <>
              <ChangeSummary changes={repository.changes} />
              <div
                aria-label="Change source"
                className="mt-3 grid grid-cols-2 rounded-lg bg-forge-canvas p-0.5"
                role="group"
              >
                <ScopeButton
                  active={changeScope === "working-tree"}
                  label="Working tree"
                  onClick={() => setChangeScope("working-tree")}
                />
                <ScopeButton
                  active={changeScope === "last-turn"}
                  label="Last agent turn"
                  onClick={() => setChangeScope("last-turn")}
                />
              </div>
              <ChangedFileList files={visibleFiles} scope={changeScope} />
              {changeScope === "last-turn" ? (
                <div className="mt-2 text-[10px] leading-4 text-forge-muted">
                  Direct write/edit tools only; shell changes are not attributed.
                </div>
              ) : null}
            </>
          ) : (
            <div aria-live="polite" className="text-[11px] text-forge-muted" role="status">
              {props.repositoryLoading ? "Loading changes…" : "Git changes unavailable."}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader icon={<StatusDot status={runtime?.status} />}>Run</CardHeader>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate text-[12px] font-medium text-forge-ink">
              {runtime ? STATUS_LABEL[runtime.status] : "No turn yet"}
            </span>
            <span className="flex-none font-mono text-[11px] text-forge-muted">
              {runtime ? elapsed : "—"}
            </span>
          </div>
          <Row
            label="Steps"
            value={runtime ? `${runtime.steps} ${runtime.steps === 1 ? "step" : "steps"}` : "—"}
          />
          <ContextRow usage={contextUsage} />
        </Card>

        <Card>
          <CardHeader icon={<Braces size={16} />}>Model</CardHeader>
          <Row label="Provider" value={props.provider?.displayName ?? props.session?.providerId ?? "—"} />
          <Row label="Model" value={props.session?.model ?? props.provider?.model ?? "—"} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>PI</Badge>
            {props.provider?.isDefault ? <Badge>default</Badge> : null}
          </div>
        </Card>

        <button
          aria-label="Inspector"
          className="flex w-full items-center justify-between rounded-[10px] border border-forge-line bg-white px-3 py-3 text-left disabled:cursor-default disabled:opacity-60"
          disabled={!props.developerMode}
          onClick={props.onOpenInspector}
          title={props.developerMode ? "Open model inspector" : "Enable developer mode to inspect"}
          type="button"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-forge-ink">
              <Braces size={16} />
              Inspector
            </div>
            <div className="mt-1 truncate text-[11px] text-forge-muted">
              {`{ role: "assistant", tools: ${toolCount}, messages: ${messageCount} }`}
            </div>
          </div>
          <ChevronRight className="flex-none text-forge-muted" size={16} />
        </button>
      </div>
    </aside>
  );
}

function RepositoryContent(props: {
  repository: GitRepositoryView | undefined;
  loading: boolean;
  branchesExpanded: boolean;
  onBranchesExpandedChange: (expanded: boolean) => void;
}) {
  const { repository } = props;
  if (props.loading && !repository) {
    return (
      <div aria-live="polite" className="text-[11px] text-forge-muted" role="status">
        Loading repository…
      </div>
    );
  }
  if (!repository || repository.status === "unavailable") {
    return (
      <div aria-live="polite" role="status">
        <div className="text-[12px] font-medium text-forge-ink">Repository unavailable</div>
        <div className="mt-1 break-words text-[11px] leading-4 text-forge-muted">
          {repository?.status === "unavailable"
            ? repository.message
            : "Repository information has not loaded yet."}
        </div>
      </div>
    );
  }
  if (repository.status === "not-repository") {
    return (
      <div>
        <div className="text-[12px] font-medium text-forge-ink">Not a Git repository</div>
        <div className="mt-1 text-[11px] leading-4 text-forge-muted">
          This workspace has no Git metadata.
        </div>
      </div>
    );
  }

  const headLabel = repository.head.detached
    ? `Detached at ${shortCommit(repository.head.commit)}`
    : repository.head.branch ?? (repository.head.unborn ? "Unborn branch" : "Unknown branch");
  const upstreamLabel = repository.upstream
    ? `${repository.upstream.name}${repository.upstream.gone ? " (gone)" : ""}`
      + ` ↑${repository.upstream.ahead} ↓${repository.upstream.behind}`
    : "No upstream";
  const commitLabel = repository.lastCommit
    ? `${repository.lastCommit.shortHash} · ${repository.lastCommit.subject}`
    : repository.head.commit
      ? shortCommit(repository.head.commit)
      : "No commits yet";

  return (
    <>
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-forge-canvas px-2.5 py-2">
        <GitBranch className="flex-none text-forge-muted" size={14} />
        <span className="truncate text-[12px] font-semibold text-forge-ink" title={headLabel}>
          {headLabel}
        </span>
        {props.loading ? <RefreshCw className="ml-auto flex-none animate-spin text-forge-muted" size={12} /> : null}
      </div>
      <div className="mt-2">
        <Row label="Upstream" value={upstreamLabel} />
        <Row label="Commit" value={commitLabel} />
      </div>
      <BranchList
        expanded={props.branchesExpanded}
        onExpandedChange={props.onBranchesExpandedChange}
        repository={repository}
      />
    </>
  );
}

function BranchList(props: {
  repository: ReadyRepository;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { local, remote } = props.repository.branches;
  return (
    <div className="mt-2 border-t border-forge-divider pt-2">
      <button
        aria-label="Branches"
        aria-expanded={props.expanded}
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => props.onExpandedChange(!props.expanded)}
        type="button"
      >
        <span className="text-[11px] font-medium text-forge-ink">Branches</span>
        <span className="flex items-center gap-1 text-[10px] text-forge-muted">
          {`${local.length} local · ${remote.length} remote-tracking`}
          {props.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {props.expanded ? (
        <div className="mt-2 space-y-2">
          <BranchGroup branches={local} emptyLabel="No local branches" label="Local" />
          <BranchGroup branches={remote} emptyLabel="No remote-tracking branches" label="Remote-tracking" />
        </div>
      ) : null}
    </div>
  );
}

function BranchGroup(props: {
  branches: ReadyRepository["branches"]["local"];
  label: string;
  emptyLabel: string;
}) {
  const visible = props.branches.slice(0, MAX_VISIBLE_BRANCHES);
  const remaining = props.branches.length - visible.length;
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-forge-muted">
        {props.label}
      </div>
      {visible.length === 0 ? (
        <div className="text-[11px] text-forge-muted">{props.emptyLabel}</div>
      ) : (
        <div className="space-y-1">
          {visible.map((branch) => (
            <div className="flex min-w-0 items-center gap-1.5" key={`${branch.kind}:${branch.name}`}>
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 flex-none rounded-full ${
                  branch.current ? "bg-forge-dot" : "bg-[#cbd5e1]"
                }`}
              />
              <span className="truncate text-[11px] text-forge-ink" title={branch.name}>
                {branch.name}
              </span>
            </div>
          ))}
          {remaining > 0 ? (
            <div className="text-[10px] text-forge-muted">+{remaining} more</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ChangeSummary(props: { changes: ReadyRepository["changes"] }) {
  const summaries = [
    ["staged", props.changes.staged],
    ["modified", props.changes.modified],
    ["added", props.changes.added],
    ["deleted", props.changes.deleted],
    ["renamed", props.changes.renamed],
    ["untracked", props.changes.untracked],
    ["conflicted", props.changes.conflicted],
  ] as const;
  if (props.changes.total === 0) {
    return (
    <div className="mt-2 text-[11px] font-medium text-forge-success">Working tree clean</div>
    );
  }
  const visible = summaries.filter(([label, count]) => label === "staged" || count > 0);
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {visible.map(([label, count]) => (
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
            label === "conflicted"
              ? "bg-forge-danger-bg text-forge-danger"
              : "bg-forge-info-bg text-forge-info"
          }`}
          key={label}
        >
          {count} {label}
        </span>
      ))}
    </div>
  );
}

function ScopeButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={props.active}
      className={`rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors ${
        props.active ? "bg-white text-forge-ink shadow-sm" : "text-forge-muted hover:text-forge-ink"
      }`}
      onClick={props.onClick}
      type="button"
    >
      {props.label}
    </button>
  );
}

function ChangedFileList(props: { files: GitChangedFile[]; scope: ChangeScope }) {
  const visible = props.files.slice(0, MAX_VISIBLE_FILES);
  const remaining = props.files.length - visible.length;
  if (visible.length === 0) {
    return props.scope === "last-turn" ? (
      <div className="mt-3 text-[11px] text-forge-muted">
        No direct file edits recorded
      </div>
    ) : null;
  }
  return (
    <div className="mt-3 space-y-2">
      {visible.map((file) => (
        <div className="flex min-w-0 items-start gap-2" key={`${file.originalPath ?? ""}:${file.path}`}>
          <FileCode2 className="mt-0.5 flex-none text-forge-muted" size={13} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-forge-ink" title={file.path}>
              {file.path}
            </div>
            <div className="truncate text-[10px] text-forge-muted">
              {describeGitFile(file)}
            </div>
          </div>
        </div>
      ))}
      {remaining > 0 ? (
        <div className="pl-5 text-[10px] text-forge-muted">+{remaining} more files</div>
      ) : null}
    </div>
  );
}

function Card(props: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-forge-line bg-white px-3 py-3">{props.children}</div>
  );
}

function CardHeader(props: {
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex min-h-6 items-center gap-2 text-xs font-semibold text-forge-ink">
      <span className="text-forge-ink">{props.icon}</span>
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.action}
    </div>
  );
}

function Row(props: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex-none text-[11px] text-forge-muted">{props.label}</span>
      <span
        className={`min-w-0 truncate text-right text-[12px] font-medium ${
          props.tone === "danger" ? "text-forge-danger" : "text-forge-ink"
        }`}
        title={props.value}
      >
        {props.value}
      </span>
    </div>
  );
}

function ContextRow(props: { usage: PanelContextUsageEvent | undefined }) {
  const { usage } = props;
  if (!usage || usage.budgetTokens <= 0) {
    return <Row label="Context" value="—" />;
  }
  const ratio = Math.min(1, Math.max(0, usage.usedTokens / usage.budgetTokens));
  const percent = Math.round(ratio * 100);
  const tone = percent >= 90 ? "danger" : percent >= 75 ? "warn" : "normal";
  const barColor =
    tone === "danger" ? "bg-forge-danger" : tone === "warn" ? "bg-forge-info" : "bg-forge-ink";
  const textColor = tone === "danger" ? "text-forge-danger" : "text-forge-ink";
  const title =
    `${usage.usedTokens.toLocaleString()} / ${usage.budgetTokens.toLocaleString()} tokens`
    + ` (${usage.source === "provider" ? "actual" : "estimated"}, window ${usage.windowTokens.toLocaleString()})`;
  return (
    <div className="pt-1" title={title}>
      <div className="flex items-center justify-between py-0.5">
        <span className="text-[11px] text-forge-muted">Context</span>
        <span className={`text-[12px] font-medium ${textColor}`}>{percent}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-forge-line">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Badge(props: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-forge-info-bg px-1.5 py-0.5 text-[10px] font-medium text-forge-info">
      {props.children}
    </span>
  );
}

function StatusDot(props: { status: RunStatus | undefined }) {
  const color = props.status === "failed"
    ? "bg-forge-danger"
    : props.status === "completed"
      ? "bg-forge-success"
      : props.status === "waiting-approval"
        ? "bg-forge-info"
        : props.status === "running"
          ? "bg-forge-dot animate-pulse"
          : "bg-[#cbd5e1]";
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

function useElapsed(runtime: TurnRuntime | undefined): string {
  const [, setTick] = useState(0);
  const running = runtime?.status === "running" || runtime?.status === "waiting-approval";
  useEffect(() => {
    if (!running) {
      return;
    }
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!runtime) {
    return "00:00";
  }
  const end = runtime.endedAt ? new Date(runtime.endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - new Date(runtime.startedAt).getTime()) / 1000));
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function collectSuccessfulDirectEditFiles(
  activities: PanelAgentEvent[],
  gitFiles: GitChangedFile[],
  repositoryRoot: string,
  workspacePath: string | undefined,
  turnId: TurnId | undefined,
): GitChangedFile[] {
  if (!turnId) {
    return [];
  }
  const calls = new Map<string, PanelToolCallEvent>();
  for (const event of activities) {
    if (
      event.turnId === turnId
      && event.type === "tool.call"
      && isDirectEditTool(event.name)
    ) {
      calls.set(event.callId, event);
    }
  }

  const gitFileByPath = new Map<string, GitChangedFile>();
  for (const file of gitFiles) {
    gitFileByPath.set(normalizePath(file.path), file);
    if (file.originalPath) {
      gitFileByPath.set(normalizePath(file.originalPath), file);
    }
  }

  const found: GitChangedFile[] = [];
  const seen = new Set<string>();
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const result = activities[index];
    if (
      result?.turnId !== turnId
      || result.type !== "tool.result"
      || !result.ok
      || !isDirectEditTool(result.name)
    ) {
      continue;
    }
    const call = calls.get(result.callId);
    const inputPath = call ? extractPath(call.input) : undefined;
    if (!inputPath) {
      continue;
    }
    const file = gitFileByPath.get(
      normalizeToolPath(inputPath, repositoryRoot, workspacePath),
    );
    if (!file || seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    found.push(file);
  }
  return found;
}

function isDirectEditTool(name: string): boolean {
  const baseName = name.split(".").at(-1) ?? name;
  return DIRECT_EDIT_TOOL_NAMES.has(baseName);
}

function extractPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of ["path", "file", "filePath", "filename"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeToolPath(
  inputPath: string,
  repositoryRoot: string,
  workspacePath: string | undefined,
): string {
  const normalizedRoot = normalizePath(repositoryRoot);
  const normalizedInput = inputPath.replaceAll("\\", "/");
  const absolute = normalizedInput.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedInput);
  const candidate = normalizePath(
    absolute ? normalizedInput : `${workspacePath ?? repositoryRoot}/${normalizedInput}`,
  );
  const caseInsensitive = /^[a-zA-Z]:\//.test(normalizedRoot);
  const comparableCandidate = caseInsensitive ? candidate.toLowerCase() : candidate;
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (comparableCandidate === comparableRoot) {
    return "";
  }
  if (comparableCandidate.startsWith(`${comparableRoot}/`)) {
    return candidate.slice(normalizedRoot.length + 1);
  }
  return candidate;
}

function normalizePath(inputPath: string): string {
  const slashed = inputPath.replaceAll("\\", "/");
  const drive = /^[a-zA-Z]:/.exec(slashed)?.[0] ?? "";
  const rooted = slashed.startsWith("/");
  const body = drive ? slashed.slice(drive.length) : slashed;
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const prefix = drive ? `${drive}/` : rooted ? "/" : "";
  return parts.length === 0 ? prefix : `${prefix}${parts.join("/")}`;
}

function describeGitFile(file: GitChangedFile): string {
  if (file.conflicted) {
    return "conflicted";
  }
  if (file.untracked) {
    return "untracked";
  }
  const statuses = [
    file.indexStatus ? `staged ${file.indexStatus}` : undefined,
    file.worktreeStatus ?? undefined,
  ].filter((status): status is string => Boolean(status));
  return Array.from(new Set(statuses)).join(" · ") || "changed";
}

function shortCommit(commit: string | null): string {
  return commit?.slice(0, 8) || "unknown";
}

function lastModelRequest(
  activities: PanelAgentEvent[],
  turnId: TurnId | undefined,
): PanelModelRequestEvent | undefined {
  if (!turnId) {
    return undefined;
  }
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const event = activities[index];
    if (event?.turnId === turnId && event.type === "model.request") {
      return event;
    }
  }
  return undefined;
}

function latestContextUsage(
  activities: PanelAgentEvent[],
  turnId: TurnId | undefined,
): PanelContextUsageEvent | undefined {
  if (!turnId) {
    return undefined;
  }
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const event = activities[index];
    if (event?.turnId !== turnId) {
      continue;
    }
    if (event.type === "context.compacted") {
      return undefined;
    }
    if (event.type === "context.usage") {
      return event;
    }
  }
  return undefined;
}
