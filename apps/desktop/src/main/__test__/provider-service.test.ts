// @vitest-environment node

import type { PiModelService, SessionRepository } from "@story-forge/agent";
import { describe, expect, it, vi } from "vitest";
import { ProviderService } from "../provider-service";

describe("ProviderService", () => {
  it("sets the normalized default before updating every existing session", async () => {
    const callOrder: string[] = [];
    const setDefault = vi.fn(async () => {
      callOrder.push("set-default");
    });
    const updateModelForAllSessions = vi.fn(async () => {
      callOrder.push("update-sessions");
    });
    const service = new ProviderService({
      piModels: { setDefault } as unknown as PiModelService,
      sessions: { updateModelForAllSessions } as unknown as SessionRepository,
    });

    await service.setDefault({
      providerId: "openai",
      model: "  gpt-5-test  ",
    });

    const expectedSelection = {
      providerId: "openai",
      model: "gpt-5-test",
    };
    expect(setDefault).toHaveBeenCalledWith(expectedSelection);
    expect(updateModelForAllSessions).toHaveBeenCalledWith(expectedSelection);
    expect(callOrder).toEqual(["set-default", "update-sessions"]);
  });

  it("does not update sessions when setting the default model fails", async () => {
    const failure = new Error("provider settings unavailable");
    const setDefault = vi.fn().mockRejectedValue(failure);
    const updateModelForAllSessions = vi.fn();
    const service = new ProviderService({
      piModels: { setDefault } as unknown as PiModelService,
      sessions: { updateModelForAllSessions } as unknown as SessionRepository,
    });

    await expect(service.setDefault({
      providerId: "openai",
      model: "gpt-5-test",
    })).rejects.toBe(failure);
    expect(updateModelForAllSessions).not.toHaveBeenCalled();
  });

  it("keeps the new default active when session metadata synchronization fails", async () => {
    const setDefault = vi.fn();
    const updateModelForAllSessions = vi.fn()
      .mockRejectedValue(new Error("session metadata is read-only"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new ProviderService({
      piModels: { setDefault } as unknown as PiModelService,
      sessions: { updateModelForAllSessions } as unknown as SessionRepository,
    });

    await expect(service.setDefault({
      providerId: "openai",
      model: "gpt-5-test",
    })).resolves.toBeUndefined();

    expect(setDefault).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
