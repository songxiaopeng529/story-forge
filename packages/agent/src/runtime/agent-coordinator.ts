import {
  createAgentEventId,
  createAgentExecutionId,
  createEmptyAgentExecutionUsage,
  formatError,
  type AgentEvent,
  type AgentExecutionId,
  type AgentRunView,
  type DelegateResult,
  type DelegateTaskInput,
  type DelegateTaskResult,
  type ExtensionUiResponse,
  type HumanInputResponse,
  type ImageAttachmentView,
  type SessionId,
  type TurnId,
  type UnsequencedAgentEvent,
} from "@story-forge/shared";
import {
  AgentRunRepository,
  type AgentExecutionRecord,
} from "../persistence/agent-run-repository";
import type { SessionRepository } from "../persistence/session-repository";
import {
  PiAgentWorker,
  type PiAgentWorkerEvent,
  type PiAgentWorkerResult,
} from "./pi-agent-worker";
import {
  RunAdmissionController,
  type ChildAdmissionLease,
} from "./run-admission-controller";
import {
  StoryForgeAgentHarness,
  type RootDelegateRequest,
  type StoryForgeAgentHarnessOptions,
  type TurnModelResolved,
} from "./storyforge-agent-harness";
import type { TurnOutcome } from "./turn-outcome";

type ActiveTeamRun = {
  sessionId: SessionId;
  workspaceId: string;
  turnId: TurnId;
  rootExecutionId: AgentExecutionId;
  providerId: string;
  model: string;
  sequence: number;
  eventTail: Promise<void>;
  childControllers: Map<AgentExecutionId, AbortController>;
  childPromises: Set<Promise<DelegateTaskResult>>;
  activeChildExecutions: Set<AgentExecutionId>;
  rootCapacityReleased: boolean;
  rootTerminal: boolean;
};

export type AgentCoordinatorOptions = Omit<
  StoryForgeAgentHarnessOptions,
  "emit" | "delegate" | "onTurnModelResolved"
> & {
  agentRunRepository: AgentRunRepository;
  childWorker?: PiAgentWorker;
  admissionController?: RunAdmissionController;
  emit: (event: AgentEvent) => void;
};

export class AgentCoordinator {
  private readonly sessionRepository: SessionRepository;
  private readonly agentRuns: AgentRunRepository;
  private readonly childWorker: PiAgentWorker;
  private readonly admission: RunAdmissionController;
  private readonly harness: StoryForgeAgentHarness;
  private readonly emitEvent: (event: AgentEvent) => void;
  private readonly now: () => Date;
  private readonly activeRuns = new Map<TurnId, ActiveTeamRun>();
  private readonly pendingRootEvents = new Map<TurnId, UnsequencedAgentEvent[]>();
  private readonly pendingModels = new Map<TurnId, TurnModelResolved>();

  constructor(options: AgentCoordinatorOptions) {
    const {
      agentRunRepository,
      childWorker,
      admissionController,
      emit,
      ...harnessOptions
    } = options;
    this.sessionRepository = options.sessionRepository;
    this.agentRuns = agentRunRepository;
    this.admission = admissionController ?? new RunAdmissionController();
    this.emitEvent = emit;
    this.now = options.now ?? (() => new Date());
    this.childWorker = childWorker ?? new PiAgentWorker({
      workspaceRepository: options.workspaceRepository,
      piModels: options.piModels,
      piSessions: options.piSessions,
      ...(options.createAgentSession
        ? { createAgentSession: options.createAgentSession }
        : {}),
      ...(options.getWebAccessEnabled
        ? { getWebAccessEnabled: options.getWebAccessEnabled }
        : {}),
      ...(options.getWebSearchCoverage
        ? { getWebSearchCoverage: options.getWebSearchCoverage }
        : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.getTimezone ? { getTimezone: options.getTimezone } : {}),
    });
    this.harness = new StoryForgeAgentHarness({
      ...harnessOptions,
      emit: (event) => this.receiveRootEvent(event),
      delegate: (request) => this.delegate(request),
      onTurnModelResolved: (selection) => this.captureRootModel(selection),
    });
  }

