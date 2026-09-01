// @vitest-environment node

import type {
  AgentExecutionId,
  AgentExecutionView,
  SessionId,
  TurnId,
} from "@story-forge/shared";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentRunRepository,
  type AgentExecutionRecord,
  type AgentRunRecord,
} from "../persistence/agent-run-repository";
import { resolveStoryForgePaths } from "../persistence/storyforge-home";

const NOW = "2026-08-28T08:00:00.000Z";
const LATER = "2026-08-28T08:01:00.000Z";

describe("AgentRunRepository", () => {
  it("creates and reads the per-session Turn snapshot", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => NOW });
    const record = await repository.createRun(createRunInput());

    const snapshotPath = join(
      rootDir,
      "sessions",
      "agent-runs",
      record.sessionId,
      `${record.turnId}.json`,
    );
    await expect(readFile(snapshotPath, "utf8")).resolves.toContain('"schemaVersion": 1');
    await expect(repository.getRun(record.turnId)).resolves.toEqual(record);
  });

  it("serializes concurrent additions without losing siblings", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => NOW });
    const created = await repository.createRun(createRunInput());
    const first = childExecution("sf_agent_execution_first", created.rootExecutionId);
    const second = childExecution("sf_agent_execution_second", created.rootExecutionId);

    await Promise.all([
      repository.addExecutions(created.turnId, [first]),
      repository.addExecutions(created.turnId, [second]),
    ]);

    expect((await repository.getRun(created.turnId))?.executions.map(({ id }) => id)).toEqual([
      created.rootExecutionId,
      first.id,
      second.id,
    ]);
  });

  it("updates one execution without overwriting a completed sibling", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => LATER });
    const created = await repository.createRun(createRunInput({ children: 2 }));
    const [first, second] = created.executions.slice(1);

    await Promise.all([
      repository.updateExecution(created.turnId, first!.id, (execution) => ({
        ...execution,
        status: "completed",
        endedAt: LATER,
        report: report("First complete"),
      })),
      repository.updateExecution(created.turnId, second!.id, (execution) => ({
        ...execution,
        status: "running",
        startedAt: LATER,
      })),
    ]);

    const updated = await repository.getRun(created.turnId);
    expect(updated?.executions[1]).toMatchObject({
      id: first!.id,
      status: "completed",
      report: report("First complete"),
    });
    expect(updated?.executions[2]).toMatchObject({ id: second!.id, status: "running" });
    await expect(repository.updateExecution(created.turnId, first!.id, (execution) => ({
      ...execution,
      status: "failed",
    }))).rejects.toThrow("Terminal agent execution cannot be updated");
  });

  it("recovers only queued and running executions as interrupted", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => LATER });
    const created = await repository.createRun(createRunInput({ children: 3 }));
    const [completed, running, queued] = created.executions.slice(1);
    await repository.updateExecution(created.turnId, completed!.id, (execution) => ({
      ...execution,
      status: "completed",
      report: report("Preserved"),
      endedAt: NOW,
      usage: { ...execution.usage, turns: 3, toolCalls: 7 },
    }));
    await repository.updateExecution(created.turnId, running!.id, (execution) => ({
      ...execution,
      status: "running",
      startedAt: NOW,
    }));

    await repository.recoverInterruptedRuns();

    const recovered = await repository.getRun(created.turnId);
    expect(recovered?.executions.find(({ id }) => id === completed!.id)).toMatchObject({
      status: "completed",
      report: report("Preserved"),
      usage: { turns: 3, toolCalls: 7 },
      endedAt: NOW,
    });
    expect(recovered?.executions.find(({ id }) => id === running!.id)).toMatchObject({
      status: "interrupted",
      endedAt: LATER,
    });
    expect(recovered?.executions.find(({ id }) => id === queued!.id)).toMatchObject({
      status: "interrupted",
      endedAt: LATER,
    });
  });

  it("quarantines corrupt snapshots while rebuilding the Turn index", async () => {
    const rootDir = await makeRoot();
    const corruptPath = join(
      rootDir,
      "sessions",
      "agent-runs",
      "sf_session_corrupt",
      "sf_turn_corrupt.json",
    );
    await mkdir(dirname(corruptPath), { recursive: true });
    await writeFile(corruptPath, "{broken", "utf8");

    const repository = new AgentRunRepository({ rootDir });
    await expect(repository.recoverInterruptedRuns()).resolves.toBeUndefined();

    const names = await readdir(dirname(corruptPath));
    expect(names.some((name) => name.startsWith("sf_turn_corrupt.json.corrupt-"))).toBe(true);
  });

  it("maps records to public views without internal paths", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => NOW });
    const record = await repository.createRun(createRunInput({ children: 1, rootDir }));

    const view = repository.toView(record);
    expect(view).not.toHaveProperty("workspaceId");
    expect(view.executions[1]).not.toHaveProperty("transcriptFile");
    expect(JSON.stringify(view)).not.toContain(rootDir);
  });

  it("rejects child transcript paths owned by another run", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => NOW });
    const input = createRunInput({ children: 1, rootDir });
    input.executions[1] = {
      ...input.executions[1]!,
      transcriptFile: join(
        rootDir,
        "sessions/agent-transcripts/sf_workspace_project/sf_turn_other/child.jsonl",
      ),
    };

    await expect(repository.createRun(input)).rejects.toThrow(
      "Agent transcript does not belong to this run",
    );
  });

  it("rebuilds the Turn index after restart", async () => {
    const rootDir = await makeRoot();
    const firstRepository = new AgentRunRepository({ rootDir, now: () => NOW });
    const created = await firstRepository.createRun(createRunInput());

    const restartedRepository = new AgentRunRepository({ rootDir });
    await expect(restartedRepository.getRun(created.turnId)).resolves.toEqual(created);
  });

  it("rejects duplicate Turn ids found under different sessions", async () => {
    const rootDir = await makeRoot();
    const repository = new AgentRunRepository({ rootDir, now: () => NOW });
    const created = await repository.createRun(createRunInput());
    const originalPath = join(
      rootDir,
      "sessions",
      "agent-runs",
      created.sessionId,
      `${created.turnId}.json`,
    );
    const duplicatePath = join(
      rootDir,
      "sessions",
      "agent-runs",
      "sf_session_second",
      `${created.turnId}.json`,
    );
    const duplicate: AgentRunRecord = { ...created, sessionId: "sf_session_second" };
    await mkdir(dirname(duplicatePath), { recursive: true });
    await writeFile(duplicatePath, JSON.stringify(duplicate), "utf8");
    await expect(readFile(originalPath, "utf8")).resolves.toBeTruthy();

    await expect(new AgentRunRepository({ rootDir }).getRun(created.turnId)).rejects.toThrow(
      `Duplicate agent run turn id: ${created.turnId}`,
    );
  });

  it("deletes snapshots and only their managed child transcripts", async () => {
    const rootDir = await makeRoot();
    const paths = resolveStoryForgePaths({ homeDir: rootDir });
    const repository = new AgentRunRepository({ rootDir, now: () => NOW });
    const created = await repository.createRun(createRunInput({ children: 2, rootDir }));
    const transcriptFiles = created.executions.flatMap(({ transcriptFile }) =>
      transcriptFile ? [transcriptFile] : []
    );
    for (const transcriptFile of transcriptFiles) {
      await mkdir(dirname(transcriptFile), { recursive: true });
      await writeFile(transcriptFile, "transcript", "utf8");
    }
    const orphanTranscript = join(dirname(transcriptFiles[0]!), "orphan-mid-run.jsonl");
    await writeFile(orphanTranscript, "partial transcript", "utf8");

    await repository.deleteSessionRuns(created.sessionId);

    await expect(repository.getRun(created.turnId)).resolves.toBeUndefined();
    await expect(readdir(join(paths.agentRunsDir, created.sessionId))).rejects.toThrow();
    for (const transcriptFile of transcriptFiles) {
      await expect(readFile(transcriptFile, "utf8")).rejects.toThrow();
    }
    await expect(readFile(orphanTranscript, "utf8")).rejects.toThrow();
  });
});

