import type { ParsedMcpServer } from "@story-forge/extensions";

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
