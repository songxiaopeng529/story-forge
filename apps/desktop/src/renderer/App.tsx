import type { ProviderId } from "@story-forge/model-gateway";
import type {
  AgentEvent,
  AutomationView,
  CommandExecutionMode,
  ModelRequestEvent,
  PermissionRequestEvent,
  ResponseMode,
  SessionId,
  TurnId,
} from "@story-forge/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  PersistedMessageView,
  ProviderView,
  SessionView,
  WorkspaceView,
} from "../shared/story-forge-api";
import { AgentWorkspace } from "./components/agent-workspace";
import { AutomationsPage } from "./components/automations-page";
import { McpSkillsPage } from "./components/mcp-skills-page";
import { ModelsPage } from "./components/models-page";
import { PermissionRequestPrompt } from "./components/permission-request-prompt";
import { PrimaryNavigation, type Page } from "./components/primary-navigation";
import { RunContextPanel, type RunStatus } from "./components/run-context-panel";
import { SettingsPage } from "./components/settings-page";
import { SessionSidebar } from "./components/session-sidebar";
import { formatError, upsertSession, upsertWorkspace } from "./renderer-utils";
import type { AutomationProposalTimelineState } from "./timeline";

type TurnRuntimeState = {
  turnId: TurnId;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  steps: number;
};

