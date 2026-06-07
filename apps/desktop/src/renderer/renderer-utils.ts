import type { SessionView, WorkspaceView } from "../shared/story-forge-api";

export function upsertSession(
  sessions: SessionView[],
  session: SessionView,
): SessionView[] {
  return [session, ...sessions.filter((candidate) => candidate.id !== session.id)];
}

export function upsertWorkspace(
  workspaces: WorkspaceView[],
  workspace: WorkspaceView,
): WorkspaceView[] {
  return [workspace, ...workspaces.filter((candidate) => candidate.id !== workspace.id)];
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
