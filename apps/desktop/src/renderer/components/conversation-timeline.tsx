import { CalendarClock, Check, X } from "lucide-react";
import type { TimelineItem } from "../timeline";
import { useTypewriterText } from "../use-typewriter-text";

export function ConversationTimeline(props: {
  items: TimelineItem[];
  onCreateAutomationProposal?: ((proposalId: string) => void) | undefined;
  onCancelAutomationProposal?: ((proposalId: string) => void) | undefined;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
        <div className="max-w-[82%] rounded-xl bg-forge-ink px-4 py-3 text-sm leading-6 text-white">
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
      <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
        {item.message}
      </div>
    );
  }
  return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{item.message}</div>;
}

function AutomationProposalCard(props: {
  item: Extract<TimelineItem, { type: "automation-proposal" }>;
  onCreate?: ((proposalId: string) => void) | undefined;
  onCancel?: ((proposalId: string) => void) | undefined;
}) {
  const { proposal } = props.item;
  const created = props.item.status === "created";

  return (
    <article className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md bg-white text-forge-ember">
          <CalendarClock size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-900">
              {created ? "Automation created" : "Automation proposal"}
            </div>
            <div className="text-xs text-slate-500">{proposal.timezone}</div>
          </div>
          <div className="mt-1 font-medium text-slate-800">{proposal.name}</div>
          <div className="mt-1 text-xs leading-5 text-slate-600">
            {proposal.summary} · {proposal.cron}
          </div>
          <div className="mt-2 rounded-md bg-white/70 px-3 py-2 text-xs leading-5 text-slate-700">
            {proposal.prompt}
          </div>
          {created ? null : (
            <div className="mt-3 flex items-center gap-2">
              <button
                aria-label={`Create automation ${proposal.name}`}
                className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-xs font-medium text-white"
                onClick={() => props.onCreate?.(props.item.proposalId)}
                type="button"
              >
                <Check size={14} />
                Create automation
              </button>
              <button
                aria-label={`Cancel automation ${proposal.name}`}
                className="inline-flex items-center gap-2 rounded-md border border-orange-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-orange-100"
                onClick={() => props.onCancel?.(props.item.proposalId)}
                type="button"
              >
                <X size={14} />
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
      <div className="max-w-[82%] rounded-xl border border-forge-line bg-white px-4 py-3 text-sm leading-6">
        <div className="whitespace-pre-wrap">{visibleText}</div>
      </div>
    </article>
  );
}

function ReasoningBlock(props: { content: string }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">Reasoning</summary>
      <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
        {props.content}
      </div>
    </details>
  );
}

function ToolStep(props: { item: Extract<TimelineItem, { type: "tool-step" }> }) {
  const label = props.item.status === "running"
    ? `Running ${props.item.name}`
    : props.item.status === "completed"
      ? `Completed ${props.item.name}`
      : `Failed ${props.item.name}`;
  const statusClass = props.item.status === "failed"
    ? "border-red-200 bg-red-50 text-red-800"
    : props.item.status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-blue-200 bg-blue-50 text-blue-800";

  return (
    <details className={`rounded-lg border px-4 py-3 text-sm ${statusClass}`}>
      <summary className="cursor-pointer font-medium">{label}</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-md bg-white/70 p-3 text-xs leading-5 text-slate-700">
        {props.item.input !== undefined ? (
          <>
            <div className="font-semibold text-slate-600">Input</div>
            <pre className="mt-1 whitespace-pre-wrap">{formatValue(props.item.input)}</pre>
          </>
        ) : null}
        {props.item.output !== undefined ? (
          <div className={props.item.input !== undefined ? "mt-3" : ""}>
            <div className="font-semibold text-slate-600">Output</div>
            <pre className="mt-1 whitespace-pre-wrap">{formatValue(props.item.output)}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
