import { realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

const workspaceSchema = z.object({
  id: z.string(),
  path: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
});

const workspaceFileSchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(workspaceSchema),
});

export type WorkspaceRecord = z.infer<typeof workspaceSchema>;

export class WorkspaceRepository {
  private readonly filePath: string;

  constructor(options: { rootDir: string }) {
    this.filePath = join(options.rootDir, "workspaces.json");
  }

  async list(): Promise<WorkspaceRecord[]> {
    return (await this.read()).workspaces.sort((left, right) =>
      right.lastOpenedAt.localeCompare(left.lastOpenedAt),
    );
  }

  async open(inputPath: string): Promise<WorkspaceRecord> {
    const canonicalPath = await realpath(inputPath);
    const file = await this.read();
    const now = new Date().toISOString();
    const existing = file.workspaces.find((workspace) => workspace.path === canonicalPath);
    if (existing) {
      existing.lastOpenedAt = now;
      await writeJsonAtomic(this.filePath, file);
      return existing;
    }
    const workspace: WorkspaceRecord = {
      id: createWorkspaceId(),
      path: canonicalPath,
      displayName: basename(canonicalPath),
      createdAt: now,
      lastOpenedAt: now,
    };
    file.workspaces.push(workspace);
    await writeJsonAtomic(this.filePath, file);
    return workspace;
  }

  async get(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = (await this.read()).workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  async remove(workspaceId: string): Promise<void> {
    const file = await this.read();
    file.workspaces = file.workspaces.filter((workspace) => workspace.id !== workspaceId);
    await writeJsonAtomic(this.filePath, file);
  }

  private read() {
    return readJson(this.filePath, workspaceFileSchema, {
      schemaVersion: 1 as const,
      workspaces: [],
    });
  }
}

function createWorkspaceId(): string {
  return `sf_workspace_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
