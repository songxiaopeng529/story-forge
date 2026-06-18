import type { SessionId, TurnId } from "@story-forge/shared";
import { FolderOpen, MessageSquarePlus, Trash2 } from "lucide-react";
import type { SessionView, WorkspaceView } from "../../shared/story-forge-api";

export function SessionSidebar(props: {
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  selectedWorkspaceId: string | undefined;
  selectedSessionId: SessionId | undefined;
  activeTurns: Record<string, TurnId>;
  onOpenWorkspace: () => void;
  onCreateSession: (workspaceId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: SessionId, workspaceId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-forge-line bg-white">
      <div className="flex h-16 flex-none items-center justify-between border-b border-forge-line px-4">
        <div>
          <div className="text-sm font-semibold">Workspaces</div>
          <div className="text-xs text-slate-500">Persistent local sessions</div>
        </div>
        <button
          aria-label="Open workspace"
          className="rounded-md border border-forge-line p-2 hover:bg-slate-50"
          onClick={props.onOpenWorkspace}
          type="button"
        >
          <FolderOpen size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {props.workspaces.length === 0 ? (
          <button
            className="w-full rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-600"
            onClick={props.onOpenWorkspace}
            type="button"
          >
            Open a workspace
          </button>
        ) : null}
        {props.workspaces.map((workspace) => {
          const workspaceSessions = props.sessions.filter(
            (session) => session.workspaceId === workspace.id,
          );
          return (
            <section className="mb-4" key={workspace.id}>
              <div className="flex items-center gap-1 px-1 py-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => props.onSelectWorkspace(workspace.id)}
                  type="button"
                >
                  <div className="truncate text-sm font-semibold">{workspace.displayName}</div>
                  <div className="truncate text-xs text-slate-500">{workspace.path}</div>
                </button>
                <button
                  aria-label={`New session in ${workspace.displayName}`}
                  className="rounded p-1.5 hover:bg-slate-100"
                  onClick={() => props.onCreateSession(workspace.id)}
                  type="button"
                >
                  <MessageSquarePlus size={15} />
                </button>
                <button
                  aria-label={`Remove ${workspace.displayName}`}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => props.onRemoveWorkspace(workspace.id)}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="space-y-1">
                {workspaceSessions.map((session) => (
                  <button
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                      session.id === props.selectedSessionId
                        ? "bg-orange-50 font-medium text-forge-ember"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                    key={session.id}
                    onClick={() => props.onSelectSession(session.id, workspace.id)}
                    type="button"
                  >
                    <span className={`h-2 w-2 rounded-full ${
                      props.activeTurns[session.id] ? "bg-emerald-500" : "bg-slate-300"
                    }`} />
                    <span className="truncate">{session.title}</span>
                  </button>
                ))}
                {workspaceSessions.length === 0 ? (
                  <button
                    className="w-full rounded-md px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50"
                    onClick={() => props.onCreateSession(workspace.id)}
                    type="button"
                  >
                    Create first session
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
