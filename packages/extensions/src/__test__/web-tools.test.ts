import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../tool-definition";
import { createWebTools } from "../web/web-tools";

describe("createWebTools", () => {
  it("exposes provider-safe web_search and web_fetch schemas", () => {
    const tools = createWebTools({
      enabled: true,
      coverage: "focused",
      credentials: { tavilyApiKey: "tvly" },
      fetch: vi.fn(),
    });

    expect(toSchemas(tools).map((schema) => schema.name)).toEqual(["web_search", "web_fetch"]);
  });

  it("runs focused search with Tavily only", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        query: "agent",
        results: [{ title: "Agent", url: "https://example.com", content: "Result" }],
        request_id: "tvly-1",
      }), { status: 200 })
    );
    const tools = createWebTools({
      enabled: true,
      coverage: "focused",
      credentials: { tavilyApiKey: "tvly" },
      fetch,
      now: () => new Date("2026-08-03T06:07:08.000Z"),
    });

    const result = await executeTool(tools, "web_search", { query: "agent" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toMatchObject({
      query: "agent",
      coverage: "focused",
      retrievedAt: "2026-08-03T06:07:08.000Z",
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
    const tools = createWebTools({
      enabled: true,
      coverage: "wide",
      credentials: { tavilyApiKey: "tvly", serpApiKey: "serp" },
      fetch,
    });

    const result = await executeTool(tools, "web_search", { query: "agent" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toMatchObject({
      coverage: "wide",
      results: [expect.objectContaining({
        url: "https://example.com/page",
        providers: ["tavily", "serpapi"],
      })],
    });
  });

  it("uses Tavily extract for web_fetch and blocks unsafe URLs", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        results: [{ url: "https://example.com", raw_content: "hello" }],
        request_id: "extract-1",
      }), { status: 200 })
    );
    const tools = createWebTools({
      enabled: true,
      coverage: "focused",
      credentials: { tavilyApiKey: "tvly" },
      fetch,
      now: () => new Date("2026-08-03T06:07:08.000Z"),
    });

    await expect(executeTool(tools, "web_fetch", { url: "http://localhost:3000" }))
      .resolves.toMatchObject({ ok: false });
    await expect(executeTool(tools, "web_fetch", { url: "https://example.com" }))
      .resolves.toMatchObject({
        ok: true,
        output: { retrievedAt: "2026-08-03T06:07:08.000Z" },
      });
  });
});

function toSchemas(tools: ToolDefinition[]) {
  return tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

async function executeTool(
  tools: ToolDefinition[],
  name: string,
  input: Record<string, unknown>,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return { ok: false, error: `Tool not found: ${name}` };
  }
  try {
    return { ok: true, output: await tool.execute(input, {}) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
