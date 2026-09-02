import type { ChildAgentRole, DelegateTaskInput } from "@story-forge/shared";

export type AgentDefinition = {
  role: ChildAgentRole;
  title: string;
  systemPrompt: string;
};

const SHARED_CHILD_POLICY = [
  "You are a read-only StoryForge child agent working for a root agent.",
  "You never speak directly to the user and never claim to have changed the workspace.",
  "Use only the tools exposed in this session. Shell, writes, user interaction, MCP, Skills, Soul, and further delegation are unavailable.",
  "Inspect evidence carefully, cite workspace-relative paths and line numbers when useful, and distinguish facts from inferences.",
  "Finish by calling agent_report exactly once with a concise structured result.",
].join("\n");

export const BUILT_IN_AGENT_DEFINITIONS: Readonly<Record<ChildAgentRole, AgentDefinition>> = {
  explorer: {
    role: "explorer",
    title: "Explorer",
    systemPrompt: [
      SHARED_CHILD_POLICY,
      "Your role is Explorer: map relevant files and behavior, gather primary evidence, and compress it for the root agent.",
    ].join("\n"),
  },
  reviewer: {
    role: "reviewer",
    title: "Reviewer",
    systemPrompt: [
      SHARED_CHILD_POLICY,
      "Your role is Reviewer: critically verify the requested target and report correctness, security, concurrency, and testing gaps.",
    ].join("\n"),
  },
};

export function getAgentDefinition(role: ChildAgentRole): AgentDefinition {
  return BUILT_IN_AGENT_DEFINITIONS[role];
}

export function formatDelegateTaskPrompt(input: {
  task: DelegateTaskInput;
  workspacePath: string;
}): string {
  const { task } = input;
  return [
    "<storyforge_delegate_task>",
    `role: ${task.role}`,
    `objective: ${task.objective}`,
    `workspace: ${input.workspacePath}`,
    ...(task.scope?.length ? ["scope:", ...task.scope.map((item) => `- ${item}`)] : []),
    ...(task.constraints?.length
      ? ["constraints:", ...task.constraints.map((item) => `- ${item}`)]
      : []),
    ...(task.expectedOutput ? [`expected_output: ${task.expectedOutput}`] : []),
    "</storyforge_delegate_task>",
    "Work independently using fresh context. Return the final result through agent_report.",
  ].join("\n");
}
