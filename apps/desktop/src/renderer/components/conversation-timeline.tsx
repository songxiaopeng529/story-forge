import { Check, Clock3, OctagonAlert, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { TimelineItem } from "../timeline";
import { useTypewriterText } from "../use-typewriter-text";

export function ConversationTimeline(props: {
  items: TimelineItem[];
  startedAt?: string | undefined;
  onCreateAutomationProposal?: ((proposalId: string) => void) | undefined;
  onCancelAutomationProposal?: ((proposalId: string) => void) | undefined;
}) {
  const timeChip = formatTimeChip(props.startedAt);
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-stretch gap-3">
      {timeChip ? (
        <div className="flex justify-center">
          <span className="rounded-full border border-forge-line bg-forge-canvas px-2 py-[3px] text-[11px] font-medium text-forge-ink">
            {timeChip}
          </span>
        </div>
      ) : null}
      {props.items.map((item) => (
        <TimelineItemView
          item={item}
          key={item.id}
          onCancelAutomationProposal={props.onCancelAutomationProposal}
          onCreateAutomationProposal={props.onCreateAutomationProposal}
        />
      ))}
    </div>
  );
}

function TimelineItemView(props: {
  item: TimelineItem;
  onCreateAutomationProposal?: ((proposalId: string) => void) | undefined;
  onCancelAutomationProposal?: ((proposalId: string) => void) | undefined;
}) {
  const { item } = props;
  if (item.type === "user-message") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[82%] rounded-xl bg-forge-ink px-3.5 py-2.5 text-[13px] leading-5 text-white">
          <div className="whitespace-pre-wrap">{item.content}</div>
        </div>
      </article>
    );
  }
  if (item.type === "assistant-message") {
    return (
      <AssistantMessage
        content={item.content}
        smooth={Boolean(item.streaming) && item.delivery === "smooth"}
      />
    );
  }
  if (item.type === "reasoning") {
    return <ReasoningBlock content={item.content} />;
  }
  if (item.type === "tool-step") {
    return <ToolStep item={item} />;
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

function AssistantMessage(props: { content: string; smooth: boolean }) {
  const visibleText = useTypewriterText(props.content, props.smooth);

  return (
    <article className="flex justify-start">
      <div className="max-w-full rounded-xl border border-forge-line bg-white px-3.5 py-3 text-[13px] leading-5 text-forge-ink">
        <div className="whitespace-pre-wrap">{visibleText}</div>
      </div>
    </article>
  );
}

function ReasoningBlock(props: { content: string }) {
  return (
    <details className="rounded-[10px] border border-forge-line bg-white px-3 py-2.5 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-forge-ink">
        <Sparkles className="text-forge-ink" size={16} />
        Reasoning
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap text-xs leading-[18px] text-forge-ink">
        {props.content}
      </div>
    </details>
  );
}

function ToolStep(props: { item: Extract<TimelineItem, { type: "tool-step" }> }) {
  const { status } = props.item;
  const label = status === "running"
    ? `Running ${props.item.name}`
    : status === "completed"
      ? `Completed ${props.item.name}`
      : `Failed ${props.item.name}`;
  const tone: { card: string; text: string; icon: ReactNode } = status === "failed"
    ? {
        card: "border-forge-danger bg-forge-danger-bg",
        text: "text-forge-danger",
        icon: <OctagonAlert size={18} />,
      }
    : status === "completed"
      ? {
          card: "border-forge-success-line bg-forge-success-bg",
          text: "text-forge-success",
          icon: <Check size={18} />,
        }
      : {
          card: "border-forge-info bg-forge-info-bg",
          text: "text-forge-info",
          icon: <Clock3 size={18} />,
        };
  const detail = toolDetail(props.item.input ?? props.item.output);

  return (
    <details className={`rounded-[10px] border px-3 py-2.5 text-sm ${tone.card}`}>
      <summary className="flex cursor-pointer items-center gap-2.5">
        <span className={`flex-none ${tone.text}`}>{tone.icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block text-xs font-semibold ${tone.text}`}>{label}</span>
          {detail ? (
            <span className={`block truncate text-[11px] ${tone.text} opacity-80`}>{detail}</span>
          ) : null}
        </span>
      </summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-md bg-white/70 p-3 text-xs leading-5 text-forge-ink">
        {props.item.input !== undefined ? (
          <>
            <div className="font-semibold text-forge-muted">Input</div>
            <pre className="mt-1 whitespace-pre-wrap">{formatValue(props.item.input)}</pre>
          </>
        ) : null}
        {props.item.output !== undefined ? (
          <div className={props.item.input !== undefined ? "mt-3" : ""}>
            <div className="font-semibold text-forge-muted">Output</div>
            <pre className="mt-1 whitespace-pre-wrap">{formatValue(props.item.output)}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function toolDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const firstLine = text.split("\n")[0]?.trim();
  return firstLine || undefined;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
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
