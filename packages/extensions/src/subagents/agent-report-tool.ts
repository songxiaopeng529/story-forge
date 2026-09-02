import { isRecord, type AgentEvidence, type AgentReport } from "@story-forge/shared";
import type { ToolDefinition } from "../tool-definition";

export const AGENT_REPORT_TOOL_NAME = "agent_report";
export const MAX_AGENT_REPORT_BYTES = 16 * 1024;

export type AgentReportSubmission = {
  report: AgentReport;
  truncated: boolean;
};

export type AgentReportCollector = {
  tool: ToolDefinition<Record<string, unknown>, { accepted: true; truncated: boolean }>;
  getLatest(): AgentReportSubmission | undefined;
};

export function createAgentReportCollector(options: {
  maxBytes?: number;
} = {}): AgentReportCollector {
  const maxBytes = options.maxBytes ?? MAX_AGENT_REPORT_BYTES;
  let latest: AgentReportSubmission | undefined;
  return {
    tool: {
      name: AGENT_REPORT_TOOL_NAME,
      description:
        "Submit the final structured result of this delegated task to the StoryForge root agent.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "findings", "evidence", "filesInspected", "unresolved"],
        properties: {
          summary: { type: "string", minLength: 1 },
          findings: { type: "array", items: { type: "string" } },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["detail"],
              properties: {
                path: { type: "string" },
                line: { type: "integer", minimum: 1 },
                detail: { type: "string", minLength: 1 },
              },
            },
          },
          filesInspected: { type: "array", items: { type: "string" } },
          unresolved: { type: "array", items: { type: "string" } },
        },
      },
      execute: (input) => {
        latest = normalizeAndLimitAgentReport(input, maxBytes);
        return { accepted: true, truncated: latest.truncated };
      },
    },
    getLatest: () => latest,
  };
}

export function normalizeAndLimitAgentReport(
  value: unknown,
  maxBytes = MAX_AGENT_REPORT_BYTES,
): AgentReportSubmission {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 512) {
    throw new Error("agent_report byte limit must be an integer of at least 512");
  }
  const normalized = readAgentReport(value);
  let truncated = false;
  const report: AgentReport = {
    summary: truncateField(normalized.summary, 2_048),
    findings: normalized.findings.slice(0, 32).map((item) => truncateField(item, 1_024)),
    evidence: normalized.evidence.slice(0, 32).map((entry) => ({
      ...(entry.path ? { path: truncateField(entry.path, 512) } : {}),
      ...(entry.line ? { line: entry.line } : {}),
      detail: truncateField(entry.detail, 1_024),
    })),
    filesInspected: normalized.filesInspected
      .slice(0, 64)
      .map((item) => truncateField(item, 512)),
    unresolved: normalized.unresolved
      .slice(0, 32)
      .map((item) => truncateField(item, 1_024)),
  };
  truncated = JSON.stringify(report) !== JSON.stringify(normalized);

  const removalOrder = [
    "unresolved",
    "filesInspected",
    "evidence",
    "findings",
  ] as const;
  while (byteLength(report) > maxBytes) {
    const field = removalOrder.find((candidate) => report[candidate].length > 0);
    if (field) {
      report[field].pop();
      truncated = true;
      continue;
    }
    const currentBytes = Buffer.byteLength(report.summary, "utf8");
    if (currentBytes === 0) {
      throw new Error("agent_report byte limit is too small for the report envelope");
    }
    report.summary = truncateUtf8(report.summary, Math.max(0, currentBytes - 256));
    truncated = true;
  }
  return { report, truncated };
}

export function readAgentReport(value: unknown): AgentReport {
  if (!isRecord(value)) {
    throw new Error("agent_report requires an object input");
  }
  assertOnlyKeys(value, [
    "summary",
    "findings",
    "evidence",
    "filesInspected",
    "unresolved",
  ]);
  return {
    summary: readString(value.summary, "summary"),
    findings: readStringArray(value.findings, "findings", 128),
    evidence: readEvidence(value.evidence),
    filesInspected: readPathArray(value.filesInspected, "filesInspected", 256),
    unresolved: readStringArray(value.unresolved, "unresolved", 128),
  };
}

function readEvidence(value: unknown): AgentEvidence[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("agent_report evidence must be an array of at most 128 items");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`agent_report evidence ${index + 1} must be an object`);
    }
    assertOnlyKeys(item, ["path", "line", "detail"], `evidence ${index + 1}`);
    const path = item.path === undefined
      ? undefined
      : readRelativePath(item.path, `evidence ${index + 1} path`);
    if (item.line !== undefined && (!Number.isSafeInteger(item.line) || Number(item.line) < 1)) {
      throw new Error(`agent_report evidence ${index + 1} line must be a positive integer`);
    }
    return {
      ...(path ? { path } : {}),
      ...(typeof item.line === "number" ? { line: item.line } : {}),
      detail: readString(item.detail, `evidence ${index + 1} detail`),
    };
  });
}

function readPathArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`agent_report ${field} must be an array of at most ${maxItems} items`);
  }
  return value.map((item, index) => readRelativePath(item, `${field} item ${index + 1}`));
}

function readRelativePath(value: unknown, label: string): string {
  const string = readString(value, label).replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = string.split("/").filter((segment) => segment && segment !== ".");
  if (
    string.startsWith("/")
    || /^[A-Za-z]:\//.test(string)
    || segments.includes("..")
    || string.includes("\0")
    || segments.length === 0
  ) {
    throw new Error(`agent_report ${label} must be workspace-relative`);
  }
  return segments.join("/");
}

function readStringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`agent_report ${field} must be an array of at most ${maxItems} items`);
  }
  return value.map((item, index) => readString(item, `${field} item ${index + 1}`));
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`agent_report ${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label = "input",
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) {
    throw new Error(`agent_report ${label} contains unsupported field: ${unknown}`);
  }
}

function truncateField(value: string, maxBytes: number): string {
  return Buffer.byteLength(value, "utf8") <= maxBytes ? value : truncateUtf8(value, maxBytes);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (maxBytes <= suffixBytes) {
    return "";
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, mid);
    if (Buffer.byteLength(candidate, "utf8") + suffixBytes <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${suffix}`;
}

function byteLength(report: AgentReport): number {
  return Buffer.byteLength(JSON.stringify(report), "utf8");
}
