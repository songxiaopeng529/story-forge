import {
  Check,
  ChevronRight,
  CircleX,
  Clock3,
  Copy,
  FilePenLine,
  FilePlus,
  FileText,
  FoldVertical,
  FolderOpen,
  FolderSearch,
  Globe,
  ListChecks,
  LoaderCircle,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import { toRecord, type HumanInputResponse } from "@story-forge/shared";
import { useI18n } from "../i18n";
import type { TimelineItem } from "../utils/timeline";
import { useTypewriterText } from "../hooks/use-typewriter-text";
import { HumanInputCard } from "./human-input-prompt";

export function ConversationTimeline(props: {
  items: TimelineItem[];
  startedAt?: string | undefined;
  onCreateAutomationProposal?: ((proposalId: string) => void) | undefined;
  onCancelAutomationProposal?: ((proposalId: string) => void) | undefined;
  onHumanInputRespond?: ((response: Omit<HumanInputResponse, "requestId">) => void) | undefined;
}) {
  const timeChip = formatTimeChip(props.startedAt);
  const entries = groupToolSteps(props.items);
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-stretch gap-3">
      {timeChip ? (
        <div className="flex justify-center">
          <span className="rounded-full border border-forge-line bg-forge-canvas px-2 py-[3px] text-[11px] font-medium text-forge-ink">
            {timeChip}
          </span>
        </div>
      ) : null}
      {entries.map((entry) => entry.kind === "tool-group"
        ? <ToolActivityGroup items={entry.items} key={entry.id} />
        : (
            <TimelineItemView
              item={entry.item}
              key={entry.item.id}
              onCancelAutomationProposal={props.onCancelAutomationProposal}
              onCreateAutomationProposal={props.onCreateAutomationProposal}
              onHumanInputRespond={props.onHumanInputRespond}
            />
          ))}
    </div>
  );
}

type ToolStepItem = Extract<TimelineItem, { type: "tool-step" }>;

type TimelineRenderEntry =
  | { kind: "item"; item: Exclude<TimelineItem, ToolStepItem> }
  | { kind: "tool-group"; id: string; items: ToolStepItem[] };

function groupToolSteps(items: TimelineItem[]): TimelineRenderEntry[] {
  const entries: TimelineRenderEntry[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!item) {
      break;
    }
    if (item.type !== "tool-step") {
      entries.push({ kind: "item", item });
      index += 1;
      continue;
    }

    const group: ToolStepItem[] = [item];
    index += 1;
    while (true) {
      const next = items[index];
      if (!next || next.type !== "tool-step") {
        break;
      }
      group.push(next);
      index += 1;
    }
    entries.push({
      kind: "tool-group",
      id: `tool-group-${group[0]?.id ?? index}`,
      items: group,
    });
  }

  return entries;
}

function isThinkingPlaceholder(
  item: Extract<TimelineItem, { type: "assistant-message" }>,
): boolean {
  return Boolean(item.streaming) && item.content.trim() === "Thinking...";
}

function ThinkingStatusRow() {
  const t = useI18n();
  return (
    <div
      aria-live="polite"
      className="motion-message-enter flex items-center gap-2.5 px-1 py-1.5 text-xs font-medium text-forge-muted"
      data-testid="thinking-status"
      role="status"
    >
      <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-forge-canvas">
        <Sparkles aria-hidden="true" className="animate-pulse text-forge-ink motion-reduce:animate-none" size={14} />
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full border border-forge-line opacity-40 motion-reduce:animate-none"
        />
      </span>
      <span className="relative overflow-hidden rounded-sm px-0.5">
        <span className="relative z-10">{t.agent.thinking}</span>
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white to-transparent opacity-80 motion-reduce:animate-none"
        />
      </span>
    </div>
  );
}