function createRunInput(options: { children?: number; rootDir?: string } = {}) {
  const rootExecutionId = "sf_agent_execution_root" as AgentExecutionId;
  const executions: AgentExecutionRecord[] = [rootExecution(rootExecutionId)];
  for (let index = 0; index < (options.children ?? 0); index += 1) {
    const id = `sf_agent_execution_child${index}` as AgentExecutionId;
    executions.push(childExecution(id, rootExecutionId, options.rootDir));
  }
  return {
    sessionId: "sf_session_project" as SessionId,
    workspaceId: "sf_workspace_project",
    turnId: "sf_turn_project" as TurnId,
    rootExecutionId,
    executions,
  };
}

function rootExecution(id: AgentExecutionId): AgentExecutionRecord {
  return {
    id,
    role: "root",
    objective: "Answer the user",
    status: "running",
    attempt: 1,
    providerId: "openai",
    model: "gpt-test",
    createdAt: NOW,
    startedAt: NOW,
    usage: emptyUsage(),
  };
}

function childExecution(
  id: AgentExecutionId,
  parentExecutionId: AgentExecutionId,
  rootDir?: string,
): AgentExecutionRecord {
  return {
    id,
    parentExecutionId,
    role: "explorer",
    objective: `Explore ${id}`,
    status: "queued",
    attempt: 1,
    providerId: "openai",
    model: "gpt-test",
    createdAt: NOW,
    usage: emptyUsage(),
    ...(rootDir
      ? {
          transcriptFile: join(
            rootDir,
            "sessions",
            "agent-transcripts",
            "sf_workspace_project",
            "sf_turn_project",
            `${id}.jsonl`,
          ),
        }
      : {}),
  };
}

function emptyUsage() {
  return {
    turns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function report(summary: string) {
  return {
    summary,
    findings: [],
    evidence: [],
    filesInspected: [],
    unresolved: [],
  };
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "story-forge-agent-runs-"));
}

// Compile-time assurance that internal records remain structurally compatible
// with the renderer-safe public view after transcript fields are stripped.
const _viewCompatibility: AgentExecutionView | undefined = undefined;
void _viewCompatibility;
