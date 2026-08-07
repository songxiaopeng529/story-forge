import { formatError } from "@story-forge/shared";
import type { SessionView, WorkspaceView } from "../shared/story-forge-api";

export { formatError };

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
