import type {
  AgentEvent,
  AutomationView,
  CommandExecutionMode,
  ModelRequestEvent,
  ResponseMode,
  SessionId,
  TurnId,
  TurnMode,
} from "@story-forge/shared";
import type { KeyboardEvent } from "react";
import type {
  ImageAttachmentView,
  ProviderView,
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import type { AutomationProposalTimelineState } from "../timeline";
import { AgentWorkspace } from "./agent-workspace";
import { RunContextPanel, type RunStatus } from "./run-context-panel";
import { SessionSidebar } from "./session-sidebar";

export type TurnRuntimeState = {
  turnId: TurnId;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  steps: number;
};

export type AgentLayoutProps = {
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  selectedWorkspace: WorkspaceView | undefined;
  selectedSession: SessionView | undefined;
  selectedSessionProvider: ProviderView | undefined;
  selectedWorkspaceId: string | undefined;
  selectedSessionId: SessionId | undefined;
  activeTurns: Record<string, TurnId>;
  activities: AgentEvent[];
  automationProposals: AutomationProposalTimelineState[];
  modelRequests: ModelRequestEvent[];
  runtime: TurnRuntimeState | undefined;
  activeTurnId: TurnId | undefined;
  loading: boolean;
  compacting: boolean;
  modelInspectorOpen: boolean;
  sessionTimerCount: number;
  commandExecutionMode: CommandExecutionMode;
  responseMode: ResponseMode;
  developerMode: boolean;
  imageInputEnabled: boolean;
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  contextCollapsed: boolean;
  prompt: string;
  composerMode: TurnMode;
  imageAttachments: ImageAttachmentView[];
  error: string | undefined;
  onExpandNav: () => void;
  onExpandSidebar: () => void;
  onExpandContext: () => void;
  onCollapseSidebar: () => void;
  onCollapseContext: () => void;
  onOpenWorkspace: () => void;
  onCreateSession: (workspaceId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onRemoveSession: (sessionId: SessionId) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: SessionId, workspaceId: string) => void;
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
  onOpenModels: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: () => void;
  onCompact: () => void;
  onModelInspectorOpen: () => void;
  onModelInspectorClose: () => void;
  onSessionTimerCreated: (automation: AutomationView) => void;
  onError: (message: string | undefined) => void;
  onCreateAutomationProposal: (proposalId: string) => void;
  onCancelAutomationProposal: (proposalId: string) => void;
};

export function AgentLayout(props: AgentLayoutProps) {
  const {
    workspaces,
    sessions,
    selectedWorkspace,
    selectedSession,
    selectedSessionProvider,
    selectedWorkspaceId,
    selectedSessionId,
    activeTurns,
    activities,
    automationProposals,
    modelRequests,
    runtime,
    activeTurnId,
    loading,
    compacting,
    modelInspectorOpen,
    sessionTimerCount,
    commandExecutionMode,
    responseMode,
    developerMode,
    imageInputEnabled,
    navCollapsed,
    sidebarCollapsed,
    contextCollapsed,
    prompt,
    composerMode,
    imageAttachments,
    error,
  } = props;

  const showSidebar = !sidebarCollapsed;
  const showContextPanel = Boolean(selectedSession) && !contextCollapsed;

  const gridTemplateColumns = [
    showSidebar ? "288px" : null,
    "1fr",
    showContextPanel ? "292px" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="grid min-h-0 min-w-0 overflow-hidden"
      data-testid="agent-layout"
      style={{ gridTemplateColumns }}
    >
      {showSidebar ? (
        <SessionSidebar
          workspaces={workspaces}
          sessions={sessions}
          selectedWorkspaceId={selectedWorkspaceId}
          selectedSessionId={selectedSessionId}
          activeTurns={activeTurns}
          commandExecutionMode={commandExecutionMode}
          onCollapse={props.onCollapseSidebar}
          onOpenWorkspace={props.onOpenWorkspace}
          onCreateSession={props.onCreateSession}
          onRemoveWorkspace={props.onRemoveWorkspace}
          onRemoveSession={props.onRemoveSession}
          onSelectWorkspace={props.onSelectWorkspace}
          onSelectSession={props.onSelectSession}
        />
      ) : null}
      <AgentWorkspace
        loading={loading}
        workspace={selectedWorkspace}
        session={selectedSession}
        activities={activities}
        automationProposals={automationProposals}
        modelRequests={modelRequests}
        developerMode={developerMode}
        commandExecutionMode={commandExecutionMode}
        compacting={compacting}
        modelInspectorOpen={modelInspectorOpen}
        sessionTimerCount={sessionTimerCount}
        activeTurnId={activeTurnId}
        navCollapsed={navCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        contextCollapsed={Boolean(selectedSession) && contextCollapsed}
        onExpandNav={props.onExpandNav}
        onExpandSidebar={props.onExpandSidebar}
        onExpandContext={props.onExpandContext}
        prompt={prompt}
        composerMode={composerMode}
        imageAttachments={imageAttachments}
        imageInputEnabled={imageInputEnabled}
        error={error}
        onPromptChange={props.onPromptChange}
        onComposerModeChange={props.onComposerModeChange}
        onImageAttachmentsChange={props.onImageAttachmentsChange}
        onPromptKeyDown={props.onPromptKeyDown}
        onCompositionStart={props.onCompositionStart}
        onCompositionEnd={props.onCompositionEnd}
        onSend={props.onSend}
        onStop={props.onStop}
        onRename={props.onRename}
        onDelete={props.onDelete}
        onOpenWorkspace={props.onOpenWorkspace}
        onOpenModels={props.onOpenModels}
        onOpenExtensions={props.onOpenExtensions}
        onOpenSettings={props.onOpenSettings}
        onCompact={props.onCompact}
        onModelInspectorOpen={props.onModelInspectorOpen}
        onModelInspectorClose={props.onModelInspectorClose}
        onSessionTimerCreated={props.onSessionTimerCreated}
        onError={props.onError}
        onCreateAutomationProposal={props.onCreateAutomationProposal}
        onCancelAutomationProposal={props.onCancelAutomationProposal}
      />
      {showContextPanel && selectedSession ? (
        <RunContextPanel
          session={selectedSession}
          provider={selectedSessionProvider}
          responseMode={responseMode}
          commandExecutionMode={commandExecutionMode}
          runtime={runtime}
          activities={activities}
          developerMode={developerMode}
          onCollapse={props.onCollapseContext}
          onOpenInspector={props.onModelInspectorOpen}
        />
      ) : null}
    </div>
  );
}