  async start(input: {
    sessionId: SessionId;
    prompt: string;
    imageAttachments?: ImageAttachmentView[];
  }): Promise<{ turnId: TurnId }> {
    this.admission.observeRootStarted();
    let turnId: TurnId | undefined;
    try {
      const started = await this.harness.start(input);
      turnId = started.turnId;
      await this.initializeRootRun({
        sessionId: input.sessionId,
        turnId,
        objective: input.prompt.trim() || "Handle the user's attached context",
      });
      return started;
    } catch (error) {
      if (turnId) {
        await this.harness.stop(turnId).catch(() => undefined);
      }
      this.admission.observeRootSettled();
      throw error;
    }
  }

  async startAutomationRun(input: {
    workspaceId: string;
    providerId: string;
    model: string;
    prompt: string;
    title?: string;
  }): Promise<{ sessionId: SessionId; turnId: TurnId }> {
    this.admission.observeRootStarted();
    let started: { sessionId: SessionId; turnId: TurnId } | undefined;
    try {
      started = await this.harness.startAutomationRun(input);
      await this.initializeRootRun({
        sessionId: started.sessionId,
        turnId: started.turnId,
        objective: input.prompt,
      });
      return started;
    } catch (error) {
      if (started) {
        await this.harness.stop(started.turnId).catch(() => undefined);
      }
      this.admission.observeRootSettled();
      throw error;
    }
  }

  async stop(turnId: TurnId): Promise<void> {
    const run = this.activeRuns.get(turnId);
    if (run) {
      for (const controller of run.childControllers.values()) {
        controller.abort(new Error("Root turn stopped"));
      }
    }
    const rootStop = this.harness.stop(turnId);
    if (run) {
      await Promise.allSettled([...run.childPromises]);
    }
    await rootStop;
  }

  async waitForTurn(turnId: TurnId): Promise<TurnOutcome> {
    const outcome = await this.harness.waitForTurn(turnId);
    const run = this.activeRuns.get(turnId);
    if (run) {
      await run.eventTail;
    }
    return outcome;
  }

  async compactSession(sessionId: SessionId): Promise<void> {
    this.admission.observeRootStarted();
    try {
      const { turnId } = await this.harness.compactSession(sessionId);
      await this.initializeRootRun({
        sessionId,
        turnId,
        objective: "Compact the root session context",
        completed: true,
      });
      const run = this.activeRuns.get(turnId);
      if (run) {
        await run.eventTail;
        this.releaseRootCapacity(run);
      }
    } catch (error) {
      this.admission.observeRootSettled();
      throw error;
    }
  }

  respondToPermission(input: { requestId: string; approved: boolean }): void {
    this.harness.respondToPermission(input);
  }

  respondToExtensionUi(input: ExtensionUiResponse): void {
    this.harness.respondToExtensionUi(input);
  }

  respondToHumanInput(input: HumanInputResponse): void {
    this.harness.respondToHumanInput(input);
  }

  async getAgentRun(turnId: TurnId): Promise<AgentRunView | undefined> {
    const record = await this.agentRuns.getRun(turnId);
    return record ? this.agentRuns.toView(record) : undefined;
  }

