import { NativeAgentRuntime } from "@story-forge/agent-core";
import { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from "@story-forge/model-gateway";
import { createWorkspaceFileTools, ToolRegistry, WorkspaceSandbox } from "@story-forge/tools";

export type DesktopProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type DesktopRuntimeOptions = {
  workspaceRoot: string;
  providerConfig: DesktopProviderConfig;
  fetch?: OpenAICompatibleProviderOptions["fetch"];
};

export function createDesktopRuntime(options: DesktopRuntimeOptions): NativeAgentRuntime {
  const tools = new ToolRegistry();
  const sandbox = new WorkspaceSandbox(options.workspaceRoot);

  for (const tool of createWorkspaceFileTools(sandbox)) {
    tools.register(tool);
  }

  return new NativeAgentRuntime({
    workspaceRoot: options.workspaceRoot,
    tools,
    provider: new OpenAICompatibleProvider({
      apiKey: options.providerConfig.apiKey,
      baseUrl: options.providerConfig.baseUrl,
      model: options.providerConfig.model,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
  });
}
