import "@testing-library/jest-dom/vitest";
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

describe("RunContextPanel runtime row", () => {
  it("shows PI as the desktop runtime", () => {
    render(
      <RunContextPanel
        session={session}
        provider={undefined}
        commandExecutionMode="sentinel"
        runtime={undefined}
        activities={[]}
        developerMode={false}
        onCollapse={() => {}}
        onOpenInspector={() => {}}
      />,
    );

    const row = screen.getByText("Runtime").parentElement;
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("PI Agent Runtime")).toBeInTheDocument();
  });
});
