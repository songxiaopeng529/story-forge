import { describe, expect, it, vi } from "vitest";
import {
  extractTavily,
  searchSerpApi,
  searchTavily,
} from "../web-search-providers";

describe("web search providers", () => {
  it("normalizes Tavily search results", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        query: "story forge",
        results: [{
          title: "StoryForge",
          url: "https://example.com/story",
          content: "A coding agent.",
          score: 0.9,
          favicon: "https://example.com/favicon.ico",
        }],
        request_id: "tvly-1",
      }), { status: 200 })
    );

    const output = await searchTavily({
      apiKey: "tvly-secret",
      query: "story forge",
      maxResults: 5,
      fetch,
    });

    expect(fetch).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tvly-secret" }),
    }));
    expect(output.results[0]).toMatchObject({
      title: "StoryForge",
      url: "https://example.com/story",
      snippet: "A coding agent.",
      provider: "tavily",
      rank: 1,
      score: 0.9,
    });
    expect(output.requestId).toBe("tvly-1");
  });

  it("normalizes SerpApi organic results", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        organic_results: [{
          title: "StoryForge docs",
          link: "https://example.com/docs",
          snippet: "Documentation.",
        }],
        search_metadata: { id: "serp-1" },
      }), { status: 200 })
    );

    const output = await searchSerpApi({
      apiKey: "serp-secret",
      query: "story forge",
      maxResults: 5,
      fetch,
    });

    const calls = fetch.mock.calls as unknown as Array<[string | URL, RequestInit?]>;
    expect(String(calls[0]?.[0])).toContain("api_key=serp-secret");
    expect(output.results[0]).toMatchObject({
      title: "StoryForge docs",
      url: "https://example.com/docs",
      snippet: "Documentation.",
      provider: "serpapi",
      rank: 1,
    });
    expect(output.requestId).toBe("serp-1");
  });

  it("extracts and truncates Tavily content", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        results: [{ url: "https://example.com", raw_content: "abcdef" }],
        request_id: "extract-1",
      }), { status: 200 })
    );

    const output = await extractTavily({
      apiKey: "tvly-secret",
      url: "https://example.com",
      maxChars: 3,
      fetch,
    });

    expect(output.content).toBe("abc");
    expect(output.truncated).toBe(true);
    expect(output.requestId).toBe("extract-1");
  });
});
