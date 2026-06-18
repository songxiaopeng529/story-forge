import type { PersistedMessageView } from "../../shared/story-forge-api";
import type { TimelineItem } from "../timeline";
import { useTypewriterText } from "../use-typewriter-text";

export function ConversationTimeline(props: { items: TimelineItem[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {props.items.map((item, index) => (
        <TimelineItemView item={item} key={timelineItemKey(item, index)} />
      ))}
    </div>
  );
}

function TimelineItemView({ item }: { item: TimelineItem }) {
  if (item.type === "message") {
    return <PersistedMessage message={item.message} />;
  }
  if (item.type === "pending") {
    return <AssistantBubble>{item.label}</AssistantBubble>;
  }
  if (item.type === "assistant-stream") {
    return (
      <AssistantStreamBubble
        content={item.content}
        smooth={item.delivery === "smooth"}
      />
    );
  }
  if (item.type === "tool-activity") {
    const label = item.status === "running"
      ? `Running ${item.name}`
      : item.status === "completed"
        ? `Completed ${item.name}`
        : `Failed ${item.name}`;
    return (
      <details className="rounded-lg border border-forge-line bg-slate-50 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">{label}</summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
          {JSON.stringify({ input: item.input, output: item.output }, null, 2)}
        </pre>
      </details>
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

function PersistedMessage({ message }: { message: PersistedMessageView }) {
  if (message.role === "tool") {
    return (
      <details className="rounded-lg border border-forge-line bg-slate-50 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {message.ok ? "Completed" : "Failed"}: {message.name}
        </summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
          {message.content}
        </pre>
      </details>
    );
  }

  const isUser = message.role === "user";
  return (
    <article className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-xl px-4 py-3 text-sm leading-6 ${
        isUser ? "bg-forge-ink text-white" : "border border-forge-line bg-white"
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.role === "assistant" && message.reasoningContent ? (
          <details className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">Reasoning</summary>
            <div className="mt-2 whitespace-pre-wrap">{message.reasoningContent}</div>
          </details>
        ) : null}
        {message.role === "assistant" && message.toolCalls?.length ? (
          <details className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">
              Tool requests ({message.toolCalls.length})
            </summary>
            {message.toolCalls.map((toolCall) => (
              <div className="mt-2" key={toolCall.id}>{toolCall.name}</div>
            ))}
          </details>
        ) : null}
      </div>
    </article>
  );
}

function AssistantStreamBubble(props: { content: string; smooth: boolean }) {
  const visibleText = useTypewriterText(props.content, props.smooth);

  return <AssistantBubble>{visibleText}</AssistantBubble>;
}

function AssistantBubble({ children }: { children: string }) {
  return (
    <article className="flex justify-start">
      <div className="max-w-[82%] rounded-xl border border-forge-line bg-white px-4 py-3 text-sm leading-6">
        <div className="whitespace-pre-wrap">{children}</div>
      </div>
    </article>
  );
}

function timelineItemKey(item: TimelineItem, index: number): string {
  if (item.type === "message") {
    return item.message.id;
  }
  if (item.type === "pending" || item.type === "assistant-stream") {
    return `${item.type}-${item.turnId}`;
  }
  if (item.type === "tool-activity") {
    return `${item.type}-${item.callId}-${item.status}-${index}`;
  }
  return `${item.type}-${index}`;
}
