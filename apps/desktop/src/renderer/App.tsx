import { PageRouter } from "./components/page-router";
import { PermissionRequestPrompt } from "./components/permission-request-prompt";
import { ExtensionUiPrompt } from "./components/extension-ui-prompt";
import { PrimaryNavigation } from "./components/primary-navigation";
import { useAppController } from "./use-app-controller";

export function App() {
  const c = useAppController();

  return (
    <main
      className={`grid h-screen overflow-hidden bg-forge-canvas text-forge-ink ${
        c.effectiveNavCollapsed ? "grid-cols-[1fr]" : "grid-cols-[72px_1fr]"
      }`}
    >
      {c.effectiveNavCollapsed ? null : (
        <PrimaryNavigation
          page={c.page}
          onChange={c.setPage}
          collapsible={c.agentHeaderVisible}
          onCollapse={() => c.setNavCollapsed(true)}
        />
      )}
      <PageRouter
        page={c.page}
        settings={{
          developerMode: c.developerMode,
          commandExecutionMode: c.commandExecutionMode,
          webAccessEnabled: c.webAccessEnabled,
          webSearchCoverage: c.webSearchCoverage,
          saving: c.settingsSaving,
          error: c.error,
          onDeveloperModeChange: (next) => void c.saveDeveloperMode(next),
          onCommandExecutionModeChange: (next) => void c.saveCommandExecutionMode(next),
          onWebAccessEnabledChange: (next) => void c.saveWebAccessEnabled(next),
          onWebSearchCoverageChange: (next) => void c.saveWebSearchCoverage(next),
        }}
        models={{
          providers: c.providers,
          selectedProvider: c.selectedProvider,
          onProvidersChange: c.setProviders,
          onSelect: c.setSelectedProviderId,
          onError: c.setError,
          error: c.error,
        }}
        extensions={{ error: c.error, onError: c.setError }}
        automations={{
          providers: c.providers,
          sessions: c.sessions,
          workspaces: c.workspaces,
          error: c.error,
          onError: c.setError,
        }}
        agent={{
          workspaces: c.workspaces,
          sessions: c.sessions,
          selectedWorkspace: c.selectedWorkspace,
          selectedSession: c.selectedSession,
          selectedSessionProvider: c.selectedSessionProvider,
          selectedWorkspaceId: c.selectedWorkspaceId,
          selectedSessionId: c.selectedSessionId,
          activeTurns: c.activeTurns,
          activities: c.activities,
          automationProposals: c.automationProposals,
          modelRequests: c.modelRequests,
          runtime: c.turnRuntime,
          activeTurnId: c.activeTurnId,
          loading: c.loading,
          compacting: Boolean(c.selectedSessionId) && c.compactingSessionId === c.selectedSessionId,
          modelInspectorOpen: c.modelInspectorOpen,
          sessionTimerCount: c.selectedSessionTimerCount,
          commandExecutionMode: c.commandExecutionMode,
          developerMode: c.developerMode,
          imageInputEnabled: Boolean(c.selectedSessionProvider?.supportsImageInput),
          navCollapsed: c.effectiveNavCollapsed,
          sidebarCollapsed: c.effectiveSidebarCollapsed,
          contextCollapsed: c.effectiveContextCollapsed,
          prompt: c.prompt,
          imageAttachments: c.imageAttachments,
          error: c.error,
          onExpandNav: () => c.setNavCollapsed(false),
          onExpandSidebar: () => c.setSidebarCollapsed(false),
          onExpandContext: () => c.setContextCollapsed(false),
          onCollapseSidebar: () => c.setSidebarCollapsed(true),
          onCollapseContext: () => c.setContextCollapsed(true),
          onOpenWorkspace: () => void c.openWorkspace(),
          onCreateSession: (workspaceId) => void c.createSession(workspaceId),
          onRemoveWorkspace: (workspaceId) => void c.removeWorkspace(workspaceId),
          onRemoveSession: (sessionId) => void c.removeSession(sessionId),
          onSelectWorkspace: c.selectWorkspace,
          onSelectSession: c.selectSession,
          onPromptChange: c.setPrompt,
          onImageAttachmentsChange: c.setImageAttachments,
          onPromptKeyDown: c.handlePromptKeyDown,
          onCompositionStart: c.handleCompositionStart,
          onCompositionEnd: c.handleCompositionEnd,
          onSend: () => void c.sendPrompt(),
          onStop: () => void c.stopTurn(),
          onRename: (title) => void c.renameSession(title),
          onDelete: () => void c.deleteSession(),
          onOpenModels: () => c.setPage("models"),
          onOpenExtensions: () => c.setPage("extensions"),
          onOpenSettings: () => c.setPage("settings"),
          onCompact: () => void c.compactSelectedSession(),
          onModelInspectorOpen: () => c.setModelInspectorOpen(true),
          onModelInspectorClose: () => c.setModelInspectorOpen(false),
          onSessionTimerCreated: c.handleSessionTimerCreated,
          onError: c.setError,
          onCreateAutomationProposal: (proposalId) =>
            void c.createAutomationFromProposal(proposalId),
          onCancelAutomationProposal: c.cancelAutomationProposal,
        }}
      />
      {c.currentPermissionRequest ? (
        <PermissionRequestPrompt
          request={c.currentPermissionRequest}
          responding={c.permissionResponding}
          onApprove={() => void c.respondToPermission(true)}
          onDeny={() => void c.respondToPermission(false)}
        />
      ) : null}
      {c.currentExtensionUiRequest ? (
        <ExtensionUiPrompt
          request={c.currentExtensionUiRequest}
          responding={c.extensionUiResponding}
          onRespond={(response) => void c.respondToExtensionUi(response)}
        />
      ) : null}
    </main>
  );
}
