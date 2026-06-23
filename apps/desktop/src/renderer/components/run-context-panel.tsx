import type {
  AgentEvent,
  CommandExecutionMode,
  ResponseMode,
  TurnId,
} from "@story-forge/shared";
import { Braces, ChevronRight, FileCode2, PanelRightClose, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProviderView, SessionView } from "../../shared/story-forge-api";
import { commandModeMeta } from "../command-mode-meta";

export type RunStatus = "running" | "completed" | "failed" | "waiting-approval";

export type TurnRuntime = {
  turnId: TurnId;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  steps: number;
};

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Turn is running",
  completed: "Turn completed",
  failed: "Turn failed",
  "waiting-approval": "Waiting for approval",
};

export function RunContextPanel(props: {
  session: SessionView | undefined;
  provider: ProviderView | undefined;
  responseMode: ResponseMode;
  commandExecutionMode: CommandExecutionMode;
  runtime: TurnRuntime | undefined;
  activities: AgentEvent[];
  developerMode: boolean;
  onCollapse: () => void;
  onOpenInspector: () => void;
}) {
  const { runtime } = props;
  const elapsed = useElapsed(runtime);
  const meta = commandModeMeta[props.commandExecutionMode];
  const recentFiles = collectRecentFiles(props.activities);
  const latestRequest = lastModelRequest(props.activities);
  const tasks = latestTasks(props.session?.tasks ?? [], props.activities);
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const currentTask = tasks.find((task) => task.status === "in_progress");
  const toolCount = latestRequest?.tools.length ?? 0;
  const messageCount = latestRequest?.messages.length ?? props.session?.messages.length ?? 0;

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-forge-line bg-forge-canvas">
      <div className="flex flex-none items-start justify-between px-4 pt-[18px]">
        <div>
          <div className="text-sm font-semibold text-forge-ink">Run context</div>
          <div className="text-[11px] text-forge-muted">Turn state, tools, files</div>
        </div>
        <button
          aria-label="Collapse run context"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-white hover:text-forge-ink"
          onClick={props.onCollapse}
          title="Collapse run context"
          type="button"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-5 pt-[14px]">
        <Card>
          <CardHeader icon={<StatusDot status={runtime?.status} />}>
            {runtime ? STATUS_LABEL[runtime.status] : "No turn yet"}
          </CardHeader>
          <Row label="Steps" value={runtime ? `${runtime.steps} steps` : "—"} />
          <Row label="Elapsed" value={runtime ? elapsed : "—"} />
          <Row label="Mode" value={props.responseMode} />
        </Card>

        {tasks.length > 0 ? (
          <Card>
            <CardHeader icon={<FileCode2 size={16} />}>Tasks</CardHeader>
            <Row label="Completed" value={`${completedTasks}/${tasks.length}`} />
            <Row
              label="Current"
              value={currentTask?.activeForm ?? currentTask?.title ?? "—"}
            />
            {blockedTasks > 0 ? (
              <Row label="Blocked" value={`${blockedTasks}`} tone="danger" />
            ) : (
              <Row label="Blocked" value={`${blockedTasks}`} />
            )}
          </Card>
        ) : null}

        <Card>
          <CardHeader icon={<Braces size={16} />}>Model</CardHeader>
          <Row label="Provider" value={props.provider?.displayName ?? props.session?.providerId ?? "—"} />
          <Row label="Model" value={props.session?.model ?? props.provider?.model ?? "—"} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{props.responseMode === "live" ? "live" : "streaming"}</Badge>
            {props.provider?.isDefault ? <Badge>default</Badge> : null}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Shield size={16} />}>Guardrails</CardHeader>
          <Row label="Command" value={meta.chip} />
          <Row label="Files" value="workspace" />
        </Card>

        <Card>
          <CardHeader icon={<FileCode2 size={16} />}>Recent files</CardHeader>
          {recentFiles.length === 0 ? (
            <div className="text-[11px] text-forge-muted">No files touched yet.</div>
          ) : (
            <div className="space-y-2">
              {recentFiles.map((file) => (
                <div className="flex items-start gap-2" key={file.path}>
                  <FileCode2 className="mt-0.5 flex-none text-forge-muted" size={14} />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-forge-ink" title={file.path}>
                      {file.name}
                    </div>
                    <div className="truncate text-[11px] text-forge-muted">{file.hint}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <button
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

function Card(props: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-forge-line bg-white px-3 py-3">{props.children}</div>
  );
}

function CardHeader(props: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-forge-ink">
      <span className="text-forge-ink">{props.icon}</span>
      {props.children}
    </div>
  );
}

function Row(props: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-forge-muted">{props.label}</span>
      <span
        className={`max-w-[60%] truncate text-[12px] font-medium ${
          props.tone === "danger" ? "text-forge-danger" : "text-forge-ink"
        }`}
        title={props.value}
      >
        {props.value}
      </span>
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

type RecentFile = { path: string; name: string; hint: string };

function collectRecentFiles(activities: AgentEvent[]): RecentFile[] {
  const found = new Map<string, RecentFile>();
  for (const event of activities) {
    if (event.type !== "tool.call") {
      continue;
    }
    const path = extractPath(event.input);
    if (!path) {
      continue;
    }
    const name = path.split("/").pop() ?? path;
    found.set(path, { path, name, hint: event.name });
  }
  return Array.from(found.values()).slice(-3).reverse();
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

function lastModelRequest(
  activities: AgentEvent[],
): Extract<AgentEvent, { type: "model.request" }> | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const event = activities[index];
    if (event?.type === "model.request") {
      return event;
    }
  }
  return undefined;
}

function latestTasks(
  persistedTasks: NonNullable<SessionView["tasks"]>,
  activities: AgentEvent[],
): NonNullable<SessionView["tasks"]> {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const event = activities[index];
    if (event?.type === "task.list.updated") {
      return event.tasks;
    }
  }
  return persistedTasks;
}
