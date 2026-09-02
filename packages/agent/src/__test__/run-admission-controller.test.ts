import { describe, expect, it } from "vitest";
import { RunAdmissionController } from "../runtime/run-admission-controller";

const firstTurn = "sf_turn_first" as const;
const secondTurn = "sf_turn_second" as const;

describe("RunAdmissionController", () => {
  it("enforces per-Turn and global child capacity while roots keep priority", async () => {
    const admission = new RunAdmissionController({
      maxChildrenPerTurn: 1,
      maxGlobalChildren: 2,
      maxGlobalPiSessions: 3,
    });
    admission.observeRootStarted();
    const first = await admission.acquire({
      turnId: firstTurn,
      signal: new AbortController().signal,
    });
    const queuedSameTurn = admission.acquire({
      turnId: firstTurn,
      signal: new AbortController().signal,
    });
    const second = await admission.acquire({
      turnId: secondTurn,
      signal: new AbortController().signal,
    });

    expect(admission.snapshot()).toEqual({
      activeRoots: 1,
      activeChildren: 2,
      queuedChildren: 1,
    });
    first.release();
    const admittedSameTurn = await queuedSameTurn;
    expect(admission.snapshot().activeChildren).toBe(2);

    second.release();
    admittedSameTurn.release();
    admission.observeRootSettled();
    expect(admission.snapshot()).toEqual({
      activeRoots: 0,
      activeChildren: 0,
      queuedChildren: 0,
    });
  });

  it("removes aborted queued children", async () => {
    const admission = new RunAdmissionController({ maxGlobalPiSessions: 1 });
    admission.observeRootStarted();
    const controller = new AbortController();
    const queued = admission.acquire({ turnId: firstTurn, signal: controller.signal });
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(admission.snapshot().queuedChildren).toBe(0);
  });
});
