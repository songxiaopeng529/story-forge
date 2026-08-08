import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentEvent } from "@story-forge/shared";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GitRepositoryView,
  ProviderView,
  SessionView,
} from "../../../shared/story-forge-api";
import { RunContextPanel } from "../run-context-panel";

afterEach(() => {
  cleanup();
});

const session: SessionView = {
  schemaVersion: 2,
  id: "sf_session_1",
  workspaceId: "workspace-1",
  title: "Session",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  status: "idle",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  messages: [],
  tasks: [],
};

const provider: ProviderView = {
  providerId: "deepseek",
  displayName: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  recommendedModels: ["deepseek-v4-pro"],
  isDefault: true,
  defaultModel: "deepseek-v4-pro",
  hasSecret: true,
  lastTestStatus: "success",
  supportsImageInput: false,
};

const readyRepository: Extract<GitRepositoryView, { status: "ready" }> = {
  status: "ready",
  workspaceId: "workspace-1",
  checkedAt: 1_786_057_200,
  rootPath: "/workspace/project",
  head: {
    branch: "feature/git-panel",
    commit: "abcdef1234567890",
    detached: false,
    unborn: false,
  },
  upstream: {
    name: "origin/feature/git-panel",
    ahead: 2,
    behind: 1,
    gone: false,
  },
  lastCommit: {
    shortHash: "abcdef1",
    subject: "Add repository context",
    committedAt: 1_786_057_100,
  },
  changes: {
    total: 3,
    staged: 1,
    modified: 1,
    added: 1,
    deleted: 0,
    renamed: 0,
    untracked: 1,
    conflicted: 0,
    files: [
      {
        path: "src/app.ts",
        originalPath: null,
        indexStatus: "modified",
        worktreeStatus: null,
        untracked: false,
        conflicted: false,
      },
      {
        path: "src/theme.ts",
        originalPath: null,
        indexStatus: null,
        worktreeStatus: "modified",
        untracked: false,
        conflicted: false,
      },
      {
        path: "notes.txt",
        originalPath: null,
        indexStatus: null,
        worktreeStatus: null,
        untracked: true,
        conflicted: false,
      },
    ],
  },
  branches: {
    local: [
      {
        name: "feature/git-panel",
        kind: "local",
        current: true,
        commit: "abcdef1",
        upstream: "origin/feature/git-panel",
        ahead: 2,
        behind: 1,
      },
      {
        name: "main",
        kind: "local",
        current: false,
        commit: "1234567",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
      },
    ],
    remote: [
      {
        name: "origin/feature/git-panel",
        kind: "remote",
        current: false,
        commit: "abcdef1",
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ],
  },
};

describe("RunContextPanel repository context", () => {
  it("shows the current branch, upstream, commit, branch counts, and refresh action", () => {
    const onRefreshRepository = vi.fn();
    renderPanel({ repository: readyRepository, onRefreshRepository });

    expect(screen.getByText("feature/git-panel")).toBeInTheDocument();
    expect(screen.getByTitle("origin/feature/git-panel ↑2 ↓1")).toBeInTheDocument();
    expect(screen.getByTitle("abcdef1 · Add repository context")).toBeInTheDocument();
    expect(screen.getByText("2 local · 1 remote-tracking")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    expect(screen.getByText("Remote-tracking")).toBeInTheDocument();
    expect(screen.getByText("origin/feature/git-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh repository" }));
    expect(onRefreshRepository).toHaveBeenCalledOnce();
  });

  it("shows dirty summaries and attributes only successful direct edits in Git changes", () => {
    const activities: AgentEvent[] = [
      {
        type: "tool.call",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        callId: "write-app",
        name: "write",
        input: { path: "/workspace/project/src/app.ts" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        callId: "write-app",
        name: "write",
        ok: true,
        output: "done",
      },
      {
        type: "tool.call",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        callId: "failed-edit",
        name: "workspace.replaceText",
        input: { path: "src/theme.ts" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        callId: "failed-edit",
        name: "workspace.replaceText",
        ok: false,
        output: "failed",
      },
      {
        type: "tool.call",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        callId: "shell-edit",
        name: "bash",
        input: { command: "touch notes.txt", path: "notes.txt" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        callId: "shell-edit",
        name: "bash",
        ok: true,
        output: "",
      },
    ];
    renderPanel({ activities, repository: readyRepository });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1 staged")).toBeInTheDocument();
    expect(screen.getByText("1 modified")).toBeInTheDocument();
    expect(screen.getByText("1 untracked")).toBeInTheDocument();
    expect(screen.getByText("src/theme.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Last agent turn" }));
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/theme.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByText(/shell changes are not attributed/i)).toBeInTheDocument();
  });

  it("keeps the staged count visible when a dirty tree has no staged files", () => {
    renderPanel({
      repository: {
        ...readyRepository,
        changes: {
          ...readyRepository.changes,
          staged: 0,
        },
      },
    });

    expect(screen.getByText("0 staged")).toBeInTheDocument();
  });

  it("shows the direct-edit empty state when the last turn has no attributable writes", () => {
    renderPanel({ repository: readyRepository });

    fireEvent.click(screen.getByRole("button", { name: "Last agent turn" }));
    expect(screen.getByText("No direct file edits recorded")).toBeInTheDocument();
  });

  it("does not attribute edits from an earlier turn", () => {
    const activities: AgentEvent[] = [
      {
        type: "tool.call",
        sessionId: "sf_session_1",
        turnId: "sf_turn_previous",
        callId: "previous-write",
        name: "write",
        input: { path: "src/app.ts" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_1",
        turnId: "sf_turn_previous",
        callId: "previous-write",
        name: "write",
        ok: true,
        output: "done",
      },
    ];
    renderPanel({
      activities,
      repository: readyRepository,
      runtime: {
        turnId: "sf_turn_current",
        status: "completed",
        startedAt: "2026-08-07T00:00:00.000Z",
        endedAt: "2026-08-07T00:00:01.000Z",
        steps: 0,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Last agent turn" }));
    expect(screen.getByText("No direct file edits recorded")).toBeInTheDocument();
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
  });

  it("attributes workspace-relative edits when the workspace is inside the Git root", () => {
    const nestedRepository: typeof readyRepository = {
      ...readyRepository,
      rootPath: "/workspace",
      changes: {
        ...readyRepository.changes,
        total: 1,
        staged: 0,
        modified: 1,
        added: 0,
        untracked: 0,
        files: [{
          path: "apps/desktop/src/window.ts",
          originalPath: null,
          indexStatus: null,
          worktreeStatus: "modified",
          untracked: false,
          conflicted: false,
        }],
      },
    };
    const activities: AgentEvent[] = [
      {
        type: "tool.call",
        sessionId: "sf_session_1",
        turnId: "sf_turn_nested",
        callId: "nested-edit",
        name: "workspace.replaceText",
        input: { path: "src/window.ts" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_1",
        turnId: "sf_turn_nested",
        callId: "nested-edit",
        name: "workspace.replaceText",
        ok: true,
        output: "done",
      },
    ];
    renderPanel({
      activities,
      repository: nestedRepository,
      workspacePath: "/workspace/apps/desktop",
    });

    fireEvent.click(screen.getByRole("button", { name: "Last agent turn" }));
    expect(screen.getByText("apps/desktop/src/window.ts")).toBeInTheDocument();
  });

  it("supports detached HEAD, non-repository, unavailable, and loading states", () => {
    const detached: Extract<GitRepositoryView, { status: "ready" }> = {
      ...readyRepository,
      head: {
        branch: null,
        commit: "1234567890abcdef",
        detached: true,
        unborn: false,
      },
    };
    const view = renderPanel({ repository: detached });
    expect(screen.getByText("Detached at 12345678")).toBeInTheDocument();

    view.rerender(panel({
      repository: {
        status: "not-repository",
        workspaceId: "workspace-1",
        checkedAt: 1_786_057_200,
      },
    }));
    expect(screen.getByText("Not a Git repository")).toBeInTheDocument();

    view.rerender(panel({
      repository: {
        status: "unavailable",
        workspaceId: "workspace-1",
        checkedAt: 1_786_057_200,
        message: "Git executable was not found",
      },
    }));
    expect(screen.getByText("Repository unavailable")).toBeInTheDocument();
    expect(screen.getByText("Git executable was not found")).toBeInTheDocument();

    view.rerender(panel({ repository: undefined, repositoryLoading: true }));
    expect(screen.getByText("Loading repository…")).toBeInTheDocument();
    expect(screen.getByText("Loading changes…")).toBeInTheDocument();
  });
});

describe("RunContextPanel run and model context", () => {
  it("keeps the compact run, context, model, and inspector controls", () => {
    const onOpenInspector = vi.fn();
    const activities: AgentEvent[] = [
      {
        type: "context.usage",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        usedTokens: 4_000,
        budgetTokens: 8_000,
        windowTokens: 16_000,
        source: "provider",
      },
      {
        type: "model.request",
        sessionId: "sf_session_1",
        turnId: "sf_turn_1",
        requestId: "request-1",
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Implement Git context" }],
        tools: [{ name: "read", description: "Read", parameters: {} }],
      },
    ];
    renderPanel({
      activities,
      developerMode: true,
      onOpenInspector,
      repository: readyRepository,
      runtime: {
        turnId: "sf_turn_1",
        status: "completed",
        startedAt: "2026-08-07T00:00:00.000Z",
        endedAt: "2026-08-07T00:01:05.000Z",
        steps: 4,
      },
    });

    const runCard = screen.getByText("Run").closest("div.rounded-\\[10px\\]");
    expect(runCard).not.toBeNull();
    expect(within(runCard as HTMLElement).getByText("Turn completed")).toBeInTheDocument();
    expect(within(runCard as HTMLElement).getByText("01:05")).toBeInTheDocument();
    expect(within(runCard as HTMLElement).getByText("4 steps")).toBeInTheDocument();
    expect(within(runCard as HTMLElement).getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-pro")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Inspector" }));
    expect(onOpenInspector).toHaveBeenCalledOnce();
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Guardrails")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent files")).not.toBeInTheDocument();
    expect(screen.queryByText("PI Agent Runtime")).not.toBeInTheDocument();
  });

  it("keeps Inspector disabled outside developer mode", () => {
    renderPanel({ developerMode: false, repository: readyRepository });

    expect(screen.getByRole("button", { name: "Inspector" })).toBeDisabled();
  });

  it("clears stale context usage after compaction until PI reports a new value", () => {
    renderPanel({
      activities: [
        {
          type: "context.usage",
          sessionId: "sf_session_1",
          turnId: "sf_turn_1",
          usedTokens: 7_000,
          budgetTokens: 8_000,
          windowTokens: 8_000,
          source: "estimate",
        },
        {
          type: "context.compacted",
          sessionId: "sf_session_1",
          turnId: "sf_turn_1",
          trigger: "auto",
        },
      ],
      repository: readyRepository,
    });

    const row = screen.getByText("Context").parentElement;
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("—")).toBeInTheDocument();
  });

  it("does not leak context or inspector data from an earlier turn", () => {
    renderPanel({
      activities: [
        {
          type: "context.usage",
          sessionId: "sf_session_1",
          turnId: "sf_turn_previous",
          usedTokens: 7_000,
          budgetTokens: 8_000,
          windowTokens: 8_000,
          source: "estimate",
        },
        {
          type: "model.request",
          sessionId: "sf_session_1",
          turnId: "sf_turn_previous",
          requestId: "request-previous",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "Previous turn" }],
          tools: [{ name: "read", description: "Read", parameters: {} }],
        },
        {
          type: "runtime.started",
          sessionId: "sf_session_1",
          turnId: "sf_turn_current",
          createdAt: "2026-08-07T00:01:00.000Z",
        },
      ],
      developerMode: true,
      repository: readyRepository,
      runtime: {
        turnId: "sf_turn_current",
        status: "running",
        startedAt: "2026-08-07T00:01:00.000Z",
        steps: 0,
      },
    });

    const contextRow = screen.getByText("Context").parentElement;
    expect(contextRow).not.toBeNull();
    expect(within(contextRow as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(screen.getByText('{ role: "assistant", tools: 0, messages: 0 }')).toBeInTheDocument();
    expect(screen.queryByText("88%")).not.toBeInTheDocument();
  });
});

function renderPanel(overrides: Partial<ComponentProps<typeof RunContextPanel>> = {}) {
  return render(panel(overrides));
}

function panel(overrides: Partial<ComponentProps<typeof RunContextPanel>> = {}) {
  const props: ComponentProps<typeof RunContextPanel> = {
    session,
    provider,
    runtime: undefined,
    activities: [],
    developerMode: false,
    workspacePath: "/workspace/project",
    repository: undefined,
    repositoryLoading: false,
    onCollapse: () => {},
    onOpenInspector: () => {},
    onRefreshRepository: () => {},
    ...overrides,
  };
  return <RunContextPanel {...props} />;
}
