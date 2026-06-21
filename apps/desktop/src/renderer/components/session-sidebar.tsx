import type { CommandExecutionMode, SessionId, TurnId } from "@story-forge/shared";
import { Folder, FolderOpen, PanelLeftClose, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SessionView, WorkspaceView } from "../../shared/story-forge-api";
import { commandModeMeta } from "../command-mode-meta";

export function SessionSidebar(props: {
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  selectedWorkspaceId: string | undefined;
  selectedSessionId: SessionId | undefined;
  activeTurns: Record<string, TurnId>;
  commandExecutionMode: CommandExecutionMode;
  onCollapse: () => void;
  onOpenWorkspace: () => void;
  onCreateSession: (workspaceId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onRemoveSession: (sessionId: SessionId) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: SessionId, workspaceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const meta = commandModeMeta[props.commandExecutionMode];
  const totalSessions = props.sessions.length;

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-forge-line bg-forge-sidebar">
      <div className="flex flex-none items-start justify-between px-4 pt-[18px]">
        <div>
          <div className="text-sm font-semibold text-forge-ink">Workspaces</div>
          <div className="text-[11px] text-forge-muted">Persistent local sessions</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="Open workspace"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas"
            onClick={props.onOpenWorkspace}
            type="button"
          >
            <FolderOpen size={16} />
          </button>
          <button
            aria-label="Collapse session sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-forge-line bg-white text-forge-muted hover:bg-forge-canvas"
            onClick={props.onCollapse}
            title="Collapse sidebar"
            type="button"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      <div className="flex-none px-4 pt-[14px]">
        <div className="flex h-9 items-center gap-2 rounded-lg border border-forge-line bg-white px-2.5">
          <Search className="text-forge-muted" size={16} />
          <input
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-xs text-forge-ink outline-none placeholder:text-forge-muted"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            value={query}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-[14px]">
        {props.workspaces.length === 0 ? (
          <button
            className="w-full rounded-[10px] border border-dashed border-forge-line p-5 text-sm text-forge-muted hover:bg-white"
            onClick={props.onOpenWorkspace}
            type="button"
          >
            Open a workspace
          </button>
        ) : null}

        {props.workspaces.map((workspace) => {
          const workspaceSessions = props.sessions.filter(
            (session) =>
              session.workspaceId === workspace.id
              && (normalizedQuery === ""
                || session.title.toLowerCase().includes(normalizedQuery)),
          );
          return (
            <section className="mb-4" key={workspace.id}>
              <div className="rounded-[10px] border border-forge-line bg-white p-3">
                <div className="flex items-center gap-2">
                  <Folder className="flex-none text-forge-muted" size={16} />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-forge-ink"
                    onClick={() => props.onSelectWorkspace(workspace.id)}
                    title={workspace.displayName}
                    type="button"
                  >
                    {workspace.displayName}
                  </button>
                  <button
                    aria-label={`New session in ${workspace.displayName}`}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-forge-muted hover:bg-forge-canvas hover:text-forge-ink"
                    onClick={() => props.onCreateSession(workspace.id)}
                    type="button"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    aria-label={`Remove ${workspace.displayName}`}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-forge-muted hover:bg-forge-danger-bg hover:text-forge-danger"
                    onClick={() => props.onRemoveWorkspace(workspace.id)}
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-2 truncate text-[11px] text-forge-muted" title={workspace.path}>
                  {workspace.path}
                </div>
              </div>

              <div className="my-4 h-px bg-forge-divider" />

              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-medium text-forge-ink">Recent sessions</span>
                <span className="text-[11px] text-forge-muted">{totalSessions}</span>
              </div>

              <div className="mt-2 space-y-2">
                {workspaceSessions.map((session) => {
                  const selected = session.id === props.selectedSessionId;
                  const running = Boolean(props.activeTurns[session.id]);
                  return (
                    <div
                      className={`group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2.5 ${
                        selected
                          ? "border-[#86868b] bg-forge-canvas"
                          : "border-forge-line bg-white hover:bg-forge-canvas"
                      }`}
                      key={session.id}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        onClick={() => props.onSelectSession(session.id, workspace.id)}
                        type="button"
                      >
                        <span
                          className={`h-2 w-2 flex-none rounded-full ${
                            running ? "bg-forge-dot" : "bg-[#c8d1dd]"
                          }`}
                        />
                        <span
                          className={`truncate text-[13px] text-forge-ink ${
                            selected ? "font-semibold" : "font-normal"
                          }`}
                        >
                          {session.title}
                        </span>
                      </button>
                      <button
                        aria-label={`Delete session ${session.title}`}
                        className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-forge-muted opacity-0 hover:bg-forge-danger-bg hover:text-forge-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-0"
                        disabled={running}
                        onClick={() => props.onRemoveSession(session.id)}
                        title="Delete session"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
                {workspaceSessions.length === 0 ? (
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left text-xs text-forge-muted hover:bg-white"
                    onClick={() => props.onCreateSession(workspace.id)}
                    type="button"
                  >
                    {normalizedQuery ? "No matching sessions" : "Create first session"}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}

        <div className="rounded-[10px] border border-forge-line bg-forge-canvas px-3 py-2.5">
          <div className="text-xs font-semibold text-forge-ink">{meta.label}</div>
          <div className="mt-1 text-[11px] leading-4 text-forge-muted">{meta.description}</div>
        </div>
      </div>
    </aside>
  );
}
