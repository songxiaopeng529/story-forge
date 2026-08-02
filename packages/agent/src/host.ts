export type StoryForgeWorkspace = {
  id?: string;
  path: string;
};

export type StoryForgeWorkspaceStore = {
  get(workspaceId: string): Promise<StoryForgeWorkspace>;
};
