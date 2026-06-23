import type {
  AgentEvent,
  AutomationView,
  CommandExecutionMode,
  ModelRequestEvent,
  SkillView,
  TurnId,
  TurnMode,
} from "@story-forge/shared";
import {
  Braces,
  CalendarClock,
  CircleStop,
  FolderOpen,
  ImagePlus,
  KeyRound,
  ListChecks,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Puzzle,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  ImageAttachmentView,
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
  composerMode: TurnMode;
  imageAttachments: ImageAttachmentView[];
  imageInputEnabled: boolean;
  error: string | undefined;
  onPromptChange: (prompt: string) => void;
  onComposerModeChange: (mode: TurnMode) => void;
  onImageAttachmentsChange: (attachments: ImageAttachmentView[]) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onSend: () => void;
  onStop: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onOpenWorkspace: () => void;
  onOpenModels: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: () => void;
  onModelInspectorOpen: () => void;
  onModelInspectorClose: () => void;
  onSessionTimerCreated: (automation: AutomationView) => void;
  onError: (error: string | undefined) => void;
  onCreateAutomationProposal: (proposalId: string) => void;
  onCancelAutomationProposal: (proposalId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [timerDialogOpen, setTimerDialogOpen] = useState(false);
  const [slashRange, setSlashRange] = useState<SlashRange>();
  const [slashSkills, setSlashSkills] = useState<SkillView[]>([]);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
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
    setSlashRange(undefined);
  }, [props.session?.id, props.session?.title]);
  useEffect(() => {
    const element = messageScrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [timelineFingerprint]);
  useEffect(() => {
    if (!slashRange || !props.session) {
      return;
    }
    let cancelled = false;
    window.storyForge.skills.list()
      .then((skills) => {
        if (!cancelled) {
          setSlashSkills(skills.filter((skill) => skill.enabled));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlashSkills([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [Boolean(slashRange), props.session?.id]);

  const slashCommands = useMemo(() => {
    const builtInCommands: SlashCommandItem[] = [
      {
        id: "plan",
        invocation: "/plan",
        title: "Plan mode",
        description: "Plan the work first without editing files.",
        kind: "builtin",
        icon: <ListChecks size={15} />,
        action: () => {
          props.onPromptChange("");
          props.onComposerModeChange("plan");
        },
      },
      {
        id: "timer",
        invocation: "/timer",
        title: "Session timer",
        description: "Create an automation that continues this session.",
        kind: "builtin",
        icon: <CalendarClock size={15} />,
        action: () => {
          props.onPromptChange("");
          setTimerDialogOpen(true);
        },
      },
      {
        id: "models",
        invocation: "/models",
        title: "Models",
        description: "Open provider and model settings.",
        kind: "builtin",
        icon: <KeyRound size={15} />,
        action: () => {
          props.onPromptChange("");
          props.onOpenModels();
        },
      },
      {
        id: "skills",
        invocation: "/skills",
        title: "MCP & Skills",
        description: "Manage installed skills and MCP servers.",
        kind: "builtin",
        icon: <Puzzle size={15} />,
        action: () => {
          props.onPromptChange("");
          props.onOpenExtensions();
        },
      },
      {
        id: "settings",
        invocation: "/settings",
        title: "Settings",
        description: "Open application preferences.",
        kind: "builtin",
        icon: <Settings size={15} />,
        action: () => {
          props.onPromptChange("");
          props.onOpenSettings();
        },
      },
    ];
    const skillCommands = slashSkills.map<SlashCommandItem>((skill) => ({
      id: `skill:${skill.id}`,
      invocation: skill.invocationName,
      title: skill.name,
      description: skill.description || "Invoke installed skill.",
      kind: "skill",
      icon: <Puzzle size={15} />,
    }));
    const query = slashRange?.query.trim().toLowerCase() ?? "";
    return [...builtInCommands, ...skillCommands]
      .filter((command) => {
        if (!query) {
          return true;
        }
        return [
          command.invocation.slice(1),
          command.title,
          command.description,
        ].some((value) => value.toLowerCase().includes(query));
      })
      .slice(0, 8);
  }, [
    props.onOpenExtensions,
    props.onOpenModels,
    props.onOpenSettings,
    props.onComposerModeChange,
    props.onPromptChange,
    slashRange?.query,
    slashSkills,
  ]);
  const slashMenuOpen = Boolean(slashRange && props.session);

  useEffect(() => {
    setActiveSlashIndex((index) =>
      slashCommands.length === 0 ? 0 : Math.min(index, slashCommands.length - 1)
    );
  }, [slashCommands.length]);

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

  function handlePromptChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const value = event.currentTarget.value;
    props.onPromptChange(value);
    updateSlashRange(value, event.currentTarget.selectionStart ?? value.length);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (slashMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashRange(undefined);
        return;
      }
      if (slashCommands.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveSlashIndex((index) => (index + 1) % slashCommands.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveSlashIndex((index) =>
            (index - 1 + slashCommands.length) % slashCommands.length
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          selectSlashCommand(slashCommands[activeSlashIndex]);
          return;
        }
      }
    }
    props.onPromptKeyDown(event);
  }

  function handlePromptSelection(event: { currentTarget: HTMLTextAreaElement }): void {
    updateSlashRange(props.prompt, event.currentTarget.selectionStart ?? props.prompt.length);
  }

  function updateSlashRange(value: string, cursor: number): void {
    setSlashRange(findSlashRange(value, cursor));
    setActiveSlashIndex(0);
  }

  function selectSlashCommand(command: SlashCommandItem | undefined): void {
    if (!command) {
      return;
    }
    setSlashRange(undefined);
    if (command.kind === "builtin") {
      command.action?.();
      return;
    }
    const range = slashRange ?? findSlashRange(props.prompt, promptInputRef.current?.selectionStart ?? props.prompt.length);
    if (!range) {
      return;
    }
    const insertion = `${command.invocation} `;
    const nextPrompt = `${props.prompt.slice(0, range.start)}${insertion}${props.prompt.slice(range.end)}`;
    const nextCursor = range.start + insertion.length;
    props.onPromptChange(nextPrompt);
    requestAnimationFrame(() => {
      promptInputRef.current?.focus();
      promptInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function handleImageInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) {
      return;
    }
    try {
      const attachments = await Promise.all(files.map(readImageAttachment));
      props.onImageAttachmentsChange([...props.imageAttachments, ...attachments]);
      props.onError(undefined);
    } catch (attachmentError) {
      props.onError(attachmentError instanceof Error ? attachmentError.message : String(attachmentError));
    }
  }

  function removeImageAttachment(attachmentId: string): void {
    props.onImageAttachmentsChange(
      props.imageAttachments.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  const attachDisabled = !props.session || !props.imageInputEnabled || Boolean(props.activeTurnId);
  const attachTitle = !props.session
    ? "Create a session to attach images"
    : !props.imageInputEnabled
      ? "The current model does not support image input"
      : props.activeTurnId
        ? "Wait for the current turn to finish"
        : "Attach image";

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
                <div className="relative">
                  {slashMenuOpen ? (
                    <div className="absolute bottom-full left-3 right-3 z-30 mb-2 overflow-hidden rounded-xl border border-forge-line bg-white shadow-xl">
                      <div className="border-b border-forge-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-forge-muted">
                        Slash commands
                      </div>
                      {slashCommands.length > 0 ? (
                        <div
                          aria-label="Slash commands"
                          className="max-h-64 overflow-y-auto p-1"
                          id="slash-command-menu"
                          role="listbox"
                        >
                          {slashCommands.map((command, index) => (
                            <div
                              aria-label={`${command.invocation} ${command.title} ${command.description}`}
                              aria-selected={index === activeSlashIndex}
                              className={`flex cursor-default items-start gap-2 rounded-lg px-2.5 py-2 text-left ${
                                index === activeSlashIndex
                                  ? "bg-forge-canvas text-forge-ink"
                                  : "text-forge-ink hover:bg-forge-canvas"
                              }`}
                              key={command.id}
                              onClick={() => selectSlashCommand(command)}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveSlashIndex(index)}
                              role="option"
                              tabIndex={-1}
                            >
                              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border border-forge-line bg-white text-forge-muted">
                                {command.icon}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="font-mono text-[12px] font-semibold text-forge-ink">
                                    {command.invocation}
                                  </span>
                                  <span className="truncate text-[12px] font-medium text-forge-muted">
                                    {command.title}
                                  </span>
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-forge-muted">
                                  {command.description}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-4 text-sm text-forge-muted">
                          No matching slash commands.
                        </div>
                      )}
                    </div>
                  ) : null}
                <textarea
                  aria-autocomplete="list"
                  aria-controls={slashMenuOpen ? "slash-command-menu" : undefined}
                  aria-expanded={slashMenuOpen}
                  className="h-24 w-full resize-none rounded-2xl border-0 bg-transparent p-3.5 text-[13px] text-forge-ink outline-none placeholder:text-forge-muted disabled:bg-transparent"
                  disabled={!props.session}
                  onChange={handlePromptChange}
                  onCompositionEnd={props.onCompositionEnd}
                  onCompositionStart={props.onCompositionStart}
                  onClick={handlePromptSelection}
                  onKeyDown={handlePromptKeyDown}
                  onKeyUp={handlePromptSelection}
                  placeholder="Ask StoryForge to inspect, explain, or change code..."
                  ref={promptInputRef}
                  value={props.prompt}
                />
                </div>
                {props.imageAttachments.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto border-t border-forge-line px-3 py-2">
                    {props.imageAttachments.map((attachment) => (
                      <div
                        className="group relative flex w-28 flex-none items-center gap-2 rounded-lg border border-forge-line bg-forge-canvas p-1.5"
                        key={attachment.id}
                      >
                        <img
                          alt=""
                          className="h-9 w-9 flex-none rounded-md object-cover"
                          src={imageAttachmentSrc(attachment)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-forge-ink" title={attachment.name}>
                            {attachment.name}
                          </div>
                          <div className="text-[10px] text-forge-muted">
                            {formatFileSize(attachment.size)}
                          </div>
                        </div>
                        <button
                          aria-label={`Remove image ${attachment.name}`}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-forge-line bg-white text-forge-muted shadow-sm hover:text-forge-ink"
                          onClick={() => removeImageAttachment(attachment.id)}
                          type="button"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-2">
                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      aria-label="Choose image"
                      className="sr-only"
                      disabled={attachDisabled}
                      multiple
                      onChange={(event) => void handleImageInputChange(event)}
                      ref={imageInputRef}
                      type="file"
                    />
                    <button
                      aria-label="Attach image"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-forge-muted hover:bg-forge-canvas hover:text-forge-ink disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={attachDisabled}
                      onClick={() => imageInputRef.current?.click()}
                      title={attachTitle}
                      type="button"
                    >
                      <ImagePlus size={16} />
                    </button>
                    <span className="rounded-full border border-forge-line bg-white px-2.5 py-1 text-[11px] font-medium text-forge-ink">
                      {props.composerMode === "plan" ? "Plan" : "Agent"}
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
                      disabled={!props.session || (!props.prompt.trim() && props.imageAttachments.length === 0)}
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

type SlashRange = {
  start: number;
  end: number;
  query: string;
};

type SlashCommandItem = {
  id: string;
  invocation: `/${string}`;
  title: string;
  description: string;
  kind: "builtin" | "skill";
  icon: ReactNode;
  action?: () => void;
};

function findSlashRange(value: string, cursor: number): SlashRange | undefined {
  const beforeCursor = value.slice(0, cursor);
  const match = /(?:^|\s)(\/[^\s]*)$/.exec(beforeCursor);
  if (!match) {
    return undefined;
  }
  const token = match[1];
  if (!token) {
    return undefined;
  }
  if (token.includes("//")) {
    return undefined;
  }
  return {
    start: beforeCursor.length - token.length,
    end: cursor,
    query: token.slice(1),
  };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readImageAttachment(file: File): Promise<ImageAttachmentView> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Only image files can be attached"));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.reject(new Error("Images must be 10 MB or smaller"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read image: ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      if (!result.startsWith("data:") || commaIndex === -1) {
        reject(new Error(`Failed to encode image: ${file.name}`));
        return;
      }
      resolve({
        id: createImageAttachmentId(),
        name: file.name,
        mediaType: file.type || "image/png",
        data: result.slice(commaIndex + 1),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function imageAttachmentSrc(attachment: ImageAttachmentView): string {
  return `data:${attachment.mediaType};base64,${attachment.data}`;
}

function createImageAttachmentId(): string {
  return `sf_image_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