export function App() {
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
  const [responseMode, setResponseMode] = useState<ResponseMode>("auto");
  const [developerMode, setDeveloperMode] = useState(false);
  const [commandExecutionMode, setCommandExecutionMode] =
    useState<CommandExecutionMode>("sentinel");
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequestEvent[]>([]);
  const [permissionResponding, setPermissionResponding] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const composingRef = useRef(false);
  const persistedResponseModeRef = useRef<ResponseMode>("auto");
  const persistedDeveloperModeRef = useRef(false);
  const persistedCommandExecutionModeRef = useRef<CommandExecutionMode>("sentinel");
  const settingsSaveInFlightRef = useRef(false);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  );
  const selectedProvider = providers.find(
    (provider) => provider.providerId === selectedProviderId,
  );
  const activeTurnId = selectedSessionId ? activeTurns[selectedSessionId] : undefined;
  const selectedSessionTimerCount = selectedSessionId
    ? automations.filter((automation) =>
      automation.kind === "thread_chat"
      && automation.sessionId === selectedSessionId
      && automation.status === "active"
    ).length
    : 0;
  const currentPermissionRequest = permissionRequests[0];
  // The agent header (which hosts the expand buttons) only renders on the agent
  // page once a workspace is open, so panels may only collapse while it is visible.
  const agentHeaderVisible = page === "agent" && !loading && Boolean(selectedWorkspace);
  const effectiveNavCollapsed = navCollapsed && agentHeaderVisible;
  const effectiveSidebarCollapsed = sidebarCollapsed && agentHeaderVisible;
  const effectiveContextCollapsed = contextCollapsed;
  const agentColumns = [
    effectiveSidebarCollapsed ? null : "288px",
    "1fr",
    selectedSession && !effectiveContextCollapsed ? "292px" : null,
  ]
    .filter(Boolean)
    .join("_");

  useEffect(() => {
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
      if (event.type === "tool.call" || event.type === "model.request") {
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
        persistedResponseModeRef.current = nextSettings.responseMode;
        persistedDeveloperModeRef.current = nextSettings.developerMode;
        persistedCommandExecutionModeRef.current = nextSettings.commandExecutionMode;
        setResponseMode(nextSettings.responseMode);
        setDeveloperMode(nextSettings.developerMode);
        setCommandExecutionMode(nextSettings.commandExecutionMode);
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
      unsubscribe();
    };
  }, []);

  async function refreshSession(sessionId: SessionId): Promise<void> {
    try {
      const session = await window.storyForge.sessions.get(sessionId);
      setSessions((current) => upsertSession(current, session));
    } catch (refreshError) {
      setError(formatError(refreshError));
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
    if (!content) {
      return;
    }
    let session = selectedSession;
    if (!session) {
      session = await createSession();
    }
    if (!session || activeTurns[session.id]) {
      return;
    }

    setPrompt("");
    setError(undefined);
    setActivities((current) => ({ ...current, [session.id]: [] }));
    setModelRequests((current) => ({ ...current, [session.id]: [] }));
    const optimisticMessage: PersistedMessageView = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setSessions((current) => current.map((candidate) =>
      candidate.id === session.id
        ? { ...candidate, messages: [...candidate.messages, optimisticMessage] }
        : candidate
    ));
    try {
      const { turnId } = await window.storyForge.turns.start({
        sessionId: session.id,
        prompt: content,
      });
      setActiveTurns((current) => ({ ...current, [session.id]: turnId }));
    } catch (turnError) {
      setError(formatError(turnError));
      await refreshSession(session.id);
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

  async function saveResponseMode(nextResponseMode: ResponseMode): Promise<void> {
    if (
      settingsSaveInFlightRef.current
      || nextResponseMode === persistedResponseModeRef.current
    ) {
      return;
    }
    const previousResponseMode = persistedResponseModeRef.current;
    settingsSaveInFlightRef.current = true;
    setResponseMode(nextResponseMode);
    setSettingsSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.settings.save({
        responseMode: nextResponseMode,
      });
      persistedResponseModeRef.current = saved.responseMode;
      setResponseMode(saved.responseMode);
    } catch (settingsError) {
      setResponseMode(previousResponseMode);
      setError(formatError(settingsError));
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaving(false);
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

  async function respondToPermission(approved: boolean): Promise<void> {
    if (!currentPermissionRequest || permissionResponding) {
      return;
    }
    setPermissionResponding(true);
    setError(undefined);
    try {
      await window.storyForge.permissions.respond({
        requestId: currentPermissionRequest.requestId,
        approved,
      });
      setPermissionRequests((current) =>
        current.filter((request) => request.requestId !== currentPermissionRequest.requestId)
      );
      setTurnRuntimes((current) => {
        const sessionId = currentPermissionRequest.sessionId;
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
    try {
      await window.storyForge.sessions.delete(selectedSession.id);
      const remaining = sessions.filter((session) => session.id !== selectedSession.id);
      setSessions(remaining);
      setSelectedSessionId(
        remaining.find((session) => session.workspaceId === selectedWorkspaceId)?.id,
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

  return (
    <main
      className={`grid h-screen overflow-hidden bg-forge-canvas text-forge-ink ${
        effectiveNavCollapsed ? "grid-cols-[1fr]" : "grid-cols-[72px_1fr]"
      }`}
    >
      {effectiveNavCollapsed ? null : (
        <PrimaryNavigation
          page={page}
          onChange={setPage}
          collapsible={agentHeaderVisible}
          onCollapse={() => setNavCollapsed(true)}
        />
      )}
      {page === "settings" ? (
        <SettingsPage
          responseMode={responseMode}
          developerMode={developerMode}
          commandExecutionMode={commandExecutionMode}
          saving={settingsSaving}
          error={error}
          onResponseModeChange={(nextResponseMode) => void saveResponseMode(nextResponseMode)}
          onDeveloperModeChange={(nextDeveloperMode) => void saveDeveloperMode(nextDeveloperMode)}
          onCommandExecutionModeChange={(nextCommandExecutionMode) =>
            void saveCommandExecutionMode(nextCommandExecutionMode)}
        />
      ) : page === "models" ? (
        <ModelsPage
          providers={providers}
          selectedProvider={selectedProvider}
          onProvidersChange={setProviders}
          onSelect={setSelectedProviderId}
          onError={setError}
          error={error}
        />
      ) : page === "extensions" ? (
        <McpSkillsPage
          error={error}
          onError={setError}
        />
      ) : page === "automations" ? (
        <AutomationsPage
          providers={providers}
          sessions={sessions}
          workspaces={workspaces}
          error={error}
          onError={setError}
        />
      ) : (
        <div
          className="grid min-h-0 min-w-0 overflow-hidden"
          data-testid="agent-layout"
          style={{ gridTemplateColumns: agentColumns.replace(/_/g, " ") }}
        >
          {effectiveSidebarCollapsed ? null : (
            <SessionSidebar
              workspaces={workspaces}
              sessions={sessions}
              selectedWorkspaceId={selectedWorkspaceId}
              selectedSessionId={selectedSessionId}
              activeTurns={activeTurns}
              commandExecutionMode={commandExecutionMode}
              onCollapse={() => setSidebarCollapsed(true)}
              onOpenWorkspace={() => void openWorkspace()}
              onCreateSession={(workspaceId) => void createSession(workspaceId)}
              onRemoveWorkspace={(workspaceId) => void removeWorkspace(workspaceId)}
              onRemoveSession={(sessionId) => void removeSession(sessionId)}
              onSelectWorkspace={(workspaceId) => {
                setSelectedWorkspaceId(workspaceId);
                setSelectedSessionId(
                  sessions.find((session) => session.workspaceId === workspaceId)?.id,
                );
              }}
              onSelectSession={(sessionId, workspaceId) => {
                setSelectedWorkspaceId(workspaceId);
                setSelectedSessionId(sessionId);
              }}
            />
          )}
          <AgentWorkspace
            loading={loading}
            workspace={selectedWorkspace}
            session={selectedSession}
            activities={selectedSessionId ? activities[selectedSessionId] ?? [] : []}
            automationProposals={
              selectedSessionId ? automationProposals[selectedSessionId] ?? [] : []
            }
            modelRequests={selectedSessionId ? modelRequests[selectedSessionId] ?? [] : []}
            developerMode={developerMode}
            commandExecutionMode={commandExecutionMode}
            modelInspectorOpen={modelInspectorOpen}
            sessionTimerCount={selectedSessionTimerCount}
            activeTurnId={activeTurnId}
            navCollapsed={effectiveNavCollapsed}
            sidebarCollapsed={effectiveSidebarCollapsed}
            contextCollapsed={Boolean(selectedSession) && effectiveContextCollapsed}
            onExpandNav={() => setNavCollapsed(false)}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            onExpandContext={() => setContextCollapsed(false)}
            prompt={prompt}
            error={error}
            onPromptChange={setPrompt}
            onPromptKeyDown={handlePromptKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onSend={() => void sendPrompt()}
            onStop={() => void stopTurn()}
            onRename={(title) => void renameSession(title)}
            onDelete={() => void deleteSession()}
            onOpenWorkspace={() => void openWorkspace()}
            onModelInspectorOpen={() => setModelInspectorOpen(true)}
            onModelInspectorClose={() => setModelInspectorOpen(false)}
            onSessionTimerCreated={handleSessionTimerCreated}
            onError={setError}
            onCreateAutomationProposal={(proposalId) =>
              void createAutomationFromProposal(proposalId)}
            onCancelAutomationProposal={cancelAutomationProposal}
          />
          {selectedSession && !effectiveContextCollapsed ? (
            <RunContextPanel
              session={selectedSession}
              provider={selectedProvider}
              responseMode={responseMode}
              commandExecutionMode={commandExecutionMode}
              runtime={selectedSessionId ? turnRuntimes[selectedSessionId] : undefined}
              activities={selectedSessionId ? activities[selectedSessionId] ?? [] : []}
              developerMode={developerMode}
              onCollapse={() => setContextCollapsed(true)}
              onOpenInspector={() => setModelInspectorOpen(true)}
            />
          ) : null}
        </div>
      )}
      {currentPermissionRequest ? (
        <PermissionRequestPrompt
          request={currentPermissionRequest}
          responding={permissionResponding}
          onApprove={() => void respondToPermission(true)}
          onDeny={() => void respondToPermission(false)}
        />
      ) : null}
    </main>
  );
}
