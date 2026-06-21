import type {
  AgentEvent,
  AutomationView,
  CommandExecutionMode,
  ModelRequestEvent,
  TurnId,
} from "@story-forge/shared";
import {
  Braces,
  CalendarClock,
  CircleStop,
  FolderOpen,
  PanelLeftOpen,
  PanelRightOpen,
  Paperclip,
  Play,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import { commandModeMeta } from "../command-mode-meta";
import { buildTimeline, type AutomationProposalTimelineState } from "../timeline";
import { ConversationTimeline } from "./conversation-timeline";
import { ModelRequestDrawer } from "./model-request-drawer";
import { SessionTimerDialog } from "./session-timer-dialog";

export function AgentWorkspace(props: {
  loading: boolean;
  workspace: WorkspaceView | undefined;
  session: SessionView | undefined;
  activities: AgentEvent[];
  automationProposals: AutomationProposalTimelineState[];
  modelRequests: ModelRequestEvent[];
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  modelInspectorOpen: boolean;
  sessionTimerCount: number;
  activeTurnId: TurnId | undefined;
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  contextCollapsed: boolean;
  onExpandNav: () => void;
  onExpandSidebar: () => void;
  onExpandContext: () => void;
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
  onSessionTimerCreated: (automation: AutomationView) => void;
  onError: (error: string | undefined) => void;
  onCreateAutomationProposal: (proposalId: string) => void;
  onCancelAutomationProposal: (proposalId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [timerDialogOpen, setTimerDialogOpen] = useState(false);
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
    setTimerDialogOpen(false);
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
        className={`flex h-16 flex-none items-center gap-3 border-b border-forge-line bg-white pr-5 ${
          props.navCollapsed || props.sidebarCollapsed ? "pl-4" : "pl-6"
        }`}
        data-testid="agent-header"
      >
        {props.navCollapsed || props.sidebarCollapsed ? (
          <div className="flex flex-none items-center gap-2">
            {props.navCollapsed ? (
              <button
                aria-label="Expand navigation"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
                onClick={props.onExpandNav}
                title="Expand navigation"
                type="button"
              >
                <PanelLeftOpen size={16} />
              </button>
            ) : null}
            {props.sidebarCollapsed ? (
              <button
                aria-label="Expand session sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
                onClick={props.onExpandSidebar}
                title="Expand sidebar"
                type="button"
              >
                <PanelRightOpen size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          {props.session ? (
            <input
              aria-label="Session title"
              className="w-full truncate bg-transparent text-sm font-semibold text-forge-ink outline-none"
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
            <div className="text-sm font-semibold text-forge-ink">{props.workspace.displayName}</div>
          )}
          <div className="truncate text-[11px] text-forge-muted">
            {props.session
              ? `${props.workspace.displayName} / ${props.session.model} / live response`
              : props.workspace.path}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {props.session ? (
            <button
              aria-label="Create session timer"
              className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink disabled:opacity-40"
              disabled={Boolean(props.activeTurnId)}
              onClick={() => setTimerDialogOpen(true)}
              title="Create session timer"
              type="button"
            >
              <CalendarClock size={16} />
              {props.sessionTimerCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-forge-ink px-1 text-[10px] font-semibold leading-4 text-white">
                  {props.sessionTimerCount}
                </span>
              ) : null}
            </button>
          ) : null}
          {props.developerMode ? (
            <button
              aria-label="Open model request inspector"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
              onClick={props.onModelInspectorOpen}
              type="button"
            >
              <Braces size={16} />
            </button>
          ) : null}
          {props.session ? (
            <button
              aria-label="Delete session"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-danger-bg hover:text-forge-danger disabled:opacity-40"
              disabled={Boolean(props.activeTurnId)}
              onClick={props.onDelete}
              type="button"
            >
              <Trash2 size={16} />
            </button>
          ) : null}
          {props.contextCollapsed ? (
            <button
              aria-label="Expand run context"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
              onClick={props.onExpandContext}
              title="Expand run context"
              type="button"
            >
              <PanelRightOpen size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 py-[22px]"
            data-testid="agent-message-scroll"
            ref={messageScrollRef}
          >
            {!props.session ? (
              <div className="mx-auto max-w-xl rounded-[10px] border border-dashed border-forge-line p-8 text-center text-sm text-forge-muted">
                Create a session from the workspace sidebar to begin.
              </div>
            ) : props.session.messages.length === 0 && timelineItems.length === 0 ? (
              <div className="mx-auto max-w-[560px] rounded-[10px] border border-forge-line bg-white p-5 text-sm text-forge-muted">
                Ask StoryForge to inspect code, edit workspace files, or run an allowed development command.
              </div>
            ) : (
              <ConversationTimeline
                items={timelineItems}
                startedAt={props.session.createdAt}
                onCancelAutomationProposal={props.onCancelAutomationProposal}
                onCreateAutomationProposal={props.onCreateAutomationProposal}
              />
            )}
          </div>

          <footer className="flex-none border-t border-forge-line bg-forge-canvas px-6 pb-5 pt-3">
            <div className="mx-auto max-w-[560px]">
              {props.error ? (
                <div className="mb-2 rounded-lg border border-forge-danger/30 bg-forge-danger-bg px-3 py-2 text-sm text-forge-danger">
                  {props.error}
                </div>
              ) : null}
              <div className="rounded-2xl border border-forge-line bg-white focus-within:border-forge-ink/40">
                <textarea
                  className="h-24 w-full resize-none rounded-2xl border-0 bg-transparent p-3.5 text-[13px] text-forge-ink outline-none placeholder:text-forge-muted disabled:bg-transparent"
                  disabled={!props.session}
                  onChange={(event) => props.onPromptChange(event.target.value)}
                  onCompositionEnd={props.onCompositionEnd}
                  onCompositionStart={props.onCompositionStart}
                  onKeyDown={props.onPromptKeyDown}
                  placeholder="Ask StoryForge to inspect, explain, or change code..."
                  value={props.prompt}
                />
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-2">
                    <button
                      aria-label="Attach file"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-forge-muted disabled:opacity-50"
                      disabled
                      title="Attachments coming soon"
                      type="button"
                    >
                      <Paperclip size={16} />
                    </button>
                    <span className="rounded-full border border-forge-line bg-white px-2.5 py-1 text-[11px] font-medium text-forge-ink">
                      Agent
                    </span>
                    <span className="rounded-full border border-forge-line bg-white px-2.5 py-1 text-[11px] font-medium text-forge-danger">
                      {commandModeMeta[props.commandExecutionMode].chip}
                    </span>
                  </div>
                  {props.activeTurnId ? (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg bg-forge-ink px-3.5 py-2 text-sm font-medium text-white"
                      onClick={props.onStop}
                      type="button"
                    >
                      <CircleStop size={15} />
                      Stop
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg bg-forge-ink px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
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
              <div className="mt-2 text-[10px] leading-[14px] text-forge-muted">
                Enter to send, Shift+Enter for newline
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
      {timerDialogOpen && props.session && props.workspace ? (
        <SessionTimerDialog
          session={props.session}
          workspace={props.workspace}
          timerCount={props.sessionTimerCount}
          onClose={() => setTimerDialogOpen(false)}
          onCreated={props.onSessionTimerCreated}
          onError={props.onError}
        />
      ) : null}
    </section>
  );
}
