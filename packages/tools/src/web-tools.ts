import type { WebSearchCoverage } from "@story-forge/shared";
import type { ToolDefinition } from "./tool-registry";
import {
  extractTavily,
  type FetchLike,
  type ProviderSearchOutput,
  type ProviderSearchResult,
  searchSerpApi,
  searchTavily,
  type WebProviderName,
} from "./web-search-providers";
import { assertPublicWebUrl, canonicalizeUrl } from "./web-url-policy";

export type WebToolsOptions = {
  enabled: boolean;
  coverage: WebSearchCoverage;
  credentials: {
    tavilyApiKey?: string | undefined;
    serpApiKey?: string | undefined;
  };
  fetch?: FetchLike | undefined;
};

export type WebSearchOutput = {
  query: string;
  coverage: WebSearchCoverage;
  results: WebSearchResult[];
  warnings: string[];
  providerDiagnostics: WebProviderDiagnostic[];
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  providers: WebProviderName[];
  providerRanks: Partial<Record<WebProviderName, number>>;
  score?: number;
  publishedAt?: string;
  favicon?: string;
};

export type WebProviderDiagnostic = {
  provider: WebProviderName;
  ok: boolean;
  resultCount?: number;
  requestId?: string;
  error?: string;
};

export type WebFetchOutput = {
  url: string;
  content: string;
  format: "markdown" | "text";
  truncated: boolean;
  byteCount: number;
  warnings: string[];
  providerDiagnostics: {
    provider: "tavily";
    ok: boolean;
    requestId?: string;
    error?: string;
  };
};

type WebSearchInput = {
  query: string;
  maxResults?: number;
  topic?: "general" | "news" | "finance";
  timeRange?: "day" | "week" | "month" | "year";
  includeDomains?: string[];
  excludeDomains?: string[];
};

type WebFetchInput = {
  url: string;
  query?: string;
  maxChars?: number;
};

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;

export function createWebTools(options: WebToolsOptions): ToolDefinition[] {
  if (!options.enabled) {
    return [];
  }
  return [
    createWebSearchTool(options),
    createWebFetchTool(options),
  ];
}

function createWebSearchTool(options: WebToolsOptions): ToolDefinition {
  return {
    name: "web.search",
    description: "Search the live web for current or external information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
        maxResults: {
          type: "number",
          description: "Maximum merged results to return, from 1 to 10.",
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance"],
          description: "Optional search topic.",
        },
        timeRange: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Optional recency range.",
        },
        includeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to include when supported.",
        },
        excludeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to exclude when supported.",
        },
      },
      required: ["query"],
    },
    execute: async (rawInput) => {
      const input = readSearchInput(rawInput);
      return runWebSearch(options, input);
    },
  };
}

