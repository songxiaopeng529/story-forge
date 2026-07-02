import type { ComponentProps, ReactNode } from "react";
import { AgentLayout, type AgentLayoutProps } from "./agent-layout";
import { AutomationsPage } from "./automations-page";
import { McpSkillsPage } from "./mcp-skills-page";
import { ModelsPage } from "./models-page";
import type { Page } from "./primary-navigation";
import { SettingsPage } from "./settings-page";

export type PageRouterProps = {
  page: Page;
  settings: ComponentProps<typeof SettingsPage>;
  models: ComponentProps<typeof ModelsPage>;
  extensions: ComponentProps<typeof McpSkillsPage>;
  automations: ComponentProps<typeof AutomationsPage>;
  agent: AgentLayoutProps;
};

export function PageRouter(props: PageRouterProps): ReactNode {
  const renderers: Record<Page, () => ReactNode> = {
    settings: () => <SettingsPage {...props.settings} />,
    models: () => <ModelsPage {...props.models} />,
    extensions: () => <McpSkillsPage {...props.extensions} />,
    automations: () => <AutomationsPage {...props.automations} />,
    agent: () => <AgentLayout {...props.agent} />,
  };
  return renderers[props.page]();
}
