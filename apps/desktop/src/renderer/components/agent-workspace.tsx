import type { AgentEvent, TurnId } from "@story-forge/shared";
import { ChevronRight, CircleStop, FolderOpen, Play, Trash2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import type {
  PersistedMessageView,
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";

export function AgentWorkspace(props: {
  loading: boolean;
  workspace: WorkspaceView | undefined;
  session: SessionView | undefined;
  activities: AgentEvent[];
  activeTurnId: TurnId | undefined;
  prompt: string;
  error: string | undefined;
  onPromptChange: (prompt: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onSend: () => void;
  onStop: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onOpenWorkspace: () => void;
}) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    setTitle(props.session?.title ?? "");
  }, [props.session?.id, props.session?.title]);

  if (props.loading) {
    return <div className="flex items-center justify-center text-sm text-slate-500">Loading...</div>;
  }
  if (!props.workspace) {
    return (
      <div className="flex items-center justify-center">
        <div className="max-w-sm rounded-xl border border-forge-line bg-white p-8 text-center shadow-sm">
          <FolderOpen className="mx-auto text-forge-ember" size={28} />
          <h2 className="mt-4 text-lg font-semibold">Open a workspace</h2>
          <p className="mt-2 text-sm text-slate-600">
            Sessions and full conversation history are stored locally per workspace.
          </p>
          <button
            className="mt-5 rounded-md bg-forge-ember px-4 py-2 text-sm font-medium text-white"
            onClick={props.onOpenWorkspace}
            type="button"
          >
            Choose folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      data-testid="agent-workspace"
    >
      <header
        className="flex h-16 flex-none items-center gap-3 border-b border-forge-line bg-white px-5"
        data-testid="agent-header"
      >
        <div className="min-w-0 flex-1">
          {props.session ? (
            <input
              aria-label="Session title"
              className="w-full truncate bg-transparent text-sm font-semibold outline-none"
              onBlur={() => props.onRename(title)}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              value={title}
            />
          ) : (
            <div className="text-sm font-semibold">{props.workspace.displayName}</div>
          )}
          <div className="truncate text-xs text-slate-500">
            {props.session
              ? `${props.session.providerId} / ${props.session.model}`
              : props.workspace.path}
          </div>
        </div>
        {props.session ? (
          <button
            aria-label="Delete session"
            className="rounded-md border border-forge-line p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            disabled={Boolean(props.activeTurnId)}
            onClick={props.onDelete}
            type="button"
          >
            <Trash2 size={16} />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6" data-testid="agent-message-scroll">
        {!props.session ? (
          <div className="mx-auto max-w-xl rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
            Create a session from the workspace sidebar to begin.
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {props.session.messages.length === 0 ? (
              <div className="rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">
                Ask StoryForge to inspect code, edit workspace files, or run an allowed development command.
              </div>
            ) : null}
            {props.session.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {props.session.stopReason && props.session.status !== "completed" ? (
              <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-amber-800">
                  Session {props.session.status}
                </summary>
                <div className="mt-2 text-xs text-amber-700">
                  Stop reason: {props.session.stopReason}
                </div>
              </details>
            ) : null}
            {props.activities.length > 0 ? (
              <details className="rounded-lg border border-forge-line bg-white p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">
                  Activity ({props.activities.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {props.activities.map((event, index) => (
                    <Activity event={event} key={`${event.turnId}-${event.type}-${index}`} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
      </div>

      <footer className="flex-none border-t border-forge-line bg-white p-4">
        <div className="mx-auto max-w-3xl">
          {props.error ? (
            <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {props.error}
            </div>
          ) : null}
          <div className="rounded-xl border border-forge-line bg-white shadow-sm focus-within:ring-2 focus-within:ring-orange-200">
            <textarea
              className="h-24 w-full resize-none rounded-xl border-0 bg-transparent p-3 text-sm outline-none disabled:bg-slate-50"
              disabled={!props.session}
              onChange={(event) => props.onPromptChange(event.target.value)}
              onCompositionEnd={props.onCompositionEnd}
              onCompositionStart={props.onCompositionStart}
              onKeyDown={props.onPromptKeyDown}
              placeholder="Ask StoryForge to inspect, explain, or change code..."
              value={props.prompt}
            />
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
              <span className="text-xs text-slate-500">Enter to send, Shift+Enter for newline</span>
              {props.activeTurnId ? (
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white"
                  onClick={props.onStop}
                  type="button"
                >
                  <CircleStop size={15} />
                  Stop
                </button>
              ) : (
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                  disabled={!props.session || !props.prompt.trim()}
                  onClick={props.onSend}
                  type="button"
                >
                  <Play size={15} />
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}

function Message({ message }: { message: PersistedMessageView }) {
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

function Activity({ event }: { event: AgentEvent }) {
  if (event.type === "tool.call") {
    return (
      <div className="rounded-md bg-slate-50 p-2">
        <div className="font-medium">{event.name}</div>
        <pre className="mt-1 overflow-auto text-xs text-slate-500">
          {JSON.stringify(event.input, null, 2)}
        </pre>
      </div>
    );
  }
  if (event.type === "tool.result") {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <ChevronRight size={13} />
        {event.name}: {event.ok ? "completed" : "failed"}
      </div>
    );
  }
  if (event.type === "runtime.error") {
    return <div className="text-xs text-red-700">{event.message}</div>;
  }
  if (event.type === "runtime.completed") {
    return (
      <div className="text-xs text-slate-600">
        Stopped: {event.stopReason ?? "completed"} · {event.steps ?? 0} steps
      </div>
    );
  }
  return <div className="text-xs text-slate-500">{event.type}</div>;
}
