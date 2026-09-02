import { describe, expect, it } from "vitest";
import {
  createAgentReportCollector,
  MAX_AGENT_REPORT_BYTES,
  normalizeAndLimitAgentReport,
  readAgentReport,
} from "../subagents/agent-report-tool";

const validReport = {
  summary: "Mapped the runtime",
  findings: ["The root owns user interaction"],
  evidence: [{ path: "packages/agent/src/index.ts", line: 1, detail: "Exports runtime" }],
  filesInspected: ["packages/agent/src/index.ts"],
  unresolved: [],
};

describe("agent_report", () => {
  it("normalizes evidence and stores the latest valid report", () => {
    const collector = createAgentReportCollector();
    expect(collector.tool.execute(validReport, {})).toEqual({
      accepted: true,
      truncated: false,
    });
    expect(collector.getLatest()).toEqual({ report: validReport, truncated: false });
  });

  it("rejects malformed evidence and paths outside the workspace", () => {
    expect(() => readAgentReport({ ...validReport, evidence: [{ detail: "x", line: 0 }] }))
      .toThrow("line must be a positive integer");
    expect(() => readAgentReport({ ...validReport, filesInspected: ["../secret"] }))
      .toThrow("workspace-relative");
    expect(() => readAgentReport({ ...validReport, cwd: "/tmp" }))
      .toThrow("unsupported field: cwd");
  });

  it("deterministically caps the serialized report at 16 KiB", () => {
    const oversized = {
      ...validReport,
      summary: "中".repeat(10_000),
      findings: Array.from({ length: 32 }, (_, index) => `${index}:${"x".repeat(2_000)}`),
      unresolved: Array.from({ length: 32 }, () => "y".repeat(2_000)),
    };
    const first = normalizeAndLimitAgentReport(oversized);
    const second = normalizeAndLimitAgentReport(oversized);

    expect(first).toEqual(second);
    expect(first.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first.report), "utf8"))
      .toBeLessThanOrEqual(MAX_AGENT_REPORT_BYTES);
  });
});
