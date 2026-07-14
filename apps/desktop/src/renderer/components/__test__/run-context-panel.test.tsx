import "@testing-library/jest-dom/vitest";
import type { AgentRuntimeKind } from "@story-forge/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionView } from "../../../shared/story-forge-api";
import { RunContextPanel } from "../run-context-panel";

afterEach(() => {
  cleanup();
});

const session: SessionView = {
  schemaVersion: 1,
  id: "sf_session_1",
  workspaceId: "workspace-1",
  title: "Session",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  status: "idle",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [],
  tasks: [],
};

function renderPanel(runtimeKind: AgentRuntimeKind) {
  return render(
    <RunContextPanel
      session={session}
      provider={undefined}
      responseMode="auto"
      commandExecutionMode="sentinel"
      runtimeKind={runtimeKind}
      runtime={undefined}
      activities={[]}
      developerMode={false}
      onCollapse={() => {}}
      onOpenInspector={() => {}}
    />,
  );
}

function runtimeRowValue(): HTMLElement {
  const label = screen.getByText("Runtime");
  const row = label.parentElement;
  if (!row) {
    throw new Error("Runtime row not found");
  }
  return row;
}

describe("RunContextPanel runtime row", () => {
  it("shows the native runtime label below the context field", () => {
    renderPanel("native");
    expect(within(runtimeRowValue()).getByText("StoryForge Native Runtime")).toBeInTheDocument();
  });

  it("shows the PI runtime label", () => {
    renderPanel("pi");
    expect(within(runtimeRowValue()).getByText("PI Agent Runtime")).toBeInTheDocument();
  });
});
