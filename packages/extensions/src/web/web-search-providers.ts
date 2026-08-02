export type WebProviderName = "tavily" | "serpapi";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderSearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: WebProviderName;
  rank: number;
  score?: number;
  publishedAt?: string;
  favicon?: string;
};

export type ProviderSearchOutput = {
  provider: WebProviderName;
  results: ProviderSearchResult[];
  requestId?: string;
};

export type TavilyExtractOutput = {
  url: string;
  content: string;
  format: "markdown" | "text";
  truncated: boolean;
  byteCount: number;
  requestId?: string;
};

export type SearchProviderInput = {
  apiKey: string;
  query: string;
  maxResults?: number;
  topic?: "general" | "news" | "finance";
  timeRange?: "day" | "week" | "month" | "year";
  includeDomains?: string[];
  excludeDomains?: string[];
  fetch?: FetchLike;
};

export type ExtractProviderInput = {
  apiKey: string;
  url: string;
  query?: string;
  maxChars?: number;
  fetch?: FetchLike;
};

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const DEFAULT_MAX_RESULTS = 5;
const MAX_SEARCH_RESULTS = 10;
const DEFAULT_MAX_FETCH_CHARS = 20_000;
const MAX_FETCH_CHARS = 50_000;

export async function searchTavily(input: SearchProviderInput): Promise<ProviderSearchOutput> {
  const response = await readFetch(input.fetch)(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      search_depth: "basic",
      max_results: clampInteger(input.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_SEARCH_RESULTS),
      include_answer: false,
      include_raw_content: false,
      include_favicon: true,
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.timeRange ? { time_range: input.timeRange } : {}),
      ...(input.includeDomains?.length ? { include_domains: input.includeDomains } : {}),
      ...(input.excludeDomains?.length ? { exclude_domains: input.excludeDomains } : {}),
    }),
  });
  const data = await parseJsonObject(response, "Tavily");
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    provider: "tavily",
    results: results.flatMap((result, index) => normalizeTavilySearchResult(result, index)),
    ...(typeof data.request_id === "string" ? { requestId: data.request_id } : {}),
  };
}

export async function searchSerpApi(input: SearchProviderInput): Promise<ProviderSearchOutput> {
  const url = new URL(SERPAPI_SEARCH_URL);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", input.query);
  url.searchParams.set("api_key", input.apiKey);
  url.searchParams.set("output", "json");
  url.searchParams.set("num", String(clampInteger(input.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_SEARCH_RESULTS)));

  const response = await readFetch(input.fetch)(url);
  const data = await parseJsonObject(response, "SerpApi");
  const results = Array.isArray(data.organic_results) ? data.organic_results : [];
  const requestId = readNestedString(data, ["search_metadata", "id"]);
  return {
    provider: "serpapi",
    results: results.flatMap((result, index) => normalizeSerpApiSearchResult(result, index)),
    ...(requestId ? { requestId } : {}),
  };
}

export async function extractTavily(input: ExtractProviderInput): Promise<TavilyExtractOutput> {
  const maxChars = clampInteger(input.maxChars, DEFAULT_MAX_FETCH_CHARS, 1, MAX_FETCH_CHARS);
  const response = await readFetch(input.fetch)(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: input.url,
      extract_depth: "basic",
      format: "markdown",
      include_images: false,
      include_favicon: false,
      ...(input.query ? { query: input.query, chunks_per_source: 3 } : {}),
    }),
  });
  const data = await parseJsonObject(response, "Tavily");
  const firstResult = Array.isArray(data.results) ? data.results[0] : undefined;
  if (!firstResult || typeof firstResult !== "object") {
    throw new Error("Tavily extract returned no content");
  }
  const rawContent = typeof (firstResult as { raw_content?: unknown }).raw_content === "string"
    ? (firstResult as { raw_content: string }).raw_content
    : "";
  const content = rawContent.slice(0, maxChars);
  return {
    url: typeof (firstResult as { url?: unknown }).url === "string"
      ? (firstResult as { url: string }).url
      : input.url,
    content,
    format: "markdown",
    truncated: rawContent.length > content.length,
    byteCount: Buffer.byteLength(rawContent),
    ...(typeof data.request_id === "string" ? { requestId: data.request_id } : {}),
  };
}

function normalizeTavilySearchResult(result: unknown, index: number): ProviderSearchResult[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const record = result as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.url !== "string") {
    return [];
  }
  return [{
    title: record.title,
    url: record.url,
    snippet: typeof record.content === "string" ? record.content : "",
    provider: "tavily",
    rank: index + 1,
    ...(typeof record.score === "number" ? { score: record.score } : {}),
    ...(typeof record.published_date === "string" ? { publishedAt: record.published_date } : {}),
    ...(typeof record.favicon === "string" ? { favicon: record.favicon } : {}),
  }];
}

function normalizeSerpApiSearchResult(result: unknown, index: number): ProviderSearchResult[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const record = result as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.link !== "string") {
    return [];
  }
  return [{
    title: record.title,
    url: record.link,
    snippet: typeof record.snippet === "string" ? record.snippet : "",
    provider: "serpapi",
    rank: index + 1,
  }];
}

async function parseJsonObject(response: Response, providerLabel: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`${providerLabel} request failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") {
    throw new Error(`${providerLabel} returned malformed JSON`);
  }
  return data as Record<string, unknown>;
}

function readFetch(fetchImpl: FetchLike | undefined): FetchLike {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Number(value)));
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = record;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}
