import type {
  AgentEvent,
  AutomationView,
  CommandExecutionMode,
  HumanInputRequestEvent,
  HumanInputResponse,
  ModelRequestEvent,
  SessionId,
  TurnId,
} from "@story-forge/shared";
import type { KeyboardEvent } from "react";
import type {
  GitRepositoryView,
  ImageAttachmentView,
  ProviderView,
  SessionView,
  WorkspaceView,
} from "../../shared/story-forge-api";
import type { AutomationProposalTimelineState } from "../utils/timeline";
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
  repository: GitRepositoryView | undefined;
  repositoryLoading: boolean;
  activeTurns: Record<string, TurnId>;
  activities: AgentEvent[];
  automationProposals: AutomationProposalTimelineState[];
  currentHumanInputRequest: HumanInputRequestEvent | undefined;
  humanInputResponding: boolean;
  modelRequests: ModelRequestEvent[];
  runtime: TurnRuntimeState | undefined;
  activeTurnId: TurnId | undefined;
  turnStarting: boolean;
  commandModeLocked: boolean;
  loading: boolean;
  compacting: boolean;
  modelInspectorOpen: boolean;
  sessionTimerCount: number;
  commandExecutionMode: CommandExecutionMode;
  settingsSaving: boolean;
  developerMode: boolean;
  imageInputEnabled: boolean;
  navCollapsed: boolean;
  sidebarCollapsed: boolean;
  contextCollapsed: boolean;
  prompt: string;
  imageAttachments: ImageAttachmentView[];
  error: string | undefined;
  onExpandNav: () => void;
  onExpandSidebar: () => void;
  onExpandContext: () => void;
  onCollapseSidebar: () => void;
  onCollapseContext: () => void;
  onRefreshRepository: () => void;
  onOpenWorkspace: () => void;
  onCreateSession: (workspaceId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onRemoveSession: (sessionId: SessionId) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: SessionId, workspaceId: string) => void;
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
  onHumanInputRespond: (response: Omit<HumanInputResponse, "requestId">) => void;
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
    repository,
    repositoryLoading,
    activeTurns,
    activities,
    automationProposals,
    currentHumanInputRequest,
    humanInputResponding,
    modelRequests,
    runtime,
    activeTurnId,
    turnStarting,
    commandModeLocked,
    loading,
    compacting,
    modelInspectorOpen,
    sessionTimerCount,
    commandExecutionMode,
    settingsSaving,
    developerMode,
    imageInputEnabled,
    navCollapsed,
    sidebarCollapsed,
    contextCollapsed,
    prompt,
    imageAttachments,
    error,
  } = props;

  const showSidebar = !sidebarCollapsed;
  const showContextPanel = Boolean(selectedWorkspace) && !contextCollapsed;

  const gridTemplateColumns = [
    showSidebar ? "288px" : null,
    "1fr",
    showContextPanel ? "304px" : null,
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
        currentHumanInputRequest={currentHumanInputRequest}
        humanInputResponding={humanInputResponding}
        modelRequests={modelRequests}
        developerMode={developerMode}
        commandExecutionMode={commandExecutionMode}
        settingsSaving={settingsSaving}
        compacting={compacting}
        modelInspectorOpen={modelInspectorOpen}
        sessionTimerCount={sessionTimerCount}
        activeTurnId={activeTurnId}
        turnStarting={turnStarting}
        commandModeLocked={commandModeLocked}
        navCollapsed={navCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        contextCollapsed={Boolean(selectedWorkspace) && contextCollapsed}
        onExpandNav={props.onExpandNav}
        onExpandSidebar={props.onExpandSidebar}
        onExpandContext={props.onExpandContext}
        prompt={prompt}
        imageAttachments={imageAttachments}
        imageInputEnabled={imageInputEnabled}
        error={error}
        onPromptChange={props.onPromptChange}
        onImageAttachmentsChange={props.onImageAttachmentsChange}
        onCommandExecutionModeChange={props.onCommandExecutionModeChange}
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
        onHumanInputRespond={props.onHumanInputRespond}
      />
      {showContextPanel ? (
        <RunContextPanel
          session={selectedSession}
          provider={selectedSessionProvider}
          runtime={runtime}
          activities={activities}
          developerMode={developerMode}
          workspacePath={selectedWorkspace?.path}
          repository={repository}
          repositoryLoading={repositoryLoading}
          onCollapse={props.onCollapseContext}
          onOpenInspector={props.onModelInspectorOpen}
          onRefreshRepository={props.onRefreshRepository}
        />
      ) : null}
    </div>
  );
}
