import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "./in-memory-memory-store";

describe("InMemoryMemoryStore", () => {
  it("stores and queries memories by scope and text match", async () => {
    const store = new InMemoryMemoryStore();
    await store.write({ scope: "project", key: "style", value: "Use pnpm for StoryForge." });
    await store.write({ scope: "user", key: "style", value: "Use yarn elsewhere." });

    const results = await store.query({ scope: "project", query: "PNPM" });

    expect(results).toEqual([{ scope: "project", key: "style", value: "Use pnpm for StoryForge." }]);
  });
});