function TimelineItemView(props: {
  item: TimelineItem;
  onCreateAutomationProposal?: ((proposalId: string) => void) | undefined;
  onCancelAutomationProposal?: ((proposalId: string) => void) | undefined;
  onHumanInputRespond?: ((response: Omit<HumanInputResponse, "requestId">) => void) | undefined;
}) {
  const { item } = props;
  if (item.type === "user-message") {
    return (
      <article className="motion-message-enter flex justify-end">
        <div className="max-w-[82%] rounded-xl bg-forge-ink px-3.5 py-2.5 text-[13px] leading-5 text-white">
          {item.content.trim() ? <div className="whitespace-pre-wrap">{item.content}</div> : null}
          {item.imageAttachments?.length ? (
            <div className={`grid gap-2 ${item.content.trim() ? "mt-2" : ""}`}>
              {item.imageAttachments.map((attachment) => (
                <img
                  alt={attachment.name}
                  className="max-h-44 rounded-lg border border-white/15 object-contain"
                  key={attachment.id}
                  src={`data:${attachment.mediaType};base64,${attachment.data}`}
                  title={attachment.name}
                />
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }
  if (item.type === "assistant-message") {
    if (isThinkingPlaceholder(item)) {
      return <ThinkingStatusRow />;
    }
    return (
      <AssistantMessage
        content={item.content}
        smooth={Boolean(item.streaming) && item.delivery === "smooth"}
        streaming={Boolean(item.streaming)}
      />
    );
  }
  if (item.type === "reasoning") {
    return <ReasoningBlock content={item.content} />;
  }
  if (item.type === "summary") {
    return <SummaryBlock content={item.content} />;
  }
  if (item.type === "plan") {
    return <PlanBlock content={item.content} />;
  }
  if (item.type === "tool-step") {
    return <ToolActivityGroup items={[item]} />;
  }
  if (item.type === "automation-proposal") {
    return (
      <AutomationProposalCard
        item={item}
        onCancel={props.onCancelAutomationProposal}
        onCreate={props.onCreateAutomationProposal}
      />
    );
  }
  if (item.type === "human-input") {
    return (
      <HumanInputCard
        request={item.request}
        responding={item.responding}
        onRespond={(response) => props.onHumanInputRespond?.(response)}
      />
    );
  }
  if (item.type === "task-list") {
    return <TaskListCard item={item} />;
  }
  if (item.type === "notice") {
    return (
      <div className="rounded-lg border border-forge-info/30 bg-forge-info-bg px-3 py-2 text-[13px] text-forge-info">
        {item.message}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-forge-danger/30 bg-forge-danger-bg px-3 py-2 text-[13px] text-forge-danger">
      {item.message}
    </div>
  );
}

function TaskListCard(props: {
  item: Extract<TimelineItem, { type: "task-list" }>;
}) {
  const { item } = props;
  return (
    <article className="rounded-[10px] border border-forge-line bg-white px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md bg-forge-canvas text-forge-ink">
          <ListChecks aria-hidden="true" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-forge-ink">Tasks</div>
            <div className="text-xs text-forge-muted">
              {item.completedCount}/{item.totalCount} completed
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {item.tasks.map((task) => (
              <div className="flex items-start gap-2" key={task.id}>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-forge-ink">{task.title}</div>
                  {task.activeForm || task.blockedReason ? (
                    <div className={`mt-0.5 text-[11px] leading-4 ${
                      task.status === "blocked" ? "text-forge-danger" : "text-forge-muted"
                    }`}>
                      {task.blockedReason ?? task.activeForm}
                    </div>
                  ) : null}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${taskBadge(task.status)}`}>
                  {taskLabel(task.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function AutomationProposalCard(props: {
  item: Extract<TimelineItem, { type: "automation-proposal" }>;
  onCreate?: ((proposalId: string) => void) | undefined;
  onCancel?: ((proposalId: string) => void) | undefined;
}) {
  const { proposal } = props.item;
  const created = props.item.status === "created";
  const threadTimer = proposal.kind === "thread_chat";
  const noun = threadTimer ? "timer" : "automation";
  const pendingTitle = threadTimer ? "Thread timer proposal" : "Automation proposal";
  const createdTitle = threadTimer ? "Thread timer created" : "Automation created";

  return (
    <article className="rounded-[10px] border border-forge-line bg-white px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md bg-forge-canvas text-forge-ink">
          <Clock3 size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-forge-ink">
              {created ? createdTitle : pendingTitle}
            </div>
            <div className="text-xs text-forge-muted">{proposal.timezone}</div>
          </div>
          <div className="mt-1 font-medium text-forge-ink">{proposal.name}</div>
          <div className="mt-1 text-xs leading-5 text-forge-muted">
            {proposal.summary} · {proposal.cron}
          </div>
          <div className="mt-2 rounded-md bg-forge-canvas px-3 py-2 text-xs leading-5 text-forge-ink">
            {proposal.prompt}
          </div>
          {created ? null : (
            <div className="mt-3 flex items-center gap-2">
              <button
                aria-label={`Create ${noun} ${proposal.name}`}
                className="inline-flex items-center gap-2 rounded-md bg-forge-ink px-3 py-2 text-xs font-medium text-white"
                onClick={() => props.onCreate?.(props.item.proposalId)}
                type="button"
              >
                <Check size={14} />
                Create {noun}
              </button>
              <button
                aria-label={`Cancel ${noun} ${proposal.name}`}
                className="inline-flex items-center gap-2 rounded-md border border-forge-line bg-white px-3 py-2 text-xs font-medium text-forge-ink hover:bg-forge-canvas"
                onClick={() => props.onCancel?.(props.item.proposalId)}
                type="button"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function AssistantMessage(props: { content: string; smooth: boolean; streaming: boolean }) {
  const t = useI18n();
  const visibleText = useTypewriterText(props.content, props.smooth);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) {
      clearTimeout(copiedTimer.current);
    }
  }, []);

  async function copyResponse(): Promise<void> {
    if (!navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(props.content);
      setCopied(true);
      if (copiedTimer.current !== undefined) {
        clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = setTimeout(() => setCopied(false), 1_800);
    } catch {
      // Clipboard access can be denied by the host. Keep the action available for retry.
    }
  }

  return (
    <article
      aria-busy={props.streaming}
      aria-live={props.streaming ? "polite" : undefined}
      className="group/answer motion-message-enter relative flex min-w-0 flex-col items-start px-1"
    >
      <div className="max-w-full pr-9 text-[13px] leading-5 text-forge-ink">
        <Streamdown mode={props.streaming ? "streaming" : "static"} plugins={{ code }} isAnimating={props.smooth}>
          {visibleText}
        </Streamdown>
      </div>
      {props.streaming ? null : (
        <button
          aria-label={copied ? t.agent.assistantResponseCopied : t.agent.copyAssistantResponse}
          className="motion-interactive absolute right-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-forge-muted opacity-0 outline-none hover:bg-forge-canvas hover:text-forge-ink focus-visible:bg-forge-canvas focus-visible:text-forge-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-forge-ink/15 group-focus-within/answer:opacity-100 group-hover/answer:opacity-100"
          onClick={() => void copyResponse()}
          title={copied ? t.agent.copied : t.agent.copy}
          type="button"
        >
          {copied ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
          <span className="sr-only" role={copied ? "status" : undefined}>
            {copied ? t.agent.copied : t.agent.copy}
          </span>
        </button>
      )}
    </article>
  );
}

function ReasoningBlock(props: { content: string }) {
  const t = useI18n();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <section className="motion-message-enter overflow-hidden rounded-[10px] bg-forge-canvas/70 text-sm">
      <button
        aria-label={`${expanded ? t.agent.reasoning : t.agent.thought} ${t.agent.completed}`}
        aria-controls={panelId}
        aria-expanded={expanded}
        className="motion-interactive flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forge-ink/15"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white text-forge-ink shadow-sm">
          <Sparkles aria-hidden="true" size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-forge-ink">
            {expanded ? t.agent.reasoning : t.agent.thought}
          </span>
          <span className="block text-[11px] text-forge-muted">{t.agent.completed}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`motion-interactive text-forge-muted ${expanded ? "rotate-90" : ""}`}
          size={15}
        />
      </button>
      <div
        aria-hidden={!expanded}
        className="motion-collapsible"
        id={panelId}
        inert={!expanded}
      >
        <div className="motion-collapsible-content">
          <div className="border-t border-forge-line/70 px-3 pb-3 pt-2.5 whitespace-pre-wrap text-xs leading-[18px] text-forge-ink">
            {props.content}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryBlock(props: { content: string }) {
  return (
    <details className="rounded-[10px] border border-forge-line bg-forge-canvas px-3 py-2.5 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-forge-muted">
        <FoldVertical className="text-forge-muted" size={16} />
        上下文摘要
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap text-xs leading-[18px] text-forge-ink">
        {props.content}
      </div>
    </details>
  );
}

function PlanBlock(props: { content: string }) {
  return (
    <article className="rounded-[10px] border border-forge-info bg-white px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-forge-ink">
        <ListChecks className="text-forge-info" size={17} />
        Proposed plan
      </div>
      <div className="mt-3 text-[13px] leading-5 text-forge-ink">
        <Streamdown mode="static" plugins={{ code }}>
          {props.content}
        </Streamdown>
      </div>
    </article>
  );
}

function ToolActivityGroup(props: { items: ToolStepItem[] }) {
  const t = useI18n();
  const runningCount = props.items.filter((item) => item.status === "running").length;
  const completedCount = props.items.filter((item) => item.status === "completed").length;
  const failedCount = props.items.filter((item) => item.status === "failed").length;
  const [expanded, setExpanded] = useState(runningCount > 0 || failedCount > 0);
  const panelId = useId();

  useEffect(() => {
    if (runningCount > 0 || failedCount > 0) {
      setExpanded(true);
    }
  }, [failedCount, runningCount]);

  const countLabel = t.agent.toolCount(props.items.length);
  const statusLabel = [
    completedCount > 0 ? t.agent.completedToolCount(completedCount) : undefined,
    failedCount > 0 ? t.agent.failedToolCount(failedCount) : undefined,
    runningCount > 0 ? t.agent.runningToolCount(runningCount) : undefined,
  ].filter((label): label is string => Boolean(label)).join(" · ");

  return (
    <section className="motion-message-enter overflow-hidden rounded-[10px] border border-forge-line bg-white/60" data-testid="tool-activity-group">
      <button
        aria-label={`${t.agent.toolActivity} ${countLabel} ${statusLabel}`}
        aria-controls={panelId}
        aria-expanded={expanded}
        className="motion-interactive flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none hover:bg-forge-canvas/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forge-ink/15"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-forge-canvas text-forge-muted">
          <Wrench aria-hidden="true" size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-forge-ink">{t.agent.toolActivity}</span>
          <span aria-live="polite" className="block truncate text-[11px] text-forge-muted">
            {countLabel} · {statusLabel}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`motion-interactive flex-none text-forge-muted ${expanded ? "rotate-90" : ""}`}
          size={15}
        />
      </button>
      <div
        aria-hidden={!expanded}
        className="motion-collapsible"
        id={panelId}
        inert={!expanded}
      >
        <div className="motion-collapsible-content">
          <div aria-label={t.agent.toolActivityDetails} className="border-t border-forge-line/80 px-2 py-1.5" role="region">
            {props.items.map((item) => <ToolActivityRow item={item} key={item.id} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function ToolActivityRow(props: { item: ToolStepItem }) {
  const t = useI18n();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const descriptor = describeTool(props.item.name, t.agent.toolLabels);
  const detail = toolDetail(props.item.input ?? props.item.output);
  const hasDetails = props.item.input !== undefined || props.item.output !== undefined;
  const status = toolStatus(props.item.status, {
    completed: t.agent.completed,
    failed: t.agent.failed,
    running: t.agent.running,
  });

  return (
    <div className="border-b border-forge-line/60 last:border-b-0">
      <button
        aria-label={`${descriptor.label}${detail ? ` ${detail}` : ""} ${status.label}`}
        aria-controls={hasDetails ? panelId : undefined}
        aria-expanded={hasDetails ? expanded : undefined}
        className="motion-interactive flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-forge-canvas/80 focus-visible:ring-2 focus-visible:ring-forge-ink/15"
        disabled={!hasDetails}
        onClick={() => hasDetails && setExpanded((value) => !value)}
        type="button"
      >
        <span className="flex h-6 w-6 flex-none items-center justify-center text-forge-muted">
          {descriptor.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-forge-ink">{descriptor.label}</span>
          {detail ? <span className="block truncate text-[11px] text-forge-muted">{detail}</span> : null}
        </span>
        <span className={`inline-flex flex-none items-center gap-1 text-[10px] font-medium ${status.text}`} role="status">
          {status.icon}
          {status.label}
        </span>
        {hasDetails ? (
          <ChevronRight
            aria-hidden="true"
            className={`motion-interactive flex-none text-forge-muted ${expanded ? "rotate-90" : ""}`}
            size={13}
          />
        ) : null}
      </button>
      {hasDetails ? (
        <div
          aria-hidden={!expanded}
          className="motion-collapsible"
          id={panelId}
        >
          <div className="motion-collapsible-content">
            <div className="mx-2 mb-2 max-h-64 overflow-auto rounded-md bg-forge-canvas px-3 py-2.5 text-[11px] leading-[18px] text-forge-ink">
              {props.item.input !== undefined ? (
                <>
                  <div className="font-semibold text-forge-muted">{t.agent.toolInput}</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words">{formatValue(props.item.input)}</pre>
                </>
              ) : null}
              {props.item.output !== undefined ? (
                <div className={props.item.input !== undefined ? "mt-3" : ""}>
                  <div className="font-semibold text-forge-muted">{t.agent.toolOutput}</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words">{formatValue(props.item.output)}</pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function describeTool(
  name: string,
  labels: ReturnType<typeof useI18n>["agent"]["toolLabels"],
): { label: string; icon: ReactNode } {
  const normalized = name.toLowerCase();
  if (normalized.startsWith("mcp__")) {
    const [, server = "MCP", ...toolParts] = name.split("__");
    const tool = humanizeToolName(toolParts.join("_"));
    return {
      label: tool ? `${humanizeToolName(server)} · ${tool}` : labels.useMcp(humanizeToolName(server)),
      icon: <Plug aria-hidden="true" size={15} />,
    };
  }
  if (normalized === "bash" || normalized.includes("runcommand")) {
    return { label: labels.runCommand, icon: <Terminal aria-hidden="true" size={15} /> };
  }
  if (normalized === "read" || normalized.includes("readfile")) {
    return { label: labels.readFile, icon: <FileText aria-hidden="true" size={15} /> };
  }
  if (normalized === "write" || normalized.includes("writefile")) {
    return { label: labels.writeFile, icon: <FilePlus aria-hidden="true" size={15} /> };
  }
  if (normalized === "edit" || normalized.includes("replacetext") || normalized.includes("editfile")) {
    return { label: labels.editFile, icon: <FilePenLine aria-hidden="true" size={15} /> };
  }
  if (normalized === "grep" || normalized.includes("searchtext")) {
    return { label: labels.searchText, icon: <Search aria-hidden="true" size={15} /> };
  }
  if (normalized === "find" || normalized.includes("findfile")) {
    return { label: labels.findFiles, icon: <FolderSearch aria-hidden="true" size={15} /> };
  }
  if (normalized === "ls" || normalized.includes("listdirectory")) {
    return { label: labels.listDirectory, icon: <FolderOpen aria-hidden="true" size={15} /> };
  }
  if (normalized === "web_search") {
    return { label: labels.searchWeb, icon: <Globe aria-hidden="true" size={15} /> };
  }
  if (normalized === "web_fetch") {
    return { label: labels.fetchWebpage, icon: <Globe aria-hidden="true" size={15} /> };
  }
  return { label: humanizeToolName(name) || labels.useTool, icon: <Wrench aria-hidden="true" size={15} /> };
}

function humanizeToolName(name: string): string {
  const text = name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function toolStatus(
  status: ToolStepItem["status"],
  labels: { completed: string; failed: string; running: string },
): { label: string; text: string; icon: ReactNode } {
  if (status === "completed") {
    return {
      label: labels.completed,
      text: "text-forge-success",
      icon: <Check aria-hidden="true" size={12} />,
    };
  }
  if (status === "failed") {
    return {
      label: labels.failed,
      text: "text-forge-danger",
      icon: <CircleX aria-hidden="true" size={12} />,
    };
  }
  return {
    label: labels.running,
    text: "text-forge-info",
    icon: <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={12} />,
  };
}

function toolDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = toRecord(value);
  for (const field of ["command", "path", "filePath", "query", "pattern", "glob", "url", "cwd"]) {
    const candidate = record[field];
    if (typeof candidate === "string" && candidate.trim()) {
      return firstLine(candidate);
    }
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return firstLine(text);
}

function firstLine(value: string): string | undefined {
  const line = value.split("\n")[0]?.trim();
  return line || undefined;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function taskLabel(status: Extract<TimelineItem, { type: "task-list" }>["tasks"][number]["status"]): string {
  if (status === "in_progress") {
    return "In progress";
  }
  return status[0]?.toUpperCase() + status.slice(1);
}

function taskBadge(status: Extract<TimelineItem, { type: "task-list" }>["tasks"][number]["status"]): string {
  if (status === "completed") {
    return "bg-forge-success-bg text-forge-success";
  }
  if (status === "blocked") {
    return "bg-forge-danger-bg text-forge-danger";
  }
  if (status === "in_progress") {
    return "bg-forge-info-bg text-forge-info";
  }
  return "bg-forge-canvas text-forge-muted";
}

function formatTimeChip(startedAt: string | undefined): string | undefined {
  if (!startedAt) {
    return undefined;
  }
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return `Today ${time}`;
  }
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
