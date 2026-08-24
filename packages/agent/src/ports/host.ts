import type { ParsedMcpServer } from "@story-forge/extensions";
import type { SoulDocumentView } from "@story-forge/shared";

export type StoryForgeWorkspace = {
  id?: string;
  path: string;
};

export type StoryForgeWorkspaceStore = {
  get(workspaceId: string): Promise<StoryForgeWorkspace>;
};

export type StoryForgeSkillSource = {
  listEnabledSkillPaths(): Promise<string[]>;
};

export type StoryForgeMcpSource = {
  listEnabledMcpServers(): Promise<ParsedMcpServer[]>;
};

export type StoryForgeSoulStore = {
  get(): Promise<SoulDocumentView>;
  save(input: { content: string; expectedRevision: string }): Promise<SoulDocumentView>;
};
