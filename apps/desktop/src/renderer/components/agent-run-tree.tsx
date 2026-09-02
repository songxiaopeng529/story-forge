import type {
  AgentEvent,
  AgentExecutionId,
  AgentExecutionStatus,
  AgentExecutionView,
  AgentRunView,
} from "@story-forge/shared";
import { Bot, ChevronRight, CircleAlert, Network } from "lucide-react";
import { useEffect, useState } from "react";

export type ChildAgentActivities = Partial<Record<AgentExecutionId, AgentEvent[]>>;

const STATUS_META: Record<AgentExecutionStatus, { label: string; dot: string; badge: string }> = {
  queued: {
    label: "Queued",
    dot: "bg-[#94a3b8]",
    badge: "bg-forge-canvas text-forge-muted",
  },
  running: {
    label: "Running",
    dot: "bg-forge-dot animate-pulse",
    badge: "bg-forge-info-bg text-forge-info",
  },
  completed: {
    label: "Completed",
    dot: "bg-forge-success",
    badge: "bg-[#ecfdf3] text-forge-success",
  },
  failed: {
    label: "Failed",
    dot: "bg-forge-danger",
    badge: "bg-forge-danger-bg text-forge-danger",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-[#94a3b8]",
    badge: "bg-forge-canvas text-forge-muted",
  },
  interrupted: {
    label: "Interrupted",
    dot: "bg-forge-info",
    badge: "bg-forge-info-bg text-forge-info",
  },
};

export function AgentRunTree(props: {
  run: AgentRunView;
  childActivities: ChildAgentActivities;
}) {
  useRunningClock(props.run.executions.some((execution) => execution.status === "running"));
  const root = props.run.executions.find((execution) => execution.id === props.run.rootExecutionId);
  if (!root) {
    return null;
  }
  const children = props.run.executions.filter((execution) =>
    execution.parentExecutionId === root.id
  );

  return (
    <section
      aria-label="Agent run tree"
      className="rounded-[10px] border border-forge-line bg-white px-3 py-3"
      data-testid="agent-run-tree"
    >
      <div className="mb-2 flex min-h-6 items-center gap-2 text-xs font-semibold text-forge-ink">
        <Network aria-hidden="true" size={16} />
        <span className="min-w-0 flex-1">Agent team</span>
        <span className="rounded-md bg-forge-canvas px-1.5 py-0.5 text-[10px] font-medium text-forge-muted">
          {props.run.executions.length} agents
        </span>
      </div>
      <AgentRunNode
        activities={props.childActivities[root.id] ?? []}
        execution={root}
      />
      {children.length > 0 ? (
        <div className="ml-3 border-l border-forge-line pl-3">
          {children.map((execution) => (
            <AgentRunNode
              activities={props.childActivities[execution.id] ?? []}
              child
              execution={execution}
              key={execution.id}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AgentRunNode(props: {
  execution: AgentExecutionView;
  activities: AgentEvent[];
  child?: boolean;
}) {
  const { execution } = props;
  const status = STATUS_META[execution.status];
  const liveToolCount = props.activities.filter((event) => event.type === "tool.call").length;
  const toolCount = Math.max(execution.usage.toolCalls, liveToolCount);
  const duration = formatDuration(execution);
  const usage = formatUsage(execution);

  return (
    <article
      aria-label={`${roleLabel(execution.role)} agent: ${execution.objective}`}
      className={`${props.child ? "py-2.5" : "pb-2.5"} border-b border-forge-divider last:border-b-0`}
      data-agent-execution-id={execution.id}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-forge-canvas text-forge-muted">
          <Bot aria-hidden="true" size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 flex-none rounded-full ${status.dot}`} />
            <span className="text-[11px] font-semibold text-forge-ink">
              {roleLabel(execution.role)}
            </span>
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium ${status.badge}`}>
              {status.label}
            </span>
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-4 text-forge-ink" title={execution.objective}>
            {execution.objective}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[9px] text-forge-muted">
            <span>{duration}</span>
            <span>{toolCount} {toolCount === 1 ? "tool" : "tools"}</span>
            <span title={usage.title}>{usage.label}</span>
          </div>
          {execution.report ? (
            <details className="mt-2 rounded-md bg-forge-canvas px-2 py-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-semibold text-forge-ink">
                <ChevronRight aria-hidden="true" size={11} />
                Result
              </summary>
              <div className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-forge-muted">
                {execution.report.summary}
              </div>
              {execution.report.findings.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] leading-4 text-forge-muted">
                  {execution.report.findings.map((finding, index) => (
                    <li key={`${execution.id}-finding-${index}`}>{finding}</li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}
          {execution.error ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-forge-danger-bg px-2 py-1.5 text-[10px] leading-4 text-forge-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 flex-none" size={11} />
              <span className="min-w-0 break-words">{execution.error}</span>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function useRunningClock(running: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
}

function formatDuration(execution: AgentExecutionView): string {
  const start = Date.parse(execution.startedAt ?? execution.createdAt);
  const end = execution.endedAt ? Date.parse(execution.endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "—";
  }
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatUsage(execution: AgentExecutionView): { label: string; title: string } {
  const { usage } = execution;
  const tokens = usage.inputTokens + usage.outputTokens;
  return {
    label: `${tokens.toLocaleString()} tokens · $${usage.costUsd.toFixed(4)}`,
    title: [
      `${usage.inputTokens.toLocaleString()} input`,
      `${usage.outputTokens.toLocaleString()} output`,
      `${usage.cacheReadTokens.toLocaleString()} cache read`,
      `${usage.cacheWriteTokens.toLocaleString()} cache write`,
      `${usage.turns} turns`,
    ].join(" · "),
  };
}

function roleLabel(role: AgentExecutionView["role"]): string {
  if (role === "root") {
    return "Root";
  }
  return role === "explorer" ? "Explorer" : "Reviewer";
}
