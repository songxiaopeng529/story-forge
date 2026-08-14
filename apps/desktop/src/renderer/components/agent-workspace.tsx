import type {
  AgentEvent,
  AutomationView,
  CommandExecutionMode,
  HumanInputRequestEvent,
  HumanInputResponse,
  ModelRequestEvent,
  SkillView,
  TurnId,
} from "@story-forge/shared";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CalendarClock,
  CircleStop,
  FoldVertical,
  FolderOpen,
  KeyRound,
  Loader2,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Puzzle,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
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
import { useI18n } from "../i18n";
import { useSmartScroll } from "../hooks/use-smart-scroll";
import { buildTimeline, type AutomationProposalTimelineState } from "../utils/timeline";
import { CommandModePicker } from "./command-mode-picker";
import { ConversationTimeline } from "./conversation-timeline";
import { ModelRequestDrawer } from "./model-request-drawer";
import { SessionTimerDialog } from "./session-timer-dialog";

const PROMPT_MIN_HEIGHT = 28;
const PROMPT_MAX_HEIGHT = 100;

export function AgentWorkspace(props: {
  loading: boolean;
  workspace: WorkspaceView | undefined;
  session: SessionView | undefined;
  activities: AgentEvent[];
  automationProposals: AutomationProposalTimelineState[];
  currentHumanInputRequest: HumanInputRequestEvent | undefined;
  humanInputResponding: boolean;
  modelRequests: ModelRequestEvent[];
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  compacting: boolean;
  modelInspectorOpen: boolean;
  sessionTimerCount: number;
  activeTurnId: TurnId | undefined;
  turnStarting: boolean;
  commandModeLocked: boolean;
  settingsSaving: boolean;
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  contextCollapsed: boolean;
  onExpandNav: () => void;
  onExpandSidebar: () => void;
  onExpandContext: () => void;
  prompt: string;
  imageAttachments: ImageAttachmentView[];
  imageInputEnabled: boolean;
  error: string | undefined;
  onPromptChange: (prompt: string) => void;
  onImageAttachmentsChange: (attachments: ImageAttachmentView[]) => void;
  onCommandExecutionModeChange: (commandExecutionMode: CommandExecutionMode) => void;
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
  onCompact: () => void;
  onModelInspectorOpen: () => void;
  onModelInspectorClose: () => void;
  onSessionTimerCreated: (automation: AutomationView) => void;
  onError: (error: string | undefined) => void;
  onCreateAutomationProposal: (proposalId: string) => void;
  onCancelAutomationProposal: (proposalId: string) => void;
  onHumanInputRespond: (response: Omit<HumanInputResponse, "requestId">) => void;
}) {
  const t = useI18n();
  const [title, setTitle] = useState("");
  const [timerDialogOpen, setTimerDialogOpen] = useState(false);
  const [slashRange, setSlashRange] = useState<SlashRange>();
  const [slashSkills, setSlashSkills] = useState<SkillView[]>([]);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [activeSlashCommand, setActiveSlashCommand] = useState<ActiveSlashCommand>();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const pendingSendRef = useRef(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const promptControlsRef = useRef<HTMLDivElement | null>(null);
  const promptMeasureRef = useRef<HTMLSpanElement | null>(null);
  const modeControlRef = useRef<HTMLDivElement | null>(null);
  const timelineItems = buildTimeline({
    session: props.session,
    activities: props.activities,
    activeTurnId: props.activeTurnId,
    automationProposals: props.automationProposals,
    ...(props.currentHumanInputRequest ? { humanInputRequest: props.currentHumanInputRequest } : {}),
    humanInputResponding: props.humanInputResponding,
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
  const scrollFingerprint = `${timelineFingerprint}|${props.compacting ? "compacting" : "idle"}`;
  const smartScroll = useSmartScroll({
    itemCount: timelineItems.length + (props.compacting ? 1 : 0),
    sessionKey: props.session?.id,
    contentVersion: scrollFingerprint,
  });

  useEffect(() => {
    setTitle(props.session?.title ?? "");
    setTimerDialogOpen(false);
    setSlashRange(undefined);
    setActiveSlashCommand(undefined);
    setModeMenuOpen(false);
  }, [props.session?.id, props.session?.title]);
  useLayoutEffect(() => {
    updatePromptLayout();
  }, [
    activeSlashCommand?.invocation,
    props.commandExecutionMode,
    props.prompt,
    props.session?.id,
  ]);
  useLayoutEffect(() => {
    const controls = promptControlsRef.current;
    if (!controls || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(updatePromptLayout);
    observer.observe(controls);
    if (promptMeasureRef.current) {
      observer.observe(promptMeasureRef.current);
    }
    if (modeControlRef.current) {
      observer.observe(modeControlRef.current);
    }
    return () => observer.disconnect();
  }, [props.session?.id]);
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

  useEffect(() => {
    if (!pendingSendRef.current) {
      return;
    }
    pendingSendRef.current = false;
    props.onSend();
    setActiveSlashCommand(undefined);
  }, [props.prompt]);

  const slashCommands = useMemo(() => {
    const builtInCommands: SlashCommandItem[] = [
      {
        id: "timer",
        invocation: "/timer",
        title: t.agent.builtinCommands.timer.title,
        description: t.agent.builtinCommands.timer.description,
        kind: "builtin",
        icon: <CalendarClock size={15} />,
        action: () => {
          props.onPromptChange("");
          setTimerDialogOpen(true);
        },
      },
      {
        id: "compact",
        invocation: "/compact",
        title: t.agent.builtinCommands.compact.title,
        description: t.agent.builtinCommands.compact.description,
        kind: "builtin",
        icon: <FoldVertical size={15} />,
        action: () => {
          props.onPromptChange("");
          props.onCompact();
        },
      },
      {
        id: "models",
        invocation: "/models",
        title: t.agent.builtinCommands.models.title,
        description: t.agent.builtinCommands.models.description,
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
        title: t.agent.builtinCommands.skills.title,
        description: t.agent.builtinCommands.skills.description,
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
        title: t.agent.builtinCommands.settings.title,
        description: t.agent.builtinCommands.settings.description,
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
      description: skill.description || t.agent.builtinCommands.skillFallbackDescription,
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
    props.onCompact,
    props.onPromptChange,
    slashRange?.query,
    slashSkills,
    t,
  ]);
  const slashMenuOpen = Boolean(slashRange && props.session);
  const activeSlashOptionId = slashMenuOpen && slashCommands[activeSlashIndex]
    ? slashCommandOptionId(slashCommands[activeSlashIndex].id)
    : undefined;

  useEffect(() => {
    setActiveSlashIndex((index) =>
      slashCommands.length === 0 ? 0 : Math.min(index, slashCommands.length - 1)
    );
  }, [slashCommands.length]);

  useEffect(() => {
    if (!activeSlashOptionId) {
      return;
    }
    document.getElementById(activeSlashOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeSlashOptionId]);

  if (props.loading) {
    return <div className="flex items-center justify-center text-sm text-slate-500">{t.agent.loading}</div>;
  }
  if (!props.workspace) {
    return (
      <div className="flex items-center justify-center">
        <div className="max-w-sm rounded-xl border border-forge-line bg-white p-8 text-center shadow-sm">
          <FolderOpen className="mx-auto text-forge-ember" size={28} />
          <h2 className="mt-4 text-lg font-semibold">{t.agent.openWorkspaceTitle}</h2>
          <p className="mt-2 text-sm text-slate-600">
            {t.agent.openWorkspaceDescription}
          </p>
          <button
            className="mt-5 rounded-md bg-forge-ember px-4 py-2 text-sm font-medium text-white"
            onClick={props.onOpenWorkspace}
            type="button"
          >
            {t.agent.chooseFolder}
          </button>
        </div>
      </div>
    );
  }

  function handlePromptChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const value = event.currentTarget.value;
    resizePromptInput(event.currentTarget);
    props.onPromptChange(value);
    updateSlashRange(value, event.currentTarget.selectionStart ?? value.length);
  }

  function updatePromptLayout(): void {
    const controls = promptControlsRef.current;
    const measure = promptMeasureRef.current;
    const modeControl = modeControlRef.current;
    let needsFullWidth = Boolean(promptInputRef.current?.value.includes("\n"));
    if (!needsFullWidth && controls && measure && modeControl && controls.clientWidth > 0) {
      const fixedControlsWidth = 28 + modeControl.offsetWidth + 28;
      const inlineGaps = 4 * 3;
      const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
      needsFullWidth = measure.offsetWidth + 8 > inlineInputWidth;
    }
    setPromptExpanded((current) => current === needsFullWidth ? current : needsFullWidth);
    resizePromptInput();
  }

  function resizePromptInput(element = promptInputRef.current): void {
    if (!element) {
      return;
    }
    element.style.height = "0px";
    const contentHeight = element.scrollHeight;
    element.style.height = `${Math.min(
      Math.max(contentHeight, PROMPT_MIN_HEIGHT),
      PROMPT_MAX_HEIGHT,
    )}px`;
    element.style.overflowY = contentHeight > PROMPT_MAX_HEIGHT ? "auto" : "hidden";
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
    if (activeSlashCommand) {
      const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent;
      if (event.key === "Backspace" && props.prompt === "") {
        event.preventDefault();
        clearActiveSlashCommand();
        return;
      }
      if (
        event.key === "Enter"
        && !event.shiftKey
        && !nativeEvent.isComposing
        && nativeEvent.keyCode !== 229
      ) {
        event.preventDefault();
        if (canSend && !props.activeTurnId) {
          handleSend();
        }
        return;
      }
    }
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent;
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !nativeEvent.isComposing
      && nativeEvent.keyCode !== 229
      && canSend
      && !props.activeTurnId
    ) {
      smartScroll.scrollToLatest({ behavior: "auto" });
    }
    props.onPromptKeyDown(event);
  }

  function handlePromptSelection(event: { currentTarget: HTMLTextAreaElement }): void {
    updateSlashRange(props.prompt, event.currentTarget.selectionStart ?? props.prompt.length);
  }

  function handlePromptKeyUp(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      slashMenuOpen
      && (event.key === "ArrowDown"
        || event.key === "ArrowUp"
        || event.key === "Enter"
        || event.key === "Tab"
        || event.key === "Escape")
    ) {
      return;
    }
    handlePromptSelection(event);
  }

  function updateSlashRange(value: string, cursor: number): void {
    const nextSlashRange = findSlashRange(value, cursor);
    setSlashRange(nextSlashRange);
    if (nextSlashRange) {
      setModeMenuOpen(false);
    }
    setActiveSlashIndex(0);
  }

  function selectSlashCommand(command: SlashCommandItem | undefined): void {
    if (!command) {
      return;
    }
    setSlashRange(undefined);
    if (command.kind === "builtin") {
      if (command.pill) {
        setActiveSlashCommand({
          invocation: command.invocation,
          title: command.title,
          icon: command.icon,
          kind: "extension",
        });
        command.action?.();
        requestAnimationFrame(() => promptInputRef.current?.focus());
        return;
      }
      command.action?.();
      return;
    }
    setActiveSlashCommand({
      invocation: command.invocation,
      title: command.title,
      icon: command.icon,
      kind: "skill",
    });
    props.onPromptChange("");
    requestAnimationFrame(() => promptInputRef.current?.focus());
  }

  function clearActiveSlashCommand(): void {
    setActiveSlashCommand(undefined);
    requestAnimationFrame(() => promptInputRef.current?.focus());
  }

  function handleSend(): void {
    if (props.settingsSaving) {
      return;
    }
    smartScroll.scrollToLatest({ behavior: "auto" });
    if (activeSlashCommand) {
      const merged = `${activeSlashCommand.invocation} ${props.prompt}`.trimEnd();
      pendingSendRef.current = true;
      props.onPromptChange(merged);
      return;
    }
    props.onSend();
    setActiveSlashCommand(undefined);
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

  const attachDisabled = !props.session
    || !props.imageInputEnabled
    || Boolean(props.activeTurnId)
    || props.turnStarting;
  const attachTitle = !props.session
    ? t.agent.createSessionToAttachImages
    : !props.imageInputEnabled
      ? t.agent.modelNoImageInput
      : props.activeTurnId || props.turnStarting
        ? t.agent.waitForTurn
        : t.agent.attachImage;
  const canSend = Boolean(props.session)
    && (Boolean(props.prompt.trim())
      || props.imageAttachments.length > 0
      || activeSlashCommand?.kind === "skill")
    && (props.imageAttachments.length === 0 || props.imageInputEnabled)
    && !props.settingsSaving
    && !props.turnStarting;

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
                aria-label={t.agent.expandNavigation}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
                onClick={props.onExpandNav}
                title={t.agent.expandNavigation}
                type="button"
              >
                <PanelLeftOpen size={16} />
              </button>
            ) : null}
            {props.sidebarCollapsed ? (
              <button
                aria-label={t.agent.expandSessionSidebar}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
                onClick={props.onExpandSidebar}
                title={t.agent.expandSidebar}
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
              aria-label={t.agent.sessionTitle}
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
              ? `${props.workspace.displayName} / ${props.session.model} / ${t.agent.liveResponse}`
              : props.workspace.path}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {props.session ? (
            <button
              aria-label={t.agent.createSessionTimer}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink disabled:opacity-40"
              disabled={Boolean(props.activeTurnId)}
              onClick={() => setTimerDialogOpen(true)}
              title={t.agent.createSessionTimer}
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
              aria-label={t.agent.openModelInspector}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
              onClick={props.onModelInspectorOpen}
              type="button"
            >
              <Braces size={16} />
            </button>
          ) : null}
          {props.session ? (
            <button
              aria-label={t.agent.deleteSession}
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
              aria-label={t.agent.expandWorkspaceContext}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
              onClick={props.onExpandContext}
              title={t.agent.expandWorkspaceContext}
              type="button"
            >
              <PanelRightOpen size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              className="h-full overflow-y-auto px-6 py-[22px]"
              data-testid="agent-message-scroll"
              onScroll={smartScroll.handleScroll}
              ref={smartScroll.containerRef}
            >
              {!props.session ? (
                <div className="mx-auto max-w-xl rounded-[10px] border border-dashed border-forge-line p-8 text-center text-sm text-forge-muted">
                  {t.agent.createSessionHint}
                </div>
              ) : props.session.messages.length === 0 && timelineItems.length === 0 ? (
                <div className="mx-auto max-w-[560px] rounded-[10px] border border-forge-line bg-white p-5 text-sm text-forge-muted">
                  {t.agent.emptySessionHint}
                </div>
              ) : (
                <ConversationTimeline
                  items={timelineItems}
                  startedAt={props.session.createdAt}
                  onCancelAutomationProposal={props.onCancelAutomationProposal}
                  onCreateAutomationProposal={props.onCreateAutomationProposal}
                  onHumanInputRespond={props.onHumanInputRespond}
                />
              )}
              {props.session && props.compacting ? (
                <div className="mx-auto mt-3 flex max-w-[560px] justify-center">
                  <span
                    aria-live="polite"
                    className="inline-flex items-center gap-2 rounded-full border border-forge-line bg-white px-3 py-1.5 text-[12px] font-medium text-forge-muted shadow-sm"
                    data-testid="compaction-indicator"
                    role="status"
                  >
                    <Loader2 className="animate-spin text-forge-ink" size={14} />
                    {t.agent.compacting}
                  </span>
                </div>
              ) : null}
              <div aria-hidden="true" className="h-px" ref={smartScroll.sentinelRef} />
            </div>
            {!smartScroll.isPinned ? (
              <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
                <button
                  aria-label={smartScroll.newItemsCount > 0
                    ? t.agent.newUpdates(smartScroll.newItemsCount)
                    : t.agent.backToLatest}
                  className="motion-message-enter inline-flex items-center gap-2 rounded-full border border-forge-line bg-white px-3 py-2 text-xs font-medium text-forge-ink shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_10px_30px_rgba(15,23,42,0.18)] active:translate-y-px"
                  onClick={() => smartScroll.scrollToLatest()}
                  type="button"
                >
                  <ArrowDown aria-hidden="true" size={14} />
                  <span aria-live="polite">
                    {smartScroll.newItemsCount > 0
                      ? t.agent.newUpdates(smartScroll.newItemsCount)
                      : t.agent.backToLatest}
                  </span>
                </button>
              </div>
            ) : null}
          </div>

          <footer className="flex-none bg-forge-canvas px-6 pb-4 pt-3">
            <div className="mx-auto max-w-[560px]">
              {props.error ? (
                <div className="mb-2 rounded-lg border border-forge-danger/30 bg-forge-danger-bg px-3 py-2 text-sm text-forge-danger">
                  {props.error}
                </div>
              ) : null}
              <div className="relative">
                {slashMenuOpen ? (
                  <div className="motion-popover absolute inset-x-0 bottom-full z-30 mb-2 origin-bottom rounded-[10px] border border-forge-line bg-white p-1 shadow-[0_12px_36px_rgba(15,23,42,0.14)]">
                    <div
                      aria-label={t.agent.slashCommands}
                      className="relative max-h-64 overflow-y-auto"
                      id="slash-command-menu"
                      role="listbox"
                    >
                      {slashCommands.length > 0 ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-0 h-9 rounded-[6px] bg-forge-canvas"
                          style={{
                            transform: `translateY(${activeSlashIndex * 36}px)`,
                            transition: "transform 220ms var(--motion-ease-enter)",
                          }}
                        />
                      ) : null}
                      {slashCommands.length > 0 ? (
                        slashCommands.map((command, index) => (
                          <div
                            aria-label={`${command.invocation} ${command.title} ${command.description}`}
                            aria-selected={index === activeSlashIndex}
                            className="relative z-10 flex h-9 cursor-default items-center gap-2.5 rounded-[6px] px-2 text-left text-forge-ink"
                            id={slashCommandOptionId(command.id)}
                            key={command.id}
                            onClick={() => selectSlashCommand(command)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveSlashIndex(index)}
                            role="option"
                            tabIndex={-1}
                          >
                            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center text-forge-muted">
                              {command.icon}
                            </span>
                            <span className="shrink-0 font-mono text-[12.5px] font-semibold text-forge-ink">
                              {command.invocation}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-forge-muted">
                              {command.title} · {command.description}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="flex h-9 items-center px-2 text-[12px] text-forge-muted">
                          {t.agent.noMatchingSlashCommands}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 border-t border-forge-line px-2 pb-1 pt-1.5 text-[11px] text-forge-muted">
                      {t.agent.typeToSearchCommands}
                    </div>
                  </div>
                ) : null}

                <div
                  className="relative flex flex-col gap-1.5 rounded-[14px] border border-forge-line bg-white p-1.5 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-[border-color,box-shadow] duration-150 focus-within:border-forge-ink/35 focus-within:shadow-[0_5px_18px_rgba(15,23,42,0.09)]"
                  data-expanded={promptExpanded ? "true" : "false"}
                  data-testid="prompt-bar"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]"
                    ref={promptMeasureRef}
                  >
                    {props.prompt}
                  </span>

                  {activeSlashCommand || props.imageAttachments.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
                      {activeSlashCommand ? (
                        <span
                          className="motion-content-enter flex h-[26px] items-center gap-1.5 rounded-[7px] bg-forge-canvas py-1 pl-1.5 pr-1 text-[11.5px] font-medium text-forge-ink shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]"
                          data-testid="active-slash-command"
                        >
                          <span className="flex h-4 w-4 items-center justify-center text-forge-muted">
                            {activeSlashCommand.icon}
                          </span>
                          <span className="font-mono font-semibold">{activeSlashCommand.invocation}</span>
                          <button
                            aria-label={t.agent.removeCommand(activeSlashCommand.invocation)}
                            className="flex h-4 w-4 items-center justify-center rounded-[4px] text-forge-muted transition-colors hover:bg-forge-line/70 hover:text-forge-ink"
                            onClick={clearActiveSlashCommand}
                            type="button"
                          >
                            <X size={10} strokeWidth={2.5} />
                          </button>
                        </span>
                      ) : null}
                      {props.imageAttachments.map((attachment) => (
                        <span
                          className="motion-content-enter flex h-[26px] max-w-48 items-center gap-1.5 rounded-[7px] bg-forge-canvas py-1 pl-1 pr-1 text-[11.5px] text-forge-ink shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]"
                          key={attachment.id}
                          title={`${attachment.name} · ${formatFileSize(attachment.size)}`}
                        >
                          <img
                            alt=""
                            className="h-[18px] w-[18px] flex-none rounded-[4px] object-cover"
                            src={imageAttachmentSrc(attachment)}
                          />
                          <span className="min-w-0 truncate">{attachment.name}</span>
                          <button
                            aria-label={t.agent.removeImage(attachment.name)}
                            className="flex h-4 w-4 flex-none items-center justify-center rounded-[4px] text-forge-muted transition-colors hover:bg-forge-line/70 hover:text-forge-ink"
                            onClick={() => removeImageAttachment(attachment.id)}
                            type="button"
                          >
                            <X size={10} strokeWidth={2.5} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div
                    className="grid grid-cols-[28px_minmax(0,1fr)_auto_28px] items-end gap-x-1 gap-y-1.5"
                    data-testid="prompt-bar-controls"
                    ref={promptControlsRef}
                  >
                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      aria-label={t.agent.chooseImage}
                      className="sr-only"
                      disabled={attachDisabled}
                      multiple
                      onChange={(event) => void handleImageInputChange(event)}
                      ref={imageInputRef}
                      type="file"
                    />
                    <button
                      aria-label={t.agent.attachImage}
                      className={`flex h-7 w-7 items-center justify-center justify-self-start rounded-[8px] text-forge-muted transition-[background-color,color,transform] duration-150 hover:bg-forge-canvas hover:text-forge-ink active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40 ${
                        promptExpanded ? "col-start-1 row-start-2" : "col-start-1 row-start-1"
                      }`}
                      disabled={attachDisabled}
                      onClick={() => imageInputRef.current?.click()}
                      title={attachTitle}
                      type="button"
                    >
                      <Plus size={16} strokeWidth={2} />
                    </button>

                    <textarea
                      aria-activedescendant={activeSlashOptionId}
                      aria-autocomplete="list"
                      aria-controls={slashMenuOpen ? "slash-command-menu" : undefined}
                      aria-expanded={slashMenuOpen}
                      className={`min-h-7 min-w-0 w-full resize-none bg-transparent px-1 py-[5px] text-[13px] leading-[18px] text-forge-ink outline-none [overflow-wrap:anywhere] placeholder:text-forge-muted disabled:bg-transparent ${
                        promptExpanded
                          ? "col-span-full col-start-1 row-start-1"
                          : "col-start-2 row-start-1"
                      }`}
                      disabled={!props.session}
                      onChange={handlePromptChange}
                      onCompositionEnd={props.onCompositionEnd}
                      onCompositionStart={props.onCompositionStart}
                      onClick={handlePromptSelection}
                      onKeyDown={handlePromptKeyDown}
                      onKeyUp={handlePromptKeyUp}
                      placeholder={activeSlashCommand
                        ? t.agent.activeCommandPlaceholder(activeSlashCommand.invocation)
                        : t.agent.promptPlaceholder}
                      ref={promptInputRef}
                      role="combobox"
                      rows={1}
                      value={props.prompt}
                    />

                    <div
                      className={promptExpanded ? "col-start-3 row-start-2" : "col-start-3 row-start-1"}
                      ref={modeControlRef}
                    >
                      <CommandModePicker
                        busy={props.settingsSaving}
                        disabled={!props.session || props.commandModeLocked}
                        {...(props.commandModeLocked
                          ? { disabledReason: t.agent.commandModeUnavailableWhileRunning }
                          : props.settingsSaving
                            ? { disabledReason: t.agent.savingCommandMode }
                            : {})}
                        onChange={props.onCommandExecutionModeChange}
                        onOpenChange={(open) => {
                          setModeMenuOpen(open);
                          if (open) {
                            setSlashRange(undefined);
                          }
                        }}
                        open={modeMenuOpen}
                        value={props.commandExecutionMode}
                      />
                    </div>

                    <button
                      aria-label={props.activeTurnId
                        ? t.agent.stop
                        : props.turnStarting
                          ? t.agent.starting
                          : t.agent.send}
                      className={`flex h-7 w-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
                        promptExpanded ? "col-start-4 row-start-2" : "col-start-4 row-start-1"
                      } ${
                        props.activeTurnId
                          ? "bg-forge-ink text-white"
                          : canSend
                            ? "bg-forge-ink text-white"
                            : "bg-forge-line text-forge-muted"
                      }`}
                      disabled={!props.activeTurnId && (props.turnStarting || !canSend)}
                      onClick={props.activeTurnId ? props.onStop : handleSend}
                      type="button"
                    >
                      {props.activeTurnId
                        ? <CircleStop size={15} strokeWidth={2.2} />
                        : props.turnStarting
                          ? <Loader2 className="animate-spin" size={15} />
                          : <ArrowUp size={16} strokeWidth={2.4} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] leading-[14px] text-forge-muted">
                {t.agent.enterToSend}
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
  pill?: boolean;
};

type ActiveSlashCommand = {
  invocation: `/${string}`;
  title: string;
  icon: ReactNode;
  kind: "extension" | "skill";
};

function slashCommandOptionId(commandId: string): string {
  return `slash-command-${commandId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

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
