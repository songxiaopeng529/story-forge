import type { ProviderId } from "@story-forge/model-gateway";
import type {
  AgentEvent,
  ModelRequestEvent,
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
import { ModelsPage } from "./components/models-page";
import { PrimaryNavigation, type Page } from "./components/primary-navigation";
import { SettingsPage } from "./components/settings-page";
import { SessionSidebar } from "./components/session-sidebar";
import { formatError, upsertSession, upsertWorkspace } from "./renderer-utils";

export function App() {
  const [page, setPage] = useState<Page>("agent");
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedSessionId, setSelectedSessionId] = useState<SessionId>();
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>("deepseek");
  const [activities, setActivities] = useState<Record<string, AgentEvent[]>>({});
  const [modelRequests, setModelRequests] = useState<Record<string, ModelRequestEvent[]>>({});
  const [modelInspectorOpen, setModelInspectorOpen] = useState(false);
  const [activeTurns, setActiveTurns] = useState<Record<string, TurnId>>({});
  const [prompt, setPrompt] = useState("");
  const [responseMode, setResponseMode] = useState<ResponseMode>("auto");
  const [developerMode, setDeveloperMode] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const composingRef = useRef(false);
  const persistedResponseModeRef = useRef<ResponseMode>("auto");
  const persistedDeveloperModeRef = useRef(false);
  const settingsSaveInFlightRef = useRef(false);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  );
  const selectedProvider = providers.find(
    (provider) => provider.providerId === selectedProviderId,
  );
  const activeTurnId = selectedSessionId ? activeTurns[selectedSessionId] : undefined;

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
      if (event.type === "runtime.started") {
        setActiveTurns((current) => ({ ...current, [event.sessionId]: event.turnId }));
      }
      if (event.type === "runtime.completed" || event.type === "runtime.error") {
        setActiveTurns((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        void refreshSession(event.sessionId);
      }
    });

    void (async () => {
      try {
        const [nextSettings, nextProviders, nextWorkspaces, nextSessions] = await Promise.all([
          window.storyForge.settings.get(),
          window.storyForge.providers.list(),
          window.storyForge.workspaces.list(),
          window.storyForge.sessions.list(),
        ]);
        if (disposed) {
          return;
        }
        persistedResponseModeRef.current = nextSettings.responseMode;
        persistedDeveloperModeRef.current = nextSettings.developerMode;
        setResponseMode(nextSettings.responseMode);
        setDeveloperMode(nextSettings.developerMode);
        setProviders(nextProviders);
        setWorkspaces(nextWorkspaces);
        setSessions(nextSessions);
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
    <main className="grid h-screen grid-cols-[220px_1fr] overflow-hidden bg-forge-canvas text-forge-ink">
      <PrimaryNavigation page={page} onChange={setPage} />
      {page === "settings" ? (
        <SettingsPage
          responseMode={responseMode}
          developerMode={developerMode}
          saving={settingsSaving}
          error={error}
          onResponseModeChange={(nextResponseMode) => void saveResponseMode(nextResponseMode)}
          onDeveloperModeChange={(nextDeveloperMode) => void saveDeveloperMode(nextDeveloperMode)}
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
      ) : (
        <div
          className="grid min-h-0 min-w-0 grid-cols-[290px_1fr] overflow-hidden"
          data-testid="agent-layout"
        >
          <SessionSidebar
            workspaces={workspaces}
            sessions={sessions}
            selectedWorkspaceId={selectedWorkspaceId}
            selectedSessionId={selectedSessionId}
            activeTurns={activeTurns}
            onOpenWorkspace={() => void openWorkspace()}
            onCreateSession={(workspaceId) => void createSession(workspaceId)}
            onRemoveWorkspace={(workspaceId) => void removeWorkspace(workspaceId)}
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
          <AgentWorkspace
            loading={loading}
            workspace={selectedWorkspace}
            session={selectedSession}
            activities={selectedSessionId ? activities[selectedSessionId] ?? [] : []}
            modelRequests={selectedSessionId ? modelRequests[selectedSessionId] ?? [] : []}
            developerMode={developerMode}
            modelInspectorOpen={modelInspectorOpen}
            activeTurnId={activeTurnId}
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
          />
        </div>
      )}
    </main>
  );
}