function createWebFetchTool(options: WebToolsOptions): ToolDefinition {
  return {
    name: "web.fetch",
    description: "Extract readable content from a public URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public http(s) URL to extract.",
        },
        query: {
          type: "string",
          description: "Optional intent to focus extracted chunks.",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return.",
        },
      },
      required: ["url"],
    },
    execute: async (rawInput) => {
      const input = readFetchInput(rawInput);
      assertPublicWebUrl(input.url);
      const apiKey = options.credentials.tavilyApiKey;
      if (!apiKey) {
        throw new Error("Tavily API key is not configured. Set Tavily_API_KEY before using web.fetch.");
      }
      const output = await extractTavily({
        apiKey,
        url: input.url,
        ...(input.query ? { query: input.query } : {}),
        ...(input.maxChars ? { maxChars: input.maxChars } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      return {
        url: output.url,
        content: output.content,
        format: output.format,
        truncated: output.truncated,
        byteCount: output.byteCount,
        warnings: [],
        providerDiagnostics: {
          provider: "tavily",
          ok: true,
          ...(output.requestId ? { requestId: output.requestId } : {}),
        },
      } satisfies WebFetchOutput;
    },
  };
}

async function runWebSearch(
  options: WebToolsOptions,
  input: WebSearchInput,
): Promise<WebSearchOutput> {
  const warnings: string[] = [];
  const tasks: Array<{
    provider: WebProviderName;
    run: () => Promise<ProviderSearchOutput>;
  }> = [];

  if (options.credentials.tavilyApiKey) {
    tasks.push({
      provider: "tavily",
      run: () => searchTavily({
        apiKey: options.credentials.tavilyApiKey!,
        query: input.query,
        maxResults: input.maxResults,
        ...(input.topic ? { topic: input.topic } : {}),
        ...(input.timeRange ? { timeRange: input.timeRange } : {}),
        ...(input.includeDomains ? { includeDomains: input.includeDomains } : {}),
        ...(input.excludeDomains ? { excludeDomains: input.excludeDomains } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
    });
  } else {
    warnings.push("Tavily API key is not configured. Set Tavily_API_KEY before using web.search.");
  }

  if (options.coverage === "wide") {
    if (options.credentials.serpApiKey) {
      tasks.push({
        provider: "serpapi",
        run: () => searchSerpApi({
          apiKey: options.credentials.serpApiKey!,
          query: input.query,
          maxResults: input.maxResults,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
      });
    } else {
      warnings.push("SerpApi API key is not configured. Wide search will continue without SerpApi.");
    }
  }

  if (tasks.length === 0) {
    throw new Error("No web search provider API keys are configured. Set Tavily_API_KEY or SerpApi_API_KEY before using web.search.");
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const diagnostics: WebProviderDiagnostic[] = [];
  const providerOutputs: ProviderSearchOutput[] = [];
  settled.forEach((result, index) => {
    const provider = tasks[index]?.provider;
    if (!provider) {
      return;
    }
    if (result.status === "fulfilled") {
      providerOutputs.push(result.value);
      diagnostics.push({
        provider,
        ok: true,
        resultCount: result.value.results.length,
        ...(result.value.requestId ? { requestId: result.value.requestId } : {}),
      });
      return;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    warnings.push(`${provider} search failed: ${message}`);
    diagnostics.push({ provider, ok: false, error: message });
  });

  if (providerOutputs.length === 0) {
    throw new Error(warnings.at(-1) ?? "All web search providers failed.");
  }

  return {
    query: input.query,
    coverage: options.coverage,
    results: mergeSearchResults(providerOutputs, warnings)
      .slice(0, clampInteger(input.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS)),
    warnings,
    providerDiagnostics: diagnostics,
  };
}

function mergeSearchResults(
  outputs: ProviderSearchOutput[],
  warnings: string[],
): WebSearchResult[] {
  const merged = new Map<string, WebSearchResult>();
  for (const output of outputs) {
    for (const result of output.results) {
      let url: string;
      try {
        url = canonicalizeUrl(result.url);
      } catch (error) {
        warnings.push(`Skipped unsafe search result from ${output.provider}: ${formatError(error)}`);
        continue;
      }
      const existing = merged.get(url);
      if (!existing) {
        merged.set(url, toMergedResult(result, url));
        continue;
      }
      if (!existing.providers.includes(result.provider)) {
        existing.providers.push(result.provider);
      }
      existing.providerRanks[result.provider] = result.rank;
      if (result.score !== undefined && (existing.score === undefined || result.score > existing.score)) {
        existing.score = result.score;
      }
      if (!existing.favicon && result.favicon) {
        existing.favicon = result.favicon;
      }
      if (!existing.publishedAt && result.publishedAt) {
        existing.publishedAt = result.publishedAt;
      }
    }
  }

  return [...merged.values()].sort((left, right) => {
    const providerDelta = right.providers.length - left.providers.length;
    if (providerDelta !== 0) {
      return providerDelta;
    }
    return bestRank(left) - bestRank(right);
  });
}

function toMergedResult(result: ProviderSearchResult, url: string): WebSearchResult {
  return {
    title: result.title,
    url,
    snippet: result.snippet,
    providers: [result.provider],
    providerRanks: { [result.provider]: result.rank },
    ...(result.score !== undefined ? { score: result.score } : {}),
    ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
  };
}

function bestRank(result: WebSearchResult): number {
  const ranks = Object.values(result.providerRanks).filter((rank): rank is number =>
    typeof rank === "number"
  );
  return ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
}

function readSearchInput(input: Record<string, unknown>): WebSearchInput {
  const query = readRequiredString(input.query, "web.search", "query");
  return {
    query,
    ...(input.maxResults !== undefined ? { maxResults: readOptionalInteger(input.maxResults, "web.search", "maxResults") } : {}),
    ...(input.topic !== undefined ? { topic: readEnum(input.topic, "web.search", "topic", ["general", "news", "finance"]) } : {}),
    ...(input.timeRange !== undefined ? { timeRange: readEnum(input.timeRange, "web.search", "timeRange", ["day", "week", "month", "year"]) } : {}),
    ...(input.includeDomains !== undefined ? { includeDomains: readStringArray(input.includeDomains, "web.search", "includeDomains") } : {}),
    ...(input.excludeDomains !== undefined ? { excludeDomains: readStringArray(input.excludeDomains, "web.search", "excludeDomains") } : {}),
  };
}

function readFetchInput(input: Record<string, unknown>): WebFetchInput {
  return {
    url: readRequiredString(input.url, "web.fetch", "url"),
    ...(input.query !== undefined ? { query: readRequiredString(input.query, "web.fetch", "query") } : {}),
    ...(input.maxChars !== undefined ? { maxChars: readOptionalInteger(input.maxChars, "web.fetch", "maxChars") } : {}),
  };
}

function readRequiredString(value: unknown, toolName: string, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${toolName} requires string ${fieldName}`);
  }
  if (!value.trim()) {
    throw new Error(`${toolName} requires non-empty ${fieldName}`);
  }
  return value;
}

function readOptionalInteger(value: unknown, toolName: string, fieldName: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${toolName} requires integer ${fieldName}`);
  }
  return Number(value);
}

function readStringArray(value: unknown, toolName: string, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${toolName} requires string array ${fieldName}`);
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  toolName: string,
  fieldName: string,
  values: T[],
): T {
  if (typeof value === "string" && values.includes(value as T)) {
    return value as T;
  }
  throw new Error(`${toolName} requires valid ${fieldName}`);
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
