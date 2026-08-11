import type {
  AgentEvent,
  AppLanguage,
  AutomationView,
  CommandExecutionMode,
  ExtensionUiRequestEvent,
  ExtensionUiResponse,
  HumanInputRequestEvent,
  HumanInputResponse,
  ModelRequestEvent,
  PermissionRequestEvent,
  SessionId,
  TurnId,
  WebSearchCoverage,
} from "@story-forge/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  GitRepositoryView,
  ImageAttachmentView,
  PersistedMessageView,
  ProviderId,
  ProviderView,
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import type { TurnRuntimeState } from "../components/agent-layout";
import { formatError, upsertSession, upsertWorkspace } from "../utils/renderer-utils";
import type { AutomationProposalTimelineState } from "../utils/timeline";

export type Page = "agent" | "models" | "extensions" | "automations" | "settings";

export type AppController = {
  // page navigation
  page: Page;
  setPage: (page: Page) => void;
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  contextCollapsed: boolean;
  setNavCollapsed: (collapsed: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setContextCollapsed: (collapsed: boolean) => void;
  agentHeaderVisible: boolean;
  effectiveNavCollapsed: boolean;
  effectiveSidebarCollapsed: boolean;
  effectiveContextCollapsed: boolean;

  // data
  loading: boolean;
  error: string | undefined;
  setError: (error: string | undefined) => void;
  providers: ProviderView[];
  setProviders: (providers: ProviderView[]) => void;
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  automations: AutomationView[];
  selectedWorkspaceId: string | undefined;
  selectedSessionId: SessionId | undefined;
  setSelectedWorkspaceId: (id: string | undefined) => void;
  setSelectedSessionId: (id: SessionId | undefined) => void;
  selectedProviderId: ProviderId;
  setSelectedProviderId: (id: ProviderId) => void;
  gitRepository: GitRepositoryView | undefined;
  gitRepositoryLoading: boolean;

  // derived
  selectedSession: SessionView | undefined;
  selectedWorkspace: WorkspaceView | undefined;
  selectedProvider: ProviderView | undefined;
  selectedSessionProvider: ProviderView | undefined;
  activeTurnId: TurnId | undefined;
  activeTurns: Record<string, TurnId>;
  selectedSessionTimerCount: number;
  currentPermissionRequest: PermissionRequestEvent | undefined;
  currentExtensionUiRequest: ExtensionUiRequestEvent | undefined;
  currentHumanInputRequest: HumanInputRequestEvent | undefined;

  // per-session runtime state
  activities: AgentEvent[];
  modelRequests: ModelRequestEvent[];
  automationProposals: AutomationProposalTimelineState[];
  turnRuntime: TurnRuntimeState | undefined;

  // composer
  prompt: string;
  setPrompt: (prompt: string) => void;
  imageAttachments: ImageAttachmentView[];
  setImageAttachments: (attachments: ImageAttachmentView[]) => void;
  developerMode: boolean;
  language: AppLanguage;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
  settingsSaving: boolean;

  // dialogs / overlays
  modelInspectorOpen: boolean;
  setModelInspectorOpen: (open: boolean) => void;
  permissionResponding: boolean;
  extensionUiResponding: boolean;
  humanInputResponding: boolean;
  compactingSessionId: SessionId | undefined;

  // IME composition
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
  handlePromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;

  // actions
  openWorkspace: () => Promise<void>;
  createSession: (workspaceId?: string) => Promise<SessionView | undefined>;
  sendPrompt: () => Promise<void>;
  stopTurn: () => Promise<void>;
  compactSelectedSession: () => Promise<void>;
  saveDeveloperMode: (next: boolean) => Promise<void>;
  saveLanguage: (next: AppLanguage) => Promise<void>;
  saveCommandExecutionMode: (next: CommandExecutionMode) => Promise<void>;
  saveWebAccessEnabled: (next: boolean) => Promise<void>;
  saveWebSearchCoverage: (next: WebSearchCoverage) => Promise<void>;
  respondToPermission: (approved: boolean) => Promise<void>;
  respondToExtensionUi: (response: Omit<ExtensionUiResponse, "requestId">) => Promise<void>;
  respondToHumanInput: (response: Omit<HumanInputResponse, "requestId">) => Promise<void>;
  renameSession: (title: string) => Promise<void>;
  deleteSession: () => Promise<void>;
  removeSession: (sessionId: SessionId) => Promise<void>;
  createAutomationFromProposal: (proposalId: string) => Promise<void>;
  cancelAutomationProposal: (proposalId: string) => void;
  handleSessionTimerCreated: (automation: AutomationView) => void;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  selectSession: (sessionId: SessionId, workspaceId: string) => void;
  refreshGitRepository: (workspaceId?: string, showLoading?: boolean) => Promise<void>;
};

export function useAppController(): AppController {
  const [page, setPage] = useState<Page>("agent");
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedSessionId, setSelectedSessionId] = useState<SessionId>();
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>("deepseek");
  const [activities, setActivities] = useState<Record<string, AgentEvent[]>>({});
  const [automations, setAutomations] = useState<AutomationView[]>([]);
  const [automationProposals, setAutomationProposals] =
    useState<Record<string, AutomationProposalTimelineState[]>>({});
  const [modelRequests, setModelRequests] = useState<Record<string, ModelRequestEvent[]>>({});
  const [modelInspectorOpen, setModelInspectorOpen] = useState(false);
  const [activeTurns, setActiveTurns] = useState<Record<string, TurnId>>({});
  const [turnRuntimes, setTurnRuntimes] = useState<Record<string, TurnRuntimeState>>({});
  const [prompt, setPrompt] = useState("");
  const [imageAttachments, setImageAttachments] = useState<ImageAttachmentView[]>([]);
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [developerMode, setDeveloperMode] = useState(false);
  const [commandExecutionMode, setCommandExecutionMode] =
    useState<CommandExecutionMode>("sentinel");
  const [webAccessEnabled, setWebAccessEnabled] = useState(false);
  const [webSearchCoverage, setWebSearchCoverage] =
    useState<WebSearchCoverage>("focused");
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequestEvent[]>([]);
  const [permissionResponding, setPermissionResponding] = useState(false);
  const [extensionUiRequests, setExtensionUiRequests] = useState<ExtensionUiRequestEvent[]>([]);
  const [extensionUiResponding, setExtensionUiResponding] = useState(false);
  const [humanInputRequests, setHumanInputRequests] = useState<HumanInputRequestEvent[]>([]);
  const [humanInputResponding, setHumanInputResponding] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [compactingSessionId, setCompactingSessionId] = useState<SessionId>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [gitRepository, setGitRepository] = useState<GitRepositoryView>();
  const [gitRepositoryLoading, setGitRepositoryLoading] = useState(false);
  const composingRef = useRef(false);
  const selectedWorkspaceIdRef = useRef<string | undefined>(undefined);
  const gitMountedRef = useRef(true);
  const gitRequestsRef = useRef(new Map<string, Promise<void>>());
  const persistedDeveloperModeRef = useRef(false);
  const persistedLanguageRef = useRef<AppLanguage>("en");
  const persistedCommandExecutionModeRef = useRef<CommandExecutionMode>("sentinel");
  const persistedWebAccessEnabledRef = useRef(false);
  const persistedWebSearchCoverageRef = useRef<WebSearchCoverage>("focused");
  const settingsSaveInFlightRef = useRef(false);

  selectedWorkspaceIdRef.current = selectedWorkspaceId;

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  );
  const selectedProvider = providers.find(
    (provider) => provider.providerId === selectedProviderId,
  );
  const selectedSessionProvider = selectedSession
    ? providers.find((provider) => provider.providerId === selectedSession.providerId)
    : selectedProvider;
  const activeTurnId = selectedSessionId ? activeTurns[selectedSessionId] : undefined;
  const selectedSessionTimerCount = selectedSessionId
    ? automations.filter((automation) =>
      automation.kind === "thread_chat"
      && automation.sessionId === selectedSessionId
      && automation.status === "active"
    ).length
    : 0;
  const currentPermissionRequest = permissionRequests[0];
  const currentExtensionUiRequest = extensionUiRequests[0];
  const currentHumanInputRequest = humanInputRequests[0];
  // The agent header (which hosts the expand buttons) only renders on the agent
  // page once a workspace is open, so panels may only collapse while it is visible.
  const agentHeaderVisible = page === "agent" && !loading && Boolean(selectedWorkspace);
  const effectiveNavCollapsed = navCollapsed && agentHeaderVisible;
  const effectiveSidebarCollapsed = sidebarCollapsed && agentHeaderVisible;
  const effectiveContextCollapsed = contextCollapsed;

  const sessionActivities = selectedSessionId ? activities[selectedSessionId] ?? [] : [];
  const sessionModelRequests = selectedSessionId ? modelRequests[selectedSessionId] ?? [] : [];
  const sessionAutomationProposals = selectedSessionId
    ? automationProposals[selectedSessionId] ?? []
    : [];
  const sessionTurnRuntime = selectedSessionId ? turnRuntimes[selectedSessionId] : undefined;

  useEffect(() => {
    gitMountedRef.current = true;
    let disposed = false;
    const unsubscribe = window.storyForge.turns.onEvent((event) => {
      if (disposed) {
        return;
      }
      setActivities((current) => ({
        ...current,
        [event.sessionId]: [...(current[event.sessionId] ?? []), event],
      }));
      if (event.type === "model.request") {
        setModelRequests((current) => ({
          ...current,
          [event.sessionId]: [...(current[event.sessionId] ?? []), event],
        }));
      }
      if (event.type === "automation.proposal") {
        setAutomationProposals((current) => {
          const proposals = current[event.sessionId] ?? [];
          if (proposals.some((proposal) => proposal.proposalId === event.proposalId)) {
            return current;
          }
          return {
            ...current,
            [event.sessionId]: [
              ...proposals,
              {
                proposalId: event.proposalId,
                proposal: event.proposal,
                status: "pending",
              },
            ],
          };
        });
      }
      if (event.type === "tool.call") {
        setTurnRuntimes((current) => {
          const existing = current[event.sessionId];
          if (!existing || existing.turnId !== event.turnId || existing.endedAt) {
            return current;
          }
          return {
            ...current,
            [event.sessionId]: { ...existing, steps: existing.steps + 1 },
          };
        });
      }
      if (event.type === "permission.request") {
        setPermissionRequests((current) => [...current, event]);
        setTurnRuntimes((current) => {
          const existing = current[event.sessionId];
          if (!existing || existing.turnId !== event.turnId) {
            return current;
          }
          return {
            ...current,
            [event.sessionId]: { ...existing, status: "waiting-approval" },
          };
        });
      }
      if (event.type === "extension.ui.request") {
        setExtensionUiRequests((current) => [...current, event]);
        setTurnRuntimes((current) => {
          const existing = current[event.sessionId];
          if (!existing || existing.turnId !== event.turnId) {
            return current;
          }
          return {
            ...current,
            [event.sessionId]: { ...existing, status: "waiting-approval" },
          };
        });
      }
      if (event.type === "human.input.request") {
        setHumanInputRequests((current) => [...current, event]);
        setTurnRuntimes((current) => {
          const existing = current[event.sessionId];
          if (!existing || existing.turnId !== event.turnId) {
            return current;
          }
          return {
            ...current,
            [event.sessionId]: { ...existing, status: "waiting-approval" },
          };
        });
      }
      if (event.type === "extension.notification" && event.level === "error") {
        setError(event.message);
      }
      if (event.type === "runtime.started") {
        setActiveTurns((current) => ({ ...current, [event.sessionId]: event.turnId }));
        setTurnRuntimes((current) => ({
          ...current,
          [event.sessionId]: {
            turnId: event.turnId,
            status: "running",
            startedAt: event.createdAt,
            steps: 0,
          },
        }));
      }
      if (event.type === "runtime.completed" || event.type === "runtime.error") {
        setActiveTurns((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setPermissionRequests((current) =>
          current.filter((request) => request.sessionId !== event.sessionId)
        );
        setExtensionUiRequests((current) =>
          current.filter((request) => request.sessionId !== event.sessionId)
        );
        setHumanInputRequests((current) =>
          current.filter((request) => request.sessionId !== event.sessionId)
        );
        setTurnRuntimes((current) => {
          const existing = current[event.sessionId];
          if (!existing || existing.turnId !== event.turnId) {
            return current;
          }
          return {
            ...current,
            [event.sessionId]: {
              ...existing,
              status: event.type === "runtime.error" ? "failed" : "completed",
              endedAt: new Date().toISOString(),
              steps: event.steps ?? existing.steps,
            },
          };
        });
        void refreshSession(event.sessionId);
        void refreshGitRepository(selectedWorkspaceIdRef.current);
      }
    });

    void (async () => {
      try {
        const [
          nextSettings,
          nextProviders,
          nextWorkspaces,
          nextSessions,
          nextAutomations,
        ] = await Promise.all([
          window.storyForge.settings.get(),
          window.storyForge.providers.list(),
          window.storyForge.workspaces.list(),
          window.storyForge.sessions.list(),
          window.storyForge.automations.list(),
        ]);
        if (disposed) {
          return;
        }
        persistedDeveloperModeRef.current = nextSettings.developerMode;
        persistedLanguageRef.current = nextSettings.language;
        persistedCommandExecutionModeRef.current = nextSettings.commandExecutionMode;
        persistedWebAccessEnabledRef.current = nextSettings.webAccessEnabled;
        persistedWebSearchCoverageRef.current = nextSettings.webSearchCoverage;
        setLanguage(nextSettings.language);
        setDeveloperMode(nextSettings.developerMode);
        setCommandExecutionMode(nextSettings.commandExecutionMode);
        setWebAccessEnabled(nextSettings.webAccessEnabled);
        setWebSearchCoverage(nextSettings.webSearchCoverage);
        setProviders(nextProviders);
        setWorkspaces(nextWorkspaces);
        setSessions(nextSessions);
        setAutomations(nextAutomations);
        const defaultProvider = nextProviders.find((provider) => provider.isDefault)
          ?? nextProviders[0];
        if (defaultProvider) {
          setSelectedProviderId(defaultProvider.providerId);
        }
        const initialWorkspace = nextWorkspaces[0];
        const initialSession = initialWorkspace
          ? nextSessions.find((session) => session.workspaceId === initialWorkspace.id)
          : undefined;
        setSelectedWorkspaceId(initialWorkspace?.id);
        setSelectedSessionId(initialSession?.id);
      } catch (loadError) {
        setError(formatError(loadError));
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      gitMountedRef.current = false;
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setImageAttachments([]);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setGitRepository(undefined);
      setGitRepositoryLoading(false);
      return;
    }

    setGitRepository((current) =>
      current?.workspaceId === selectedWorkspaceId ? current : undefined
    );
    if (page !== "agent" || contextCollapsed) {
      setGitRepositoryLoading(false);
      return;
    }

    let stopped = false;
    let timeoutId: number | undefined;
    const scheduleNext = () => {
      if (stopped) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        const refresh = document.visibilityState === "visible"
          ? refreshGitRepository(selectedWorkspaceId)
          : Promise.resolve();
        void refresh.finally(scheduleNext);
      }, 3_000);
    };
    void refreshGitRepository(selectedWorkspaceId, true).finally(scheduleNext);
    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        void refreshGitRepository(selectedWorkspaceId);
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      stopped = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", handleFocus);
    };
  // The refresh function deliberately uses refs and same-workspace requests are coalesced.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextCollapsed, page, selectedWorkspaceId]);

  async function refreshSession(sessionId: SessionId): Promise<void> {
    try {
      const session = await window.storyForge.sessions.get(sessionId);
      setSessions((current) => upsertSession(current, session));
    } catch (refreshError) {
      setError(formatError(refreshError));
    }
  }

  async function refreshGitRepository(
    workspaceId = selectedWorkspaceIdRef.current,
    showLoading = false,
  ): Promise<void> {
    if (!workspaceId) {
      return;
    }
    const existingRequest = gitRequestsRef.current.get(workspaceId);
    if (existingRequest) {
      if (showLoading && workspaceId === selectedWorkspaceIdRef.current) {
        setGitRepositoryLoading(true);
      }
      return existingRequest;
    }
    if (showLoading) {
      setGitRepositoryLoading(true);
    }
    const request = (async () => {
      try {
        const next = await window.storyForge.git.get(workspaceId);
        if (
          !gitMountedRef.current
          || workspaceId !== selectedWorkspaceIdRef.current
        ) {
          return;
        }
        setGitRepository((current) =>
          gitRepositoryContentKey(current) === gitRepositoryContentKey(next) ? current : next
        );
      } catch (repositoryError) {
        if (
          !gitMountedRef.current
          || workspaceId !== selectedWorkspaceIdRef.current
        ) {
          return;
        }
        setGitRepository({
          status: "unavailable",
          workspaceId,
          checkedAt: Math.floor(Date.now() / 1_000),
          message: formatError(repositoryError),
        });
      } finally {
        if (
          gitMountedRef.current
          && workspaceId === selectedWorkspaceIdRef.current
        ) {
          setGitRepositoryLoading(false);
        }
      }
    })();
    gitRequestsRef.current.set(workspaceId, request);
    try {
      await request;
    } finally {
      if (gitRequestsRef.current.get(workspaceId) === request) {
        gitRequestsRef.current.delete(workspaceId);
      }
    }
  }

  async function openWorkspace(): Promise<void> {
    try {
      const workspace = await window.storyForge.workspaces.open();
      if (!workspace) {
        return;
      }
      setWorkspaces((current) => upsertWorkspace(current, workspace));
      setSelectedWorkspaceId(workspace.id);
      const workspaceSessions = await window.storyForge.sessions.list(workspace.id);
      setSessions((current) => [
        ...current.filter((session) => session.workspaceId !== workspace.id),
        ...workspaceSessions,
      ]);
      setSelectedSessionId(workspaceSessions[0]?.id);
    } catch (workspaceError) {
      setError(formatError(workspaceError));
    }
  }

  async function createSession(workspaceId = selectedWorkspaceId): Promise<SessionView | undefined> {
    if (!workspaceId) {
      return undefined;
    }
    try {
      const session = await window.storyForge.sessions.create({ workspaceId });
      setSessions((current) => upsertSession(current, session));
      setSelectedWorkspaceId(workspaceId);
      setSelectedSessionId(session.id);
      setPage("agent");
      return session;
    } catch (sessionError) {
      setError(formatError(sessionError));
      return undefined;
    }
  }

  async function sendPrompt(): Promise<void> {
    const content = prompt.trim();
    const attachments = imageAttachments;
    if (!content && attachments.length === 0) {
      return;
    }
    let session: SessionView | undefined = selectedSession;
    if (!session) {
      session = await createSession();
    }
    if (!session || activeTurns[session.id]) {
      return;
    }
    const targetSession = session;

    setPrompt("");
    setImageAttachments([]);
    setError(undefined);
    setActivities((current) => ({ ...current, [targetSession.id]: [] }));
    setModelRequests((current) => ({ ...current, [targetSession.id]: [] }));
    const optimisticMessage: PersistedMessageView = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      ...(attachments.length ? { imageAttachments: attachments } : {}),
      createdAt: new Date().toISOString(),
    };
    setSessions((current) => current.map((candidate) =>
      candidate.id === targetSession.id
        ? { ...candidate, messages: [...candidate.messages, optimisticMessage] }
        : candidate
    ));
    try {
      const { turnId } = await window.storyForge.turns.start({
        sessionId: targetSession.id,
        prompt: content,
        ...(attachments.length ? { imageAttachments: attachments } : {}),
      });
      setActiveTurns((current) => ({ ...current, [targetSession.id]: turnId }));
    } catch (turnError) {
      setError(formatError(turnError));
      await refreshSession(targetSession.id);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent;
    if (
      event.key !== "Enter"
      || event.shiftKey
      || composingRef.current
      || nativeEvent.isComposing
      || nativeEvent.keyCode === 229
    ) {
      return;
    }
    event.preventDefault();
    if (!activeTurnId) {
      void sendPrompt();
    }
  }

  function handleCompositionStart(): void {
    composingRef.current = true;
  }

  function handleCompositionEnd(): void {
    composingRef.current = false;
  }

  async function stopTurn(): Promise<void> {
    if (!activeTurnId) {
      return;
    }
    try {
      await window.storyForge.turns.stop(activeTurnId);
    } catch (stopError) {
      setError(formatError(stopError));
    }
  }

  async function compactSelectedSession(): Promise<void> {
    if (!selectedSession || selectedSession.messages.length === 0) {
      return;
    }
    if (compactingSessionId) {
      return;
    }
    const sessionId = selectedSession.id;
    setCompactingSessionId(sessionId);
    try {
      await window.storyForge.turns.compact(sessionId);
      await refreshSession(sessionId);
    } catch (compactError) {
      setError(formatError(compactError));
    } finally {
      setCompactingSessionId((current) => (current === sessionId ? undefined : current));
    }
  }

  async function saveDeveloperMode(nextDeveloperMode: boolean): Promise<void> {
    if (
      settingsSaveInFlightRef.current
      || nextDeveloperMode === persistedDeveloperModeRef.current
    ) {
      return;
    }
    const previousDeveloperMode = persistedDeveloperModeRef.current;
    settingsSaveInFlightRef.current = true;
    setDeveloperMode(nextDeveloperMode);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        developerMode: nextDeveloperMode,
      });
      persistedDeveloperModeRef.current = saved.developerMode;
      setDeveloperMode(saved.developerMode);
    } catch (settingsError) {
      setDeveloperMode(previousDeveloperMode);
      setError(formatError(settingsError));
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaving(false);
    }
  }

  async function saveLanguage(nextLanguage: AppLanguage): Promise<void> {
    if (
      settingsSaveInFlightRef.current
      || nextLanguage === persistedLanguageRef.current
    ) {
      return;
    }
    const previousLanguage = persistedLanguageRef.current;
    settingsSaveInFlightRef.current = true;
    setLanguage(nextLanguage);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        language: nextLanguage,
      });
      persistedLanguageRef.current = saved.language;
      setLanguage(saved.language);
    } catch (settingsError) {
      setLanguage(previousLanguage);
      setError(formatError(settingsError));
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaving(false);
    }
  }

  async function saveCommandExecutionMode(
    nextCommandExecutionMode: CommandExecutionMode,
  ): Promise<void> {
    if (
      settingsSaveInFlightRef.current
      || nextCommandExecutionMode === persistedCommandExecutionModeRef.current
    ) {
      return;
    }
    const previousCommandExecutionMode = persistedCommandExecutionModeRef.current;
    settingsSaveInFlightRef.current = true;
    setCommandExecutionMode(nextCommandExecutionMode);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        commandExecutionMode: nextCommandExecutionMode,
      });
      persistedCommandExecutionModeRef.current = saved.commandExecutionMode;
      setCommandExecutionMode(saved.commandExecutionMode);
    } catch (settingsError) {
      setCommandExecutionMode(previousCommandExecutionMode);
      setError(formatError(settingsError));
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaving(false);
    }
  }

  async function saveWebAccessEnabled(nextWebAccessEnabled: boolean): Promise<void> {
    if (
      settingsSaveInFlightRef.current
      || nextWebAccessEnabled === persistedWebAccessEnabledRef.current
    ) {
      return;
    }
    const previousWebAccessEnabled = persistedWebAccessEnabledRef.current;
    settingsSaveInFlightRef.current = true;
    setWebAccessEnabled(nextWebAccessEnabled);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        webAccessEnabled: nextWebAccessEnabled,
      });
      persistedWebAccessEnabledRef.current = saved.webAccessEnabled;
      setWebAccessEnabled(saved.webAccessEnabled);
    } catch (settingsError) {
      setWebAccessEnabled(previousWebAccessEnabled);
      setError(formatError(settingsError));
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaving(false);
    }
  }

  async function saveWebSearchCoverage(
    nextWebSearchCoverage: WebSearchCoverage,
  ): Promise<void> {
    if (
      settingsSaveInFlightRef.current
      || nextWebSearchCoverage === persistedWebSearchCoverageRef.current
    ) {
      return;
    }
    const previousWebSearchCoverage = persistedWebSearchCoverageRef.current;
    settingsSaveInFlightRef.current = true;
    setWebSearchCoverage(nextWebSearchCoverage);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        webSearchCoverage: nextWebSearchCoverage,
      });
      persistedWebSearchCoverageRef.current = saved.webSearchCoverage;
      setWebSearchCoverage(saved.webSearchCoverage);
    } catch (settingsError) {
      setWebSearchCoverage(previousWebSearchCoverage);
      setError(formatError(settingsError));
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaving(false);
    }
  }

  async function respondToPermission(approved: boolean): Promise<void> {
    if (!currentPermissionRequest || permissionResponding) {
      return;
    }
    setPermissionResponding(true);
    setError(undefined);
    const requestId = currentPermissionRequest.requestId;
    const sessionId = currentPermissionRequest.sessionId;
    try {
      await window.storyForge.permissions.respond({ requestId, approved });
      setPermissionRequests((current) =>
        current.filter((request) => request.requestId !== requestId)
      );
      setTurnRuntimes((current) => {
        const existing = current[sessionId];
        if (!existing || existing.status !== "waiting-approval") {
          return current;
        }
        return { ...current, [sessionId]: { ...existing, status: "running" } };
      });
    } catch (permissionError) {
      setError(formatError(permissionError));
    } finally {
      setPermissionResponding(false);
    }
  }

  async function respondToExtensionUi(
    response: Omit<ExtensionUiResponse, "requestId">,
  ): Promise<void> {
    if (!currentExtensionUiRequest || extensionUiResponding) {
      return;
    }
    setExtensionUiResponding(true);
    setError(undefined);
    const requestId = currentExtensionUiRequest.requestId;
    const sessionId = currentExtensionUiRequest.sessionId;
    try {
      await window.storyForge.extensionUi.respond({ requestId, ...response });
      setExtensionUiRequests((current) =>
        current.filter((request) => request.requestId !== requestId)
      );
      setTurnRuntimes((current) => {
        const existing = current[sessionId];
        if (!existing || existing.status !== "waiting-approval") {
          return current;
        }
        return { ...current, [sessionId]: { ...existing, status: "running" } };
      });
    } catch (extensionError) {
      setError(formatError(extensionError));
    } finally {
      setExtensionUiResponding(false);
    }
  }

  async function respondToHumanInput(
    response: Omit<HumanInputResponse, "requestId">,
  ): Promise<void> {
    if (!currentHumanInputRequest || humanInputResponding) {
      return;
    }
    setHumanInputResponding(true);
    setError(undefined);
    const requestId = currentHumanInputRequest.requestId;
    const sessionId = currentHumanInputRequest.sessionId;
    try {
      await window.storyForge.humanInput.respond({ requestId, ...response });
      setHumanInputRequests((current) =>
        current.filter((request) => request.requestId !== requestId)
      );
      setTurnRuntimes((current) => {
        const existing = current[sessionId];
        if (!existing || existing.status !== "waiting-approval") {
          return current;
        }
        return { ...current, [sessionId]: { ...existing, status: "running" } };
      });
    } catch (humanInputError) {
      setError(formatError(humanInputError));
    } finally {
      setHumanInputResponding(false);
    }
  }

  async function renameSession(title: string): Promise<void> {
    if (!selectedSession || !title.trim()) {
      return;
    }
    try {
      const renamed = await window.storyForge.sessions.rename(
        selectedSession.id,
        title.trim(),
      );
      setSessions((current) => upsertSession(current, renamed));
    } catch (renameError) {
      setError(formatError(renameError));
    }
  }

  async function deleteSession(): Promise<void> {
    if (!selectedSession || activeTurns[selectedSession.id]) {
      return;
    }
    const sessionId = selectedSession.id;
    const workspaceId = selectedWorkspaceId;
    try {
      await window.storyForge.sessions.delete(sessionId);
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      setSelectedSessionId(
        remaining.find((session) => session.workspaceId === workspaceId)?.id,
      );
    } catch (deleteError) {
      setError(formatError(deleteError));
    }
  }

  async function removeSession(sessionId: SessionId): Promise<void> {
    if (activeTurns[sessionId]) {
      return;
    }
    try {
      await window.storyForge.sessions.delete(sessionId);
      const target = sessions.find((session) => session.id === sessionId);
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      if (sessionId === selectedSessionId) {
        setSelectedSessionId(
          remaining.find((session) => session.workspaceId === target?.workspaceId)?.id,
        );
      }
    } catch (deleteError) {
      setError(formatError(deleteError));
    }
  }

  async function createAutomationFromProposal(proposalId: string): Promise<void> {
    if (!selectedSessionId) {
      return;
    }
    const item = automationProposals[selectedSessionId]
      ?.find((proposal) => proposal.proposalId === proposalId);
    if (!item || item.status === "created") {
      return;
    }

    setError(undefined);
    try {
      const { proposal } = item;
      const created = await window.storyForge.automations.create({
        kind: proposal.kind,
        name: proposal.name,
        status: "active",
        workspaceId: proposal.workspaceId,
        providerId: proposal.providerId,
        model: proposal.model,
        schedule: {
          sourceText: proposal.scheduleText,
          cron: proposal.cron,
          timezone: proposal.timezone,
          summary: proposal.summary,
        },
        prompt: proposal.prompt,
        ...(proposal.sessionId ? { sessionId: proposal.sessionId } : {}),
      });
      setAutomations((current) => [created, ...current]);
      setAutomationProposals((current) => ({
        ...current,
        [selectedSessionId]: (current[selectedSessionId] ?? []).map((proposal) =>
          proposal.proposalId === proposalId
            ? { ...proposal, status: "created" }
            : proposal
        ),
      }));
    } catch (createError) {
      setError(formatError(createError));
    }
  }

  function handleSessionTimerCreated(automation: AutomationView): void {
    setAutomations((current) => [automation, ...current]);
  }

  function cancelAutomationProposal(proposalId: string): void {
    if (!selectedSessionId) {
      return;
    }
    setAutomationProposals((current) => ({
      ...current,
      [selectedSessionId]: (current[selectedSessionId] ?? [])
        .filter((proposal) => proposal.proposalId !== proposalId),
    }));
  }

  async function removeWorkspace(workspaceId: string): Promise<void> {
    try {
      await window.storyForge.workspaces.remove(workspaceId);
      const nextWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
      setWorkspaces(nextWorkspaces);
      if (workspaceId === selectedWorkspaceId) {
        const nextWorkspace = nextWorkspaces[0];
        setSelectedWorkspaceId(nextWorkspace?.id);
        setSelectedSessionId(
          sessions.find((session) => session.workspaceId === nextWorkspace?.id)?.id,
        );
      }
    } catch (removeError) {
      setError(formatError(removeError));
    }
  }

  function selectWorkspace(workspaceId: string): void {
    setSelectedWorkspaceId(workspaceId);
    setSelectedSessionId(
      sessions.find((session) => session.workspaceId === workspaceId)?.id,
    );
  }

  function selectSession(sessionId: SessionId, workspaceId: string): void {
    setSelectedWorkspaceId(workspaceId);
    setSelectedSessionId(sessionId);
  }

  return {
    // navigation
    page,
    setPage,
    navCollapsed,
    setNavCollapsed,
    sidebarCollapsed,
    setSidebarCollapsed,
    contextCollapsed,
    setContextCollapsed,
    agentHeaderVisible,
    effectiveNavCollapsed,
    effectiveSidebarCollapsed,
    effectiveContextCollapsed,

    // data
    loading,
    error,
    setError,
    providers,
    setProviders,
    workspaces,
    sessions,
    automations,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedSessionId,
    setSelectedSessionId,
    selectedProviderId,
    setSelectedProviderId,
    gitRepository: gitRepository?.workspaceId === selectedWorkspaceId ? gitRepository : undefined,
    gitRepositoryLoading,

    // derived
    selectedSession,
    selectedWorkspace,
    selectedProvider,
    selectedSessionProvider,
    activeTurnId,
    activeTurns,
    selectedSessionTimerCount,
    currentPermissionRequest,
    currentExtensionUiRequest,
    currentHumanInputRequest,

    // per-session runtime
    activities: sessionActivities,
    modelRequests: sessionModelRequests,
    automationProposals: sessionAutomationProposals,
    turnRuntime: sessionTurnRuntime,

    // composer
    prompt,
    setPrompt,
    imageAttachments,
    setImageAttachments,
    language,
    developerMode,
    commandExecutionMode,
    webAccessEnabled,
    webSearchCoverage,
    settingsSaving,

    // dialogs
    modelInspectorOpen,
    setModelInspectorOpen,
    permissionResponding,
    extensionUiResponding,
    humanInputResponding,
    compactingSessionId,

    // IME
    handleCompositionStart,
    handleCompositionEnd,
    handlePromptKeyDown,

    // actions
    openWorkspace,
    createSession,
    sendPrompt,
    stopTurn,
    compactSelectedSession,
    saveDeveloperMode,
    saveLanguage,
    saveCommandExecutionMode,
    saveWebAccessEnabled,
    saveWebSearchCoverage,
    respondToPermission,
    respondToExtensionUi,
    respondToHumanInput,
    renameSession,
    deleteSession,
    removeSession,
    createAutomationFromProposal,
    cancelAutomationProposal,
    handleSessionTimerCreated,
    removeWorkspace,
    selectWorkspace,
    selectSession,
    refreshGitRepository,
  };
}

function gitRepositoryContentKey(repository: GitRepositoryView | undefined): string {
  if (!repository) {
    return "";
  }
  return JSON.stringify({ ...repository, checkedAt: 0 });
}
