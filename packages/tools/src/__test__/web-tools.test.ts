import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../tool-registry";
import { createWebTools } from "../web-tools";

describe("createWebTools", () => {
  it("exposes web.search and web.fetch schemas", () => {
    const registry = new ToolRegistry(createWebTools({
      enabled: true,
      coverage: "focused",
      credentials: { tavilyApiKey: "tvly" },
      fetch: vi.fn(),
    }));

    expect(registry.schemas().map((schema) => schema.name)).toEqual(["web.search", "web.fetch"]);
  });

  it("runs focused search with Tavily only", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        query: "agent",
        results: [{ title: "Agent", url: "https://example.com", content: "Result" }],
        request_id: "tvly-1",
      }), { status: 200 })
    );
    const registry = new ToolRegistry(createWebTools({
      enabled: true,
      coverage: "focused",
      credentials: { tavilyApiKey: "tvly" },
      fetch,
    }));

    const result = await registry.execute("web.search", { query: "agent" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toMatchObject({
      query: "agent",
      coverage: "focused",
      results: [expect.objectContaining({ providers: ["tavily"] })],
      warnings: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs wide search concurrently and deduplicates shared URLs", async () => {
    const fetch = vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.includes("tavily.com")) {
        return new Response(JSON.stringify({
          results: [{
            title: "Shared",
            url: "https://example.com/page#top",
            content: "Tavily",
          }],
          request_id: "tvly-1",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        organic_results: [{
          title: "Shared via Google",
          link: "https://example.com/page",
          snippet: "SerpApi",
        }],
        search_metadata: { id: "serp-1" },
      }), { status: 200 });
    });
    const registry = new ToolRegistry(createWebTools({
      enabled: true,
      coverage: "wide",
      credentials: { tavilyApiKey: "tvly", serpApiKey: "serp" },
      fetch,
    }));

    const result = await registry.execute("web.search", { query: "agent" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toMatchObject({
      coverage: "wide",
      results: [expect.objectContaining({
        url: "https://example.com/page",
        providers: ["tavily", "serpapi"],
      })],
    });
  });

  it("uses Tavily extract for web.fetch and blocks unsafe URLs", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        results: [{ url: "https://example.com", raw_content: "hello" }],
        request_id: "extract-1",
      }), { status: 200 })
    );
    const registry = new ToolRegistry(createWebTools({
      enabled: true,
      coverage: "focused",
      credentials: { tavilyApiKey: "tvly" },
      fetch,
    }));

    await expect(registry.execute("web.fetch", { url: "http://localhost:3000" }))
      .resolves.toMatchObject({ ok: false });
    await expect(registry.execute("web.fetch", { url: "https://example.com" }))
      .resolves.toMatchObject({ ok: true });
  });
});
