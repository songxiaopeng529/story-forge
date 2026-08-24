import { describe, expect, it, vi } from "vitest";
import { SOUL_MAX_BYTES } from "@story-forge/shared";
import { createSoulUpdateTool } from "../soul/soul-tool";

describe("createSoulUpdateTool", () => {
  it("forwards a concise complete-document proposal", async () => {
    const propose = vi.fn(async () => ({
      approved: false,
      message: "Declined",
    }));
    const tool = createSoulUpdateTool({ propose });

    await expect(tool.execute({
      content: "# Soul\n\n- Prefers concise answers.\n",
      reason: "Remember the user's response preference.",
    }, {})).resolves.toEqual({ approved: false, message: "Declined" });
    expect(propose).toHaveBeenCalledWith({
      content: "# Soul\n\n- Prefers concise answers.\n",
      reason: "Remember the user's response preference.",
    }, {});
  });

  it("rejects empty and oversized proposals", async () => {
    const tool = createSoulUpdateTool({
      propose: vi.fn(async () => ({ approved: true, message: "Saved" })),
    });

    await expect(tool.execute({ content: "", reason: "Reason" }, {}))
      .rejects.toThrow("non-empty string content");
    await expect(tool.execute({
      content: "x".repeat(SOUL_MAX_BYTES + 1),
      reason: "Reason",
    }, {})).rejects.toThrow("must not exceed");
  });
});
