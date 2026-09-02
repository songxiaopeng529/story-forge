import type { TurnId } from "@story-forge/shared";

export const MAX_CHILDREN_PER_TURN = 2;
export const MAX_GLOBAL_CHILDREN = 4;
export const MAX_GLOBAL_PI_SESSIONS = 4;

export type ChildAdmissionLease = {
  release(): void;
};

type Waiter = {
  id: number;
  turnId: TurnId;
  signal: AbortSignal;
  resolve(lease: ChildAdmissionLease): void;
  reject(error: Error): void;
  onAbort(): void;
};

/**
 * FIFO admission for child sessions. Root and Automation sessions are observed
 * but never queued; they reduce the capacity available to subsequently-started
 * children.
 */
export class RunAdmissionController {
  private readonly maxChildrenPerTurn: number;
  private readonly maxGlobalChildren: number;
  private readonly maxGlobalPiSessions: number;
  private readonly activeChildrenByTurn = new Map<TurnId, number>();
  private readonly waiters: Waiter[] = [];
  private activeChildren = 0;
  private activeRoots = 0;
  private nextWaiterId = 1;

  constructor(options: {
    maxChildrenPerTurn?: number;
    maxGlobalChildren?: number;
    maxGlobalPiSessions?: number;
  } = {}) {
    this.maxChildrenPerTurn = positiveInteger(
      options.maxChildrenPerTurn ?? MAX_CHILDREN_PER_TURN,
      "maxChildrenPerTurn",
    );
    this.maxGlobalChildren = positiveInteger(
      options.maxGlobalChildren ?? MAX_GLOBAL_CHILDREN,
      "maxGlobalChildren",
    );
    this.maxGlobalPiSessions = positiveInteger(
      options.maxGlobalPiSessions ?? MAX_GLOBAL_PI_SESSIONS,
      "maxGlobalPiSessions",
    );
  }

  observeRootStarted(): void {
    this.activeRoots += 1;
  }

  observeRootSettled(): void {
    this.activeRoots = Math.max(0, this.activeRoots - 1);
    this.drain();
  }

  acquire(input: {
    turnId: TurnId;
    signal: AbortSignal;
  }): Promise<ChildAdmissionLease> {
    if (input.signal.aborted) {
      return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        id: this.nextWaiterId++,
        turnId: input.turnId,
        signal: input.signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.waiters.findIndex((candidate) => candidate.id === waiter.id);
          if (index >= 0) {
            this.waiters.splice(index, 1);
            reject(abortError());
          }
        },
      };
      input.signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  snapshot(): {
    activeRoots: number;
    activeChildren: number;
    queuedChildren: number;
  } {
    return {
      activeRoots: this.activeRoots,
      activeChildren: this.activeChildren,
      queuedChildren: this.waiters.length,
    };
  }

  private drain(): void {
    let admitted = true;
    while (admitted && this.hasGlobalCapacity()) {
      admitted = false;
      const index = this.waiters.findIndex((waiter) =>
        !waiter.signal.aborted && this.hasTurnCapacity(waiter.turnId)
      );
      if (index < 0) {
        return;
      }
      const [waiter] = this.waiters.splice(index, 1);
      if (!waiter) {
        return;
      }
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      this.activeChildren += 1;
      this.activeChildrenByTurn.set(
        waiter.turnId,
        (this.activeChildrenByTurn.get(waiter.turnId) ?? 0) + 1,
      );
      let released = false;
      waiter.resolve({
        release: () => {
          if (released) {
            return;
          }
          released = true;
          this.activeChildren = Math.max(0, this.activeChildren - 1);
          const activeForTurn = Math.max(
            0,
            (this.activeChildrenByTurn.get(waiter.turnId) ?? 0) - 1,
          );
          if (activeForTurn === 0) {
            this.activeChildrenByTurn.delete(waiter.turnId);
          } else {
            this.activeChildrenByTurn.set(waiter.turnId, activeForTurn);
          }
          this.drain();
        },
      });
      admitted = true;
    }
  }

  private hasGlobalCapacity(): boolean {
    return this.activeChildren < this.maxGlobalChildren
      && this.activeRoots + this.activeChildren < this.maxGlobalPiSessions;
  }

  private hasTurnCapacity(turnId: TurnId): boolean {
    return (this.activeChildrenByTurn.get(turnId) ?? 0) < this.maxChildrenPerTurn;
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function abortError(): Error {
  const error = new Error("Child admission was cancelled");
  error.name = "AbortError";
  return error;
}