  private async initializeRootRun(input: {
    sessionId: SessionId;
    turnId: TurnId;
    objective: string;
    completed?: boolean;
  }): Promise<void> {
    const session = await this.sessionRepository.get(input.sessionId);
    const rootExecutionId = createAgentExecutionId();
    const timestamp = this.now().toISOString();
    const pendingModel = this.pendingModels.get(input.turnId);
    const providerId = pendingModel?.providerId ?? session.providerId;
    const model = pendingModel?.model ?? session.model;
    const rootExecution: AgentExecutionRecord = {
      id: rootExecutionId,
      role: "root",
      objective: input.objective.slice(0, 4_000),
      status: input.completed ? "completed" : "running",
      attempt: 1,
      providerId,
      model,
      createdAt: timestamp,
      startedAt: timestamp,
      ...(input.completed ? { endedAt: timestamp } : {}),
      usage: createEmptyAgentExecutionUsage(),
    };
    await this.agentRuns.createRun({
      sessionId: input.sessionId,
      workspaceId: session.workspaceId,
      turnId: input.turnId,
      rootExecutionId,
      executions: [rootExecution],
      createdAt: timestamp,
    });
    const run: ActiveTeamRun = {
      sessionId: input.sessionId,
      workspaceId: session.workspaceId,
      turnId: input.turnId,
      rootExecutionId,
      providerId,
      model,
      sequence: 0,
      eventTail: Promise.resolve(),
      childControllers: new Map(),
      childPromises: new Set(),
      activeChildExecutions: new Set(),
      rootCapacityReleased: false,
      rootTerminal: false,
    };
    this.activeRuns.set(input.turnId, run);
    this.pendingModels.delete(input.turnId);
    const buffered = this.pendingRootEvents.get(input.turnId) ?? [];
    this.pendingRootEvents.delete(input.turnId);
    for (const event of buffered) {
      this.queueRootEvent(run, event);
    }
    if (input.completed) {
      run.rootTerminal = true;
    }
  }

  private receiveRootEvent(event: UnsequencedAgentEvent): void {
    const run = this.activeRuns.get(event.turnId);
    if (!run) {
      const buffered = this.pendingRootEvents.get(event.turnId) ?? [];
      buffered.push(event);
      this.pendingRootEvents.set(event.turnId, buffered);
      return;
    }
    this.queueRootEvent(run, event);
  }

  private queueRootEvent(run: ActiveTeamRun, event: UnsequencedAgentEvent): void {
    if (run.rootTerminal) {
      return;
    }
    const terminal = event.type === "runtime.completed" || event.type === "runtime.error";
    if (terminal) {
      run.rootTerminal = true;
    }
    this.enqueue(run, async () => {
      try {
        if (terminal) {
          const status = event.type === "runtime.error"
            ? "failed"
            : event.stopReason === "completed" || event.stopReason === undefined
              ? "completed"
              : "cancelled";
          await this.agentRuns.updateExecution(
            run.turnId,
            run.rootExecutionId,
            (execution) => ({
              ...execution,
              status,
              endedAt: this.now().toISOString(),
              ...(event.type === "runtime.error" ? { error: event.message } : {}),
            }),
          );
        }
        await this.emitAttributed(run, event, run.rootExecutionId);
      } finally {
        if (terminal) {
          this.releaseRootCapacity(run);
        }
      }
    });
  }

  private captureRootModel(selection: TurnModelResolved): void {
    const run = this.activeRuns.get(selection.turnId);
    if (!run) {
      this.pendingModels.set(selection.turnId, selection);
      return;
    }
    if (run.rootTerminal) {
      return;
    }
    run.providerId = selection.providerId;
    run.model = selection.model;
    this.enqueue(run, async () => {
      await this.agentRuns.updateExecution(
        run.turnId,
        run.rootExecutionId,
        (execution) => ({
          ...execution,
          providerId: selection.providerId,
          model: selection.model,
        }),
      );
    });
  }

