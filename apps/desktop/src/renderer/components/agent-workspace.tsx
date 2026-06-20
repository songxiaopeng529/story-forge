import type { AgentEvent, ModelRequestEvent, TurnId } from "@story-forge/shared";
import { Braces, CircleStop, FolderOpen, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import { buildTimeline, type AutomationProposalTimelineState } from "../timeline";
import { ConversationTimeline } from "./conversation-timeline";
import { ModelRequestDrawer } from "./model-request-drawer";

export function AgentWorkspace(props: {
  loading: boolean;
  workspace: WorkspaceView | undefined;
  session: SessionView | undefined;
  activities: AgentEvent[];
  automationProposals: AutomationProposalTimelineState[];
  modelRequests: ModelRequestEvent[];
  developerMode: boolean;
  modelInspectorOpen: boolean;
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
  onModelInspectorOpen: () => void;
  onModelInspectorClose: () => void;
  onCreateAutomationProposal: (proposalId: string) => void;
  onCancelAutomationProposal: (proposalId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineItems = buildTimeline({
    session: props.session,
    activities: props.activities,
    activeTurnId: props.activeTurnId,
    automationProposals: props.automationProposals,
  });
  const timelineFingerprint = timelineItems.map((item) => {
    if (item.type === "assistant-message") {
      return `${item.id}:${item.content.length}:${item.streaming ? "streaming" : "static"}`;
    }
    if (item.type === "tool-step") {
      return `${item.id}:${item.status}`;
    }
    return item.id;
  }).join("|");

  useEffect(() => {
    setTitle(props.session?.title ?? "");
  }, [props.session?.id, props.session?.title]);
  useEffect(() => {
    const element = messageScrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [timelineFingerprint]);

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
        <div className="flex flex-none items-center gap-2">
          {props.developerMode ? (
            <button
              aria-label="Open model request inspector"
              className="rounded-md border border-forge-line p-2 text-slate-500 hover:bg-slate-50"
              onClick={props.onModelInspectorOpen}
              type="button"
            >
              <Braces size={16} />
            </button>
          ) : null}
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
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="min-h-0 flex-1 overflow-y-auto p-6"
            data-testid="agent-message-scroll"
            ref={messageScrollRef}
          >
            {!props.session ? (
              <div className="mx-auto max-w-xl rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
                Create a session from the workspace sidebar to begin.
              </div>
            ) : props.session.messages.length === 0 && timelineItems.length === 0 ? (
              <div className="mx-auto max-w-3xl rounded-lg bg-white p-5 text-sm text-slate-600 shadow-sm">
                Ask StoryForge to inspect code, edit workspace files, or run an allowed development command.
              </div>
            ) : (
              <ConversationTimeline
                items={timelineItems}
                onCancelAutomationProposal={props.onCancelAutomationProposal}
                onCreateAutomationProposal={props.onCreateAutomationProposal}
              />
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
        </div>
        {props.developerMode && props.modelInspectorOpen ? (
          <ModelRequestDrawer
            requests={props.modelRequests}
            onClose={props.onModelInspectorClose}
          />
        ) : null}
      </div>
    </section>
  );
}
