export {};

declare global {
  interface Window {
    storyForge: {
      version: string;
      runTurn(input: {
        workspaceRoot: string;
        providerConfig: {
          apiKey: string;
          baseUrl: string;
          model: string;
        };
        prompt: string;
      }): Promise<unknown[]>;
    };
  }
}