  private async delegate(request: RootDelegateRequest): Promise<DelegateResult> {
    const run = this.activeRuns.get(request.turnId);
    if (!run || run.sessionId !== request.sessionId || run.rootTerminal) {
      throw new Error(`Root run is not active: ${request.turnId}`);
    }
    const timestamp = this.now().toISOString();
    const records = request.input.tasks.map((task) => ({
      id: createAgentExecutionId(),
      parentExecutionId: run.rootExecutionId,
      role: task.role,
      objective: task.objective,
      status: "queued" as const,
      attempt: 1,
      providerId: run.providerId,
      model: run.model,
      createdAt: timestamp,
      usage: createEmptyAgentExecutionUsage(),
    } satisfies AgentExecutionRecord));
    await this.agentRuns.addExecutions(run.turnId, records);
    for (const record of records) {
      await this.enqueueAndWait(run, () => this.emitAttributed(
        run,
        {
          type: "agent.execution.queued",
          sessionId: run.sessionId,
          turnId: run.turnId,
          role: record.role as "explorer" | "reviewer",
          objective: record.objective,
        },
        record.id,
        run.rootExecutionId,
      ));
    }

    const promises = records.map((record, index) => {
      const task = request.input.tasks[index]!;
      const promise = this.runChild({ run, record, task, signal: request.signal });
      run.childPromises.add(promise);
      void promise.then(
        () => run.childPromises.delete(promise),
        () => run.childPromises.delete(promise),
      );
      return promise;
    });
    const settled = await Promise.allSettled(promises);
    const results = settled.map((result, index): DelegateTaskResult => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const record = records[index]!;
      return {
        executionId: record.id,
        role: record.role as "explorer" | "reviewer",
        status: request.signal.aborted ? "cancelled" : "failed",
        error: formatError(result.reason),
        usage: createEmptyAgentExecutionUsage(),
        truncated: false,
      };
    });
    return {
      status: aggregateStatus(results),
      results,
    };
  }

  private async runChild(input: {
    run: ActiveTeamRun;
    record: AgentExecutionRecord;
    task: DelegateTaskInput;
    signal: AbortSignal;
  }): Promise<DelegateTaskResult> {
    const { run, record, task } = input;
    const controller = new AbortController();
    const onRootAbort = () => controller.abort(input.signal.reason);
    input.signal.addEventListener("abort", onRootAbort, { once: true });
    if (input.signal.aborted) {
      controller.abort(input.signal.reason);
    }
    run.childControllers.set(record.id, controller);
    let lease: ChildAdmissionLease | undefined;
    try {
      try {
        lease = await this.admission.acquire({ turnId: run.turnId, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          return this.finishCancelledChild(run, record);
        }
        throw error;
      }
      if (controller.signal.aborted) {
        return this.finishCancelledChild(run, record);
      }
      await this.agentRuns.updateExecution(run.turnId, record.id, (execution) => ({
        ...execution,
        status: "running",
        startedAt: this.now().toISOString(),
      }));
      run.activeChildExecutions.add(record.id);
      await this.enqueueAndWait(run, () => this.emitAttributed(
        run,
        { type: "agent.execution.started", sessionId: run.sessionId, turnId: run.turnId },
        record.id,
        run.rootExecutionId,
      ));

      const workerResult = await this.childWorker.run({
        sessionId: run.sessionId,
        workspaceId: run.workspaceId,
        turnId: run.turnId,
        executionId: record.id,
        role: task.role,
        task,
        providerId: run.providerId,
        model: run.model,
        signal: controller.signal,
        onTranscriptCreated: (transcriptFile) => this.agentRuns.updateExecution(
          run.turnId,
          record.id,
          (execution) => ({ ...execution, transcriptFile }),
        ).then(() => undefined),
        onEvent: (event) => this.queueChildActivity(run, record.id, event),
      });
      await run.eventTail;
      run.activeChildExecutions.delete(record.id);
      return this.finishChild(run, record, workerResult);
    } catch (error) {
      run.activeChildExecutions.delete(record.id);
      if (controller.signal.aborted) {
        return this.finishCancelledChild(run, record);
      }
      const failed: PiAgentWorkerResult = {
        status: "failed",
        error: formatError(error),
        usage: createEmptyAgentExecutionUsage(),
        truncated: false,
        transcriptFile: "",
      };
      return this.finishChild(run, record, failed);
    } finally {
      lease?.release();
      input.signal.removeEventListener("abort", onRootAbort);
      run.childControllers.delete(record.id);
      run.activeChildExecutions.delete(record.id);
    }
  }

  private async finishCancelledChild(
    run: ActiveTeamRun,
    record: AgentExecutionRecord,
  ): Promise<DelegateTaskResult> {
    return this.finishChild(run, record, {
      status: "cancelled",
      usage: createEmptyAgentExecutionUsage(),
      truncated: false,
      transcriptFile: "",
    });
  }

  private async finishChild(
    run: ActiveTeamRun,
    record: AgentExecutionRecord,
    result: PiAgentWorkerResult,
  ): Promise<DelegateTaskResult> {
    await this.agentRuns.updateExecution(run.turnId, record.id, (execution) => ({
      ...execution,
      status: result.status === "completed" && !result.report ? "failed" : result.status,
      endedAt: this.now().toISOString(),
      usage: result.usage,
      ...(result.report ? { report: result.report } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.truncated ? { truncated: true } : {}),
      ...(result.transcriptFile ? { transcriptFile: result.transcriptFile } : {}),
    }));
    if (result.status === "completed" && result.report) {
      await this.enqueueAndWait(run, () => this.emitAttributed(
        run,
        {
          type: "agent.execution.completed",
          sessionId: run.sessionId,
          turnId: run.turnId,
          usage: result.usage,
          report: result.report!,
          truncated: result.truncated,
        },
        record.id,
        run.rootExecutionId,
      ));
    } else if (result.status === "cancelled") {
      await this.enqueueAndWait(run, () => this.emitAttributed(
        run,
        { type: "agent.execution.cancelled", sessionId: run.sessionId, turnId: run.turnId },
        record.id,
        run.rootExecutionId,
      ));
    } else {
      await this.enqueueAndWait(run, () => this.emitAttributed(
        run,
        {
          type: "agent.execution.failed",
          sessionId: run.sessionId,
          turnId: run.turnId,
          usage: result.usage,
          error: result.error ?? "Child completed without a report",
        },
        record.id,
        run.rootExecutionId,
      ));
    }
    return {
      executionId: record.id,
      role: record.role as "explorer" | "reviewer",
      status: result.status === "completed" && !result.report ? "failed" : result.status,
      ...(result.report ? { report: result.report } : {}),
      ...(result.error ? { error: result.error } : {}),
      usage: result.usage,
      truncated: result.truncated,
    };
  }

  private queueChildActivity(
    run: ActiveTeamRun,
    executionId: AgentExecutionId,
    event: PiAgentWorkerEvent,
  ): void {
    if (!run.activeChildExecutions.has(executionId)) {
      return;
    }
    const raw = {
      ...event,
      sessionId: run.sessionId,
      turnId: run.turnId,
    } as UnsequencedAgentEvent;
    this.enqueue(run, () => this.emitAttributed(
      run,
      raw,
      executionId,
      run.rootExecutionId,
    ));
  }

  private async emitAttributed(
    run: ActiveTeamRun,
    event: UnsequencedAgentEvent,
    executionId: AgentExecutionId,
    parentExecutionId?: AgentExecutionId,
  ): Promise<void> {
    const sequence = ++run.sequence;
    await this.agentRuns.setSequence(run.turnId, sequence);
    const attributed = {
      ...event,
      eventId: createAgentEventId(),
      sequence,
      occurredAt: this.now().toISOString(),
      agentExecutionId: executionId,
      ...(parentExecutionId ? { parentAgentExecutionId: parentExecutionId } : {}),
    } as AgentEvent;
    this.emitEvent(attributed);
  }

  private enqueue(run: ActiveTeamRun, operation: () => Promise<void>): void {
    run.eventTail = recoverEventTail(run.eventTail).then(operation);
  }

  private enqueueAndWait(
    run: ActiveTeamRun,
    operation: () => Promise<void>,
  ): Promise<void> {
    const next = recoverEventTail(run.eventTail).then(operation);
    run.eventTail = next;
    return next;
  }

  private releaseRootCapacity(run: ActiveTeamRun): void {
    if (run.rootCapacityReleased) {
      return;
    }
    run.rootCapacityReleased = true;
    this.admission.observeRootSettled();
    const cleanup = setTimeout(() => {
      if (this.activeRuns.get(run.turnId) === run) {
        this.activeRuns.delete(run.turnId);
      }
    }, 60_000);
    cleanup.unref?.();
  }
}

function recoverEventTail(tail: Promise<void>): Promise<void> {
  return tail.catch((error) => {
    console.error("Agent run event persistence failed", error);
  });
}

function aggregateStatus(results: DelegateTaskResult[]): DelegateResult["status"] {
  if (results.every((result) => result.status === "completed")) {
    return "completed";
  }
  if (results.every((result) => result.status === "cancelled")) {
    return "cancelled";
  }
  if (results.some((result) => result.status === "completed")) {
    return "partial";
  }
  return "failed";
}
